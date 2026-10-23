import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseTelegramAllowList } from "@/lib/allowlist";
import { isTrivial } from "@/lib/relevance";
import { downloadTelegramFile, extractTelegramMessages, verifySecret } from "@/lib/telegram";

const base = { message_id: 55, date: 1, chat: { id: 987654321, type: "private" }, from: { id: 987654321, is_bot: false, first_name: "Raj" } };

describe("telegram secret header", () => {
  it("accepts only the exact secret", () => {
    expect(verifySecret("s3cret_token", "s3cret_token")).toBe(true);
    expect(verifySecret("s3cret_token ", "s3cret_token")).toBe(false);
    expect(verifySecret("wrong", "s3cret_token")).toBe(false);
    expect(verifySecret(null, "s3cret_token")).toBe(false);
    expect(verifySecret("anything", "")).toBe(false);
  });
});

describe("extractTelegramMessages", () => {
  it("reads a private text message", () => {
    const [m] = extractTelegramMessages({ message: { ...base, text: "labels Monday tak" } });
    expect(m).toMatchObject({ channel: "telegram", id: "987654321_55", from: "987654321", type: "text", text: "labels Monday tak", forwarded: false });
    expect(m.groupId).toBeUndefined();
  });

  it("reads a voice note", () => {
    const [m] = extractTelegramMessages({ message: { ...base, voice: { file_id: "FILE1", mime_type: "audio/ogg", duration: 5 } } });
    expect(m).toMatchObject({ type: "audio", mediaId: "FILE1", mime: "audio/ogg" });
  });

  it("marks group messages with the group's chat id, and forwarded ones", () => {
    const [m] = extractTelegramMessages({
      message: { ...base, chat: { id: -1001234, type: "supergroup" }, text: "hi", forward_origin: { type: "user" } },
    });
    expect(m).toMatchObject({ groupId: "-1001234", forwarded: true, id: "-1001234_55" });
  });

  it("reads an EDITED text message (with its edit time) and ignores edited voice notes", () => {
    const [m] = extractTelegramMessages({ edited_message: { ...base, text: "PO 105 labels Monday", edit_date: 1761234567 } });
    expect(m).toMatchObject({ id: "987654321_55", type: "text", text: "PO 105 labels Monday", editedAt: 1761234567 });
    expect(extractTelegramMessages({ message: { ...base, text: "first" } })[0].editedAt).toBeUndefined();
    expect(extractTelegramMessages({ edited_message: { ...base, voice: { file_id: "F" }, edit_date: 1 } })).toEqual([]);
  });

  it("ignores bots, channel posts and photos' text", () => {
    expect(extractTelegramMessages({ message: { ...base, from: { id: 1, is_bot: true }, text: "x" } })).toEqual([]);
    expect(extractTelegramMessages({ channel_post: { ...base, text: "x" } })).toEqual([]);
    expect(extractTelegramMessages(null)).toEqual([]);
    expect(extractTelegramMessages({ message: { ...base, photo: [{}] } })[0].type).toBe("other");
  });
});

describe("telegram allow-list", () => {
  it("separates people (positive ids) from groups (negative ids) and ignores junk", () => {
    expect(parseTelegramAllowList("123456789=*, 987654321=Rajesh Labels, -1001234567890=Vendor Group, 12=Short, abc=Nope")).toEqual([
      { key: "123456789", vendor: null },
      { key: "987654321", vendor: "Rajesh Labels" },
      { key: "group:-1001234567890", vendor: "Vendor Group" },
    ]);
    expect(parseTelegramAllowList("")).toEqual([]);
  });

  it("treats bot commands as chit-chat", () => {
    expect(isTrivial("/start")).toBe(true);
    expect(isTrivial("/start@popilot_bot")).toBe(true);
    expect(isTrivial("/ labels late")).toBe(false);
  });
});

describe("telegram file download", () => {
  const calls: string[] = [];
  beforeEach(() => { calls.length = 0; });
  afterEach(() => vi.unstubAllGlobals());

  it("looks the file up, then downloads it", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      calls.push(url);
      if (url.includes("/getFile")) return { ok: true, json: async () => ({ ok: true, result: { file_path: "voice/file_1.oga", file_size: 1000 } }) };
      return { ok: true, arrayBuffer: async () => new Uint8Array([9, 9]).buffer };
    });
    const r = await downloadTelegramFile("FILE1", "123:ABC");
    expect(r.bytes.length).toBe(2);
    expect(calls[0]).toContain("/bot123:ABC/getFile?file_id=FILE1");
    expect(calls[1]).toBe("https://api.telegram.org/file/bot123:ABC/voice/file_1.oga");
  });

  it("refuses oversize files and never leaks the bot token in errors", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => ({ ok: true, result: { file_path: "x", file_size: 25 * 1024 * 1024 } }) }));
    await expect(downloadTelegramFile("F", "123:SECRETTOKEN")).rejects.toThrow(/too large/);
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 401 }));
    await expect(downloadTelegramFile("F", "123:SECRETTOKEN")).rejects.toThrow(/401/);
    await downloadTelegramFile("F", "123:SECRETTOKEN").catch((e) => expect(String(e.message)).not.toContain("SECRETTOKEN"));
  });
});

describe("telegram webhook route", () => {
  const inboundMock = vi.fn(async () => ({}));
  beforeEach(() => {
    vi.resetModules();
    inboundMock.mockClear();
    process.env.TELEGRAM_WEBHOOK_SECRET = "hook_secret-1";
    process.env.TELEGRAM_ALLOWED = "987654321=Rajesh Labels";
  });

  async function load() {
    vi.doMock("next/server", async (orig) => ({ ...(await orig<any>()), after: (fn: () => any) => fn() }));
    vi.doMock("@/lib/inbound", () => ({ handleInbound: inboundMock }));
    return import("@/app/api/telegram/route");
  }
  const update = JSON.stringify({ update_id: 1, message: { ...base, text: "labels Monday tak" } });
  const post = (b: string, secret?: string) =>
    new Request("http://x/api/telegram", { method: "POST", body: b, headers: secret ? { "x-telegram-bot-api-secret-token": secret } : {} });

  it("rejects a call without the right secret and never processes it", async () => {
    const { POST } = await load();
    expect((await POST(post(update))).status).toBe(401);
    expect((await POST(post(update, "wrong"))).status).toBe(401);
    expect(inboundMock).not.toHaveBeenCalled();
  });

  it("accepts the right secret and passes the message and parsed allow-list on", async () => {
    const { POST } = await load();
    const r = await POST(post(update, "hook_secret-1"));
    expect(r.status).toBe(200);
    expect(inboundMock).toHaveBeenCalledTimes(1);
    const [msgs, allow] = inboundMock.mock.calls[0] as any;
    expect(msgs[0]).toMatchObject({ channel: "telegram", text: "labels Monday tak" });
    expect(allow).toEqual([{ key: "987654321", vendor: "Rajesh Labels" }]);
  });

  it("answers 200 and does nothing for updates with no message (other event types)", async () => {
    const { POST } = await load();
    const r = await POST(post(JSON.stringify({ update_id: 2, my_chat_member: { chat: base.chat } }), "hook_secret-1"));
    expect(r.status).toBe(200);
    expect(inboundMock).not.toHaveBeenCalled();
  });

  it("is switched off (503) until the secret is set, and 400 on junk", async () => {
    const { POST } = await load();
    expect((await POST(post("not json", "hook_secret-1"))).status).toBe(400);
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    const mod = await load();
    expect((await mod.POST(post(update, "hook_secret-1"))).status).toBe(503);
  });
});
