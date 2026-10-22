# POPilot

Forward a vendor's delay message (WhatsApp text or voice-note transcript, Hinglish is fine) and POPilot:

1. uses Claude to read it into fields (vendor, PO, item, new ETA, confidence),
2. checks with plain code that this vendor really has an open PO for that item,
3. updates the PO's ETA in your Google Sheet (or asks you to review if anything is unclear),
4. compares the real ETA with how many days of Shopify stock are left, and warns you about a stock-out.

**What is AI and what is plain code?** Claude only reads messy text and fills labels. Every date, day-of-stock number, comparison and the alert wording is ordinary code in `lib/` (`dates.ts`, `risk.ts`, `gate.ts`).

## Run it (demo mode, no keys needed to look around)

```bash
npm install
npm run dev
```

Open http://localhost:3000. Without Google keys it runs in "demo mode" (data in memory). Without `ANTHROPIC_API_KEY`, parsing shows "needs your review" and changes nothing.

## Connect everything (about 15 minutes)

1. **Anthropic key**: create one at console.anthropic.com. Put it in `.env.local` as `ANTHROPIC_API_KEY=...`.
2. **Google Sheet**: create a blank Google Sheet. Copy the ID from its URL (`docs.google.com/spreadsheets/d/<THIS PART>/edit`) into `GOOGLE_SHEET_ID`.
3. **Service account** (a robot Google account that edits the sheet for you):
   - console.cloud.google.com → create a project → enable **Google Sheets API**.
   - IAM & Admin → Service Accounts → create one → Keys → Add key → JSON. A file downloads.
   - From that JSON: `client_email` → `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `private_key` → `GOOGLE_PRIVATE_KEY` (keep the `\n` characters, wrap in double quotes).
   - In your sheet click **Share** and give that `client_email` **Editor** access.
4. Copy `.env.example` to `.env.local` and fill the four values. **Never commit `.env.local`** (it is git-ignored).
5. Create the tabs and load starter POs:

```bash
npm run seed
```

6. `npm run dev` again. The yellow demo banner disappears and you're on your real sheet.

## Try the 3 tests

Use the sample chips in the parser panel.

| Test | Do this | Expect |
|---|---|---|
| 1. Parse + update | "Labels delayed (Hinglish)" → Parse | Result card with vendor / PO / item / ETA / confidence next to the original text; `Updates` tab gets a row; PO-101 label ETA changes on the board and in the `POs` tab. |
| 2. Stock-out alert | "Voice transcript" sample (labels in 7 days) | Red alert: "Glow Serum runs out in 4 days; label now arrives in 7 → 3-day stock-out risk. Reorder or slow ads?" and the PO-101 row is marked At risk. |
| 3. Bad input | "Gibberish" or "Unknown vendor" | Amber "Needs your review" card with the original text and a low-confidence flag. No PO changes until you press **Confirm**. |

Automated checks (no API key needed, Claude is faked): `npm test`.

## Voice notes

For the demo you paste a transcript. For real audio later, transcribe first, then paste/send the text into the same flow. Options: OpenAI Whisper API (simplest) or Sarvam AI "Saarika" (built for Indian languages and Hinglish).

## Real Shopify later

Replace the body of `getStockAndSales()` in `lib/shopify.ts` (steps are in the comment there). Nothing else changes.

## Deploy to Vercel

Push to GitHub, import the repo in Vercel, add the four env vars in Project Settings → Environment Variables, deploy.

## Not built (on purpose)

Live WhatsApp Business API, call transcription, auto-messaging vendors, pausing ads, reorder forecasting, multi-store, vendor reliability scores.
