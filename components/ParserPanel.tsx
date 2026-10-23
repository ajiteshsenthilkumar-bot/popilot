"use client";

import { useRef, useState } from "react";
import { parseChatExport } from "@/lib/whatsapp";
import type { PO, UpdateRow } from "@/lib/types";
import { ResultCard } from "./ResultCard";

const SAMPLES: { label: string; text: string; source: "text" | "voice"; sender?: string }[] = [
  { label: "Labels delayed (Hinglish)", text: "bhaiya labels Monday tak nahi aayenge", source: "text", sender: "Rajesh Labels" },
  { label: "Voice transcript", text: "haan bhaiya, Rajesh bol raha hoon, printing machine kharab ho gayi thi, labels ab 7 din mein pahunchenge", source: "voice", sender: "Rajesh Labels" },
  { label: "Gibberish", text: "asdf ok kk lol 👍", source: "text" },
  { label: "Unknown vendor", text: "Sir Zenith Prints here, your stickers will be delayed till Friday", source: "text" },
];

export function ParserPanel({ updates, pos, onChange }: { updates: UpdateRow[]; pos: PO[]; onChange: () => void }) {
  const [text, setText] = useState("");
  const [source, setSource] = useState<"text" | "voice">("text");
  const [sender, setSender] = useState("");
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const file = useRef<HTMLInputElement>(null);

  async function send(t: string, s: "text" | "voice", who?: string) {
    const res = await fetch("/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: t, source: s, sender: who }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Something went wrong");
  }

  async function submit() {
    setErr("");
    setBusy("Reading the message…");
    try {
      await send(text, source, sender || undefined);
      setText("");
      onChange();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy("");
  }

  async function uploadChat(f: File) {
    setErr("");
    try {
      const msgs = parseChatExport(await f.text()).slice(-10); // last 10 messages keeps the demo fast and cheap
      if (!msgs.length) return setErr("Couldn't find any messages in that file. Is it a WhatsApp 'Export chat' .txt?");
      for (let i = 0; i < msgs.length; i++) {
        setBusy(`Reading message ${i + 1} of ${msgs.length}…`);
        await send(msgs[i].text, "text", msgs[i].sender);
        onChange();
      }
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy("");
    if (file.current) file.current.value = "";
  }

  return (
    <section className="panel" id="parser" tabIndex={-1}>
      <h2>1 · Update parser</h2>
      <p className="sub">Paste a vendor's WhatsApp message or a voice-note transcript, or upload an exported chat.</p>

      <div className="row" style={{ marginBottom: 8 }}>
        {SAMPLES.map((s) => (
          <button key={s.label} className="chip" onClick={() => { setText(s.text); setSource(s.source); setSender(s.sender ?? ""); }}>
            {s.label}
          </button>
        ))}
      </div>

      <div className="row">
        <div className="seg">
          <button className={source === "text" ? "on" : ""} onClick={() => setSource("text")}>Text</button>
          <button className={source === "voice" ? "on" : ""} onClick={() => setSource("voice")}>Voice transcript</button>
        </div>
        <input placeholder="Vendor chat name (optional)" value={sender} onChange={(e) => setSender(e.target.value)} />
      </div>

      <label className="field">{source === "voice" ? "Voice note transcript" : "Message"}</label>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. bhaiya labels Monday tak nahi aayenge" />

      <div className="row" style={{ marginTop: 8 }}>
        <button className="primary" onClick={submit} disabled={!!busy || !text.trim()}>{busy || "Parse & update"}</button>
        <button onClick={() => file.current?.click()} disabled={!!busy}>Upload chat .txt</button>
        <input ref={file} type="file" accept=".txt" hidden onChange={(e) => e.target.files?.[0] && uploadChat(e.target.files[0])} />
      </div>
      {err && <div className="banner bad" style={{ marginTop: 8 }}>{err}</div>}

      <h2 style={{ marginTop: 18 }}>Parsed results</h2>
      {updates.length === 0 && <p className="sub">Nothing yet. Try a sample above.</p>}
      {updates.map((u) => <ResultCard key={u.id + u.status} u={u} pos={pos} onDone={onChange} />)}
    </section>
  );
}
