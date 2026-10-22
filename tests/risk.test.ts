import { describe, expect, it } from "vitest";
import { assessRisk, realEta } from "@/lib/risk";
import { makePO, TODAY } from "./helpers";

const stock = { sku: "SKU-SERUM", stock: 40, daily_sales: 10 }; // 4 days of stock

describe("risk", () => {
  it("slowest open input sets the real ETA", () => {
    expect(realEta(makePO())).toEqual({ eta: "2026-10-26", item: "label" });
  });

  it("ignores delivered inputs", () => {
    const po = makePO();
    po.inputs.label.status = "delivered";
    expect(realEta(po)).toEqual({ eta: "2026-10-25", item: "packaging" });
  });

  it("flags a 3-day stock-out when labels arrive in 7 and stock lasts 4", () => {
    const po = makePO();
    po.inputs.label.eta = "2026-10-29";
    const r = assessRisk(po, stock, TODAY);
    expect(r.at_risk).toBe(true);
    expect(r.days_left).toBe(4);
    expect(r.days_to_arrival).toBe(7);
    expect(r.gap_days).toBe(3);
    expect(r.alert).toBe(
      "Glow Serum runs out in 4 days; label now arrives in 7 → 3-day stock-out risk. Reorder or slow ads?",
    );
  });

  it("no alert when stock outlasts the ETA", () => {
    const r = assessRisk(makePO(), { ...stock, stock: 100 }, TODAY); // 10 days left, ETA in 4
    expect(r.at_risk).toBe(false);
    expect(r.alert).toBeNull();
  });

  it("exactly equal is not a risk", () => {
    const po = makePO();
    po.inputs.label.eta = "2026-10-26"; // 4 days
    expect(assessRisk(po, stock, TODAY).at_risk).toBe(false);
  });

  it("does not crash with no sales or no stock data", () => {
    expect(assessRisk(makePO(), { ...stock, daily_sales: 0 }, TODAY).at_risk).toBe(false);
    expect(assessRisk(makePO(), undefined, TODAY).at_risk).toBe(false);
  });
});
