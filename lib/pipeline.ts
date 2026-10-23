// The flow for one message: Claude proposes -> plain-code gate decides -> sheet changes (or not).
// Order matters: the log row is written FIRST, then the PO, then the log row is marked done.
// So a failure midway leaves a visible "pending" row, never a silent PO change.
import { extractProposal } from "./claude";
import { isValidIso, todayIST } from "./dates";
import { maybeAlert, riskGap } from "./alerts";
import { evaluate } from "./gate";
import { assessRisk } from "./risk";
import { describeEta } from "./sanitize";
import { findStock, getStockSnapshot } from "./shopify";
import { appendUpdate, deleteUpdate as removeUpdate, getPOs, getUpdates, saveUpdate, setAlertState, setEta } from "./store";
import { ITEMS, type Item, type PO, type Proposal, type UpdateRow } from "./types";

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Tell the owner on Telegram if this ETA change creates (or worsens) a stock-out risk.
// Best effort: a problem here must never undo or hide the PO update that already succeeded.
export async function notifyRisk(poBefore: PO, item: Item, newEta: string): Promise<void> {
  try {
    const snap = await getStockSnapshot();
    const input = poBefore.inputs[item];
    const out = await maybeAlert({ poBefore, item, newEta, stock: findStock(snap.records, poBefore.sku), vendor: input.vendor, oldEta: input.eta });
    // remember what the owner now knows, so the daily check doesn't repeat it (and notices if it gets worse later)
    if (out.assessed && out.changed) await setAlertState(poBefore.po_id, out.gap);
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
  // Shown on the card: e.g. "Edited message: the earlier change (PO-101 label) was undone first."
  note?: string;
}

export async function processMessage(input: ProcessInput & { dropIrrelevant: true }): Promise<UpdateRow | null>;
export async function processMessage(input: ProcessInput): Promise<UpdateRow>;
export async function processMessage(input: ProcessInput): Promise<UpdateRow | null> {
  const today = todayIST();
  const pos = await getPOs();
  const withNote = (r: string) => (input.note ? `${r} ${input.note}` : r);

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
    row.reason = withNote(`Needs your review: couldn't read this message (${(e as Error).message})`);
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

  const verdict = evaluate(proposal, pos, today, undefined, input.text);
  row.new_eta = verdict.newEta ?? "";

  if (!verdict.ok) {
    row.status = "needs_review";
    row.reason = withNote(`Needs your review: ${verdict.reason}`);
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
    row.reason = withNote(changed ? proposal.reason : "Needs your review: PO row not found in the sheet");
  } catch (e) {
    row.status = "needs_review";
    row.reason = withNote(`Needs your review: couldn't update the sheet (${(e as Error).message})`);
  }
  await saveUpdate(row);
  if (row.status === "applied") await notifyRisk(verdict.po, verdict.item, verdict.newEta);
  return row;
}

// ---- Undo: put an applied update's date back, but only when that is safe ----

// After an undo the risk may be different: remember what the owner should now consider "already told".
async function syncAlertMemory(poBefore: PO, item: Item, eta: string): Promise<void> {
  try {
    const snap = await getStockSnapshot();
    const stock = findStock(snap.records, poBefore.sku);
    if (!stock) return;
    const po: PO = structuredClone(poBefore);
    po.inputs[item].eta = eta;
    await setAlertState(po.po_id, riskGap(assessRisk(po, stock, todayIST())));
  } catch (e) {
    console.error("alert memory sync failed:", (e as Error).message);
  }
}

export interface RevertResult { ok: boolean; reason?: string; row?: UpdateRow }

// Restores the date this update replaced. Refuses (and explains) unless the PO still holds exactly the date this
// update wrote, so we never overwrite a newer change by accident.
async function revertRow(row: UpdateRow): Promise<RevertResult> {
  if (row.status !== "applied" && row.status !== "confirmed") return { ok: false, reason: "That update isn't applied, so there is nothing to undo." };
  const item = row.item as Item;
  if (!ITEMS.includes(item)) return { ok: false, reason: "That update has no item recorded." };
  const po = (await getPOs()).find((p) => p.po_id === row.po_id);
  if (!po) return { ok: false, reason: `${row.po_id} is no longer in the sheet.` };
  const current = po.inputs[item].eta;
  if (current !== row.new_eta) {
    return { ok: false, reason: `${row.po_id} ${item} is now ${current || "empty"}, not ${row.new_eta}, so it was changed again after this update. Check it by hand.` };
  }
  if (!isValidIso(row.old_eta)) return { ok: false, reason: "No earlier date was recorded for this update, so it can't be restored automatically." };

  await saveUpdate({ ...row, status: "pending", reason: "Undoing…" }); // log first, like every other change
  try {
    if (!(await setEta(po.po_id, item, row.old_eta))) throw new Error("PO row not found in the sheet");
  } catch (e) {
    await saveUpdate(row); // nothing changed: put the log row back as it was
    return { ok: false, reason: `Couldn't update the sheet (${(e as Error).message})` };
  }
  const reverted: UpdateRow = { ...row, status: "reverted", reason: `Undone: ${row.po_id} ${item} is back to ${row.old_eta}.` };
  await saveUpdate(reverted);
  await syncAlertMemory(po, item, row.old_eta);
  return { ok: true, row: reverted };
}

// The Undo button.
export async function undoUpdate(id: string): Promise<UpdateRow> {
  const row = (await getUpdates()).find((u) => u.id === id);
  if (!row) throw new Error("That message was not found");
  const r = await revertRow(row);
  if (!r.ok || !r.row) throw new Error(r.reason ?? "Couldn't undo that");
  return r.row;
}

// A message was edited in the chat: undo what its earlier version(s) did, newest first.
export async function revertMessageEffects(baseId: string): Promise<{ reverted: string[]; blocked: string[] }> {
  const rows = (await getUpdates())
    .filter((u) => (u.id === baseId || u.id.startsWith(`${baseId}_e`)) && (u.status === "applied" || u.status === "confirmed"))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const out = { reverted: [] as string[], blocked: [] as string[] };
  for (const r of rows) {
    const res = await revertRow(r);
    if (res.ok) out.reverted.push(`${r.po_id} ${r.item}`);
    else out.blocked.push(res.reason ?? "it couldn't be undone");
  }
  return out;
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

// ---- Delete a card from the log ----
// Only cards that changed nothing (or were already undone) can be deleted. An applied change must be undone first,
// so the log never loses the record of a change that is still in effect.
export async function deleteLogRow(id: string): Promise<void> {
  const row = (await getUpdates()).find((u) => u.id === id);
  if (!row) throw new Error("That card was not found (it may already be deleted)");
  if (row.status === "applied" || row.status === "confirmed") throw new Error("This change is still in effect. Click Undo first, then delete the card.");
  if (row.status === "pending") throw new Error("This update is still being applied. Try again in a moment.");
  if (!(await removeUpdate(id))) throw new Error("That card was not found (it may already be deleted)");
}
