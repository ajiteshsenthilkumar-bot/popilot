// Google Sheets as the database. Two tabs: "POs" (the board) and "Updates" (every parsed message).
import { google } from "googleapis";
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
  return Boolean(
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY && process.env.GOOGLE_SHEET_ID,
  );
}

function client() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY ?? "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

const id = () => process.env.GOOGLE_SHEET_ID as string;

// column letter for a 1-based index (1 -> A)
function col(n: number): string {
  let s = "";
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// Create the two tabs and header rows if they don't exist yet.
export async function ensureTabs(): Promise<void> {
  const api = client();
  const meta = await api.spreadsheets.get({ spreadsheetId: id() });
  const have = new Set(meta.data.sheets?.map((s) => s.properties?.title));
  const missing = [PO_TAB, UPDATES_TAB].filter((t) => !have.has(t));
  if (missing.length) {
    await api.spreadsheets.batchUpdate({
      spreadsheetId: id(),
      requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) },
    });
  }
  for (const [tab, headers] of [[PO_TAB, PO_HEADERS], [UPDATES_TAB, UPDATE_HEADERS]] as const) {
    const first = await api.spreadsheets.values.get({ spreadsheetId: id(), range: `${tab}!A1:A1` });
    if (!first.data.values?.length) {
      await api.spreadsheets.values.update({
        spreadsheetId: id(),
        range: `${tab}!A1`,
        valueInputOption: "RAW",
        requestBody: { values: [headers] },
      });
    }
  }
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
  const res = await client().spreadsheets.values.get({
    spreadsheetId: id(),
    range: `${PO_TAB}!A2:${col(PO_HEADERS.length)}`,
  });
  return (res.data.values ?? []).filter((r) => r[0]).map(rowToPo);
}

export async function sheetReplacePOs(pos: PO[]): Promise<void> {
  const api = client();
  await api.spreadsheets.values.clear({ spreadsheetId: id(), range: `${PO_TAB}!A2:${col(PO_HEADERS.length)}` });
  if (!pos.length) return;
  await api.spreadsheets.values.update({
    spreadsheetId: id(),
    range: `${PO_TAB}!A2`,
    valueInputOption: "RAW",
    requestBody: { values: pos.map(poToRow) },
  });
}

// Change one ETA cell (and nothing else) on the board.
export async function sheetSetEta(po_id: string, item: Item, eta: string): Promise<boolean> {
  const api = client();
  const ids = await api.spreadsheets.values.get({ spreadsheetId: id(), range: `${PO_TAB}!A2:A` });
  const idx = (ids.data.values ?? []).findIndex((r) => r[0] === po_id);
  if (idx === -1) return false;
  const column = col(PO_HEADERS.indexOf(`${item}_eta`) + 1);
  await api.spreadsheets.values.update({
    spreadsheetId: id(),
    range: `${PO_TAB}!${column}${idx + 2}`,
    valueInputOption: "RAW",
    requestBody: { values: [[eta]] },
  });
  return true;
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
  await client().spreadsheets.values.append({
    spreadsheetId: id(),
    range: `${UPDATES_TAB}!A1`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: [updateToRow(u)] },
  });
}

export async function sheetGetUpdates(): Promise<UpdateRow[]> {
  const res = await client().spreadsheets.values.get({
    spreadsheetId: id(),
    range: `${UPDATES_TAB}!A2:${col(UPDATE_HEADERS.length)}`,
  });
  return (res.data.values ?? []).filter((r) => r[0]).map(rowToUpdate);
}

export async function sheetSaveUpdate(u: UpdateRow): Promise<boolean> {
  const api = client();
  const ids = await api.spreadsheets.values.get({ spreadsheetId: id(), range: `${UPDATES_TAB}!A2:A` });
  const idx = (ids.data.values ?? []).findIndex((r) => r[0] === u.id);
  if (idx === -1) return false;
  await api.spreadsheets.values.update({
    spreadsheetId: id(),
    range: `${UPDATES_TAB}!A${idx + 2}`,
    valueInputOption: "RAW",
    requestBody: { values: [updateToRow(u)] },
  });
  return true;
}
