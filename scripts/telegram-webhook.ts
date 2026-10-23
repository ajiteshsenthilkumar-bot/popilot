// Tell Telegram where to send your bot's messages. Run after the site is deployed and the .env values are set.
//   npm run telegram:webhook                  register  https://popilot-sable.vercel.app/api/telegram
//   npm run telegram:webhook -- --url https://my-site.vercel.app
//   npm run telegram:webhook -- --info        show what Telegram currently has
//   npm run telegram:webhook -- --delete      switch the webhook off
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env.local");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !line.trim().startsWith("#")) process.env[m[1]] ??= m[2].replace(/^"(.*)"$/s, "$1");
  }
}

const args = process.argv.slice(2);
const urlArg = args.indexOf("--url") !== -1 ? args[args.indexOf("--url") + 1] : undefined;
const site = (urlArg ?? "https://popilot-sable.vercel.app").replace(/\/+$/, "");

async function tg(method: string, body?: Record<string, unknown>) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is empty in .env.local");
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  return (await res.json()) as { ok: boolean; description?: string; result?: any };
}

async function main() {
  if (args.includes("--delete")) {
    const r = await tg("deleteWebhook", { drop_pending_updates: true });
    return console.log(r.ok ? "Webhook removed. The bot no longer sends messages to the app." : `Failed: ${r.description}`);
  }
  if (args.includes("--info")) {
    const r = await tg("getWebhookInfo");
    if (!r.ok) return console.log(`Failed: ${r.description}`);
    const i = r.result;
    return console.log({ url: i.url || "(none)", pending: i.pending_update_count, last_error: i.last_error_message ?? "(none)" });
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) throw new Error("TELEGRAM_WEBHOOK_SECRET is empty in .env.local");
  const me = await tg("getMe");
  if (!me.ok) throw new Error(`Telegram rejected the bot token: ${me.description}`);
  console.log(`Bot found: @${me.result.username}`);

  const r = await tg("setWebhook", {
    url: `${site}/api/telegram`,
    secret_token: secret,
    allowed_updates: ["message", "edited_message"], // edits too, so a corrected message replaces the first version
    drop_pending_updates: true,
  });
  console.log(r.ok ? `Webhook set: ${site}/api/telegram` : `Failed: ${r.description}`);
}

main().catch((e) => {
  console.error("Error:", e.message ?? e);
  process.exit(1);
});
