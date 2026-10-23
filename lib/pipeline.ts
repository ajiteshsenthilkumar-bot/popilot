// The flow for one message: Claude proposes -> plain-code gate decides -> sheet changes (or not).
// Order matters: the log row is written FIRST, then the PO, then the log row is marked done.
// So a failure midway leaves a visible "pending" row, never a silent PO change.
import { extractProposal } from "./claude";
import { isValidIso, todayIST } from "./dates";
import { maybeAlert } from "./alerts";
import { evaluate } from "./gate";
import { describeEta } from "./sanitize";
import { findStock, getStockSnapshot } from "./shopify";
import { appendUpdate, getPOs, getUpdates, saveUpdate, setEta } from "./store";
import { ITEMS, type Item, type PO, type Proposal, type UpdateRow } from "./types";

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Tell the owner on Telegram if this ETA change creates (or worsens) a stock-out risk.
// Best effort: a problem here must never undo or hide the PO update that already succeeded.
async function notifyRisk(poBefore: PO, item: Item, newEta: string): Promise<void> {
  try {
    const snap = await getStockSnapshot();
    const input = poBefore.inputs[item];
    await maybeAlert({ poBefore, item, newEta, stock: findStock(snap.records, poBefore.sku), vendor: input.vendor, oldEta: input.eta });
  } catch (e) {
    console.error("stock-out alert failed:", (e as Error).message);
  }
}

export interface ProcessInput {
  text: string;
  source: "text" | "voice";
  sender?: string;
  // WhatsApp message id (as "wa_<id>"): makes a re-delivered message recognisable as a duplicate
  id?: string;
  // Live feeds only: if the AI says the message isn't about supply status, drop it and store nothing.
  dropIrrelevant?: boolean;
}

export async function processMessage(input: ProcessInput & { dropIrrelevant: true }): Promise<UpdateRow | null>;
export async function processMessage(input: ProcessInput): Promise<UpdateRow>;
export async function processMessage(input: ProcessInput): Promise<UpdateRow | null> {
  const today = todayIST();
  const pos = await getPOs();

  const row: UpdateRow = {
    id: input.id ?? newId(),
    timestamp: new Date().toISOString(),
    original_text: input.text,
    source: input.source,
    vendor: "",
    po_id: "",
    item: "",
    eta_expression: "",
    old_eta: "",
    new_eta: "",
    confidence: 0,
    status: "needs_review",
    reason: "",
  };

  let proposal: Proposal | null = null;
  try {
    proposal = await extractProposal({ text: input.text, source: input.source, sender: input.sender, today, openPOs: pos });
  } catch (e) {
    // If the AI is down we change nothing and ask the human.
    row.reason = `Needs your review: couldn't read this message (${(e as Error).message})`;
    await appendUpdate(row);
    return row;
  }

  // Not about supply status (chit-chat etc.): in a live feed we neither act on it nor keep its text.
  if (input.dropIrrelevant && proposal.relevant === false) return null;

  row.vendor = proposal.vendor ?? "";
  row.po_id = proposal.po_id ?? "";
  row.item = proposal.item ?? "";
  row.eta_expression = describeEta(proposal.eta_expression);
  row.confidence = proposal.confidence;

  // show what the ETA is today, if the AI pointed at a real PO + item
  const guessPo = pos.find((p) => p.po_id === proposal!.po_id);
  if (guessPo && proposal.item) row.old_eta = guessPo.inputs[proposal.item].eta;

  const verdict = evaluate(proposal, pos, today);
  row.new_eta = verdict.newEta ?? "";

  if (!verdict.ok) {
    row.status = "needs_review";
    row.reason = `Needs your review: ${verdict.reason}`;
    await appendUpdate(row);
    return row;
  }

  // 1) log first as pending, 2) change the PO, 3) mark the log row applied
  row.status = "pending";
  row.reason = "Updating the PO…";
  await appendUpdate(row);
  try {
    const changed = await setEta(verdict.po.po_id, verdict.item, verdict.newEta);
    row.status = changed ? "applied" : "needs_review";
    row.reason = changed ? proposal.reason : "Needs your review: PO row not found in the sheet";
  } catch (e) {
    row.status = "needs_review";
    row.reason = `Needs your review: couldn't update the sheet (${(e as Error).message})`;
  }
  await saveUpdate(row);
  if (row.status === "applied") await notifyRisk(verdict.po, verdict.item, verdict.newEta);
  return row;
}

// One-tap confirm by the human. The person picks/approves the PO, item and date.
export async function confirmUpdate(input: {
  id: string;
  po_id: string;
  item: Item;
  eta: string;
}): Promise<UpdateRow> {
  if (!ITEMS.includes(input.item)) throw new Error("Pick manufacturer, packaging or label");
  if (!isValidIso(input.eta)) throw new Error("Pick a valid date");

  const [updates, pos] = await Promise.all([getUpdates(), getPOs()]);
  const row = updates.find((u) => u.id === input.id);
  if (!row) throw new Error("That message was not found");
  if (row.status !== "needs_review") throw new Error("That message was already handled");

  const po = pos.find((p) => p.po_id === input.po_id);
  if (!po) throw new Error(`No PO called ${input.po_id}`);
  if (po.inputs[input.item].status !== "open") throw new Error(`${input.po_id} ${input.item} is already delivered`);

  const done: UpdateRow = {
    ...row,
    po_id: po.po_id,
    item: input.item,
    vendor: po.inputs[input.item].vendor,
    old_eta: po.inputs[input.item].eta,
    new_eta: input.eta,
    status: "pending",
    reason: "Updating the PO…",
  };
  await saveUpdate(done); // log first
  if (!(await setEta(po.po_id, input.item, input.eta))) {
    done.status = "needs_review";
    done.reason = "Needs your review: PO row not found in the sheet";
    await saveUpdate(done);
    throw new Error("PO row not found in the sheet");
  }
  done.status = "confirmed";
  done.reason = "Confirmed by you";
  await saveUpdate(done);
  await notifyRisk(po, input.item, input.eta);
  return done;
}
