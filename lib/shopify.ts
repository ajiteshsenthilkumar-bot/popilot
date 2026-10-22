// Stock and daily sales per SKU.
//   - Shopify connected (SHOPIFY_STORE, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET set): LIVE data, read-only.
//   - Not connected: the small sample file, clearly labelled "Sample data" on screen.
// If Shopify is connected but fails, we say so. We never quietly show sample numbers in its place,
// because that could hide a real stock-out.
import sample from "@/data/shopify-sample.json";
import { addDays, todayIST } from "./dates";
import type { StockRecord } from "./types";

export const SHOPIFY_API_VERSION = "2026-07";
const SALES_DAYS = 30; // daily sales = units sold in the last 30 days / 30
const CACHE_MS = 5 * 60_000; // the screen refreshes every 30 s; Shopify is only asked every 5 minutes
const STALE_OK_MS = 60 * 60_000; // if Shopify is down, show the last good data for up to an hour, marked stale

export interface StockSnapshot {
  records: StockRecord[];
  source: "shopify" | "sample";
  asOf: string; // ISO time the data was fetched
  stale: boolean; // Shopify failed just now; these are the last good numbers
  error?: string;
}

export function shopifyConfigured(): boolean {
  return Boolean(process.env.SHOPIFY_STORE && process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET);
}

function host(): string {
  const s = (process.env.SHOPIFY_STORE ?? "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return s.includes(".") ? s : `${s}.myshopify.com`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const retry = { baseMs: 1000 }; // wait before retrying a rate-limited/failed call (tests shorten this)

// ---- access token (the app exchanges its client id + secret for a token that lasts 24 h) ----
let tokenCache: { token: string; expires: number } | null = null;
let tokenInflight: Promise<string> | null = null;

async function getToken(): Promise<string> {
  if (tokenCache && tokenCache.expires > Date.now() + 5 * 60_000) return tokenCache.token;
  if (tokenInflight) return tokenInflight;
  tokenInflight = (async () => {
    const res = await fetch(`https://${host()}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: process.env.SHOPIFY_CLIENT_ID as string,
        client_secret: process.env.SHOPIFY_CLIENT_SECRET as string,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    let data: any = {};
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    if (!res.ok || !data.access_token) {
      const why = data.error_description ?? data.error ?? `HTTP ${res.status}`;
      throw new Error(`Shopify wouldn't give a token (${why}). Check SHOPIFY_STORE, the client id and secret, and that the app is installed on the store.`);
    }
    tokenCache = { token: data.access_token, expires: Date.now() + (Number(data.expires_in) || 86_399) * 1000 };
    return data.access_token as string;
  })().finally(() => { tokenInflight = null; });
  return tokenInflight;
}

// ---- GraphQL with retries for rate limits and server hiccups ----
async function gql<T = any>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  let lastErr = "";
  for (let attempt = 1; attempt <= 4; attempt++) {
    const token = await getToken();
    const res = await fetch(`https://${host()}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401) { tokenCache = null; lastErr = "Shopify rejected the access token (401)"; if (attempt < 2) continue; throw new Error(lastErr); }
    if (res.status === 429 || res.status >= 500) { lastErr = `Shopify error ${res.status}`; if (attempt < 4) { await sleep(retry.baseMs * attempt); continue; } throw new Error(lastErr); }
    const json: any = await res.json().catch(() => ({}));
    const throttled = json.errors?.some((e: any) => e?.extensions?.code === "THROTTLED");
    if (throttled && attempt < 4) { await sleep(retry.baseMs * attempt); continue; }
    if (json.errors?.length) throw new Error(`Shopify: ${json.errors.map((e: any) => e.message).join("; ").slice(0, 300)}`);
    if (!json.data) throw new Error(`Shopify returned no data (HTTP ${res.status})`);
    return json.data as T;
  }
  throw new Error(lastErr || "Shopify request failed");
}

export { gql as shopifyGraphQL }; // used by scripts/shopify-seed-test-store.ts

const norm = (s: string) => s.trim().toLowerCase();

async function fetchStock(): Promise<Map<string, { sku: string; stock: number }>> {
  const out = new Map<string, { sku: string; stock: number }>();
  let after: string | null = null;
  for (let page = 0; page < 40; page++) {
    const d: any = await gql(
      `query($after: String) { productVariants(first: 250, after: $after) { pageInfo { hasNextPage endCursor } nodes { sku inventoryQuantity } } }`,
      { after },
    );
    for (const v of d.productVariants.nodes) {
      if (!v.sku) continue;
      const key = norm(v.sku);
      const cur = out.get(key);
      out.set(key, { sku: v.sku.trim(), stock: (cur?.stock ?? 0) + (Number(v.inventoryQuantity) || 0) });
    }
    if (!d.productVariants.pageInfo.hasNextPage) break;
    after = d.productVariants.pageInfo.endCursor;
  }
  return out;
}

async function fetchUnitsSold(): Promise<Map<string, number>> {
  const since = addDays(todayIST(), -SALES_DAYS);
  const units = new Map<string, number>();
  let after: string | null = null;
  for (let page = 0; page < 100; page++) {
    const d: any = await gql(
      `query($after: String, $q: String) {
         orders(first: 100, after: $after, query: $q) {
           pageInfo { hasNextPage endCursor }
           nodes { cancelledAt lineItems(first: 100) { nodes { sku quantity currentQuantity } } }
         }
       }`,
      { after, q: `processed_at:>=${since}` },
    );
    for (const o of d.orders.nodes) {
      if (o.cancelledAt) continue;
      for (const li of o.lineItems.nodes) {
        if (!li.sku) continue;
        const q = li.currentQuantity ?? li.quantity ?? 0; // after refunds/edits when Shopify gives it
        units.set(norm(li.sku), (units.get(norm(li.sku)) ?? 0) + Number(q));
      }
    }
    if (!d.orders.pageInfo.hasNextPage) break;
    after = d.orders.pageInfo.endCursor;
  }
  return units;
}

async function fetchLive(): Promise<StockRecord[]> {
  const [stock, units] = await Promise.all([fetchStock(), fetchUnitsSold()]);
  return [...stock.entries()].map(([key, s]) => ({
    sku: s.sku,
    stock: Math.max(0, s.stock),
    daily_sales: (units.get(key) ?? 0) / SALES_DAYS,
  }));
}

// ---- the one function the app uses ----
let cache: StockSnapshot | null = null;
let inflight: Promise<StockSnapshot> | null = null;

export function resetShopifyCache() { cache = null; inflight = null; tokenCache = null; tokenInflight = null; }

export async function getStockSnapshot(opts: { force?: boolean } = {}): Promise<StockSnapshot> {
  if (!shopifyConfigured()) {
    return { records: sample as StockRecord[], source: "sample", asOf: new Date().toISOString(), stale: false };
  }
  if (!opts.force && cache && Date.now() - Date.parse(cache.asOf) < CACHE_MS) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      cache = { records: await fetchLive(), source: "shopify", asOf: new Date().toISOString(), stale: false };
      return cache;
    } catch (e) {
      const message = (e as Error).message;
      if (cache && Date.now() - Date.parse(cache.asOf) < STALE_OK_MS) {
        return { ...cache, stale: true, error: message }; // last good numbers, clearly marked
      }
      throw new Error(message);
    }
  })().finally(() => { inflight = null; });
  return inflight;
}

export async function getStockAndSales(): Promise<StockRecord[]> {
  return (await getStockSnapshot()).records;
}

// match a PO's sku to a Shopify sku (ignores case and stray spaces)
export function findStock(records: StockRecord[], sku: string): StockRecord | undefined {
  return records.find((r) => norm(r.sku) === norm(sku));
}
