// The daily stock check. Alerts that follow a PO update can't see a risk that appears because stock dropped or sales
// rose on their own. Once a day this re-checks every PO against fresh Shopify numbers and tells the owner about any
// risk that is NEW or WORSE than what they were last told. Same or better = silence. Never messages vendors.
import { appUrl, notifyOwners, riskGap } from "./alerts";
import { todayIST } from "./dates";
import { assessRisk } from "./risk";
import { findStock, getStockSnapshot, type StockSnapshot } from "./shopify";
import { getAlertState, getPOs, setAlertState } from "./store";
import type { PO, RiskResult } from "./types";

export interface DailyDeps {
  getPOs: () => Promise<PO[]>;
  getStock: () => Promise<StockSnapshot>;
  getState: () => Promise<Record<string, number>>;
  setState: (po_id: string, gap: number) => Promise<void>;
  notify: (text: string) => Promise<boolean>;
}

const defaultDeps: DailyDeps = {
  getPOs,
  getStock: () => getStockSnapshot({ force: true }),
  getState: getAlertState,
  setState: setAlertState,
  notify: (t) => notifyOwners(t),
};

export interface DailyResult {
  status: "ok" | "skipped";
  reason?: string;
  checked: number;
  newRisks: string[]; // po_ids the owner was told about
  stateUpdated: number;
  notified: boolean;
}

export function buildDailyText(risks: RiskResult[], url = appUrl()): string {
  const lines = risks.map((r) => `• ${r.po_id}: ${r.alert}`);
  return [`📉 Daily stock check: ${risks.length} ${risks.length === 1 ? "PO" : "POs"} newly at risk`, "", ...lines, url ? `\nOpen POPilot: ${url}` : ""]
    .join("\n").trim();
}

// Throws if Shopify or the alert memory can't be read: a safety check must never pretend everything is fine.
export async function runStockCheck(deps: DailyDeps = defaultDeps, today: string = todayIST()): Promise<DailyResult> {
  const empty: DailyResult = { status: "ok", checked: 0, newRisks: [], stateUpdated: 0, notified: false };
  // Shopify and the sheet are slow-ish, so ask for everything at once (this keeps the run well under Vercel's time limit)
  const [snap, pos, state] = await Promise.all([deps.getStock(), deps.getPOs(), deps.getState()]);
  if (snap.source === "sample") return { ...empty, status: "skipped", reason: "Shopify isn't connected (sample data), so there is nothing real to check" };
  if (snap.stale) throw new Error(`Shopify didn't answer, so the numbers are out of date (${snap.error ?? "unknown error"})`);
  const judged = pos
    .map((po) => ({ po, stock: findStock(snap.records, po.sku) }))
    .filter((x) => x.stock)
    .map((x) => assessRisk(x.po, x.stock, today));

  const toTell = judged.filter((r) => r.at_risk && r.gap_days > (state[r.po_id] ?? 0));
  let notified = false;
  if (toTell.length) {
    notified = await deps.notify(buildDailyText(toTell));
    // if the owner couldn't be reached, remember nothing, so tomorrow's check tries again
    if (!notified) return { ...empty, checked: judged.length, newRisks: [] };
  }

  // remember what the owner now knows: new/worse risks, and risks that improved or cleared (so a relapse alerts again)
  let stateUpdated = 0;
  for (const r of judged) {
    const g = riskGap(r);
    if (g !== (state[r.po_id] ?? 0)) { await deps.setState(r.po_id, g); stateUpdated++; }
  }
  return { status: "ok", checked: judged.length, newRisks: toTell.map((r) => r.po_id), stateUpdated, notified };
}
