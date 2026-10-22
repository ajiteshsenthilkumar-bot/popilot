import { NextResponse } from "next/server";
import { confirmUpdate } from "@/lib/pipeline";

export async function POST(req: Request) {
  try {
    const b = await req.json();
    const update = await confirmUpdate({
      id: String(b.id ?? ""),
      po_id: String(b.po_id ?? ""),
      item: b.item,
      eta: String(b.eta ?? ""),
    });
    return NextResponse.json({ update });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
