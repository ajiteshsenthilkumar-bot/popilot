// One door to the data. Uses the real Google Sheet when it's configured.
// Otherwise falls back to in-memory demo data (resets on restart) so the app still runs.
import seed from "@/data/seed-pos.json";
import { addDays, todayIST } from "./dates";
import * as sheets from "./sheets";
import { ITEMS, type Item, type PO, type UpdateRow } from "./types";

export function seedPOs(today: string = todayIST()): PO[] {
  return (seed as any[]).map((p) => {
    const inputs = {} as PO["inputs"];
    for (const item of ITEMS) {
      const s = p.inputs[item];
      inputs[item] = { vendor: s.vendor, status: s.status, eta: s.status === "delivered" ? "" : addDays(today, s.eta_in_days) };
    }
    return { po_id: p.po_id, sku: p.sku, product: p.product, qty: p.qty, inputs };
  });
}

const g = globalThis as unknown as { __popilot?: { pos: PO[]; updates: UpdateRow[] } };
function mem() {
  if (!g.__popilot) g.__popilot = { pos: seedPOs(), updates: [] };
  return g.__popilot;
}

export const usingSheet = () => sheets.sheetsConfigured();

export async function getPOs(): Promise<PO[]> {
  return usingSheet() ? sheets.sheetGetPOs() : structuredClone(mem().pos);
}

export async function setEta(po_id: string, item: Item, eta: string): Promise<boolean> {
  if (usingSheet()) return sheets.sheetSetEta(po_id, item, eta);
  const po = mem().pos.find((p) => p.po_id === po_id);
  if (!po) return false;
  po.inputs[item].eta = eta;
  return true;
}

export async function appendUpdate(u: UpdateRow): Promise<void> {
  if (usingSheet()) return sheets.sheetAppendUpdate(u);
  mem().updates.push(u);
}

export async function getUpdates(): Promise<UpdateRow[]> {
  return usingSheet() ? sheets.sheetGetUpdates() : structuredClone(mem().updates);
}

export async function saveUpdate(u: UpdateRow): Promise<boolean> {
  if (usingSheet()) return sheets.sheetSaveUpdate(u);
  const i = mem().updates.findIndex((x) => x.id === u.id);
  if (i === -1) return false;
  mem().updates[i] = u;
  return true;
}
