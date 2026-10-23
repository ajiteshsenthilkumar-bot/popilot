"use client";

import { useCallback, useEffect, useState } from "react";
import { Hero } from "@/components/Hero";
import { ParserPanel } from "@/components/ParserPanel";
import { PoBoard } from "@/components/PoBoard";
import { RiskAlerts, type StockInfo } from "@/components/RiskAlerts";
import type { PO, RiskResult, UpdateRow } from "@/lib/types";

interface Board {
  today: string;
  pos: PO[];
  risks: RiskResult[];
  stockInfo?: StockInfo;
  missingSkus?: { po_id: string; sku: string }[];
  dateProblems?: { po_id: string; item: string; value: string }[];
  updates: UpdateRow[];
}

export default function Home() {
  const [board, setBoard] = useState<Board | null>(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/board", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't load the board");
      setBoard(data);
      setErr("");
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // WhatsApp updates arrive on their own, so re-check every 30 seconds while this tab is visible.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 30_000);
    return () => clearInterval(t);
  }, [load]);

  return (
    <main>
      <Hero />
      <div className="wrap">
      {err && <div className="banner bad">{err}</div>}

      {board && (
        <div className="grid">
          <ParserPanel updates={board.updates} pos={board.pos} onChange={load} />
          <div className="right">
            <RiskAlerts risks={board.risks} stockInfo={board.stockInfo} missingSkus={board.missingSkus} />
            <PoBoard pos={board.pos} risks={board.risks} problems={board.dateProblems} />
          </div>
        </div>
      )}
      {!board && !err && <p>Loading…</p>}
      </div>
    </main>
  );
}
