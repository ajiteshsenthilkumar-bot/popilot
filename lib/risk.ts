// Stock-out math. Plain code only: no AI here, and the alert is a fixed template.
import { diffDays, isValidIso } from "./dates";
import { ITEMS, type Item, type PO, type RiskResult, type StockRecord } from "./types";

// The slowest open input decides when the PO really finishes.
export function realEta(po: PO): { eta: string; item: Item } | null {
  let best: { eta: string; item: Item } | null = null;
  for (const item of ITEMS) {
    const input = po.inputs[item];
    // a date typed by hand in the sheet may be wrong ("5 Nov"): ignore it here rather than crash; the screen warns about it
    if (input.status !== "open" || !input.eta || !isValidIso(input.eta)) continue;
    if (!best || input.eta > best.eta) best = { eta: input.eta, item };
  }
  return best;
}

export function alertText(product: string, daysLeft: number, item: Item, daysToArrival: number, gap: number): string {
  return (
    `${product} runs out in ${daysLeft} days; ${item} now arrives in ${daysToArrival} ` +
    `→ ${gap}-day stock-out risk. Reorder or slow ads?`
  );
}

export function assessRisk(po: PO, stock: StockRecord | undefined, today: string): RiskResult {
  const base: RiskResult = {
    po_id: po.po_id,
    sku: po.sku,
    product: po.product,
    days_left: null,
    real_eta: null,
    slowest_item: null,
    days_to_arrival: null,
    gap_days: 0,
    at_risk: false,
    alert: null,
  };

  const slowest = realEta(po);
  if (!stock || stock.daily_sales <= 0 || !slowest) return base;

  const daysLeft = Math.floor(stock.stock / stock.daily_sales);
  // an ETA already in the past while still open counts as "arrives today"
  const daysToArrival = Math.max(0, diffDays(today, slowest.eta));
  const gap = daysToArrival - daysLeft;

  return {
    ...base,
    days_left: daysLeft,
    real_eta: slowest.eta,
    slowest_item: slowest.item,
    days_to_arrival: daysToArrival,
    gap_days: Math.max(0, gap),
    at_risk: gap > 0,
    alert: gap > 0 ? alertText(po.product, daysLeft, slowest.item, daysToArrival, gap) : null,
  };
}
