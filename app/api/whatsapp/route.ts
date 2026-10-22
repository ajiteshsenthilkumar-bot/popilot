import { after, NextResponse } from "next/server";
import { handleInbound } from "@/lib/inbound";
import { extractMessages, verifySignature } from "@/lib/whatsapp-cloud";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Meta calls this once, when you add the webhook, to check you own it.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (expected && q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === expected) {
    return new Response(q.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

// Meta calls this for every message. We must answer 200 fast, so the real work runs after the reply.
export async function POST(req: Request) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) return NextResponse.json({ error: "WhatsApp is not configured" }, { status: 503 });

  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), secret)) {
    return NextResponse.json({ error: "bad signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const messages = extractMessages(payload);
  if (messages.length) {
    after(async () => {
      try {
        const s = await handleInbound(messages);
        // counts only: message text is never logged
        console.log("whatsapp inbound", JSON.stringify(s));
      } catch (e) {
        console.error("whatsapp inbound failed:", (e as Error).message);
      }
    });
  }
  return NextResponse.json({ ok: true });
}
