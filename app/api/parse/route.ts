import { NextResponse } from "next/server";
import { processMessage } from "@/lib/pipeline";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 4000) : "";
    if (!text) return NextResponse.json({ error: "Paste a message first" }, { status: 400 });
    const source = body.source === "voice" ? "voice" : "text";
    const sender = typeof body.sender === "string" ? body.sender.trim().slice(0, 100) : undefined;
    const update = await processMessage({ text, source, sender });
    return NextResponse.json({ update });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
