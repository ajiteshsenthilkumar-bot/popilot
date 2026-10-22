// Google Sheet as the database, reached through a small Apps Script "bridge" that lives inside the sheet
// (see apps-script/Code.gs). No Google Cloud key needed: every request carries a secret token instead.
// Two tabs: "POs" (the board) and "Updates" (every parsed message).
import { ITEMS, type Item, type PO, type UpdateRow } from "./types";

export const PO_TAB = "POs";
export const UPDATES_TAB = "Updates";

export const PO_HEADERS = [
  "po_id", "sku", "product", "qty",
  ...ITEMS.flatMap((i) => [`${i}_vendor`, `${i}_eta`, `${i}_status`]),
];

export const UPDATE_HEADERS = [
  "id", "timestamp", "original_text", "source", "vendor", "po_id", "item",
  "eta_expression", "old_eta", "new_eta", "confidence", "status", "reason",
];

export function sheetsConfigured(): boolean {
  return Boolean(process.env.SHEETS_BRIDGE_URL && process.env.SHEETS_BRIDGE_TOKEN);
}

async function callOnce(action: string, payload: Record<string, unknown>): Promise<any> {
  const res = await fetch(process.env.SHEETS_BRIDGE_URL as string, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ token: process.env.SHEETS_BRIDGE_TOKEN, action, ...payload }),
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(
      "The Google Sheet bridge didn't answer properly. Check SHEETS_BRIDGE_URL, and that the web app is deployed with access set to Anyone.",
    );
  }
  if (!data.ok) throw new Error(`Google Sheet bridge: ${data.error}`);
  return data;
}

// The bridge (Apps Script) is occasionally slow or flaky. Retry actions that are safe to repeat.
// "append" is never retried: a repeat could add the same row twice.
async function call(action: string, payload: Record<string, unknown> = {}): Promise<any> {
  const attempts = action === "append" ? 1 : 3;
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await callOnce(action, payload);
    } catch (e) {
      lastErr = e;
      if (/unauthorized|unknown (tab|action)/.test((e as Error).message)) break; // retrying can't fix these
      if (i < attempts) await new Promise((r) => setTimeout(r, 800 * i));
    }
  }
  throw lastErr;
}

// Create the two tabs and header rows if they don't exist yet.
export async function ensureTabs(): Promise<void> {
  await call("ensure", { headers: { [PO_TAB]: PO_HEADERS, [UPDATES_TAB]: UPDATE_HEADERS } });
}

function poToRow(po: PO): (string | number)[] {
  return [
    po.po_id, po.sku, po.product, po.qty,
    ...ITEMS.flatMap((i) => [po.inputs[i].vendor, po.inputs[i].eta, po.inputs[i].status]),
  ];
}

function rowToPo(r: string[]): PO {
  const inputs = {} as PO["inputs"];
  ITEMS.forEach((item, k) => {
    const base = 4 + k * 3;
    inputs[item] = {
      vendor: r[base] ?? "",
      eta: r[base + 1] ?? "",
      status: r[base + 2] === "delivered" ? "delivered" : "open",
    };
  });
  return { po_id: r[0], sku: r[1], product: r[2], qty: Number(r[3]) || 0, inputs };
}

export async function sheetGetPOs(): Promise<PO[]> {
  const { values } = await call("read", { tab: PO_TAB });
  return (values as string[][]).filter((r) => r[0]).map(rowToPo);
}

export async function sheetReplacePOs(pos: PO[]): Promise<void> {
  await call("replace", { tab: PO_TAB, rows: pos.map(poToRow) });
}

// Change one ETA cell (and nothing else) on the board.
export async function sheetSetEta(po_id: string, item: Item, eta: string): Promise<boolean> {
  const col = PO_HEADERS.indexOf(`${item}_eta`) + 1;
  const { found } = await call("setCell", { tab: PO_TAB, key: po_id, col, value: eta });
  return Boolean(found);
}

function updateToRow(u: UpdateRow): (string | number)[] {
  return [
    u.id, u.timestamp, u.original_text, u.source, u.vendor, u.po_id, u.item,
    u.eta_expression, u.old_eta, u.new_eta, u.confidence, u.status, u.reason,
  ];
}

function rowToUpdate(r: string[]): UpdateRow {
  return {
    id: r[0], timestamp: r[1], original_text: r[2], source: r[3] === "voice" ? "voice" : "text",
    vendor: r[4] ?? "", po_id: r[5] ?? "", item: r[6] ?? "", eta_expression: r[7] ?? "",
    old_eta: r[8] ?? "", new_eta: r[9] ?? "", confidence: Number(r[10]) || 0,
    status: (r[11] as UpdateRow["status"]) || "needs_review", reason: r[12] ?? "",
  };
}

export async function sheetAppendUpdate(u: UpdateRow): Promise<void> {
  await call("append", { tab: UPDATES_TAB, row: updateToRow(u) });
}

export async function sheetGetUpdates(): Promise<UpdateRow[]> {
  const { values } = await call("read", { tab: UPDATES_TAB });
  return (values as string[][]).filter((r) => r[0]).map(rowToUpdate);
}

// Wipe the message log (header row stays). Used only by `npm run seed -- --clear-log`.
export async function sheetClearUpdates(): Promise<void> {
  await call("replace", { tab: UPDATES_TAB, rows: [] });
}

export async function sheetSaveUpdate(u: UpdateRow): Promise<boolean> {
  const { found } = await call("replaceRow", { tab: UPDATES_TAB, key: u.id, row: updateToRow(u) });
  return Boolean(found);
}
