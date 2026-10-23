import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Proposal, RiskResult } from "@/lib/types";

const mockExtract = vi.fn<(...a: any[]) => Promise<Proposal>>();
vi.mock("@/lib/claude", () => ({ extractProposal: (...a: any[]) => mockExtract(...a) }));

import { buildAlertText, maybeAlert, ownerChatIds, shouldAlert } from "@/lib/alerts";
import { confirmUpdate, processMessage } from "@/lib/pipeline";
import { getAlertState } from "@/lib/store";
import { makePO, TODAY } from "./helpers";

const risk = (o: Partial<RiskResult>): RiskResult => ({
  po_id: "PO-101", sku: "S", product: "Glow Serum", days_left: 4, real_eta: null, slowest_item: "label",
  days_to_arrival: 7, gap_days: 0, at_risk: false, alert: null, ...o,
});

describe("when to alert", () => {
  it("alerts when risk appears or the gap grows, otherwise stays quiet", () => {
    expect(shouldAlert(risk({}), risk({ at_risk: true, gap_days: 3 }))).toBe(true); // new risk
    expect(shouldAlert(risk({ at_risk: true, gap_days: 2 }), risk({ at_risk: true, gap_days: 5 }))).toBe(true); // worse
    expect(shouldAlert(risk({ at_risk: true, gap_days: 3 }), risk({ at_risk: true, gap_days: 3 }))).toBe(false); // same
    expect(shouldAlert(risk({ at_risk: true, gap_days: 5 }), risk({ at_risk: true, gap_days: 2 }))).toBe(false); // better
    expect(shouldAlert(risk({ at_risk: true, gap_days: 3 }), risk({}))).toBe(false); // cleared
    expect(shouldAlert(risk({}), risk({}))).toBe(false); // fine before and after
  });
});

describe("who gets alerted", () => {
  it("only the owner ids (id=*), never vendors or groups", () => {
    expect(ownerChatIds("123456789=*,987654321=Rajesh Labels,-1001234567=Vendor Group,555555555=*")).toEqual(["123456789", "555555555"]);
    expect(ownerChatIds("")).toEqual([]);
    expect(ownerChatIds(undefined)).toEqual([]);
  });
});

describe("alert text", () => {
  it("uses the fixed template plus what changed", () => {
    const t = buildAlertText(
      risk({ at_risk: true, gap_days: 3, alert: "Glow Serum runs out in 4 days; label now arrives in 7 → 3-day stock-out risk. Reorder or slow ads?" }),
      { vendor: "Rajesh Labels", item: "label", oldEta: "2026-10-25", newEta: "2026-10-30", url: "https://x.vercel.app" },
    );
    expect(t).toContain("Glow Serum runs out in 4 days; label now arrives in 7 → 3-day stock-out risk. Reorder or slow ads?");
    expect(t).toContain("Rajesh Labels moved label ETA");
    expect(t).toContain("Sun, 25 Oct");
    expect(t).toContain("Fri, 30 Oct");
    expect(t).toContain("https://x.vercel.app");
  });
});

describe("maybeAlert", () => {
  const stock = { sku: "SKU-SERUM", stock: 40, daily_sales: 10 }; // 4 days
  const base = () => ({ poBefore: makePO(), item: "label" as const, newEta: "2026-10-29", stock, vendor: "Rajesh Labels", oldEta: "2026-10-26", today: TODAY });
  const send = vi.fn(async (_t: string, _c: string, _x: string) => {});

  beforeEach(() => {
    send.mockClear();
    process.env.TELEGRAM_BOT_TOKEN = "123:ABC";
    process.env.TELEGRAM_ALLOWED = "111111111=*,222222222=Rajesh Labels";
  });
  afterEach(() => { delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.TELEGRAM_ALLOWED; });

  it("sends one message to each owner when a delay creates a stock-out risk", async () => {
    expect((await maybeAlert(base(), send)).sent).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toBe("111111111"); // the owner, not the vendor 222222222
    expect(send.mock.calls[0][2]).toMatch(/runs out in 4 days; label now arrives in 7 → 3-day stock-out risk/);
  });

  it("stays quiet when the new ETA is still inside the stock runway", async () => {
    expect((await maybeAlert({ ...base(), newEta: "2026-10-25" }, send)).sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("stays quiet when there is no Shopify data for the SKU, no token, or no owner", async () => {
    expect((await maybeAlert({ ...base(), stock: undefined }, send)).sent).toBe(false);
    delete process.env.TELEGRAM_BOT_TOKEN;
    expect((await maybeAlert(base(), send)).sent).toBe(false);
    process.env.TELEGRAM_BOT_TOKEN = "123:ABC";
    process.env.TELEGRAM_ALLOWED = "222222222=Rajesh Labels";
    expect((await maybeAlert(base(), send)).sent).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it("does not repeat for an unchanged risk but does warn when it gets worse", async () => {
    const already = makePO();
    already.inputs.label.eta = "2026-10-29"; // already 7 days away -> already at risk
    expect((await maybeAlert({ ...base(), poBefore: already, newEta: "2026-10-29" }, send)).sent).toBe(false); // same
    expect((await maybeAlert({ ...base(), poBefore: already, newEta: "2026-11-02" }, send)).sent).toBe(true); // worse
    expect((await maybeAlert({ ...base(), poBefore: already, newEta: "2026-10-27" }, send)).sent).toBe(false); // better
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("still tries every owner if one send fails, then reports the failure", async () => {
    process.env.TELEGRAM_ALLOWED = "111111111=*,333333333=*";
    const flaky = vi.fn(async (_t: string, chat: string) => { if (chat === "111111111") throw new Error("blocked"); });
    await expect(maybeAlert(base(), flaky)).rejects.toThrow(/blocked/);
    expect(flaky).toHaveBeenCalledTimes(2);
  });
});

// The whole flow: a vendor delay is applied to the PO, then Telegram is told. Telegram itself is faked.
describe("alert through the pipeline", () => {
  const delay: Proposal = { vendor: "Rajesh Labels", item: "label", po_id: "PO-101", eta_expression: { type: "relative_days", value: 7 }, confidence: 0.95, reason: "7 din" };
  let sent: { url: string; body: any }[];

  beforeEach(() => {
    delete (globalThis as any).__popilot;
    mockExtract.mockReset();
    sent = [];
    process.env.TELEGRAM_BOT_TOKEN = "123:ABC";
    process.env.TELEGRAM_ALLOWED = "111111111=*";
    vi.stubGlobal("fetch", async (url: string, init: any) => {
      sent.push({ url: String(url), body: JSON.parse(init.body) });
      return { ok: true, status: 200 };
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.TELEGRAM_ALLOWED; });

  it("sends the alert after an applied delay (sample stock: 4 days)", async () => {
    mockExtract.mockResolvedValue(delay);
    const row = await processMessage({ text: "labels 7 din", source: "voice" });
    expect(row.status).toBe("applied");
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe("https://api.telegram.org/bot123:ABC/sendMessage");
    expect(sent[0].body.chat_id).toBe("111111111");
    expect(sent[0].body.text).toContain("3-day stock-out risk. Reorder or slow ads?");
    expect(await getAlertState()).toEqual({ "PO-101": 3 }); // remembered, so the daily check won't repeat it
  });

  it("records a cleared risk as 0 so a later relapse alerts again", async () => {
    mockExtract.mockResolvedValue(delay);
    await processMessage({ text: "labels 7 din", source: "text" }); // risk appears (gap 3)
    mockExtract.mockResolvedValue({ ...delay, eta_expression: { type: "relative_days", value: 2 } });
    await processMessage({ text: "labels 2 din", source: "text" }); // delivered sooner: risk gone
    expect(sent).toHaveLength(1); // no alert for good news
    expect(await getAlertState()).toEqual({ "PO-101": 0 });
  });

  it("does not alert for a bad-input message that changes nothing", async () => {
    mockExtract.mockResolvedValue({ ...delay, confidence: 0.2 });
    const row = await processMessage({ text: "kuch bhi", source: "text" });
    expect(row.status).toBe("needs_review");
    expect(sent).toHaveLength(0);
  });

  it("a failing Telegram send never breaks or hides the PO update", async () => {
    vi.stubGlobal("fetch", async () => { throw new Error("network down"); });
    mockExtract.mockResolvedValue(delay);
    const row = await processMessage({ text: "labels 7 din", source: "text" });
    expect(row.status).toBe("applied");
  });

  it("alerts after a human Confirm too", async () => {
    mockExtract.mockResolvedValue({ ...delay, confidence: 0.4 });
    const review = await processMessage({ text: "shayad late", source: "text" });
    expect(review.status).toBe("needs_review");
    expect(sent).toHaveLength(0);
    const eta = new Date(Date.now() + 7 * 86_400_000 + 5.5 * 3_600_000).toISOString().slice(0, 10);
    await confirmUpdate({ id: review.id, po_id: "PO-101", item: "label", eta });
    expect(sent).toHaveLength(1);
  });
});
