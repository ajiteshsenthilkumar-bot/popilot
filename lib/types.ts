export const ITEMS = ["manufacturer", "packaging", "label"] as const;
export type Item = (typeof ITEMS)[number];

export type InputStatus = "open" | "delivered";

export interface POInput {
  vendor: string;
  eta: string; // YYYY-MM-DD, "" if unknown
  status: InputStatus;
}

// One PO per SKU, with three inputs (manufacturer / packaging / label).
export interface PO {
  po_id: string;
  sku: string;
  product: string;
  qty: number;
  inputs: Record<Item, POInput>;
}

export interface StockRecord {
  sku: string;
  stock: number;
  daily_sales: number;
}

// What the AI is allowed to say. Labels only; no computed dates.
export type EtaExpression =
  | { type: "weekday"; value: string } // "monday"
  | { type: "relative_days"; value: number } // 3 => in 3 days
  | { type: "absolute"; value: string }; // "2026-10-30"

export interface Proposal {
  vendor: string | null;
  item: Item | null;
  po_id: string | null;
  eta_expression: EtaExpression | null;
  confidence: number; // 0..1
  reason: string;
}

// "pending" = logged but the PO write hasn't finished (or failed midway): visible, never silent.
export type UpdateStatus = "applied" | "needs_review" | "confirmed" | "pending";

export interface UpdateRow {
  id: string;
  timestamp: string;
  original_text: string;
  source: "text" | "voice";
  vendor: string;
  po_id: string;
  item: string;
  eta_expression: string;
  old_eta: string; // the PO's ETA before this update ("" if unknown)
  new_eta: string;
  confidence: number;
  status: UpdateStatus;
  reason: string;
}

export interface RiskResult {
  po_id: string;
  sku: string;
  product: string;
  days_left: number | null;
  real_eta: string | null;
  slowest_item: Item | null;
  days_to_arrival: number | null;
  gap_days: number;
  at_risk: boolean;
  alert: string | null;
}
