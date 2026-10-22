// One-time (re-runnable) setup: creates the POs / Updates tabs and loads the starter POs.
// Usage: npm run seed   (needs the Google values in .env.local)
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// tiny .env.local loader so we don't need another dependency
const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#")) process.env[m[1]] ??= m[2].replace(/^"(.*)"$/s, "$1");
  }
}

async function main() {
  const sheets = await import("../lib/sheets");
  const { seedPOs } = await import("../lib/store");
  if (!sheets.sheetsConfigured()) {
    console.error("The sheet bridge isn't configured. Fill SHEETS_BRIDGE_URL and SHEETS_BRIDGE_TOKEN in .env.local first.");
    process.exit(1);
  }
  await sheets.ensureTabs();
  await sheets.sheetReplacePOs(seedPOs());
  console.log("Done: tabs created and 4 starter POs loaded (dates are relative to today).");
  if (process.argv.includes("--clear-log")) {
    await sheets.sheetClearUpdates();
    console.log("Cleared the Updates log.");
  } else {
    console.log("The Updates log was kept. Add --clear-log to wipe it too: npm run seed -- --clear-log");
  }
}

main().catch((e) => {
  console.error("Seed failed:", e.message ?? e);
  process.exit(1);
});
