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

// The real database (the Google Sheet).
// Returns null in automated tests (they use the in-memory copy). Throws a plain-English error if neither is set up.
interface Backend {
  getPOs(): Promise<PO[]>;
  setPOField(po_id: string, item: Item, field: "vendor" | "eta" | "status", value: string): Promise<boolean>;
  addPO(po: PO): Promise<void>;
  replacePOs(pos: PO[]): Promise<void>;
  appendUpdate(u: UpdateRow): Promise<void>;
  getUpdates(): Promise<UpdateRow[]>;
  saveUpdate(u: UpdateRow): Promise<boolean>;
  deleteUpdate(id: string): Promise<boolean>;
  getAlertState(): Promise<Record<string, number>>;
  setAlertState(po_id: string, gap: number): Promise<void>;
}

const sheetBackend: Backend = {
  getPOs: sheets.sheetGetPOs, setPOField: sheets.sheetSetPOField, addPO: sheets.sheetAddPO, replacePOs: sheets.sheetReplacePOs,
  appendUpdate: sheets.sheetAppendUpdate, getUpdates: sheets.sheetGetUpdates, saveUpdate: sheets.sheetSaveUpdate, deleteUpdate: sheets.sheetDeleteUpdate,
  getAlertState: sheets.sheetGetAlertState, setAlertState: sheets.sheetSetAlertState,
};

function backend(): Backend | null {
  if (testMode()) return null;
  if (sheets.sheetsConfigured()) return sheetBackend;
  throw new Error(
    "Google Sheets isn't connected yet. Fill in SHEETS_BRIDGE_URL and SHEETS_BRIDGE_TOKEN in .env.local and run `npm run seed` (steps are in the README).",
  );
}

export async function getPOs(): Promise<PO[]> {
  const b = backend();
  return b ? b.getPOs() : structuredClone(mem().pos);
}

export async function setEta(po_id: string, item: Item, eta: string): Promise<boolean> {
  const b = backend();
  if (b) return b.setPOField(po_id, item, "eta", eta);
  const po = mem().pos.find((p) => p.po_id === po_id);
  if (!po) return false;
  po.inputs[item].eta = eta;
  return true;
}

export async function addPO(po: PO): Promise<void> {
  const b = backend();
  if (b) return b.addPO(po);
  mem().pos.push(structuredClone(po));
}

export async function replacePOs(pos: PO[]): Promise<void> {
  const b = backend();
  if (b) return b.replacePOs(pos);
  mem().pos = structuredClone(pos);
}

// Change one cell of a PO (an item's vendor, eta or status). Throws if the PO row isn't there.
export async function setPOField(po_id: string, item: Item, field: "vendor" | "eta" | "status", value: string): Promise<void> {
  const b = backend();
  if (b) {
    if (!(await b.setPOField(po_id, item, field, value))) throw new Error(`${po_id} not found in the database`);
    return;
  }
  const po = mem().pos.find((p) => p.po_id === po_id);
  if (!po) throw new Error(`${po_id} not found in the database`);
  (po.inputs[item] as any)[field] = value;
}

export async function appendUpdate(u: UpdateRow): Promise<void> {
  const b = backend();
  if (b) return b.appendUpdate(u);
  mem().updates.push(structuredClone(u));
}

export async function getUpdates(): Promise<UpdateRow[]> {
  const b = backend();
  return b ? b.getUpdates() : structuredClone(mem().updates);
}

// What the owner has already been told about each PO's stock-out risk (po_id -> gap in days, 0 = no open risk)
export async function getAlertState(): Promise<Record<string, number>> {
  const b = backend();
  return b ? b.getAlertState() : { ...mem().alerts };
}

export async function setAlertState(po_id: string, gap: number): Promise<void> {
  const b = backend();
  if (b) return b.setAlertState(po_id, gap);
  mem().alerts[po_id] = gap;
}

export async function deleteUpdate(id: string): Promise<boolean> {
  const b = backend();
  if (b) return b.deleteUpdate(id);
  const i = mem().updates.findIndex((x) => x.id === id);
  if (i === -1) return false;
  mem().updates.splice(i, 1);
  return true;
}

export async function saveUpdate(u: UpdateRow): Promise<boolean> {
  const b = backend();
  if (b) return b.saveUpdate(u);
  const i = mem().updates.findIndex((x) => x.id === u.id);
  if (i === -1) return false;
  mem().updates[i] = structuredClone(u);
  return true;
}