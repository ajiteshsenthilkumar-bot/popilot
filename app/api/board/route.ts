import { NextResponse } from "next/server";
import { todayIST } from "@/lib/dates";
import { assessRisk } from "@/lib/risk";
import { findStock, getStockSnapshot, type StockSnapshot } from "@/lib/shopify";
import { getPOs, getUpdates } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const today = todayIST();

    // Shopify trouble must not hide the PO board. We report it, and never pretend there is "no risk".
    const stockPromise: Promise<StockSnapshot> = getStockSnapshot().catch((e: Error) => ({
      records: [], source: "shopify" as const, asOf: new Date().toISOString(), stale: true, error: e.message,
    }));
    const [pos, snap, updates] = await Promise.all([getPOs(), stockPromise, getUpdates()]);

    const risks = pos.map((po) => assessRisk(po, findStock(snap.records, po.sku), today));
    const missingSkus = snap.records.length
      ? pos.filter((po) => !findStock(snap.records, po.sku)).map((po) => ({ po_id: po.po_id, sku: po.sku }))
      : [];

    return NextResponse.json({
      today,
      pos,
      risks,
      stockInfo: { source: snap.source, asOf: snap.asOf, stale: snap.stale, error: snap.error ?? null, unavailable: snap.records.length === 0 && snap.source === "shopify" },
      missingSkus,
      updates: updates.slice(-20).reverse(),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
