// Meta WhatsApp Cloud API: check the webhook is really from Meta, read its messages, fetch voice-note audio.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { InboundMessage } from "./channels";

export const GRAPH_VERSION = "v21.0";

// Meta signs every webhook body with your App Secret: header "X-Hub-Signature-256: sha256=<hex>".
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!header || !appSecret) return false;
  const expected = "sha256=" + createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Pull the messages out of Meta's webhook payload. Delivery/read "statuses" are ignored.
export function extractMessages(payload: any): InboundMessage[] {
  const out: InboundMessage[] = [];
  if (payload?.object !== "whatsapp_business_account") return out;
  for (const entry of payload.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const m of change?.value?.messages ?? []) {
        if (!m?.id || !m?.from) continue;
        out.push({
          channel: "whatsapp",
          id: String(m.id),
          from: String(m.from).replace(/\D/g, ""),
          groupId: m.group_id ? String(m.group_id) : undefined,
          type: String(m.type ?? ""),
          text: m.type === "text" ? m.text?.body : undefined,
          mediaId: m.type === "audio" ? m.audio?.id : undefined,
          mime: m.type === "audio" ? m.audio?.mime_type : undefined,
          forwarded: Boolean(m.context?.forwarded || m.context?.frequently_forwarded),
        });
      }
    }
  }
  return out;
}

// Two steps, both authorised with your access token: ask Meta where the file is, then download it.
export async function downloadMedia(mediaId: string, accessToken: string): Promise<{ bytes: Buffer; mime: string }> {
  const auth = { Authorization: `Bearer ${accessToken}` };
  const meta = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(mediaId)}`, {
    headers: auth,
    signal: AbortSignal.timeout(20_000),
  });
  if (!meta.ok) throw new Error(`Meta media lookup failed (${meta.status})`);
  const info = (await meta.json()) as { url?: string; mime_type?: string };
  if (!info.url) throw new Error("Meta returned no media URL");

  const file = await fetch(info.url, { headers: auth, signal: AbortSignal.timeout(30_000) });
  if (!file.ok) throw new Error(`Meta media download failed (${file.status})`);
  return { bytes: Buffer.from(await file.arrayBuffer()), mime: info.mime_type ?? "audio/ogg" };
}
