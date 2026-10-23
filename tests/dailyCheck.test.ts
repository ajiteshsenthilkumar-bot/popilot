import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildDailyText, runStockCheck, type DailyDeps } from "@/lib/dailyCheck";
import type { StockSnapshot } from "@/lib/shopify";
import { makePO, TODAY } from "./helpers";

// Pretend Shopify numbers. PO-101 (SKU-SERUM) has 4 days of stock, ETA of the slowest input 4 days away by default.
const snap = (records: StockSnapshot["records"], over: Partial<StockSnapshot> = {}): StockSnapshot => ({
  records, source: "shopify", asOf: "2026-10-22T10:00:00Z", stale: false, ...over,
});
const serum = (stock = 40, daily = 10) => ({ sku: "SKU-SERUM", stock, daily_sales: daily });
const lateLabel = () => { const p = makePO(); p.inputs.label.eta = "2026-10-29"; return p; }; // 7 days away vs 4 days of stock = 3-day gap

let state: Record<string, number>;
let setCalls: [string, number][];
let notified: string[];
let deps: DailyDeps;
const mk = (po = lateLabel(), s = snap([serum()]), notifyResult = true): DailyDeps => ({
  getPOs: async () => [po],
  getStock: async () => s,
  getState: async () => ({ ...state }),
  setState: async (id, g) => { setCalls.push([id, g]); state[id] = g; },
  notify: async (t) => { if (notifyResult) notified.push(t); return notifyResult; },
});

beforeEach(() => { state = {}; setCalls = []; notified = []; });

describe("daily stock check", () => {
  it("tells the owner about a risk they have not been told about (stock dropped, no PO change)", async () => {
    const r = await runStockCheck(mk(), TODAY);
    expect(r).toMatchObject({ status: "ok", checked: 1, newRisks: ["PO-101"], notified: true });
    expect(notified).toHaveLength(1);
    expect(notified[0]).toContain("Daily stock check: 1 PO newly at risk");
    expect(notified[0]).toContain("Glow Serum runs out in 4 days; label now arrives in 7 → 3-day stock-out risk. Reorder or slow ads?");
    expect(setCalls).toEqual([["PO-101", 3]]); // remembered
  });

  it("stays silent the next day when nothing changed", async () => {
    await runStockCheck(mk(), TODAY);
    notified.length = 0; setCalls.length = 0;
    const r = await runStockCheck(mk(), TODAY);
    expect(r.newRisks).toEqual([]);
    expect(notified).toHaveLength(0);
    expect(setCalls).toHaveLength(0);
  });

  it("does not repeat a risk the PO-update alert already reported", async () => {
    state["PO-101"] = 3; // the event alert recorded gap 3
    const r = await runStockCheck(mk(), TODAY);
    expect(r.newRisks).toEqual([]);
    expect(notified).toHaveLength(0);
  });

  it("warns again when the same risk gets worse (sales surged: 4 days of stock becomes 2)", async () => {
    state["PO-101"] = 3;
    const r = await runStockCheck(mk(lateLabel(), snap([serum(40, 20)])), TODAY); // 40/20 = 2 days left, gap 5
    expect(r.newRisks).toEqual(["PO-101"]);
    expect(notified[0]).toContain("runs out in 2 days");
    expect(state["PO-101"]).toBe(5);
  });

  it("stays quiet but updates memory when the risk improves, and when it clears (so a relapse alerts again)", async () => {
    state["PO-101"] = 5;
    await runStockCheck(mk(lateLabel(), snap([serum(60, 10)])), TODAY); // 6 days left, ETA 7 -> gap 1
    expect(notified).toHaveLength(0);
    expect(state["PO-101"]).toBe(1);
    await runStockCheck(mk(lateLabel(), snap([serum(500, 10)])), TODAY); // 50 days: no risk
    expect(state["PO-101"]).toBe(0);
    await runStockCheck(mk(), TODAY); // risk comes back
    expect(notified).toHaveLength(1);
  });

  it("sends one message covering several POs", async () => {
    const a = lateLabel();
    const b = makePO({ po_id: "PO-102", sku: "SKU-CREAM", product: "Radiance Cream" });
    b.inputs.label.eta = "2026-11-10";
    const d = mk(a, snap([serum(), { sku: "SKU-CREAM", stock: 50, daily_sales: 10 }]));
    d.getPOs = async () => [a, b];
    const r = await runStockCheck(d, TODAY);
    expect(r.newRisks).toEqual(["PO-101", "PO-102"]);
    expect(notified).toHaveLength(1);
    expect(notified[0]).toContain("2 POs newly at risk");
  });

  it("remembers nothing if the owner could not be reached, so tomorrow retries", async () => {
    const r = await runStockCheck(mk(lateLabel(), snap([serum()]), false), TODAY);
    expect(r.notified).toBe(false);
    expect(setCalls).toHaveLength(0);
  });

  it("skips POs whose SKU is missing in Shopify instead of guessing", async () => {
    const r = await runStockCheck(mk(lateLabel(), snap([{ sku: "OTHER", stock: 1, daily_sales: 1 }])), TODAY);
    expect(r.checked).toBe(0);
    expect(notified).toHaveLength(0);
  });

  it("refuses to run on sample data or stale data, and surfaces errors rather than saying 'all fine'", async () => {
    const sample = await runStockCheck(mk(lateLabel(), snap([serum()], { source: "sample" })), TODAY);
    expect(sample.status).toBe("skipped");
    await expect(runStockCheck(mk(lateLabel(), snap([serum()], { stale: true, error: "503" })), TODAY)).rejects.toThrow(/out of date.*503/);
    const broken = mk(); broken.getStock = async () => { throw new Error("Shopify down"); };
    await expect(runStockCheck(broken, TODAY)).rejects.toThrow(/Shopify down/);
    const noMemory = mk(); noMemory.getState = async () => { throw new Error("Alerts tab missing"); };
    await expect(runStockCheck(noMemory, TODAY)).rejects.toThrow(/Alerts tab missing/);
    expect(notified).toHaveLength(0);
  });

  it("formats a digest with a link", () => {
    expect(buildDailyText([], "https://x.app")).toContain("0 POs newly at risk");
  });
});

describe("cron route", () => {
  const run = vi.fn(async () => ({ status: "ok", checked: 4, newRisks: [], stateUpdated: 0, notified: false }));
  const notify = vi.fn(async (_t: string) => true);
  beforeEach(() => {
    vi.resetModules(); run.mockClear(); notify.mockClear();
    process.env.CRON_SECRET = "cron-secret-1";
  });
  afterEach(() => { delete process.env.CRON_SECRET; });

  async function load() {
    vi.doMock("@/lib/dailyCheck", () => ({ runStockCheck: run }));
    vi.doMock("@/lib/alerts", async (orig) => ({ ...(await orig<any>()), notifyOwners: notify }));
    return import("@/app/api/cron/stock-check/route");
  }
  const call = (auth?: string) => new Request("http://x/api/cron/stock-check", { headers: auth ? { authorization: auth } : {} });

  it("rejects calls without the right bearer secret, and never runs the check", async () => {
    const { GET } = await load();
    expect((await GET(call())).status).toBe(401);
    expect((await GET(call("Bearer nope"))).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs the check with the right secret", async () => {
    const { GET } = await load();
    const r = await GET(call("Bearer cron-secret-1"));
    expect(r.status).toBe(200);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("is switched off (503) until CRON_SECRET is set", async () => {
    delete process.env.CRON_SECRET;
    const { GET } = await load();
    expect((await GET(call("Bearer anything"))).status).toBe(503);
  });

  it("tells the owner when the check itself breaks, and returns 500", async () => {
    run.mockRejectedValueOnce(new Error("Shopify down"));
    const { GET } = await load();
    const r = await GET(call("Bearer cron-secret-1"));
    expect(r.status).toBe(500);
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("couldn't run: Shopify down"));
  });
});
