import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addDays, todayIST } from "@/lib/dates";
import { findStock, getStockAndSales, getStockSnapshot, resetShopifyCache, retry, SHOPIFY_API_VERSION } from "@/lib/shopify";

// A pretend Shopify: one token endpoint and one GraphQL endpoint.
interface Fake {
  variants: { sku: string | null; inventoryQuantity: number }[][]; // pages
  orders: { cancelledAt: string | null; lineItems: { sku: string | null; quantity: number; currentQuantity?: number | null }[] }[][];
  tokenCalls: number;
  gqlCalls: number;
  queries: string[];
  failGql?: () => any;
  tokenStatus?: number;
}
let fake: Fake;

function install() {
  vi.stubGlobal("fetch", async (url: string, init: any) => {
    const u = String(url);
    if (u.endsWith("/admin/oauth/access_token")) {
      fake.tokenCalls++;
      if (fake.tokenStatus && fake.tokenStatus !== 200) {
        return { ok: false, status: fake.tokenStatus, text: async () => JSON.stringify({ error: "shop_not_permitted" }) };
      }
      const body = init.body as URLSearchParams;
      expect(body.get("grant_type")).toBe("client_credentials");
      expect(body.get("client_id")).toBe("cid");
      expect(body.get("client_secret")).toBe("csecret");
      return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: `tok${fake.tokenCalls}`, scope: "read_products", expires_in: 86399 }) };
    }
    if (u.includes("/graphql.json")) {
      fake.gqlCalls++;
      expect(u).toContain(`/admin/api/${SHOPIFY_API_VERSION}/`);
      expect(init.headers["X-Shopify-Access-Token"]).toMatch(/^tok/);
      if (fake.failGql) return fake.failGql();
      const { query, variables } = JSON.parse(init.body);
      fake.queries.push(variables.q ?? "");
      const page = variables.after ? Number(String(variables.after).replace("c", "")) : 0;
      if (query.includes("productVariants")) {
        const nodes = fake.variants[page] ?? [];
        return ok({ productVariants: { pageInfo: { hasNextPage: page < fake.variants.length - 1, endCursor: `c${page + 1}` }, nodes } });
      }
      const nodes = fake.orders[page] ?? [];
      return ok({ orders: { pageInfo: { hasNextPage: page < fake.orders.length - 1, endCursor: `c${page + 1}` }, nodes: nodes.map((o) => ({ cancelledAt: o.cancelledAt, lineItems: { nodes: o.lineItems } })) } });
    }
    throw new Error(`unexpected fetch ${u}`);
  });
}
const ok = (data: any) => ({ ok: true, status: 200, json: async () => ({ data }) });

beforeEach(() => {
  fake = { variants: [[]], orders: [[]], tokenCalls: 0, gqlCalls: 0, queries: [] };
  resetShopifyCache();
  retry.baseMs = 1;
  process.env.SHOPIFY_STORE = "my-test-store";
  process.env.SHOPIFY_CLIENT_ID = "cid";
  process.env.SHOPIFY_CLIENT_SECRET = "csecret";
  install();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SHOPIFY_STORE; delete process.env.SHOPIFY_CLIENT_ID; delete process.env.SHOPIFY_CLIENT_SECRET;
});

describe("Shopify live data", () => {
  it("computes stock and daily sales (units in the last 30 days / 30)", async () => {
    fake.variants = [[{ sku: "SKU-SERUM", inventoryQuantity: 40 }]];
    fake.orders = [[{ cancelledAt: null, lineItems: [{ sku: "SKU-SERUM", quantity: 150 }] }, { cancelledAt: null, lineItems: [{ sku: "SKU-SERUM", quantity: 150 }] }]];
    const snap = await getStockSnapshot();
    expect(snap.source).toBe("shopify");
    expect(snap.records).toEqual([{ sku: "SKU-SERUM", stock: 40, daily_sales: 10 }]);
    expect(Math.floor(snap.records[0].stock / snap.records[0].daily_sales)).toBe(4); // the "runs out in 4 days" case
  });

  it("asks only for orders from the last 30 days", async () => {
    await getStockSnapshot();
    expect(fake.queries).toContain(`processed_at:>=${addDays(todayIST(), -30)}`);
  });

  it("follows pagination, adds up duplicate SKUs, ignores blank SKUs and cancelled orders", async () => {
    fake.variants = [[{ sku: "A", inventoryQuantity: 5 }, { sku: null, inventoryQuantity: 99 }], [{ sku: "a ", inventoryQuantity: 7 }, { sku: "B", inventoryQuantity: 1 }]];
    fake.orders = [
      [{ cancelledAt: "2026-10-01", lineItems: [{ sku: "A", quantity: 300 }] }],
      [{ cancelledAt: null, lineItems: [{ sku: "A", quantity: 60 }, { sku: null, quantity: 5 }] }],
    ];
    const { records } = await getStockSnapshot();
    const a = findStock(records, "A")!;
    expect(a.stock).toBe(12); // 5 + 7
    expect(a.daily_sales).toBe(2); // 60 / 30, the cancelled 300 is ignored
    expect(findStock(records, "B")!.daily_sales).toBe(0);
    expect(records).toHaveLength(2);
    expect(fake.gqlCalls).toBe(4);
  });

  it("uses the quantity after refunds/edits when Shopify provides it", async () => {
    fake.variants = [[{ sku: "A", inventoryQuantity: 10 }]];
    fake.orders = [[{ cancelledAt: null, lineItems: [{ sku: "A", quantity: 30, currentQuantity: 0 }, { sku: "A", quantity: 30, currentQuantity: 30 }] }]];
    expect(findStock((await getStockSnapshot()).records, "A")!.daily_sales).toBe(1);
  });

  it("never reports negative stock", async () => {
    fake.variants = [[{ sku: "A", inventoryQuantity: -3 }]];
    expect((await getStockSnapshot()).records[0].stock).toBe(0);
  });

  it("reuses the token and caches the data for a few minutes", async () => {
    fake.variants = [[{ sku: "A", inventoryQuantity: 1 }]];
    await getStockSnapshot();
    const calls = fake.gqlCalls;
    await getStockSnapshot();
    expect(fake.gqlCalls).toBe(calls);
    expect(fake.tokenCalls).toBe(1);
    await getStockSnapshot({ force: true });
    expect(fake.gqlCalls).toBeGreaterThan(calls);
    expect(fake.tokenCalls).toBe(1); // the 24-hour token is still good
  });

  it("makes one request set when several screens ask at once", async () => {
    fake.variants = [[{ sku: "A", inventoryQuantity: 1 }]];
    await Promise.all([getStockSnapshot(), getStockSnapshot(), getStockSnapshot()]);
    expect(fake.tokenCalls).toBe(1);
    expect(fake.gqlCalls).toBe(2); // one stock query + one orders query
  });

  it("matches a PO's sku to Shopify's ignoring case and spaces", () => {
    const r = [{ sku: "Sku-Serum", stock: 1, daily_sales: 1 }];
    expect(findStock(r, " SKU-SERUM ")).toBeTruthy();
    expect(findStock(r, "SKU-CREAM")).toBeUndefined();
  });
});

describe("Shopify trouble is reported, never hidden", () => {
  it("fails with a helpful message when the token is refused", async () => {
    fake.tokenStatus = 400;
    await expect(getStockSnapshot()).rejects.toThrow(/shop_not_permitted.*installed on the store/s);
  });

  it("throws when Shopify is down and there is nothing to fall back on", async () => {
    fake.failGql = () => ({ ok: false, status: 503, json: async () => ({}) });
    await expect(getStockSnapshot()).rejects.toThrow(/503/);
  });

  it("serves the last good numbers, marked stale, if Shopify fails later", async () => {
    fake.variants = [[{ sku: "A", inventoryQuantity: 9 }]];
    await getStockSnapshot();
    fake.failGql = () => ({ ok: false, status: 503, json: async () => ({}) });
    const snap = await getStockSnapshot({ force: true });
    expect(snap.stale).toBe(true);
    expect(snap.error).toMatch(/503/);
    expect(snap.records[0].stock).toBe(9);
  });

  it("surfaces GraphQL errors such as a missing permission", async () => {
    fake.failGql = () => ({ ok: true, status: 200, json: async () => ({ errors: [{ message: "Access denied for orders field" }] }) });
    await expect(getStockSnapshot()).rejects.toThrow(/Access denied for orders/);
  });
});

describe("sample mode", () => {
  it("uses the labelled sample file only when Shopify is not configured at all", async () => {
    delete process.env.SHOPIFY_STORE;
    const snap = await getStockSnapshot();
    expect(snap.source).toBe("sample");
    expect(fake.tokenCalls + fake.gqlCalls).toBe(0);
    expect((await getStockAndSales()).map((r) => r.sku)).toContain("SKU-SERUM");
  });
});
