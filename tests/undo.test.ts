// Undo, and edited messages, on the real pipeline (memory store, AI faked).
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Proposal } from "@/lib/types";

const mockExtract = vi.fn<(...a: any[]) => Promise<Proposal>>();
vi.mock("@/lib/claude", () => ({ extractProposal: (...a: any[]) => mockExtract(...a) }));

import { addDays, todayIST } from "@/lib/dates";
import { handleInbound } from "@/lib/inbound";
import { confirmUpdate, processMessage, revertMessageEffects, undoUpdate } from "@/lib/pipeline";
import { getAlertState, getPOs, getUpdates, setEta } from "@/lib/store";
import { POST as undoRoute } from "@/app/api/undo/route";

const proposal = (days: number, o: Partial<Proposal> = {}): Proposal => ({
  vendor: "Rajesh Labels", item: "label", po_id: "PO-101",
  eta_expression: { type: "relative_days", value: days }, confidence: 0.95, reason: "labels delayed", ...o,
});
const labelEta = async () => (await getPOs()).find((p) => p.po_id === "PO-101")!.inputs.label.eta;
const seedLabelEta = () => addDays(todayIST(), 2); // the starter PO-101 label date

beforeEach(() => {
  delete (globalThis as any).__popilot;
  mockExtract.mockReset();
});

describe("Undo", () => {
  it("puts the date back and marks the card as undone", async () => {
    mockExtract.mockResolvedValue(proposal(7));
    const row = await processMessage({ text: "labels 7 din", source: "text" });
    expect(await labelEta()).toBe(addDays(todayIST(), 7));

    const undone = await undoUpdate(row.id);
    expect(undone.status).toBe("reverted");
    expect(undone.reason).toContain("is back to");
    expect(await labelEta()).toBe(seedLabelEta());
    expect((await getUpdates()).find((u) => u.id === row.id)!.status).toBe("reverted");
  });

  it("works on a human-confirmed update too", async () => {
    mockExtract.mockResolvedValue(proposal(7, { confidence: 0.3 }));
    const review = await processMessage({ text: "shayad late", source: "text" });
    await confirmUpdate({ id: review.id, po_id: "PO-101", item: "label", eta: addDays(todayIST(), 9) });
    expect((await undoUpdate(review.id)).status).toBe("reverted");
    expect(await labelEta()).toBe(seedLabelEta());
  });

  it("refuses when the date was changed again afterwards, and changes nothing", async () => {
    mockExtract.mockResolvedValue(proposal(7));
    const row = await processMessage({ text: "labels 7 din", source: "text" });
    await setEta("PO-101", "label", addDays(todayIST(), 12)); // someone moved it again
    await expect(undoUpdate(row.id)).rejects.toThrow(/was changed again after this update/);
    expect(await labelEta()).toBe(addDays(todayIST(), 12));
    expect((await getUpdates()).find((u) => u.id === row.id)!.status).toBe("applied");
  });

  it("refuses an update that was never applied, an unknown one, and a second undo", async () => {
    mockExtract.mockResolvedValue(proposal(7, { confidence: 0.2 }));
    const review = await processMessage({ text: "kuch bhi", source: "text" });
    await expect(undoUpdate(review.id)).rejects.toThrow(/nothing to undo/);
    await expect(undoUpdate("nope")).rejects.toThrow(/not found/);
    mockExtract.mockResolvedValue(proposal(7));
    const row = await processMessage({ text: "labels 7 din", source: "text" });
    await undoUpdate(row.id);
    await expect(undoUpdate(row.id)).rejects.toThrow(/nothing to undo/);
  });

  it("resets what the owner was told, so a later risk alerts again", async () => {
    process.env.TELEGRAM_BOT_TOKEN = ""; // no real messages in tests
    mockExtract.mockResolvedValue(proposal(7));
    const row = await processMessage({ text: "labels 7 din", source: "text" });
    expect(await getAlertState()).toEqual({ "PO-101": 3 }); // risk was reported (sample stock = 4 days)
    await undoUpdate(row.id);
    expect(await getAlertState()).toEqual({ "PO-101": 0 }); // back to no open risk
  });

  it("the Undo route answers 200 with the undone card, and 400 with a reason otherwise", async () => {
    mockExtract.mockResolvedValue(proposal(7));
    const row = await processMessage({ text: "labels 7 din", source: "text" });
    const req = (id: string) => new Request("http://x/api/undo", { method: "POST", body: JSON.stringify({ id }) });
    const ok = await undoRoute(req(row.id));
    expect(ok.status).toBe(200);
    expect((await ok.json()).update.status).toBe("reverted");
    const bad = await undoRoute(req(row.id));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/nothing to undo/);
  });
});

describe("Edited messages (the PO 105 case, replayed)", () => {
  const ALLOWED = "919812345678=Rajesh Labels,919876500000=*";
  const first = { channel: "telegram" as const, id: "1151636184_13", from: "919876500000", type: "text", forwarded: false,
    text: "hi , rajesh labels se suresh bat kar raha hoon , label material aapko monday milega" };

  it("undoes the first version, then refuses the corrected text because PO-105 is not in the sheet", async () => {
    mockExtract.mockResolvedValueOnce(proposal(3)); // first version: matched to PO-101 and applied
    await handleInbound([first], ALLOWED);
    expect(await labelEta()).toBe(addDays(todayIST(), 3));

    // the sender edits the message to name PO 105. The AI (correctly or not) still points at PO-101.
    mockExtract.mockResolvedValueOnce(proposal(3));
    await handleInbound([{ ...first, text: "hi ,PO 105 rajesh labels se suresh bat kar raha hoon , label material aapko monday milega", editedAt: 1761234567 }], ALLOWED);

    expect(await labelEta()).toBe(seedLabelEta()); // PO-101 is back to what it was
    const rows = await getUpdates();
    const original = rows.find((r) => r.id === "tg_1151636184_13")!;
    const edited = rows.find((r) => r.id === "tg_1151636184_13_e1761234567")!;
    expect(original.status).toBe("reverted");
    expect(edited.status).toBe("needs_review");
    expect(edited.reason).toContain("No PO called PO-105 in your sheet");
    expect(edited.reason).toContain("the earlier change (PO-101 label) was undone first");
  });

  it("an edit that fixes the PO name applies the corrected message instead", async () => {
    const po102 = async () => (await getPOs()).find((p) => p.po_id === "PO-102")!.inputs.label.eta;
    const before102 = await po102();
    const vendor102 = (await getPOs()).find((p) => p.po_id === "PO-102")!.inputs.label.vendor;
    mockExtract.mockResolvedValueOnce(proposal(3, { po_id: "PO-102", vendor: vendor102 })); // first version matched the wrong PO
    await handleInbound([{ ...first, text: "labels 3 din", from: "919876500000" }], ALLOWED);
    expect(await po102()).toBe(addDays(todayIST(), 3));

    mockExtract.mockResolvedValueOnce(proposal(3, { po_id: "PO-101" }));
    await handleInbound([{ ...first, text: "PO 101 Rajesh Labels labels 3 din", editedAt: 1761234999 }], ALLOWED);
    expect(await po102()).toBe(before102); // the wrong PO is restored
    expect(await labelEta()).toBe(addDays(todayIST(), 3)); // the right one is updated
  });

  it("does not undo anything if the date was moved again after the first version", async () => {
    mockExtract.mockResolvedValueOnce(proposal(3));
    await handleInbound([first], ALLOWED);
    await setEta("PO-101", "label", addDays(todayIST(), 20));
    mockExtract.mockResolvedValueOnce(proposal(4));
    await handleInbound([{ ...first, text: "labels 4 din", editedAt: 1761235000 }], ALLOWED);
    const edited = (await getUpdates()).find((r) => r.id === "tg_1151636184_13_e1761235000")!;
    expect(edited.reason).toContain("could not be undone automatically");
    expect((await getUpdates()).find((r) => r.id === "tg_1151636184_13")!.status).toBe("applied"); // left as it was
  });

  it("revertMessageEffects finds the right rows and nothing else", async () => {
    mockExtract.mockResolvedValue(proposal(3));
    await handleInbound([first, { ...first, id: "1151636184_130", text: "labels 3 din" }], ALLOWED);
    const res = await revertMessageEffects("tg_1151636184_13"); // must not touch message 130
    expect(res.reverted.length + res.blocked.length).toBeLessThanOrEqual(1);
  });
});
