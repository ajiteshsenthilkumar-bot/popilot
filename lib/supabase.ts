// Supabase (Postgres) as the database, talked to over its plain REST API with the server-side key.
// Same jobs as lib/sheets.ts, same shapes, so lib/store.ts can use either. Tables: pos, updates, alerts
// (create them once with supabase/schema.sql). The key lives only in env vars and is never sent to the browser.
import { ITEMS, type Item, type PO, type UpdateRow } from "./types";

export function supabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);
}

type Row = Record<string, any>;

async function call(method: string, path: string, opts: { body?: unknown; prefer?: string } = {}): Promise<any> {
  const base = (process.env.SUPABASE_URL as string).replace(/\/+$/, "");
  const key = process.env.SUPABASE_SERVICE_KEY as string;
  // reads and idempotent writes are retried; a plain insert is not, so a repeat can't add a row twice
  const attempts = method === "POST" && !/on_conflict/.test(path) ? 1 : 3;
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(`${base}/rest/v1/${path}`, {
        method,
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          ...(opts.prefer ? { Prefer: opts.prefer } : {}),
        },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(20_000),
      });
      const text = await res.text();
      if (!res.ok) {
        let msg = text;
        try { msg = JSON.parse(text).message ?? text; } catch { /* keep the raw text */ }
        // never include the key or the full URL
        const err = new Error(`Supabase ${res.status}: ${String(msg).slice(0, 200)}`);
        if (res.status < 500) { (err as any).final = true; throw err; } // retrying a 4xx can't fix it
        throw err;
      }
      return text ? JSON.parse(text) : null;
    } catch (e) {
      lastErr = e;
      if ((e as any).final) break;
      if (i < attempts) await new Promise((r) => setTimeout(r, 600 * i));
    }
  }
  throw lastErr;
}

const q = (v: string) => encodeURIComponent(v);

// ---- POs ----

function poToRow(po: PO): Row {
  const r: Row = { po_id: po.po_id, sku: po.sku, product: po.product, qty: po.qty };
  for (const i of ITEMS) {
    r[`${i}_vendor`] = po.inputs[i].vendor;
    r[`${i}_eta`] = po.inputs[i].eta;
    r[`${i}_status`] = po.inputs[i].status;
  }
  return r;
}

function rowToPo(r: Row): PO {
  const inputs = {} as PO["inputs"];
  for (const i of ITEMS) {
    inputs[i] = {
      vendor: String(r[`${i}_vendor`] ?? "").trim(),
      eta: String(r[`${i}_eta`] ?? "").trim(),
      status: String(r[`${i}_status`] ?? "").trim().toLowerCase() === "delivered" ? "delivered" : "open",
    };
  }
  return { po_id: String(r.po_id).trim(), sku: String(r.sku ?? "").trim(), product: String(r.product ?? "").trim(), qty: Number(r.qty) || 0, inputs };
}

export async function dbGetPOs(): Promise<PO[]> {
  const rows: Row[] = await call("GET", "pos?select=*&order=seq.asc");
  return rows.map(rowToPo);
}

export async function dbAddPO(po: PO): Promise<void> {
  await call("POST", "pos", { body: poToRow(po), prefer: "return=minimal" }); // a duplicate PO id is refused by the table
}

// Make the table hold exactly these POs: update/insert each, then delete any other.
export async function dbReplacePOs(pos: PO[]): Promise<void> {
  if (pos.length) await call("POST", "pos?on_conflict=po_id", { body: pos.map(poToRow), prefer: "resolution=merge-duplicates,return=minimal" });
  const keep = pos.map((p) => `"${p.po_id.replace(/"/g, "")}"`).join(",");
  await call("DELETE", pos.length ? `pos?po_id=not.in.(${q(keep)})` : "pos?po_id=neq.", { prefer: "return=minimal" });
}

export async function dbSetPOField(po_id: string, item: Item, field: "vendor" | "eta" | "status", value: string): Promise<boolean> {
  const rows = await call("PATCH", `pos?po_id=eq.${q(po_id)}`, { body: { [`${item}_${field}`]: value }, prefer: "return=representation" });
  return Array.isArray(rows) && rows.length > 0;
}

// ---- Updates (the message log) ----

function updateToRow(u: UpdateRow): Row {
  return {
    id: u.id, timestamp: u.timestamp, original_text: u.original_text, source: u.source, vendor: u.vendor, po_id: u.po_id,
    item: u.item, eta_expression: u.eta_expression, old_eta: u.old_eta, new_eta: u.new_eta, confidence: u.confidence,
    status: u.status, reason: u.reason,
  };
}

function rowToUpdate(r: Row): UpdateRow {
  return {
    id: r.id, timestamp: r.timestamp ?? "", original_text: r.original_text ?? "", source: r.source === "voice" ? "voice" : "text",
    vendor: r.vendor ?? "", po_id: r.po_id ?? "", item: r.item ?? "", eta_expression: r.eta_expression ?? "",
    old_eta: r.old_eta ?? "", new_eta: r.new_eta ?? "", confidence: Number(r.confidence) || 0,
    status: (r.status as UpdateRow["status"]) || "needs_review", reason: r.reason ?? "",
  };
}

export async function dbAppendUpdate(u: UpdateRow): Promise<void> {
  await call("POST", "updates", { body: updateToRow(u), prefer: "return=minimal" });
}

export async function dbGetUpdates(): Promise<UpdateRow[]> {
  const rows: Row[] = await call("GET", "updates?select=*&order=seq.asc");
  return rows.map(rowToUpdate);
}

export async function dbSaveUpdate(u: UpdateRow): Promise<boolean> {
  const rows = await call("PATCH", `updates?id=eq.${q(u.id)}`, { body: updateToRow(u), prefer: "return=representation" });
  return Array.isArray(rows) && rows.length > 0;
}

export async function dbDeleteUpdate(id: string): Promise<boolean> {
  const rows = await call("DELETE", `updates?id=eq.${q(id)}`, { prefer: "return=representation" });
  return Array.isArray(rows) && rows.length > 0;
}

export async function dbClearUpdates(): Promise<void> {
  await call("DELETE", "updates?id=neq.", { prefer: "return=minimal" });
}

// ---- Alerts memory: what the owner has already been told (po_id -> gap, 0 = no open risk) ----

export async function dbGetAlertState(): Promise<Record<string, number>> {
  const rows: Row[] = await call("GET", "alerts?select=po_id,alerted_gap");
  const out: Record<string, number> = {};
  for (const r of rows) out[r.po_id] = Number(r.alerted_gap) || 0;
  return out;
}

export async function dbSetAlertState(po_id: string, gap: number): Promise<void> {
  await call("POST", "alerts?on_conflict=po_id", {
    body: { po_id, alerted_gap: gap, alerted_at: new Date().toISOString() },
    prefer: "resolution=merge-duplicates,return=minimal",
  });
}

export async function dbClearAlertState(): Promise<void> {
  await call("DELETE", "alerts?po_id=neq.", { prefer: "return=minimal" });
}
