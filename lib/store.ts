// One door to the data: the Google Sheet.
// An in-memory copy exists ONLY for automated tests (NODE_ENV === "test"), never in the running app.
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

const g = globalThis as unknown as { __popilot?: { pos: PO[]; updates: UpdateRow[]; alerts: Record<string, number> } };
function mem() {
  if (!g.__popilot) g.__popilot = { pos: seedPOs(), updates: [], alerts: {} };
  return g.__popilot;
}

const testMode = () => process.env.NODE_ENV === "test";

// Returns true when we should talk to the real sheet. Throws a plain-English error if it isn't set up.
function useSheet(): boolean {
  if (testMode()) return false;
  if (!sheets.sheetsConfigured()) {
    throw new Error(
      "Google Sheets isn't connected yet. Fill in SHEETS_BRIDGE_URL and SHEETS_BRIDGE_TOKEN in .env.local and run `npm run seed` (steps are in the README).",
    );
  }
  return true;
}

export async function getPOs(): Promise<PO[]> {
  return useSheet() ? sheets.sheetGetPOs() : structuredClone(mem().pos);
}

export async function setEta(po_id: string, item: Item, eta: string): Promise<boolean> {
  if (useSheet()) return sheets.sheetSetEta(po_id, item, eta);
  const po = mem().pos.find((p) => p.po_id === po_id);
  if (!po) return false;
  po.inputs[item].eta = eta;
  return true;
}

export async function appendUpdate(u: UpdateRow): Promise<void> {
  if (useSheet()) return sheets.sheetAppendUpdate(u);
  mem().updates.push(structuredClone(u));
}

export async function getUpdates(): Promise<UpdateRow[]> {
  return useSheet() ? sheets.sheetGetUpdates() : structuredClone(mem().updates);
}

// What the owner has already been told about each PO's stock-out risk (po_id -> gap in days, 0 = no open risk)
export async function getAlertState(): Promise<Record<string, number>> {
  return useSheet() ? sheets.sheetGetAlertState() : { ...mem().alerts };
}

export async function setAlertState(po_id: string, gap: number): Promise<void> {
  if (useSheet()) return sheets.sheetSetAlertState(po_id, gap);
  mem().alerts[po_id] = gap;
}

export async function saveUpdate(u: UpdateRow): Promise<boolean> {
  if (useSheet()) return sheets.sheetSaveUpdate(u);
  const i = mem().updates.findIndex((x) => x.id === u.id);
  if (i === -1) return false;
  mem().updates[i] = structuredClone(u);
  return true;
}
