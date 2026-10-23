import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { notifyOwners } from "@/lib/alerts";
import { runStockCheck } from "@/lib/dailyCheck";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Vercel Cron calls this once a day (see vercel.json) and sends "Authorization: Bearer <CRON_SECRET>".
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET is not set" }, { status: 503 });
  if (!authorised(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const result = await runStockCheck();
    console.log("daily stock check", JSON.stringify(result));
    return NextResponse.json(result);
  } catch (e) {
    const message = (e as Error).message;
    console.error("daily stock check failed:", message);
    // A broken safety check must not stay silent: tell the owner (best effort).
    await notifyOwners(`⚠️ POPilot's daily stock check couldn't run: ${message}`).catch(() => {});
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
