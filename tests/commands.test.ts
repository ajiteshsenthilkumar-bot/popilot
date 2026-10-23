// Owner-only Telegram commands for managing POs (memory store, no AI involved).
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/claude", () => ({ extractProposal: async () => { throw new Error("the AI must not be called for commands"); } }));

import { addDays, todayIST } from "@/lib/dates";
import { isCommand, parseDay, runCommand } from "@/lib/commands";
import { handleInbound } from "@/lib/inbound";
import { getPOs, getUpdates } from "@/lib/store";
import { undoUpdate } from "@/lib/pipeline";

const TODAY = "2026-10-23";
const run = (t: string, id = "tg_1_1") => runCommand(t, { id, today: todayIST() });
const po = async (id: string) => (await getPOs()).find((p) => p.po_id === id);
const in10 = () => addDays(todayIST(), 10);

beforeEach(() => { delete (globalThis as any).__popilot; });

describe("reading dates people type", () => {
  it("understands the common ways", () => {
    expect(parseDay("2026-11-05", TODAY)).toBe("2026-11-05");
    expect(parseDay("5 Nov", TODAY)).toBe("2026-11-05");
    expect(parseDay("5th november", TODAY)).toBe("2026-11-05");
    expect(parseDay("7d", TODAY)).toBe("2026-10-30");
    expect(parseDay("in 3 days", TODAY)).toBe("2026-10-26");
    expect(parseDay("monday", TODAY)).toBe("2026-10-26");
  });
  it("rolls a passed day-month into next year, and refuses past or nonsense dates", () => {
    expect(parseDay("5 Jan", TODAY)).toBe("2027-01-05");
    expect(parseDay("2026-10-01", TODAY)).toBeNull();
    expect(parseDay("31 Feb", TODAY)).toBeNull();
    expect(parseDay("soon", TODAY)).toBeNull();
  });
  it("recognises commands, including ones addressed to the bot", () => {
    expect(isCommand("/addpo PO-1 | x")).toBe(true);
    expect(isCommand("/pos@bestpopilot_bot")).toBe(true);
    expect(isCommand("/start")).toBe(false);
    expect(isCommand("labels monday tak")).toBe(false);
  });
});

describe("/addpo", () => {
  const cmd = (d = "10 Nov") => `/addpo PO 105 | Glow Cream | SKU-CREAM | 500 | label: Rajesh Labels @ ${d} | packaging: Sun Packers @ 2026-11-02`;

  it("adds a PO with the open items, and leaves unmentioned items as delivered", async () => {
    const r = await run(cmd());
    expect(r).toContain("Added PO-105");
    const p = (await po("PO-105"))!;
    expect(p).toMatchObject({ sku: "SKU-CREAM", product: "Glow Cream", qty: 500 });
    expect(p.inputs.label).toEqual({ vendor: "Rajesh Labels", eta: "2026-11-10", status: "open" });
    expect(p.inputs.packaging).toEqual({ vendor: "Sun Packers", eta: "2026-11-02", status: "open" });
    expect(p.inputs.manufacturer.status).toBe("delivered");
    expect(r).toContain("Not tracked: manufacturer");
  });

  it("refuses a duplicate, a missing date, a bad quantity and nothing-open, and saves nothing", async () => {
    await run(cmd());
    expect(await run(cmd())).toContain("already exists");
    const n = (await getPOs()).length;
    expect(await run("/addpo PO-106 | X | SKU-X | 5 | label: V")).toContain("after an @");
    expect(await run("/addpo PO-106 | X | SKU-X | lots | label: V @ 10 Nov")).toContain("whole number");
    expect(await run("/addpo PO-106 | X | SKU X | 5 | label: V @ 10 Nov")).toContain("space");
    expect(await run("/addpo PO-106 | X | SKU-X | 5 | label: V @ 1 Jan 2020")).toContain("in the past");
    expect(await run("/addpo PO-106 | X | SKU-X | 5 | glass: V @ 10 Nov")).toContain("couldn't read");
    expect(await run("/addpo PO-106 | X")).toContain("Format:");
    expect((await getPOs()).length).toBe(n);
  });
});

describe("editing a PO", () => {
  it("/eta changes the date, logs it, and the board's Undo can reverse it", async () => {
    const before = (await po("PO-101"))!.inputs.label.eta;
    const r = await run("/eta PO 101 labels 10d", "tg_9_9");
    expect(r).toContain("PO-101 label");
    expect((await po("PO-101"))!.inputs.label.eta).toBe(in10());
    const row = (await getUpdates()).find((u) => u.id === "tg_9_9")!;
    expect(row).toMatchObject({ status: "applied", old_eta: before, new_eta: in10(), confidence: 1 });
    expect((await undoUpdate("tg_9_9")).status).toBe("reverted");
    expect((await po("PO-101"))!.inputs.label.eta).toBe(before);
  });

  it("/eta explains instead of guessing: unknown PO, bad date, same date, delivered item", async () => {
    expect(await run("/eta PO-999 label 10 Nov")).toContain("No PO called PO-999");
    expect(await run("/eta PO-101 label whenever")).toContain("couldn't read");
    const cur = (await po("PO-101"))!.inputs.label.eta;
    expect(await run(`/eta PO-101 label ${cur}`)).toContain("Nothing changed");
    await run("/delivered PO-101 label");
    expect(await run("/eta PO-101 label 10d")).toContain("/reopen");
  });

  it("/vendor, /delivered and /reopen", async () => {
    expect(await run("/vendor PO-101 label New Labels Co")).toContain("New Labels Co");
    expect((await po("PO-101"))!.inputs.label.vendor).toBe("New Labels Co");
    await run("/delivered PO-101 label");
    expect((await po("PO-101"))!.inputs.label).toMatchObject({ status: "delivered", eta: "" });
    await run("/reopen PO-101 label 15d");
    expect((await po("PO-101"))!.inputs.label).toMatchObject({ status: "open", eta: addDays(todayIST(), 15) });
  });
});

describe("/removepo and /pos", () => {
  it("asks first, then removes", async () => {
    const n = (await getPOs()).length;
    expect(await run("/removepo PO-101")).toContain("/removepo PO-101 yes");
    expect((await getPOs()).length).toBe(n);
    expect(await run("/removepo PO-101 yes")).toContain("Removed PO-101");
    expect((await getPOs()).length).toBe(n - 1);
    expect(await po("PO-101")).toBeUndefined();
  });
  it("/pos lists them and /help shows the formats", async () => {
    expect(await run("/pos")).toContain("PO-101");
    expect(await run("/help")).toContain("/addpo");
  });
});

describe("who may use commands (through the real intake)", () => {
  const ALLOW = "111111111=*,222222222=Rajesh Labels";
  const msg = (from: string, text: string, extra: object = {}) =>
    ({ channel: "telegram" as const, id: `${from}_1`, from, type: "text", forwarded: false, text, ...extra });

  it("the owner's command runs and gets a reply; no AI involved", async () => {
    const command = vi.fn(async () => {});
    const s = await handleInbound([msg("111111111", "/pos")], ALLOW, deps(command));
    expect(command).toHaveBeenCalledWith("/pos", "tg_111111111_1", "111111111");
    expect(s.processed).toBe(1);
  });

  it("a vendor's command is dropped, and so is an edited command", async () => {
    const command = vi.fn(async () => {});
    await handleInbound([msg("222222222", "/removepo PO-101 yes")], ALLOW, deps(command));
    await handleInbound([msg("111111111", "/removepo PO-101 yes", { editedAt: 5 })], ALLOW, deps(command));
    expect(command).not.toHaveBeenCalled();
    expect(await po("PO-101")).toBeDefined();
  });
});

function deps(command: (t: string, id: string, chat: string) => Promise<void>) {
  return {
    process: async () => { throw new Error("no AI for commands"); },
    transcribe: async () => "", download: async () => ({ bytes: Buffer.from(""), mime: "audio/ogg" }),
    knownIds: async () => new Set<string>(), logReview: async () => {}, revertEdited: async () => ({ reverted: [], blocked: [] }),
    command,
  } as any;
}
