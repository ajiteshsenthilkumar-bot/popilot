# POPilot

Forward a vendor's delay message (WhatsApp text or voice-note transcript, Hinglish is fine) and POPilot:

1. uses an AI model to read it into fields (vendor, PO, item, new ETA, confidence),
2. checks with plain code that this vendor really has an open PO for that item,
3. updates the PO's ETA in your Google Sheet (or asks you to review if anything is unclear),
4. compares the real ETA with how many days of Shopify stock are left, and warns you about a stock-out.

**What is AI and what is plain code?** The AI model (a Google Gemini model via OpenRouter) only reads messy text and fills labels. Every date, day-of-stock number, comparison and the alert wording is ordinary code in `lib/` (`dates.ts`, `risk.ts`, `gate.ts`).

## Run it

```bash
npm install
npm run dev
```

The app needs your Google Sheet (below). Until it's connected, the page shows a red message saying so. Without `OPENROUTER_API_KEY`, parsing shows "needs your review" and changes nothing.

## Connect everything (about 15 minutes)

1. **AI key**: create one at openrouter.ai/keys and add some credit. Put it in `.env.local` as `OPENROUTER_API_KEY=...`. The app calls `google/gemini-3.7-flash` through OpenRouter, served by Google's own infrastructure only (set `AI_MODEL` to use another `google/` model).
2. **Google Sheet**: create a blank Google Sheet. Copy the ID from its URL (`docs.google.com/spreadsheets/d/<THIS PART>/edit`) into `GOOGLE_SHEET_ID`.
3. **Service account** (a robot Google account that edits the sheet for you):
   - console.cloud.google.com → create a project → enable **Google Sheets API**.
   - IAM & Admin → Service Accounts → create one → Keys → Add key → JSON. A file downloads.
   - From that JSON: `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `private_key` → `GOOGLE_PRIVATE_KEY` (keep the `\n` characters, wrap in double quotes).
   - In your sheet click **Share** and give that `client_email` **Editor** access.
4. Copy `.env.example` to `.env.local` and fill the values. **Never commit `.env.local`** (it is git-ignored).
5. Create the tabs and load starter POs:

```bash
npm run seed
```

6. `npm run dev`. The board loads from your real sheet. Each parsed message also shows the old ETA → new ETA with weekdays, so a misread date is easy to spot.

## Try the 3 tests

Use the sample chips in the parser panel.

| Test | Do this | Expect |
|---|---|---|
| 1. Parse + update | "Labels delayed (Hinglish)" → Parse | Result card with vendor / PO / item / ETA / confidence next to the original text; `Updates` tab gets a row; PO-101 label ETA changes on the board and in the `POs` tab. |
| 2. Stock-out alert | "Voice transcript" sample (labels in 7 days) | Red alert: "Glow Serum runs out in 4 days; label now arrives in 7 → 3-day stock-out risk. Reorder or slow ads?" and the PO-101 row is marked At risk. |
| 3. Bad input | "Gibberish" or "Unknown vendor" | Amber "Needs your review" card with the original text and a low-confidence flag. No PO changes until you press **Confirm**. |

Automated checks (no API key needed, Claude is faked): `npm test`.

## Live messages: Telegram (quick, free)

A Telegram bot is the fastest way to get live vendor updates. The bot only ever sees chats that contain it: a person messages it directly, or you add it to a vendor group. It **never replies** to anyone. Only people and groups on your allow-list (`TELEGRAM_ALLOWED`) are read; everyone else is dropped before any AI sees the message and nothing about them is stored. Messages are handled exactly like WhatsApp ones: voice notes are transcribed (only the transcript is kept), chit-chat and anything not about supply status is dropped, then the safety gate decides between a PO update and "needs your review".

**Setup (about 10 minutes):**
1. In Telegram, open **@BotFather** (the one with the blue tick) → send `/newbot` → choose a name (`POPilot`) and a username ending in `bot` (e.g. `popilot_yourname_bot`). BotFather replies with a **token**. Put it in `.env.local` as `TELEGRAM_BOT_TOKEN`. Treat it like a password and never share it.
2. **For groups only:** send BotFather `/setprivacy` → pick your bot → **Disable**, so the bot can read all messages in a group, not just commands. Then add the bot to the vendor group. (If you change privacy after adding the bot, remove it and add it again.)
3. Find IDs: message **@userinfobot** to get your own numeric ID. Each vendor does the same, or forwards you a message from them. A group's ID is negative (e.g. `-1001234567890`); open the group in Telegram Web and read it from the URL, or use **@getidsbot**.
4. Set `TELEGRAM_ALLOWED`, e.g. `123456789=*,987654321=Rajesh Labels,-1001234567890=Vendor Group` (`id=Vendor name` for a vendor's own account, `id=*` for **you** when you forward vendor messages, a negative id for a group).
5. Put `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` and `TELEGRAM_ALLOWED` into Vercel too (Project → Settings → Environment Variables) and redeploy.
6. Register the webhook (once, from this folder): `npm run telegram:webhook`. Check it with `npm run telegram:webhook -- --info`, switch it off with `-- --delete`.
7. Message the bot "labels Monday tak nahi aayenge" (text or voice note) from an allowed account. Within about 30 seconds it shows on the screen, marked "Telegram".

Vendors must use Telegram for this route. You can also forward their WhatsApp messages and voice notes to the bot yourself.

## Live WhatsApp (Meta Cloud API, free test number) — paused

WhatsApp does not allow any app to read your existing chats or groups. POPilot receives only what is **sent or forwarded to its own WhatsApp number**, and only from people on your allow-list. Everyone else is dropped before any AI sees the message, and nothing about them is stored.

What happens to each message: allow-list check → skip duplicates → voice note turned into text → chit-chat skipped → AI decides if it is about supply status (if not, dropped and not stored) → safety gate → PO updated, or "needs your review". Only the transcript of a voice note is kept, never the audio.

**One-time setup (about 20 minutes, screens may look slightly different):**
1. Go to developers.facebook.com, sign in with Facebook, **Create app** (type: Business) and add the **WhatsApp** product.
2. WhatsApp → **API setup**: Meta gives you a free **test phone number** and a temporary **access token** (lasts about 24 hours; a permanent one needs a System User in Business settings). Under "To", add the phone numbers that will send messages and verify each with the code WhatsApp sends.
3. App settings → Basic → **App secret** (click Show).
4. Put these in `.env.local` AND in Vercel (Project → Settings → Environment Variables), then redeploy:
   - `WHATSAPP_VERIFY_TOKEN`: already generated for you in `.env.local`
   - `WHATSAPP_APP_SECRET`: the app secret from step 3
   - `WHATSAPP_ACCESS_TOKEN`: the token from step 2
   - `WHATSAPP_ALLOWED`: who may feed POPilot, e.g. `919812345678=Rajesh Labels,919800000001=Pack Wale,919876500000=*` (`phone=Vendor name` for a vendor's own number, `phone=*` for YOUR number when you forward vendor messages)
5. WhatsApp → **Configuration** → Webhook: Callback URL `https://<your-site>.vercel.app/api/whatsapp`, Verify token = your `WHATSAPP_VERIFY_TOKEN`. Click **Verify and save**, then **subscribe** to the `messages` field.
6. From an allowed phone, send "labels Monday tak nahi aayenge" (text or voice note) to the test number. Within about 30 seconds the update shows on the screen, marked "WhatsApp".

Ways to feed it: (1) a vendor messages the POPilot number directly, (2) you forward a vendor's message or voice note to it, (3) a WhatsApp group that includes the number, only if Meta makes group messages available to you.

Not verified yet: group messages, and exactly which senders Meta's test number accepts messages from. If a vendor's message doesn't arrive, add their number under "To" in step 2.

## Voice notes

In the app you can still paste a transcript. Voice notes that arrive on WhatsApp are transcribed automatically by a Google Gemini model through OpenRouter (about $0.002 per 12-second note, nothing extra to set up). If Hinglish accuracy turns out poor, Sarvam AI "Saarika" is a drop-in alternative to try in `lib/transcribe.ts`.

## Real Shopify later

Replace the body of `getStockAndSales()` in `lib/shopify.ts` (steps are in the comment there). Nothing else changes.

## Deploy to Vercel

Push to GitHub, import the repo in Vercel, add the four env vars in Project Settings → Environment Variables, deploy.

## Not built (on purpose)

Live WhatsApp Business API, call transcription, auto-messaging vendors, pausing ads, reorder forecasting, multi-store, vendor reliability scores.
