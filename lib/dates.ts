// Plain date math. Dates are "YYYY-MM-DD" strings so time zones can't shift them.
import type { EtaExpression } from "./types";

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function toUtc(iso: string): Date | null {
  const m = ISO.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  // reject things like 2026-02-31 that JS silently rolls over
  return d.toISOString().slice(0, 10) === iso ? d : null;
}

function fromUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = toUtc(iso);
  if (!d) throw new Error(`Bad date: ${iso}`);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
}

// whole days from a to b (b - a)
export function diffDays(a: string, b: string): number {
  const da = toUtc(a);
  const db = toUtc(b);
  if (!da || !db) throw new Error(`Bad date: ${a} / ${b}`);
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

export function isValidIso(iso: string): boolean {
  return toUtc(iso) !== null;
}

// Today in India, as YYYY-MM-DD (the user and vendors are in IST).
export function todayIST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
}

export function weekdayName(iso: string): string {
  const d = toUtc(iso);
  if (!d) throw new Error(`Bad date: ${iso}`);
  return WEEKDAYS[d.getUTCDay()];
}

// "2026-10-26" -> "Mon 26 Oct" so a misread weekday is easy to spot on screen.
export function formatDay(iso: string): string {
  const d = toUtc(iso);
  if (!d) return iso || "—";
  return d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

// Turn the AI's label into a real date. Returns null if it can't be resolved.
// "monday" means the NEXT Monday after today (today itself doesn't count).
export function resolveEta(expr: EtaExpression | null, today: string): string | null {
  if (!expr || !toUtc(today)) return null;

  if (expr.type === "absolute") {
    return isValidIso(expr.value) ? expr.value : null;
  }

  if (expr.type === "relative_days") {
    if (!Number.isFinite(expr.value) || !Number.isInteger(expr.value) || expr.value < 0) return null;
    return addDays(today, expr.value);
  }

  if (expr.type === "weekday") {
    const target = WEEKDAYS.indexOf(String(expr.value).trim().toLowerCase());
    if (target === -1) return null;
    const current = WEEKDAYS.indexOf(weekdayName(today));
    const ahead = ((target - current + 7) % 7) || 7;
    return addDays(today, ahead);
  }

  return null;
}
