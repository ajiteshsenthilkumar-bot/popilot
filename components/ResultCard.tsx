"use client";

import { useState } from "react";
import { formatDay } from "@/lib/dates";
import { ITEMS, type Item, type PO, type UpdateRow } from "@/lib/types";

const LABEL: Record<UpdateRow["status"], { text: string; cls: string }> = {
  pending: { text: "Update incomplete: check the sheet", cls: "warn" },
  applied: { text: "PO updated", cls: "ok" },
  confirmed: { text: "Confirmed by you", cls: "ok" },
  needs_review: { text: "Needs your review", cls: "warn" },
};

export function ResultCard({ u, pos, onDone }: { u: UpdateRow; pos: PO[]; onDone: () => void }) {
  // Only pre-fill what the AI actually proposed. Never default to the first PO: a blank choice must be made by a human.
  const [poId, setPoId] = useState(pos.some((p) => p.po_id === u.po_id) ? u.po_id : "");
  const [item, setItem] = useState<Item | "">((ITEMS as readonly string[]).includes(u.item) ? (u.item as Item) : "");
  const [eta, setEta] = useState(u.new_eta || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const low = u.confidence < 0.7;
  const s = LABEL[u.status];

  async function confirm() {
    if (busy || !poId || !item || !eta) return; // guard against double-clicks and half-filled choices
    setBusy(true);
    setErr("");
    const res = await fetch("/api/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: u.id, po_id: poId, item, eta }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) return setErr(data.error ?? "Couldn't confirm");
    onDone();
  }

  return (
    <div className={`card ${u.status === "needs_review" ? "review" : ""}`}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className={`pill ${s.cls}`}>{s.text}</span>
        <span className="sub2">
          {u.id.startsWith("wa_") ? "WhatsApp · " : ""}{u.source === "voice" ? "Voice note" : "Text"} · {new Date(u.timestamp).toLocaleTimeString()}
        </span>
      </div>

      <div className="orig">{u.original_text}</div>

      <dl>
        <dt>Vendor</dt><dd>{u.vendor || "—"}</dd>
        <dt>PO</dt><dd>{u.po_id || "—"}</dd>
        <dt>Item</dt><dd>{u.item || "—"}</dd>
        <dt>ETA change</dt>
        <dd>
          {u.old_eta ? formatDay(u.old_eta) : "—"} → <strong>{u.new_eta ? formatDay(u.new_eta) : "—"}</strong>{" "}
          {u.eta_expression && <span className="sub2">(read as: {u.eta_expression})</span>}
        </dd>
        <dt>Confidence</dt>
        <dd>
          <span className={`bar ${low ? "low" : ""}`}><i style={{ width: `${Math.round(u.confidence * 100)}%` }} /></span>
          {Math.round(u.confidence * 100)}% {low && <span className="pill bad">Low confidence</span>}
        </dd>
      </dl>
      {u.reason && <div className="sub2">{u.reason}</div>}

      {u.status === "needs_review" && (
        <div className="confirm">
          <div className="sub2" style={{ marginBottom: 6 }}>Nothing was changed. Check the guess below, fix it if needed, then confirm.</div>
          <div className="row">
            <select value={poId} onChange={(e) => setPoId(e.target.value)} aria-label="PO">
              <option value="">Choose PO…</option>
              {pos.map((p) => <option key={p.po_id} value={p.po_id}>{p.po_id} · {p.product}</option>)}
            </select>
            <select value={item} onChange={(e) => setItem(e.target.value as Item | "")} aria-label="Item">
              <option value="">Choose item…</option>
              {ITEMS.map((i) => <option key={i} value={i}>{i}</option>)}
            </select>
            <input type="date" value={eta} onChange={(e) => setEta(e.target.value)} aria-label="New ETA" />
            <button className="primary" onClick={confirm} disabled={busy || !eta || !poId || !item}>{busy ? "Saving…" : "Confirm"}</button>
          </div>
          {err && <div className="banner bad" style={{ marginTop: 8 }}>{err}</div>}
        </div>
      )}
    </div>
  );
}
