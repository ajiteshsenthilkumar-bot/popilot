// Checks the sheet layer against a fake bridge (no network, no Google).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  sheetAppendUpdate, sheetClearAlertState, sheetGetAlertState, sheetGetPOs, sheetGetUpdates, sheetReplacePOs, sheetSaveUpdate,
  sheetSetAlertState, sheetSetEta, sheetsConfigured,
} from "@/lib/sheets";
import { makePO } from "./helpers";
import type { UpdateRow } from "@/lib/types";

const TOKEN = "test-token";
let tabs: Record<string, string[][]>;
let requests: any[];

function fakeBridge(body: any) {
  requests.push(body);
  if (body.token !== TOKEN) return { ok: false, error: "unauthorized" };
  const rows = (tabs[body.tab] ??= []);
  const find = () => rows.findIndex((r) => r[0] === body.key);
  const str = (r: any[]) => r.map((c) => String(c));
  switch (body.action) {
    case "read": return { ok: true, values: rows.map(str) };
    case "replace": tabs[body.tab] = body.rows.map(str); return { ok: true };
    case "append": rows.push(str(body.row)); return { ok: true };
    case "setCell": { const i = find(); if (i < 0) return { ok: true, found: false }; rows[i][body.col - 1] = body.value; return { ok: true, found: true }; }
    case "replaceRow": { const i = find(); if (i < 0) return { ok: true, found: false }; rows[i] = str(body.row); return { ok: true, found: true }; }
    default: return { ok: false, error: "unknown action" };
  }
}

beforeEach(() => {
  tabs = {};
  requests = [];
  process.env.SHEETS_BRIDGE_URL = "https://example.test/exec";
  process.env.SHEETS_BRIDGE_TOKEN = TOKEN;
  vi.stubGlobal("fetch", async (_url: string, init: any) => ({
    text: async () => JSON.stringify(fakeBridge(JSON.parse(init.body))),
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SHEETS_BRIDGE_URL;
  delete process.env.SHEETS_BRIDGE_TOKEN;
});

const update: UpdateRow = {
  id: "u1", timestamp: "2026-10-23T10:00:00Z", original_text: "labels Monday tak", source: "text", vendor: "Rajesh Labels",
  po_id: "PO-101", item: "label", eta_expression: "weekday: monday", old_eta: "2026-10-25", new_eta: "2026-10-26",
  confidence: 0.9, status: "applied", reason: "ok",
};

describe("sheet bridge layer", () => {
  it("reports whether it is configured", () => {
    expect(sheetsConfigured()).toBe(true);
    delete process.env.SHEETS_BRIDGE_TOKEN;
    expect(sheetsConfigured()).toBe(false);
  });

  it("round-trips POs and changes only one ETA cell", async () => {
    await sheetReplacePOs([makePO()]);
    expect(await sheetSetEta("PO-101", "label", "2026-11-02")).toBe(true);
    const [po] = await sheetGetPOs();
    expect(po.inputs.label.eta).toBe("2026-11-02");
    expect(po.inputs.packaging.eta).toBe("2026-10-25");
    expect(po.inputs.label.vendor).toBe("Rajesh Labels");
  });

  it("copes with a row typed by hand: stray spaces and 'Delivered' with a capital D", async () => {
    tabs["POs"] = [[" PO-9 ", "SKU-X ", " Test oil ", "5", " Vendor A ", " 2026-11-01 ", "Open", "Pack B", "", " Delivered ", "Label C", "5 Nov", "delivered"]];
    const [po] = await sheetGetPOs();
    expect(po).toMatchObject({ po_id: "PO-9", sku: "SKU-X", product: "Test oil" });
    expect(po.inputs.manufacturer).toEqual({ vendor: "Vendor A", eta: "2026-11-01", status: "open" });
    expect(po.inputs.packaging.status).toBe("delivered"); // capital D and trailing space still count
    expect(po.inputs.label.status).toBe("delivered");
  });

  it("returns false for an unknown PO", async () => {
    await sheetReplacePOs([makePO()]);
    expect(await sheetSetEta("PO-999", "label", "2026-11-02")).toBe(false);
  });

  it("appends, reads and saves update rows", async () => {
    await sheetAppendUpdate({ ...update, status: "pending" });
    await sheetSaveUpdate(update);
    const [u] = await sheetGetUpdates();
    expect(u.status).toBe("applied");
    expect(u.old_eta).toBe("2026-10-25");
    expect(u.confidence).toBe(0.9);
    expect(await sheetSaveUpdate({ ...update, id: "missing" })).toBe(false);
  });

  it("remembers what the owner was told per PO (add, update, read back)", async () => {
    await sheetSetAlertState("PO-101", 3);
    await sheetSetAlertState("PO-102", 1);
    await sheetSetAlertState("PO-101", 0); // risk cleared: updates the same row, no duplicate
    expect(await sheetGetAlertState()).toEqual({ "PO-101": 0, "PO-102": 1 });
    expect(tabs["Alerts"]).toHaveLength(2);
    await sheetClearAlertState();
    expect(await sheetGetAlertState()).toEqual({});
  });

  it("sends the token on every request and rejects a wrong one", async () => {
    await sheetReplacePOs([makePO()]);
    expect(requests.every((r) => r.token === TOKEN)).toBe(true);
    process.env.SHEETS_BRIDGE_TOKEN = "wrong";
    await expect(sheetGetPOs()).rejects.toThrow(/unauthorized/);
  });

  it("retries a flaky bridge, but never retries append or a wrong token", async () => {
    await sheetReplacePOs([makePO()]);
    let calls = 0;
    vi.stubGlobal("fetch", async (_u: string, init: any) => {
      calls++;
      const body = JSON.parse(init.body);
      const reply = calls === 1 ? { ok: false, error: "Exception: temporary glitch" } : fakeBridge(body);
      return { text: async () => JSON.stringify(reply) };
    });
    expect((await sheetGetPOs()).length).toBe(1); // glitch on first try, fine on second
    expect(calls).toBe(2);

    calls = 0;
    vi.stubGlobal("fetch", async () => { calls++; return { text: async () => JSON.stringify({ ok: false, error: "boom" }) }; });
    await expect(sheetAppendUpdate(update)).rejects.toThrow(/boom/);
    expect(calls).toBe(1); // append is not retried

    calls = 0;
    vi.stubGlobal("fetch", async () => { calls++; return { text: async () => JSON.stringify({ ok: false, error: "unauthorized" }) }; });
    await expect(sheetGetPOs()).rejects.toThrow(/unauthorized/);
    expect(calls).toBe(1);
  });

  it("explains a non-JSON answer (e.g. a Google login page)", async () => {
    vi.stubGlobal("fetch", async () => ({ text: async () => "<html>Sign in</html>" }));
    await expect(sheetGetPOs()).rejects.toThrow(/Anyone/);
  });
});
