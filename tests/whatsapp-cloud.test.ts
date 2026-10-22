import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { audioFormat } from "@/lib/transcribe";
import { downloadMedia, extractMessages, verifySignature } from "@/lib/whatsapp-cloud";

const SECRET = "app-secret-123";
const sign = (body: string, secret = SECRET) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

const payload = (messages: any[]) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", messages } }] }],
});

describe("webhook signature", () => {
  const body = JSON.stringify(payload([]));
  it("accepts a correct signature", () => expect(verifySignature(body, sign(body), SECRET)).toBe(true));
  it("rejects a wrong secret, a tampered body, a missing header and an empty secret", () => {
    expect(verifySignature(body, sign(body, "other"), SECRET)).toBe(false);
    expect(verifySignature(body + " ", sign(body), SECRET)).toBe(false);
    expect(verifySignature(body, null, SECRET)).toBe(false);
    expect(verifySignature(body, sign(body, ""), "")).toBe(false);
    expect(verifySignature(body, "sha256=short", SECRET)).toBe(false);
  });
});

describe("extractMessages", () => {
  it("reads text, voice, forwarded and group messages", () => {
    const msgs = extractMessages(
      payload([
        { from: "919812345678", id: "wamid.A", type: "text", text: { body: "labels Monday tak" } },
        { from: "919812345678", id: "wamid.B", type: "audio", audio: { id: "MEDIA1", mime_type: "audio/ogg; codecs=opus", voice: true } },
        { from: "919876500000", id: "wamid.C", type: "text", text: { body: "fwd" }, context: { forwarded: true } },
        { from: "919812345678", id: "wamid.D", type: "text", text: { body: "in group" }, group_id: "120363@g.us" },
        { from: "919812345678", id: "wamid.E", type: "image", image: { id: "IMG" } },
      ]),
    );
    expect(msgs.map((m) => [m.id, m.type, m.forwarded, m.groupId])).toEqual([
      ["wamid.A", "text", false, undefined],
      ["wamid.B", "audio", false, undefined],
      ["wamid.C", "text", true, undefined],
      ["wamid.D", "text", false, "120363@g.us"],
      ["wamid.E", "image", false, undefined],
    ]);
    expect(msgs[1].mediaId).toBe("MEDIA1");
    expect(msgs[0].text).toBe("labels Monday tak");
  });

  it("ignores delivery statuses, other objects and junk", () => {
    expect(extractMessages({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { statuses: [{ id: "x" }] } }] }] })).toEqual([]);
    expect(extractMessages({ object: "page" })).toEqual([]);
    expect(extractMessages(null)).toEqual([]);
  });
});

describe("voice-note download + format", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("maps mime types to OpenRouter formats, defaulting to ogg for WhatsApp voice notes", () => {
    expect(audioFormat("audio/ogg; codecs=opus")).toBe("ogg");
    expect(audioFormat("audio/mpeg")).toBe("mp3");
    expect(audioFormat("audio/wav")).toBe("wav");
    expect(audioFormat("audio/mp4")).toBe("m4a");
    expect(audioFormat("something/else")).toBe("ogg");
  });

  it("looks the file up, then downloads it, both with the bearer token", async () => {
    const calls: { url: string; auth: string }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: any) => {
      calls.push({ url, auth: init.headers.Authorization });
      if (url.includes("graph.facebook.com")) return { ok: true, json: async () => ({ url: "https://cdn.test/file", mime_type: "audio/ogg" }) };
      return { ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
    });
    const r = await downloadMedia("MEDIA1", "TOKEN");
    expect(r.bytes.length).toBe(3);
    expect(r.mime).toBe("audio/ogg");
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.auth === "Bearer TOKEN")).toBe(true);
  });

  it("fails clearly when Meta says no", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 401 }));
    await expect(downloadMedia("M", "bad")).rejects.toThrow(/401/);
  });
});
