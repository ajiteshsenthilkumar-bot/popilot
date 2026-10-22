import { describe, expect, it } from "vitest";
import { sanitizeProposal } from "@/lib/sanitize";

describe("sanitizeProposal", () => {
  it("keeps a good result", () => {
    const p = sanitizeProposal({
      vendor: " Rajesh Labels ", item: "label", po_id: "PO-101",
      eta_expression: { type: "weekday", value: "monday" }, confidence: 0.9, reason: "ok",
    });
    expect(p.vendor).toBe("Rajesh Labels");
    expect(p.eta_expression).toEqual({ type: "weekday", value: "monday" });
  });

  it("neutralises garbage", () => {
    const p = sanitizeProposal({ vendor: 5, item: "rocket", po_id: "", eta_expression: { type: "x" }, confidence: "high" });
    expect(p).toEqual({ vendor: null, item: null, po_id: null, eta_expression: null, confidence: 0, reason: "" });
  });

  it("clamps confidence to 0..1 and handles null input", () => {
    expect(sanitizeProposal({ confidence: 7 }).confidence).toBe(1);
    expect(sanitizeProposal(null).confidence).toBe(0);
  });
});
