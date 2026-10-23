import { NextResponse } from "next/server";
import { undoUpdate } from "@/lib/pipeline";

export const maxDuration = 60;

// The Undo button on an applied card: put the PO's date back, if it still holds the date that update wrote.
export async function POST(req: Request) {
  try {
    const b = await req.json();
    const update = await undoUpdate(String(b.id ?? ""));
    return NextResponse.json({ update });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
