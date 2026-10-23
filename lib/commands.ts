// Owner-only Telegram commands to manage POs without opening the Google Sheet.
// No AI here: the command is read by plain rules, so what you type is exactly what is saved.
//   /pos                                      list your POs
//   /addpo PO-105 | Glow Serum | SKU-SERUM | 500 | label: Rajesh Labels @ 5 Nov | packaging: Sun Packers @ 1 Nov
//   /eta PO-105 label 10 Nov                  change a date (shows up on the board, can be undone there)
//   /vendor PO-105 label Rajesh Labels        change who supplies an item
//   /delivered PO-105 label                   mark an item as received
//   /reopen PO-105 label 12 Nov               an item is not delivered after all
//   /removepo PO-105 yes                      delete a PO
import { addDays, formatDay, isValidIso, resolveEta, todayIST } from "./dates";
import { notifyRisk } from "./pipeline";
import { addPO, appendUpdate, getPOs, replacePOs, saveUpdate, setPOField } from "./store";
import { ITEMS, type Item, type PO, type POInput, type UpdateRow } from "./types";

export const COMMAND_RE = /^\/(pos|addpo|eta|vendor|delivered|reopen|removepo|help)(@\w+)?(\s|$)/i;
export const isCommand = (text: string) => COMMAND_RE.test(text.trim());

const HELP = [
  "POPilot commands (only you can use these):",
  "/pos : list your POs",
  "/addpo PO-105 | Glow Serum | SKU-SERUM | 500 | label: Rajesh Labels @ 5 Nov | packaging: Sun Packers @ 1 Nov | manufacturer: Acme Mfg @ 20 Nov",
  "/eta PO-105 label 10 Nov",
  "/vendor PO-105 label Rajesh Labels",
  "/delivered PO-105 label",
  "/reopen PO-105 label 12 Nov",
  "/removepo PO-105 yes",
  "Dates: 5 Nov, 2026-11-05, monday, or 7d (in 7 days). Items: manufacturer, packaging, label.",
].join("\n");

const ITEM_ALIASES: Record<string, Item> = {
  manufacturer: "manufacturer", manufacturing: "manufacturer", mfg: "manufacturer", maker: "manufacturer",
  packaging: "packaging", packing: "packaging", pack: "packaging", box: "packaging", boxes: "packaging",
  label: "label", labels: "label", lable: "label", sticker: "label",
};
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const parseItem = (s: string): Item | null => ITEM_ALIASES[s.trim().toLowerCase()] ?? null;

// "PO 105", "po-105", "105" -> "PO-105"
function parsePoId(s: string): string | null {
  const m = /^(?:po[\s\-#.:]*)?0*(\d{1,6})$/i.exec(s.trim());
  return m ? `PO-${m[1]}` : null;
}
const poNum = (id: string) => (/\d+/.exec(id)?.[0] ?? "").replace(/^0+/, "");
const findPo = (pos: PO[], id: string) => pos.find((p) => poNum(p.po_id) === poNum(id));

// A date typed by a person. Returns null if it can't be read or is in the past.
export function parseDay(raw: string, today: string): string | null {
  const s = raw.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  let iso: string | null = null;
  if (isValidIso(s)) iso = s;
  else {
    let m = /^(?:in )?\+?(\d{1,3}) ?(?:d|days?|din)$/.exec(s);
    if (m) iso = addDays(today, +m[1]);
    else if ((m = /^(\d{1,2})(?:st|nd|rd|th)? ?([a-z]{3,9})(?: (\d{4}))?$/.exec(s))) {
      const mon = MONTHS.indexOf(m[2].slice(0, 3));
      if (mon !== -1) {
        const pad = (n: number) => String(n).padStart(2, "0");
        const make = (y: number) => `${y}-${pad(mon + 1)}-${pad(+m![1])}`;
        const y = m[3] ? +m[3] : +today.slice(0, 4);
        iso = make(y);
        if (!m[3] && isValidIso(iso) && iso < today) iso = make(y + 1); // "5 Jan" typed in December means next January
      }
    }
    if (!iso) iso = resolveEta({ type: "weekday", value: s }, today);
  }
  return iso && isValidIso(iso) && iso >= today ? iso : null;
}

const itemLine = (p: PO, i: Item) => {
  const x = p.inputs[i];
  return `  ${i}: ${x.vendor || "(no vendor)"} · ${x.status === "delivered" ? "delivered" : x.eta ? formatDay(x.eta) : "no date"}`;
};

export interface CommandCtx {
  id: string; // the Telegram message id (as tg_...), used as the log row id for ETA changes
  today?: string;
}

// Runs one command and returns the reply to send. Never throws: problems become a plain-English reply.
export async function runCommand(text: string, ctx: CommandCtx): Promise<string> {
  const today = ctx.today ?? todayIST();
  const m = /^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/.exec(text.trim());
  if (!m) return HELP;
  const cmd = m[1].toLowerCase();
  // "PO 105" with a space is one word: "PO-105"
  const rest = m[2].trim().replace(/^(po)[\s#.:]+(\d)/i, "$1-$2");
  try {
    if (cmd === "help") return HELP;
    if (cmd === "pos") {
      const pos = await getPOs();
      if (!pos.length) return "No POs yet. Add one with /addpo (send /help to see how).";
      return pos.map((p) => `${p.po_id} · ${p.product} (${p.sku})\n${ITEMS.map((i) => itemLine(p, i)).join("\n")}`).join("\n\n");
    }
    if (cmd === "addpo") return await addPoCmd(rest, today);
    if (cmd === "removepo") return await removeCmd(rest);
    return await editCmd(cmd, rest, today, ctx.id, text);
  } catch (e) {
    return `Couldn't do that: ${(e as Error).message}. Nothing may have been saved, send /pos to check.`;
  }
}

async function addPoCmd(rest: string, today: string): Promise<string> {
  const usage = "Format: /addpo PO-105 | Glow Serum | SKU-SERUM | 500 | label: Rajesh Labels @ 5 Nov";
  const parts = rest.split(/[|\n]/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 5) return `I need the PO number, product, SKU, quantity and at least one item (label, packaging or manufacturer) with vendor and date.\n${usage}`;
  const [idRaw, product, sku, qtyRaw, ...itemParts] = parts;
  const po_id = parsePoId(idRaw);
  if (!po_id) return `"${idRaw}" isn't a PO number. Use something like PO-105.\n${usage}`;
  const qty = Number(qtyRaw.replace(/[, ]/g, ""));
  if (!Number.isInteger(qty) || qty <= 0) return `Quantity "${qtyRaw}" should be a whole number like 500.\n${usage}`;
  if (/\s/.test(sku)) return `The SKU "${sku}" has a space in it. SKUs are one word like SKU-SERUM.\n${usage}`;

  const inputs = {} as Record<Item, POInput>;
  for (const i of ITEMS) inputs[i] = { vendor: "", eta: "", status: "delivered" }; // not mentioned = nothing open
  for (const part of itemParts) {
    const c = part.indexOf(":");
    const item = c === -1 ? null : parseItem(part.slice(0, c));
    if (!item) return `I couldn't read "${part}". Write each item as  label: Vendor Name @ 5 Nov  (items: manufacturer, packaging, label).\n${usage}`;
    const at = part.lastIndexOf("@");
    if (at === -1) return `Add the date for ${item} after an @, like  ${item}: Vendor Name @ 5 Nov.`;
    const vendor = part.slice(c + 1, at).trim();
    const eta = parseDay(part.slice(at + 1), today);
    if (!vendor) return `Who is the ${item} vendor? Write  ${item}: Vendor Name @ 5 Nov.`;
    if (!eta) return `I couldn't read "${part.slice(at + 1).trim()}" as a date for ${item}, or it's in the past. Try 5 Nov or 2026-11-05.`;
    inputs[item] = { vendor, eta, status: "open" };
  }
  if (ITEMS.every((i) => inputs[i].status !== "open")) return `Add at least one open item, like  label: Rajesh Labels @ 5 Nov.`;

  const existing = await getPOs();
  if (findPo(existing, po_id)) return `${po_id} already exists. Use /eta or /vendor to change it, or /removepo ${po_id} yes first.`;

  await addPO({ po_id, sku, product, qty, inputs });
  const open = ITEMS.filter((i) => inputs[i].status === "open");
  const skipped = ITEMS.filter((i) => inputs[i].status !== "open");
  return [
    `Added ${po_id} · ${product} (${sku}), qty ${qty}`,
    ...open.map((i) => `  ${i}: ${inputs[i].vendor} · ${formatDay(inputs[i].eta)}`),
    skipped.length ? `Not tracked: ${skipped.join(", ")} (add later with /reopen ${po_id} <item> <date>, then /vendor).` : "",
    "It is on the board now. Vendor updates will match it by vendor name and item.",
  ].filter(Boolean).join("\n");
}

async function removeCmd(rest: string): Promise<string> {
  const [idRaw, confirm] = rest.split(/\s+/);
  const po_id = idRaw ? parsePoId(idRaw) : null;
  if (!po_id) return "Which PO? Example: /removepo PO-105 yes";
  const pos = await getPOs();
  const po = findPo(pos, po_id);
  if (!po) return `No PO called ${po_id} in your sheet.`;
  if ((confirm ?? "").toLowerCase() !== "yes") return `This deletes ${po.po_id} · ${po.product} from the board. To go ahead send:\n/removepo ${po.po_id} yes`;
  await replacePOs(pos.filter((p) => p !== po));
  return `Removed ${po.po_id} · ${po.product}. Its past messages stay in the log.`;
}

async function editCmd(cmd: string, rest: string, today: string, id: string, original: string): Promise<string> {
  const words = rest.split(/\s+/).filter(Boolean);
  const usage: Record<string, string> = {
    eta: "/eta PO-105 label 10 Nov", vendor: "/vendor PO-105 label Rajesh Labels",
    delivered: "/delivered PO-105 label", reopen: "/reopen PO-105 label 12 Nov",
  };
  const po_id = words[0] ? parsePoId(words[0]) : null;
  const item = words[1] ? parseItem(words[1]) : null;
  if (!po_id || !item) return `Format: ${usage[cmd]}  (items: manufacturer, packaging, label)`;
  const tail = words.slice(2).join(" ");

  const po = findPo(await getPOs(), po_id);
  if (!po) return `No PO called ${po_id} in your sheet. Send /pos to see your POs, or add it with /addpo.`;
  const cur = po.inputs[item];

  if (cmd === "delivered") {
    if (cur.status === "delivered") return `${po.po_id} ${item} is already marked delivered.`;
    await setPOField(po.po_id, item, "status", "delivered");
    await setPOField(po.po_id, item, "eta", "");
    return `Marked ${po.po_id} ${item} as delivered.`;
  }

  if (cmd === "vendor") {
    if (!tail) return `Who is the new vendor? ${usage.vendor}`;
    await setPOField(po.po_id, item, "vendor", tail);
    return `${po.po_id} ${item} vendor is now ${tail} (was ${cur.vendor || "empty"}).`;
  }

  // eta / reopen both need a date
  const eta = parseDay(tail, today);
  if (!eta) return `I couldn't read "${tail}" as a date, or it's in the past. Try 10 Nov, 2026-11-10, monday or 7d.\n${usage[cmd]}`;

  if (cmd === "reopen") {
    if (cur.status === "open") return `${po.po_id} ${item} is already open (arrives ${formatDay(cur.eta)}). Use /eta to change the date.`;
    await setPOField(po.po_id, item, "status", "open");
    await setPOField(po.po_id, item, "eta", eta);
    return `${po.po_id} ${item} is open again, arriving ${formatDay(eta)}.${cur.vendor ? "" : ` Set its supplier with /vendor ${po.po_id} ${item} <name>.`}`;
  }

  // eta
  if (cur.status === "delivered") return `${po.po_id} ${item} is marked delivered. If it is not, send /reopen ${po.po_id} ${item} ${tail}`;
  if (cur.eta === eta) return `${po.po_id} ${item} already arrives ${formatDay(eta)}. Nothing changed.`;
  // same careful order as a vendor update: log first, change the PO, then mark the log done (so Undo works on the board)
  const row: UpdateRow = {
    id, timestamp: new Date().toISOString(), original_text: original.trim(), source: "text", vendor: cur.vendor,
    po_id: po.po_id, item, eta_expression: "typed command", old_eta: cur.eta, new_eta: eta, confidence: 1,
    status: "pending", reason: "Updating the PO…",
  };
  await appendUpdate(row);
  try {
    await setPOField(po.po_id, item, "eta", eta);
    row.status = "applied";
    row.reason = "Date changed by you in Telegram.";
  } catch (e) {
    row.status = "needs_review";
    row.reason = `Needs your review: couldn't update the sheet (${(e as Error).message})`;
    await saveUpdate(row);
    throw e;
  }
  await saveUpdate(row);
  await notifyRisk(po, item, eta);
  return `${po.po_id} ${item}: ${cur.eta ? formatDay(cur.eta) : "no date"} → ${formatDay(eta)}. If this creates a stock-out risk you'll get an alert.`;
}
