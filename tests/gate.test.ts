import { describe, expect, it } from "vitest";
import { evaluate, mentionedPoNumbers } from "@/lib/gate";
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

describe("a PO named in the message", () => {
  const run = (p: Proposal, text: string) => evaluate(p, [makePO()], TODAY, undefined, text);

  it("finds numbers however they are written", () => {
    expect(mentionedPoNumbers("hi, PO 105 rajesh labels")).toEqual(["105"]);
    expect(mentionedPoNumbers("po-105 and PO#0106")).toEqual(["105", "106"]);
    expect(mentionedPoNumbers("apno 3 din mein, labels Monday")).toEqual([]); // 'apno' is not 'PO'
    expect(mentionedPoNumbers("popular item, 5 din")).toEqual([]);
  });

  it("refuses a PO that is not in the sheet, and says how to fix it", () => {
    const r = run(good, "PO 105 rajesh labels se bol raha hoon, labels Monday");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/No PO called PO-105 in your sheet.*Add it to the POs tab/);
  });

  it("refuses when the AI matched a different PO than the one named", () => {
    const r = run({ ...good, po_id: "PO-101" }, "PO 102 labels Monday tak");
    expect(r.ok).toBe(false); // PO-102 is not in this one-PO list: caught as 'no PO called'
    const two = [makePO(), makePO({ po_id: "PO-102" })];
    const r2 = evaluate({ ...good, po_id: "PO-101" }, two, TODAY, undefined, "PO 102 labels Monday tak");
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toMatch(/names PO-102 but was matched to PO-101/);
  });

  it("accepts when the named PO is the matched PO, or when no PO is named", () => {
    expect(run(good, "PO 101 labels Monday tak").ok).toBe(true);
    expect(run(good, "labels Monday tak nahi aayenge").ok).toBe(true);
    expect(evaluate(good, [makePO()], TODAY).ok).toBe(true); // callers that pass no text behave as before
  });
});

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
