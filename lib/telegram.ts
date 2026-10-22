// Telegram bot intake: check the webhook is really from Telegram, read its messages, fetch voice-note audio.
// The bot never replies to anyone. It only listens, and only to people/groups on TELEGRAM_ALLOWED.
import { timingSafeEqual } from "node:crypto";
import type { InboundMessage } from "./channels";

// Telegram echoes back the `secret_token` we set when registering the webhook, in this header.
export function verifySecret(header: string | null, secret: string): boolean {
  if (!header || !secret) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Pull the message out of one Telegram "update". Bots' own messages, edits and channel posts are ignored.
export function extractTelegramMessages(update: any): InboundMessage[] {
  const m = update?.message;
  if (!m?.message_id || m.chat?.id === undefined || m.from?.id === undefined || m.from?.is_bot) return [];
  const isGroup = m.chat.type === "group" || m.chat.type === "supergroup";
  const voice = m.voice ?? m.audio;
  return [
    {
      channel: "telegram",
      id: `${m.chat.id}_${m.message_id}`,
      from: String(m.from.id),
      groupId: isGroup ? String(m.chat.id) : undefined,
      type: typeof m.text === "string" ? "text" : voice ? "audio" : "other",
      text: typeof m.text === "string" ? m.text : undefined,
      mediaId: voice?.file_id,
      mime: voice?.mime_type ?? (m.voice ? "audio/ogg" : undefined),
      forwarded: Boolean(m.forward_origin || m.forward_date || m.forward_from || m.forward_from_chat),
    },
  ];
}

const FILE_LIMIT = 20 * 1024 * 1024; // Telegram bots can only download files up to 20 MB

// Two steps: ask Telegram where the file is, then download it. Errors never include the bot token.
export async function downloadTelegramFile(fileId: string, botToken: string): Promise<{ bytes: Buffer; mime?: string }> {
  const info = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!info.ok) throw new Error(`Telegram file lookup failed (${info.status})`);
  const json = (await info.json()) as { ok?: boolean; result?: { file_path?: string; file_size?: number } };
  const path = json.result?.file_path;
  if (!json.ok || !path) throw new Error("Telegram returned no file path");
  if ((json.result?.file_size ?? 0) > FILE_LIMIT) throw new Error("voice note is too large");

  const file = await fetch(`https://api.telegram.org/file/bot${botToken}/${path}`, { signal: AbortSignal.timeout(30_000) });
  if (!file.ok) throw new Error(`Telegram file download failed (${file.status})`);
  return { bytes: Buffer.from(await file.arrayBuffer()) };
}
