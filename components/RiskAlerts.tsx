import type { RiskResult } from "@/lib/types";

export function RiskAlerts({ risks }: { risks: RiskResult[] }) {
  const hot = risks.filter((r) => r.at_risk).sort((a, b) => b.gap_days - a.gap_days);
  return (
    <section className="panel">
      <h2>3 · Stock-out risk</h2>
      <p className="sub">Stock ÷ daily sales (sample Shopify data) compared with the real ETA.</p>
      {hot.length === 0 ? (
        <div className="fine">No stock-out risks right now. Every PO arrives before stock runs out.</div>
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
