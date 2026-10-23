import { NextResponse } from "next/server";
import { deleteLogRow } from "@/lib/pipeline";

export const maxDuration = 60;

// The Delete button on a card that changed nothing (or was undone): remove it from the log.
export async function POST(req: Request) {
  try {
    const b = await req.json();
    await deleteLogRow(String(b.id ?? ""));
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}