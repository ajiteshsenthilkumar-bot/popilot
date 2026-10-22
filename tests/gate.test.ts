import { describe, expect, it } from "vitest";
import { evaluate } from "@/lib/gate";
import type { Proposal } from "@/lib/types";
import { makePO, TODAY } from "./helpers";

const good: Proposal = {
  vendor: "Rajesh Labels",
  item: "label",
  po_id: "PO-101",
  eta_expression: { type: "weekday", value: "monday" },
  confidence: 0.92,
  reason: "clear",
};

const reject = (p: Proposal, pos = [makePO()]) => {
  const r = evaluate(p, pos, TODAY);
  expect(r.ok).toBe(false);
  return r.ok ? "" : r.reason;
};

describe("gate", () => {
  it("accepts a clear message that matches an open PO", () => {
    const r = evaluate(good, [makePO()], TODAY);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.newEta).toBe("2026-10-26");
  });

  it("matches vendor names loosely", () => {
    expect(evaluate({ ...good, vendor: "rajesh labels pvt" }, [makePO()], TODAY).ok).toBe(true);
  });

  it("rejects gibberish (nothing extracted)", () => {
    reject({ vendor: null, item: null, po_id: null, eta_expression: null, confidence: 0.05, reason: "gibberish" });
  });

  it("rejects no vendor", () => expect(reject({ ...good, vendor: null })).toMatch(/vendor/i));
  it("rejects no date", () => expect(reject({ ...good, eta_expression: null })).toMatch(/date/i));
  it("rejects unknown weekday", () => {
    reject({ ...good, eta_expression: { type: "weekday", value: "blah" } });
  });
  it("rejects a date in the past", () => {
    expect(reject({ ...good, eta_expression: { type: "absolute", value: "2026-10-01" } })).toMatch(/past/);
  });
  it("rejects when no PO was matched", () => reject({ ...good, po_id: null }));
  it("rejects a PO id that does not exist", () => expect(reject({ ...good, po_id: "PO-999" })).toMatch(/PO-999/));

  it("rejects a vendor with no open PO for that item", () => {
    expect(reject({ ...good, vendor: "Some Other Vendor" })).toMatch(/not the label vendor/);
  });

  it("rejects an already-delivered input", () => {
    const po = makePO();
    po.inputs.label.status = "delivered";
    expect(reject(good, [po])).toMatch(/already delivered/);
  });

  it("rejects low confidence even if everything else matches", () => {
    expect(reject({ ...good, confidence: 0.5 })).toMatch(/Low confidence/);
  });
});
