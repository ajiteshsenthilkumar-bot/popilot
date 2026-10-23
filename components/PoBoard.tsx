import { ITEMS, type PO, type RiskResult } from "@/lib/types";

export interface DateProblem { po_id: string; item: string; value: string }

export function PoBoard({ pos, risks, problems = [] }: { pos: PO[]; risks: RiskResult[]; problems?: DateProblem[] }) {
  return (
    <section className="panel" id="board" tabIndex={-1}>
      <h2>3 · PO board</h2>
      <p className="sub">One PO per product. The slowest open input sets the real ETA.</p>
      {problems.length > 0 && (
        <div className="banner warn">
          These dates in the sheet can't be read, so they're left out of the stock-out check:{" "}
          {problems.map((p) => `${p.po_id} ${p.item} (${p.value ? `"${p.value}"` : "empty"})`).join(", ")}.
          Use the format YYYY-MM-DD (for example 2026-11-05), or set the item to "delivered".
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>PO</th>
              <th>Product</th>
              {ITEMS.map((i) => <th key={i} style={{ textTransform: "capitalize" }}>{i}</th>)}
              <th>Real ETA</th>
              <th>Stock left</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {pos.map((po) => {
              const r = risks.find((x) => x.po_id === po.po_id);
              return (
                <tr key={po.po_id} className={r?.at_risk ? "risk" : ""}>
                  <td><strong>{po.po_id}</strong></td>
                  <td>{po.product}<div className="sub2">{po.sku}</div></td>
                  {ITEMS.map((i) => {
                    const inp = po.inputs[i];
                    return (
                      <td key={i}>
                        {inp.status === "delivered" ? <span className="pill grey">Delivered</span> : <strong>{inp.eta || "—"}</strong>}
                        <div className="sub2">{inp.vendor}</div>
                      </td>
                    );
                  })}
                  <td>{r?.real_eta ?? "—"}{r?.slowest_item && <div className="sub2">{r.slowest_item}</div>}</td>
                  <td>{r?.days_left != null ? `${r.days_left} days` : "—"}</td>
                  <td>
                    {r?.at_risk ? <span className="pill bad">At risk · {r.gap_days}d gap</span>
                      : r?.real_eta ? <span className="pill ok">On track</span>
                      : <span className="pill grey">No open items</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
