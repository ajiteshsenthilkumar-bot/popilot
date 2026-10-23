// The WhatsApp flow end to end, with the AI, transcription and Meta download faked.
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InboundDeps } from "@/lib/inbound";
import { handleInbound } from "@/lib/inbound";
import { parseTelegramAllowList } from "@/lib/allowlist";
import type { InboundMessage } from "@/lib/channels";
import type { UpdateRow } from "@/lib/types";

const ALLOWED = "919812345678=Rajesh Labels, 919876500000=*";
const msg = (o: Partial<InboundMessage>): InboundMessage => ({ channel: "whatsapp", id: "m1", from: "919812345678", type: "text", text: "labels Monday tak nahi aayenge", forwarded: false, ...o });
const row = (o: Partial<UpdateRow> = {}): UpdateRow => ({
  id: "wa_m1", timestamp: "", original_text: "", source: "text", vendor: "Rajesh Labels", po_id: "PO-101", item: "label",
  eta_expression: "", old_eta: "", new_eta: "", confidence: 0.9, status: "applied", reason: "", ...o,
});

let deps: InboundDeps;
let logged: UpdateRow[];
beforeEach(() => {
  logged = [];
  process.env.WHATSAPP_ACCESS_TOKEN = "TOKEN";
  deps = {
    process: vi.fn(async () => row()),
    transcribe: vi.fn(async () => "labels ab 7 din mein pahunchenge"),
    download: vi.fn(async () => ({ bytes: Buffer.from([1, 2, 3]), mime: "audio/ogg; codecs=opus" })),
    knownIds: vi.fn(async () => new Set<string>()),
    logReview: vi.fn(async (r: UpdateRow) => { logged.push(r); }),
    revertEdited: vi.fn(async () => ({ reverted: [] as string[], blocked: [] as string[] })),
  };
});

describe("WhatsApp inbound handling", () => {
  it("processes an allowed vendor's text and passes the vendor name and message id", async () => {
    const s = await handleInbound([msg({})], ALLOWED, deps);
    expect(s).toMatchObject({ processed: 1, applied: 1, notAllowed: 0 });
    expect(deps.process).toHaveBeenCalledWith({
      text: "labels Monday tak nahi aayenge", source: "text", sender: "Rajesh Labels", id: "wa_m1", dropIrrelevant: true,
    });
  });

  it("drops people who are not on the list before anything reads their message", async () => {
    const s = await handleInbound([msg({ from: "919999999999" })], ALLOWED, deps);
    expect(s.notAllowed).toBe(1);
    expect(deps.process).not.toHaveBeenCalled();
    expect(deps.knownIds).not.toHaveBeenCalled();
    expect(deps.download).not.toHaveBeenCalled();
  });

  it("drops everything when the allow-list is empty", async () => {
    const s = await handleInbound([msg({})], "", deps);
    expect(s.notAllowed).toBe(1);
    expect(deps.process).not.toHaveBeenCalled();
  });

  it("lets the forwarder through but gives the AI no vendor name", async () => {
    await handleInbound([msg({ from: "919876500000", forwarded: true })], ALLOWED, deps);
    expect((deps.process as any).mock.calls[0][0].sender).toBeUndefined();
  });

  it("skips chit-chat without calling the AI", async () => {
    const s = await handleInbound([msg({ text: "ok \u{1F64F}" })], ALLOWED, deps);
    expect(s.irrelevant).toBe(1);
    expect(deps.process).not.toHaveBeenCalled();
  });

  it("drops a message the AI says is not about supply, and stores nothing", async () => {
    (deps.process as any).mockResolvedValue(null);
    const s = await handleInbound([msg({ text: "bhaiya Diwali ki shubhkamnayein, family ko pranam" })], ALLOWED, deps);
    expect(s).toMatchObject({ irrelevant: 1, processed: 0 });
    expect(logged).toEqual([]);
  });

  it("skips a message Meta delivers twice", async () => {
    (deps.knownIds as any).mockResolvedValue(new Set(["wa_m1"]));
    const s = await handleInbound([msg({})], ALLOWED, deps);
    expect(s.duplicates).toBe(1);
    expect(deps.process).not.toHaveBeenCalled();
  });

  it("processes a message only once when Meta delivers it twice at the same moment", async () => {
    (deps.process as any).mockImplementation(() => new Promise((r) => setTimeout(() => r(row()), 30)));
    const [a, b] = await Promise.all([handleInbound([msg({})], ALLOWED, deps), handleInbound([msg({})], ALLOWED, deps)]);
    expect(deps.process).toHaveBeenCalledTimes(1);
    expect(a.processed + b.processed).toBe(1);
    expect(a.duplicates + b.duplicates).toBe(1);
  });

  it("lets the same id be retried after a failure", async () => {
    (deps.process as any).mockRejectedValueOnce(new Error("sheet down")).mockResolvedValueOnce(row());
    expect((await handleInbound([msg({})], ALLOWED, deps)).errors).toBe(1);
    expect((await handleInbound([msg({})], ALLOWED, deps)).processed).toBe(1);
  });

  it("handles the same id twice inside one delivery", async () => {
    const s = await handleInbound([msg({}), msg({})], ALLOWED, deps);
    expect(s).toMatchObject({ processed: 1, duplicates: 1 });
  });

  it("transcribes a voice note, then processes the transcript as voice", async () => {
    const s = await handleInbound([msg({ id: "v1", type: "audio", text: undefined, mediaId: "MEDIA1", mime: "audio/ogg" })], ALLOWED, deps);
    expect(deps.download).toHaveBeenCalledWith(expect.objectContaining({ mediaId: "MEDIA1", channel: "whatsapp" }));
    expect(deps.transcribe).toHaveBeenCalled();
    expect((deps.process as any).mock.calls[0][0]).toMatchObject({ text: "labels ab 7 din mein pahunchenge", source: "voice", id: "wa_v1" });
    expect(s.processed).toBe(1);
  });

  it("flags a voice note it can't read for review instead of guessing", async () => {
    (deps.transcribe as any).mockRejectedValue(new Error("model error"));
    const s = await handleInbound([msg({ id: "v2", type: "audio", text: undefined, mediaId: "MEDIA2" })], ALLOWED, deps);
    expect(s.needsReview).toBe(1);
    expect(deps.process).not.toHaveBeenCalled();
    expect(logged[0]).toMatchObject({ id: "wa_v2", status: "needs_review", source: "voice", po_id: "" });
    expect(logged[0].reason).toMatch(/needs your review/i);
  });

  it("drops a voice note with no speech", async () => {
    (deps.transcribe as any).mockResolvedValue("");
    const s = await handleInbound([msg({ type: "audio", text: undefined, mediaId: "M" })], ALLOWED, deps);
    expect(s.irrelevant).toBe(1);
    expect(deps.process).not.toHaveBeenCalled();
  });

  it("ignores images and other types", async () => {
    const s = await handleInbound([msg({ type: "image", text: undefined })], ALLOWED, deps);
    expect(s.unsupported).toBe(1);
    expect(deps.process).not.toHaveBeenCalled();
  });

  it("counts a failure without crashing the rest of the batch", async () => {
    (deps.process as any).mockRejectedValueOnce(new Error("sheet down")).mockResolvedValueOnce(row({ id: "wa_m2" }));
    const s = await handleInbound([msg({ id: "m1" }), msg({ id: "m2" })], ALLOWED, deps);
    expect(s).toMatchObject({ errors: 1, processed: 1 });
  });

  it("counts review rows separately from applied ones", async () => {
    (deps.process as any).mockResolvedValue(row({ status: "needs_review" }));
    const s = await handleInbound([msg({})], ALLOWED, deps);
    expect(s).toMatchObject({ needsReview: 1, applied: 0 });
  });
});

describe("edited messages", () => {
  const edit = (o: Partial<InboundMessage> = {}): InboundMessage =>
    msg({ channel: "telegram", id: "987654321_55", from: "919812345678", editedAt: 1761234567, text: "PO 105: labels Monday tak nahi aayenge", ...o });

  it("undoes the earlier version first, then reads the corrected text under its own id, with a note", async () => {
    (deps.revertEdited as any).mockResolvedValue({ reverted: ["PO-101 label"], blocked: [] });
    const s = await handleInbound([edit()], ALLOWED, deps);
    expect(deps.revertEdited).toHaveBeenCalledWith("tg_987654321_55");
    const call = (deps.process as any).mock.calls[0][0];
    expect(call.id).toBe("tg_987654321_55_e1761234567");
    expect(call.text).toBe("PO 105: labels Monday tak nahi aayenge");
    expect(call.note).toContain("earlier change (PO-101 label) was undone first");
    expect(s.processed).toBe(1);
  });

  it("an edit of a message that did nothing earlier needs no note", async () => {
    await handleInbound([edit()], ALLOWED, deps);
    expect((deps.process as any).mock.calls[0][0].note).toBeUndefined();
  });

  it("says so when the earlier change could not be undone safely", async () => {
    (deps.revertEdited as any).mockResolvedValue({ reverted: [], blocked: ["PO-101 label is now 2026-11-02, not 2026-10-26, so it was changed again."] });
    await handleInbound([edit()], ALLOWED, deps);
    expect((deps.process as any).mock.calls[0][0].note).toContain("could not be undone automatically");
  });

  it("handles the same edit only once", async () => {
    (deps.knownIds as any).mockResolvedValue(new Set(["tg_987654321_55_e1761234567"]));
    const s = await handleInbound([edit()], ALLOWED, deps);
    expect(s.duplicates).toBe(1);
    expect(deps.revertEdited).not.toHaveBeenCalled();
  });

  it("if the corrected text leads nowhere, it still leaves a trace of what was undone", async () => {
    (deps.revertEdited as any).mockResolvedValue({ reverted: ["PO-101 label"], blocked: [] });
    (deps.process as any).mockResolvedValue(null); // the AI says it is not about supply
    await handleInbound([edit({ text: "sorry bhaiya wrong chat, Diwali ki shubhkamnayein" })], ALLOWED, deps);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ status: "reverted", id: "tg_987654321_55_e1761234567" });
    expect(logged[0].reason).toContain("was undone first");
  });

  it("an edit from someone not on the allow-list is dropped like any other message", async () => {
    const s = await handleInbound([edit({ from: "919999999999" })], ALLOWED, deps);
    expect(s.notAllowed).toBe(1);
    expect(deps.revertEdited).not.toHaveBeenCalled();
  });
});

describe("Telegram messages through the same handler", () => {
  const tg = (o: Partial<InboundMessage> = {}): InboundMessage => ({
    channel: "telegram", id: "-1001234_55", from: "987654321", type: "text", text: "box 3 din aur lagenge", forwarded: false, ...o,
  });
  const TG_ALLOWED = parseTelegramAllowList("123456789=*,987654321=Pack Wale,-1001234=Vendor Group");

  it("uses the tg_ id prefix and the vendor name from the allow-list", async () => {
    const s = await handleInbound([tg()], TG_ALLOWED, deps);
    expect(s.processed).toBe(1);
    expect(deps.process).toHaveBeenCalledWith(expect.objectContaining({ id: "tg_-1001234_55", sender: "Pack Wale", source: "text" }));
  });

  it("drops an unknown Telegram user, even in a listed group's private chat", async () => {
    const s = await handleInbound([tg({ from: "555555555" })], TG_ALLOWED, deps);
    expect(s.notAllowed).toBe(1);
    expect(deps.process).not.toHaveBeenCalled();
  });

  it("accepts a listed group, and names the vendor from the member or the group", async () => {
    await handleInbound([tg({ groupId: "-1001234" })], TG_ALLOWED, deps);
    expect((deps.process as any).mock.calls[0][0].sender).toBe("Pack Wale");
    await handleInbound([tg({ id: "-1001234_56", from: "444444444", groupId: "-1001234" })], TG_ALLOWED, deps);
    expect((deps.process as any).mock.calls[1][0].sender).toBe("Vendor Group");
  });

  it("drops a group that is not listed", async () => {
    const s = await handleInbound([tg({ groupId: "-999999" })], TG_ALLOWED, deps);
    expect(s.notAllowed).toBe(1);
  });

  it("a Telegram and a WhatsApp message with the same raw id are different messages", async () => {
    const s = await handleInbound([msg({ id: "1_1" }), tg({ id: "1_1", from: "987654321" })], ["919812345678=Rajesh Labels"].join(",") + ",987654321=Pack Wale", deps);
    expect(s.processed).toBe(2);
  });
});

describe("webhook route", () => {
  const inboundMock = vi.fn(async () => ({}));
  beforeEach(() => {
    vi.resetModules();
    inboundMock.mockClear();
    process.env.WHATSAPP_APP_SECRET = "s3cret";
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-me";
  });

  async function load() {
    vi.doMock("next/server", async (orig) => ({ ...(await orig<any>()), after: (fn: () => any) => fn() }));
    vi.doMock("@/lib/inbound", () => ({ handleInbound: inboundMock }));
    return import("@/app/api/whatsapp/route");
  }
  const body = JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ value: { messages: [{ from: "919812345678", id: "wamid.X", type: "text", text: { body: "hi" } }] } }] }],
  });
  const sig = (b: string, s = "s3cret") => "sha256=" + createHmac("sha256", s).update(b).digest("hex");
  const post = (b: string, signature?: string) =>
    new Request("http://x/api/whatsapp", { method: "POST", body: b, headers: signature ? { "x-hub-signature-256": signature } : {} });

  it("answers Meta's verification challenge only with the right token", async () => {
    const { GET } = await load();
    const ok = await GET(new Request("http://x/api/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345"));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("12345");
    const bad = await GET(new Request("http://x/api/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=12345"));
    expect(bad.status).toBe(403);
  });

  it("rejects an unsigned or wrongly signed post and never processes it", async () => {
    const { POST } = await load();
    expect((await POST(post(body))).status).toBe(401);
    expect((await POST(post(body, sig(body, "wrong")))).status).toBe(401);
    expect(inboundMock).not.toHaveBeenCalled();
  });

  it("accepts a correctly signed post and hands the messages on", async () => {
    const { POST } = await load();
    const r = await POST(post(body, sig(body)));
    expect(r.status).toBe(200);
    expect(inboundMock).toHaveBeenCalledTimes(1);
    expect((inboundMock.mock.calls[0] as any)[0][0]).toMatchObject({ id: "wamid.X", from: "919812345678" });
  });

  it("is switched off (503) until the app secret is set", async () => {
    delete process.env.WHATSAPP_APP_SECRET;
    const { POST } = await load();
    expect((await POST(post(body, sig(body)))).status).toBe(503);
  });
});

