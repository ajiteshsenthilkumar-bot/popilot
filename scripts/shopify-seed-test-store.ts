// ONE-TIME, for a free TEST (development) store only. Creates the four demo products with the same SKUs and
// stock as the sample file, plus 10 backdated test orders so the last 30 days show the same daily sales.
// Needs the app to have write access to products, inventory and orders. Safe to re-run: it skips what exists.
//   npm run shopify:seed-test-store
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#")) process.env[m[1]] ??= m[2].replace(/^"(.*)"$/s, "$1");
  }
}

const TITLES: Record<string, string> = {
  "SKU-SERUM": "Glow Serum",
  "SKU-CREAM": "Radiance Cream",
  "SKU-HAIROIL": "Amla Hair Oil",
  "SKU-LIPBALM": "Cherry Lip Balm",
};
const ORDERS = 10; // one order every 3 days over the last 30 days
const DAYS_PER_ORDER = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { shopifyConfigured, shopifyGraphQL: gql } = await import("../lib/shopify");
  const sample: { sku: string; stock: number; daily_sales: number }[] = JSON.parse(readFileSync(resolve(process.cwd(), "data/shopify-sample.json"), "utf8"));
  if (!shopifyConfigured()) throw new Error("Shopify isn't configured in .env.local");
  const shop = process.env.SHOPIFY_STORE as string;
  if (!/test|dev|popilot/i.test(shop) && !process.argv.includes("--yes-this-is-a-test-store")) {
    throw new Error(`"${shop}" doesn't look like a test store. This script creates fake products and orders. Re-run with --yes-this-is-a-test-store if you're sure.`);
  }

  const loc: any = await gql(`{ shop { currencyCode } locations(first: 1) { nodes { id name } } }`);
  const locationId = loc.locations.nodes[0]?.id;
  if (!locationId) throw new Error("The store has no location to hold stock");
  const currency: string = loc.shop.currencyCode; // orders must use the store's own currency
  console.log(`Location: ${loc.locations.nodes[0].name}   Currency: ${currency}`);

  // ---- products ----
  const variantIds: Record<string, string> = {};
  for (const s of sample) {
    const found: any = await gql(`query($q: String) { productVariants(first: 1, query: $q) { nodes { id sku } } }`, { q: `sku:${s.sku}` });
    if (found.productVariants.nodes[0]?.sku === s.sku) {
      variantIds[s.sku] = found.productVariants.nodes[0].id;
      console.log(`  ${s.sku}: already exists, skipped`);
      continue;
    }
    const r: any = await gql(
      `mutation($input: ProductSetInput!) {
         productSet(synchronous: true, input: $input) {
           product { id variants(first: 1) { nodes { id sku } } }
           userErrors { field message }
         }
       }`,
      {
        input: {
          title: TITLES[s.sku] ?? s.sku,
          status: "ACTIVE",
          productOptions: [{ name: "Title", values: [{ name: "Default Title" }] }],
          variants: [
            {
              optionValues: [{ optionName: "Title", name: "Default Title" }],
              sku: s.sku,
              price: "499.00",
              inventoryItem: { tracked: true },
              inventoryQuantities: [{ locationId, name: "available", quantity: s.stock }],
            },
          ],
        },
      },
    );
    const errs = r.productSet.userErrors;
    if (errs?.length) throw new Error(`Couldn't create ${s.sku}: ${errs.map((e: any) => e.message).join("; ")}`);
    variantIds[s.sku] = r.productSet.product.variants.nodes[0].id;
    console.log(`  ${s.sku}: created with stock ${s.stock}`);
  }

  // ---- backdated orders ----
  // Fill in only the dates that don't have a seeded order yet, so re-running (or finishing an interrupted run) never duplicates.
  const have: any = await gql(`query { orders(first: 100, query: "tag:popilot-seed") { nodes { processedAt } } }`);
  const haveDates = new Set<string>(have.orders.nodes.map((o: any) => String(o.processedAt).slice(0, 10)));
  {
    console.log(`Test orders: ${haveDates.size} already exist, creating the missing ones (Shopify limits how fast dev stores can create orders, so this takes a few minutes)...`);
    for (let k = 0; k < ORDERS; k++) {
      const daysAgo = 29 - k * DAYS_PER_ORDER;
      const processedAt = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
      if (haveDates.has(processedAt.slice(0, 10))) { console.log(`  order ${k + 1}/${ORDERS} (dated ${processedAt.slice(0, 10)}) already exists, skipped`); continue; }
      let done = false;
      for (let attempt = 1; attempt <= 6 && !done; attempt++) {
        const r: any = await gql(
          `mutation($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
             orderCreate(order: $order, options: $options) { order { id } userErrors { field message } }
           }`,
          {
            order: {
              currency,
              processedAt,
              tags: ["popilot-seed"],
              test: true,
              financialStatus: "PAID",
              lineItems: sample.map((s) => ({ variantId: variantIds[s.sku], quantity: Math.round(s.daily_sales * DAYS_PER_ORDER) })),
            },
            options: { inventoryBehaviour: "BYPASS", sendReceipt: false, sendFulfillmentReceipt: false },
          },
        );
        const errs = r.orderCreate.userErrors;
        if (errs?.length) {
          if (/too many|limit|throttl/i.test(errs.map((e: any) => e.message).join(" "))) { await sleep(20_000); continue; }
          throw new Error(`Couldn't create an order: ${errs.map((e: any) => e.message).join("; ")}`);
        }
        done = true;
        console.log(`  order ${k + 1}/${ORDERS} created (dated ${processedAt.slice(0, 10)})`);
      }
      if (!done) throw new Error("Shopify kept refusing new orders (rate limit). Wait a few minutes and re-run; it will continue.");
      await sleep(13_000); // dev stores allow only about 5 new orders a minute
    }
  }
  console.log("\nDone. Now run: npm run shopify:check");
}

main().catch((e) => {
  console.error("Error:", e.message ?? e);
  process.exit(1);
});
