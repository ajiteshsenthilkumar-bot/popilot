import { NextResponse } from "next/server";
import { todayIST } from "@/lib/dates";
import { assessRisk } from "@/lib/risk";
import { getStockAndSales } from "@/lib/shopify";
import { getPOs, getUpdates } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const today = todayIST();
    const [pos, stock, updates] = await Promise.all([getPOs(), getStockAndSales(), getUpdates()]);
    const risks = pos.map((po) => assessRisk(po, stock.find((s) => s.sku === po.sku), today));
    return NextResponse.json({ today, pos, risks, updates: updates.slice(-20).reverse() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
