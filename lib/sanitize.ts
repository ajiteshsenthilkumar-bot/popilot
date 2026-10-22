// Never trust the AI's output shape. Turn whatever came back into a safe Proposal.
import { ITEMS, type EtaExpression, type Item, type Proposal } from "./types";

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function sanitizeEta(v: any): EtaExpression | null {
  if (!v || typeof v !== "object") return null;
  if (v.type === "weekday" && typeof v.value === "string") return { type: "weekday", value: v.value };
  if (v.type === "relative_days" && typeof v.value === "number") return { type: "relative_days", value: v.value };
  if (v.type === "absolute" && typeof v.value === "string") return { type: "absolute", value: v.value };
  return null;
}

export function sanitizeProposal(raw: any): Proposal {
  const item = ITEMS.includes(raw?.item) ? (raw.item as Item) : null;
  const c = Number(raw?.confidence);
  return {
    vendor: str(raw?.vendor),
    item,
    po_id: str(raw?.po_id),
    eta_expression: sanitizeEta(raw?.eta_expression),
    confidence: Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0,
    reason: str(raw?.reason) ?? "",
  };
}

export function describeEta(e: EtaExpression | null): string {
  if (!e) return "";
  if (e.type === "weekday") return `weekday: ${e.value}`;
  if (e.type === "relative_days") return `in ${e.value} days`;
  return e.value;
}
