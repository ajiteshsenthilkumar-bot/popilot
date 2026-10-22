// Read-only check: connects to Shopify and prints stock + daily sales per SKU, and which PO SKUs match.
//   npm run shopify:check
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#")) process.env[m[1]] ??= m[2].replace(/^"(.*)"$/s, "$1");
  }
}

async function main() {
  const { findStock, getStockSnapshot, shopifyConfigured } = await import("../lib/shopify");
  if (!shopifyConfigured()) {
    console.error("Shopify isn't configured. Fill SHOPIFY_STORE, SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in .env.local.");
    process.exit(1);
  }
  const snap = await getStockSnapshot({ force: true });
  console.log(`\nShopify store: ${process.env.SHOPIFY_STORE}  (fetched ${new Date(snap.asOf).toLocaleTimeString()})\n`);
  console.log("SKU".padEnd(22) + "stock".padStart(8) + "sold/day".padStart(10) + "days left".padStart(11));
  for (const r of snap.records.sort((a, b) => a.sku.localeCompare(b.sku))) {
    const days = r.daily_sales > 0 ? String(Math.floor(r.stock / r.daily_sales)) : "-";
    console.log(r.sku.padEnd(22) + String(r.stock).padStart(8) + r.daily_sales.toFixed(1).padStart(10) + days.padStart(11));
  }
  if (!snap.records.length) console.log("(no products with a SKU found)");

  try {
    const { getPOs } = await import("../lib/store");
    const pos = await getPOs();
    console.log("\nPO SKUs vs Shopify:");
    for (const po of pos) console.log(`  ${po.po_id}  ${po.sku.padEnd(16)} ${findStock(snap.records, po.sku) ? "found" : "NOT FOUND in Shopify"}`);
  } catch (e) {
    console.log("\n(Couldn't read the PO sheet to compare SKUs:", (e as Error).message + ")");
  }
}

main().catch((e) => {
  console.error("Error:", e.message ?? e);
  process.exit(1);
});
