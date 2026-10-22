"use client";

import { useCallback, useEffect, useState } from "react";
import { ParserPanel } from "@/components/ParserPanel";
import { PoBoard } from "@/components/PoBoard";
import { RiskAlerts } from "@/components/RiskAlerts";
import type { PO, RiskResult, UpdateRow } from "@/lib/types";

interface Board {
  today: string;
  mode: "sheet" | "memory";
  pos: PO[];
  risks: RiskResult[];
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

  return (
    <main className="wrap">
      <div className="top">
        <h1>POPilot</h1>
        <p>Forward a vendor delay. See which PO moved and whether you'll run out of stock.</p>
      </div>

      {err && <div className="banner bad">{err}</div>}
      {board?.mode === "memory" && (
        <div className="banner warn">
          Demo mode: not connected to Google Sheets yet, so data lives in memory and resets when the server restarts. See README to connect your sheet.
        </div>
      )}

      {board && (
        <div className="grid">
          <ParserPanel updates={board.updates} pos={board.pos} onChange={load} />
          <div className="right">
            <RiskAlerts risks={board.risks} />
            <PoBoard pos={board.pos} risks={board.risks} />
          </div>
        </div>
      )}
      {!board && !err && <p>Loading…</p>}
    </main>
  );
}
