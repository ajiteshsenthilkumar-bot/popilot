import { after, NextResponse } from "next/server";
import { parseTelegramAllowList } from "@/lib/allowlist";
import { handleInbound } from "@/lib/inbound";
import { extractTelegramMessages, verifySecret } from "@/lib/telegram";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Telegram calls this for every message the bot can see. We must answer 200 fast, so the real work runs after.
// Telegram proves it is really Telegram by sending back the secret_token we gave it when registering the webhook.
export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ error: "Telegram is not configured" }, { status: 503 });
  if (!verifySecret(req.headers.get("x-telegram-bot-api-secret-token"), secret)) {
    return NextResponse.json({ error: "bad secret" }, { status: 401 });
  }

  let update: unknown;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const messages = extractTelegramMessages(update);
  if (messages.length) {
    after(async () => {
      try {
        const s = await handleInbound(messages, parseTelegramAllowList(process.env.TELEGRAM_ALLOWED));
        // counts only: message text is never logged
        console.log("telegram inbound", JSON.stringify(s));
      } catch (e) {
        console.error("telegram inbound failed:", (e as Error).message);
      }
    });
  }
  return NextResponse.json({ ok: true });
}
