// End-to-end check of the three MVP tests, with Claude's answer faked so no API key is needed.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Proposal } from "@/lib/types";

const mockExtract = vi.fn<(...a: any[]) => Promise<Proposal>>();
vi.mock("@/lib/claude", () => ({ extractProposal: (...a: any[]) => mockExtract(...a) }));

import { addDays, resolveEta, todayIST } from "@/lib/dates";
import { confirmUpdate, processMessage } from "@/lib/pipeline";
import { assessRisk } from "@/lib/risk";
import { getStockAndSales } from "@/lib/shopify";
import { getPOs, getUpdates } from "@/lib/store";

const base: Proposal = {
  vendor: "Rajesh Labels", item: "label", po_id: "PO-101",
  eta_expression: { type: "relative_days", value: 7 }, confidence: 0.93, reason: "labels delayed",
};

beforeEach(() => {
  delete (globalThis as any).__popilot; // fresh sample data each test
  mockExtract.mockReset();
});

describe("Test 1: parse updates the matching PO", () => {
  it("applies a clear update and logs it with the original text and confidence", async () => {
    mockExtract.mockResolvedValue({ ...base, eta_expression: { type: "weekday", value: "monday" } });
    const row = await processMessage({ text: "bhaiya labels Monday tak nahi aayenge", source: "text" });
    const expected = resolveEta({ type: "weekday", value: "monday" }, todayIST());

    expect(row.status).toBe("applied");
    expect(row.new_eta).toBe(expected);
    expect(row.original_text).toBe("bhaiya labels Monday tak nahi aayenge");
    expect(row.confidence).toBe(0.93);
    const po = (await getPOs()).find((p) => p.po_id === "PO-101")!;
    expect(po.inputs.label.eta).toBe(expected);
    expect((await getUpdates()).length).toBe(1);
  });
});

describe("Test 2: stock-out alert", () => {
  it("raises the template alert when labels arrive after stock runs out", async () => {
    mockExtract.mockResolvedValue(base); // labels in 7 days; sample stock lasts 4 days
    await processMessage({ text: "labels 7 din", source: "text" });
    const pos = await getPOs();
    const stock = await getStockAndSales();
    const r = assessRisk(pos.find((p) => p.po_id === "PO-101")!, stock.find((s) => s.sku === "SKU-SERUM"), todayIST());
    expect(r.at_risk).toBe(true);
    expect(r.alert).toBe("Glow Serum runs out in 4 days; label now arrives in 7 → 3-day stock-out risk. Reorder or slow ads?");
  });
});

describe("Test 3: bad input never changes a PO", () => {
  const bad: [string, Proposal][] = [
    ["gibberish", { vendor: null, item: null, po_id: null, eta_expression: null, confidence: 0.02, reason: "not a vendor update" }],
    ["no vendor", { ...base, vendor: null }],
    ["no date", { ...base, eta_expression: null }],
    ["vendor with no open PO", { ...base, vendor: "Zenith Prints", po_id: null, confidence: 0.4 }],
    ["wrong vendor for that PO", { ...base, vendor: "Zenith Prints" }],
    ["item already delivered", { ...base, vendor: "Sai Prints", po_id: "PO-104", item: "label" }],
    ["low confidence", { ...base, confidence: 0.4 }],
  ];

  for (const [name, proposal] of bad) {
    it(`${name}: leaves POs untouched and asks for review`, async () => {
      const before = JSON.stringify(await getPOs());
      mockExtract.mockResolvedValue(proposal);
      const row = await processMessage({ text: `original text for ${name}`, source: "text" });

      expect(JSON.stringify(await getPOs())).toBe(before);
      expect(row.status).toBe("needs_review");
      expect(row.reason).toMatch(/needs your review/i);
      expect(row.original_text).toBe(`original text for ${name}`);
    });
  }

  it("if Claude itself fails, nothing changes", async () => {
    const before = JSON.stringify(await getPOs());
    mockExtract.mockRejectedValue(new Error("API down"));
    const row = await processMessage({ text: "labels Monday", source: "text" });
    expect(row.status).toBe("needs_review");
    expect(JSON.stringify(await getPOs())).toBe(before);
  });

  it("one-tap confirm applies the change only after the human says so", async () => {
    mockExtract.mockResolvedValue({ ...base, confidence: 0.4 });
    const row = await processMessage({ text: "shayad labels late", source: "text" });
    const eta = addDays(todayIST(), 5);

    const done = await confirmUpdate({ id: row.id, po_id: "PO-101", item: "label", eta });
    expect(done.status).toBe("confirmed");
    expect((await getPOs()).find((p) => p.po_id === "PO-101")!.inputs.label.eta).toBe(eta);
    await expect(confirmUpdate({ id: row.id, po_id: "PO-101", item: "label", eta })).rejects.toThrow(/already handled/);
  });
});
