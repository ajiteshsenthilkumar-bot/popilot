import type { RiskResult } from "@/lib/types";

export interface StockInfo {
  source: "shopify" | "sample";
  asOf: string;
  stale: boolean;
  error: string | null;
  unavailable: boolean;
}

function time(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function RiskAlerts({ risks, stockInfo, missingSkus = [] }: {
  risks: RiskResult[];
  stockInfo?: StockInfo;
  missingSkus?: { po_id: string; sku: string }[];
}) {
  const hot = risks.filter((r) => r.at_risk).sort((a, b) => b.gap_days - a.gap_days);
  const sourceLine =
    stockInfo?.source === "shopify"
      ? stockInfo.unavailable
        ? "Shopify data unavailable"
        : stockInfo.stale
          ? `Shopify unreachable, showing numbers from ${time(stockInfo.asOf)}`
          : `Live Shopify · updated ${time(stockInfo.asOf)}`
      : "Sample data (Shopify not connected)";

  return (
    <section className="panel">
      <h2>3 · Stock-out risk</h2>
      <p className="sub">Stock ÷ daily sales (last 30 days) compared with the real ETA. {sourceLine}.</p>

      {stockInfo?.unavailable && (
        <div className="banner bad">
          Can't check stock-out risk: Shopify didn't answer ({stockInfo.error}). The PO board below is still up to date.
        </div>
      )}
      {stockInfo?.stale && !stockInfo.unavailable && (
        <div className="banner warn">Shopify didn't answer just now ({stockInfo.error}). These numbers may be out of date.</div>
      )}
      {missingSkus.length > 0 && (
        <div className="banner warn">
          No Shopify stock found for: {missingSkus.map((m) => `${m.sku} (${m.po_id})`).join(", ")}. Make the PO's sku in the sheet match the
          SKU in Shopify, or these can't be checked.
        </div>
      )}

      {stockInfo?.unavailable ? null : hot.length === 0 ? (
        <div className="fine">No stock-out risks among the SKUs that could be checked.</div>
      ) : (
        hot.map((r) => (
          <div className="alert" key={r.po_id}>
            <strong>{r.po_id}</strong> · {r.alert}
          </div>
        ))
      )}
    </section>
  );
}
