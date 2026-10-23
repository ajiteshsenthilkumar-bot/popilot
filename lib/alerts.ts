// Stock-out alerts to YOU on Telegram. Event-driven and stateless: when a PO update makes the stock-out risk
// appear (or get worse), compare the risk before and after the update and message the owner once.
// The bot messages only the owner(s) in TELEGRAM_ALLOWED (an id with "=*"). Never vendors, and it never pauses ads.
import { parseTelegramAllowList } from "./allowlist";
import { formatDay, todayIST } from "./dates";
import { assessRisk } from "./risk";
import type { Item, PO, RiskResult, StockRecord } from "./types";

// Alert when the risk is new, or the gap (days without stock) got bigger. Staying the same or improving = silence.
export function shouldAlert(before: RiskResult, after: RiskResult): boolean {
  return after.at_risk && (!before.at_risk || after.gap_days > before.gap_days);
}

// Telegram chat ids of the people who forward vendor messages ("id=*"): they are the owners.
export function ownerChatIds(allowedRaw: string | undefined = process.env.TELEGRAM_ALLOWED): string[] {
  return parseTelegramAllowList(allowedRaw)
    .filter((e) => e.vendor === null && !e.key.startsWith("group:"))
    .map((e) => e.key);
}

export function buildAlertText(after: RiskResult, ctx: { vendor: string; item: Item; oldEta: string; newEta: string; url?: string }): string {
  return [
    "⚠️ Stock-out risk",
    after.alert ?? "",
    "",
    `${ctx.vendor || "Vendor"} moved ${ctx.item} ETA: ${ctx.oldEta ? formatDay(ctx.oldEta) : "?"} → ${formatDay(ctx.newEta)}.`,
    ctx.url ? `Open POPilot: ${ctx.url}` : "",
  ].filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== "")).join("\n").trim();
}

export async function sendTelegramMessage(token: string, chatId: string, text: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(8_000),
  });
  // never include the URL (it contains the bot token) in the error
  if (!res.ok) throw new Error(`Telegram sendMessage failed (${res.status})`);
}

export interface AlertCheck {
  poBefore: PO;
  item: Item;
  newEta: string;
  stock: StockRecord | undefined;
  vendor: string;
  oldEta: string;
  today?: string;
}

// Returns true if an alert was sent. Throws only if sending fails (callers catch: alerts are best-effort).
export async function maybeAlert(
  c: AlertCheck,
  send: (token: string, chatId: string, text: string) => Promise<void> = sendTelegramMessage,
): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const owners = ownerChatIds();
  if (!token || !owners.length || !c.stock) return false;

  const today = c.today ?? todayIST();
  const poAfter: PO = structuredClone(c.poBefore);
  poAfter.inputs[c.item].eta = c.newEta;
  const before = assessRisk(c.poBefore, c.stock, today);
  const after = assessRisk(poAfter, c.stock, today);
  if (!shouldAlert(before, after)) return false;

  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const text = buildAlertText(after, { vendor: c.vendor, item: c.item, oldEta: c.oldEta, newEta: c.newEta, url: host ? `https://${host}` : undefined });
  let failed: unknown;
  for (const chat of owners) {
    try { await send(token, chat, text); } catch (e) { failed = e; }
  }
  if (failed) throw failed;
  return true;
}
