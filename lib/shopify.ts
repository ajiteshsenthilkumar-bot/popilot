import sample from "@/data/shopify-sample.json";
import type { StockRecord } from "./types";

// DEMO: reads a small sample file (stock + daily sales per SKU).
//
// TO SWAP IN REAL SHOPIFY LATER, change only the body of this function:
//   1. Create a Shopify "custom app" and give it read_inventory + read_orders access.
//   2. Put SHOPIFY_STORE and SHOPIFY_TOKEN in .env.local.
//   3. Stock: Admin GraphQL `inventoryLevels` (sum "available" per SKU).
//   4. Daily sales: Admin GraphQL `orders` for the last 30 days, units sold per SKU / 30.
//   5. Return the same { sku, stock, daily_sales }[] shape. Nothing else in the app changes.
export async function getStockAndSales(): Promise<StockRecord[]> {
  return sample as StockRecord[];
}
