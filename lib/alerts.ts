// Stock-out alerts to YOU on Telegram. Two triggers share this file:
//   1. a PO update that creates or worsens a risk (maybeAlert), and
//   2. the daily stock check (lib/dailyCheck.ts) that catches risks caused by stock/sales changing on their own.
// What you were last told is remembered per PO (Alerts tab), so nothing repeats and a worsening is never missed.
// The bot messages only the owner(s) in TELEGRAM_ALLOWED (an id with "=*"). Never vendors, and it never pauses ads.
import { parseTelegramAllowList } from "./allowlist";
import { formatDay, todayIST } from "./dates";
import { assessRisk } from "./risk";
import type { Item, PO, RiskResult, StockRecord } from "./types";

type Send = (token: string, chatId: string, text: string) => Promise<void>;

// Alert when the risk is new, or the gap (days without stock) got bigger. Staying the same or improving = silence.
export function shouldAlert(before: RiskResult, after: RiskResult): boolean {
  return after.at_risk && (!before.at_risk || after.gap_days > before.gap_days);
}

// The number we remember per PO: days without stock, or 0 when there is no open risk.
export const riskGap = (r: RiskResult): number => (r.at_risk ? r.gap_days : 0);

// Telegram chat ids of the people who forward vendor messages ("id=*"): they are the owners.
export function ownerChatIds(allowedRaw: string | undefined = process.env.TELEGRAM_ALLOWED): string[] {
  return parseTelegramAllowList(allowedRaw)
    .filter((e) => e.vendor === null && !e.key.startsWith("group:"))
    .map((e) => e.key);
}

export function appUrl(): string | undefined {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return host ? `https://${host}` : undefined;
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

// Message every owner. Returns false if nothing could be sent because Telegram isn't set up; throws if a send fails.
export async function notifyOwners(text: string, send: Send = sendTelegramMessage): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const owners = ownerChatIds();
  if (!token || !owners.length) return false;
  let failed: unknown;
  for (const chat of owners) {
    try { await send(token, chat, text); } catch (e) { failed = e; }
  }
  if (failed) throw failed;
  return true;
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

export interface AlertOutcome {
  assessed: boolean; // false if there was no Shopify stock for this SKU, so nothing could be judged
  sent: boolean;
  gap: number; // the risk after this update (0 = none): what to remember
  changed: boolean; // the risk differs from before, so the remembered value should be updated
}

// Throws only if sending fails (callers catch: alerts are best-effort).
export async function maybeAlert(c: AlertCheck, send: Send = sendTelegramMessage): Promise<AlertOutcome> {
  if (!c.stock) return { assessed: false, sent: false, gap: 0, changed: false };

  const today = c.today ?? todayIST();
  const poAfter: PO = structuredClone(c.poBefore);
  poAfter.inputs[c.item].eta = c.newEta;
  const before = assessRisk(c.poBefore, c.stock, today);
  const after = assessRisk(poAfter, c.stock, today);
  const outcome: AlertOutcome = { assessed: true, sent: false, gap: riskGap(after), changed: riskGap(before) !== riskGap(after) };
  if (!shouldAlert(before, after)) return outcome;

  const text = buildAlertText(after, { vendor: c.vendor, item: c.item, oldEta: c.oldEta, newEta: c.newEta, url: appUrl() });
  outcome.sent = await notifyOwners(text, send);
  return outcome;
}
