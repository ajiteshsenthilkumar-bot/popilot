import type { PO } from "@/lib/types";

export const TODAY = "2026-10-22"; // a Thursday

export function makePO(overrides: Partial<PO> = {}): PO {
  return {
    po_id: "PO-101",
    sku: "SKU-SERUM",
    product: "Glow Serum",
    qty: 500,
    inputs: {
      manufacturer: { vendor: "Shree Labs", eta: "2026-10-24", status: "open" },
      packaging: { vendor: "Pack Wale", eta: "2026-10-25", status: "open" },
      label: { vendor: "Rajesh Labels", eta: "2026-10-26", status: "open" },
    },
    ...overrides,
  };
}
