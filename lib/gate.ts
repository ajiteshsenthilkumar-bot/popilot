// The safety gate. The AI only *proposes*; this plain code decides whether a PO may change.
import { diffDays, resolveEta } from "./dates";
import { ITEMS, type Item, type PO, type Proposal } from "./types";

export const CONFIDENCE_THRESHOLD = 0.7;

export type GateResult =
  | { ok: true; po: PO; item: Item; newEta: string }
  | { ok: false; reason: string; newEta: string | null };

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function vendorMatches(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  if (x.length < 3 || y.length < 3) return false;
  return x === y || x.includes(y) || y.includes(x);
}

// PO numbers a person wrote in the message ("PO 105", "po-105", "PO#105" all give "105").
export function mentionedPoNumbers(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\bPO[\s\-#.:]*0*(\d{1,6})\b/gi)) out.add(m[1]);
  return [...out];
}

const poNumber = (id: string): string => (/\d+/.exec(id)?.[0] ?? "").replace(/^0+/, "");

export function evaluate(
  proposal: Proposal,
  pos: PO[],
  today: string,
  threshold: number = CONFIDENCE_THRESHOLD,
  text?: string, // the original message, so a PO the person named can be checked in plain code (never trust the AI alone)
): GateResult {
  const newEta = resolveEta(proposal.eta_expression, today);

  // If the message names a PO, that is the PO it is about. The AI may not swap in a different one.
  const named = text ? mentionedPoNumbers(text) : [];
  if (named.length) {
    const exists = pos.filter((p) => named.includes(poNumber(p.po_id)));
    if (!exists.length) {
      return {
        ok: false,
        reason: `No PO called PO-${named[0]} in your sheet. Add it to the POs tab first (or pick the right PO below), then confirm`,
        newEta,
      };
    }
    if (proposal.po_id && !named.includes(poNumber(proposal.po_id))) {
      return { ok: false, reason: `The message names PO-${named[0]} but was matched to ${proposal.po_id}`, newEta };
    }
  }

  if (!proposal.vendor) return { ok: false, reason: "No vendor found in the message", newEta };
  if (!proposal.item || !ITEMS.includes(proposal.item)) {
    return { ok: false, reason: "Couldn't tell which item (manufacturing / packaging / label) this is about", newEta };
  }
  if (!newEta) return { ok: false, reason: "No clear new date in the message", newEta };
  if (diffDays(today, newEta) < 0) return { ok: false, reason: `New date ${newEta} is in the past`, newEta };
  if (!proposal.po_id) return { ok: false, reason: "Couldn't match this to a PO", newEta };

  const po = pos.find((p) => p.po_id === proposal.po_id);
  if (!po) return { ok: false, reason: `No PO called ${proposal.po_id}`, newEta };

  const input = po.inputs[proposal.item];
  if (!vendorMatches(proposal.vendor, input.vendor)) {
    return {
      ok: false,
      reason: `${proposal.vendor} is not the ${proposal.item} vendor on ${po.po_id} (that's ${input.vendor})`,
      newEta,
    };
  }
  if (input.status !== "open") {
    return { ok: false, reason: `${po.po_id} ${proposal.item} is already delivered, so there is no open PO to update`, newEta };
  }
  if (!(proposal.confidence >= threshold)) {
    return {
      ok: false,
      reason: `Low confidence (${Math.round(proposal.confidence * 100)}%, needs ${Math.round(threshold * 100)}%)`,
      newEta,
    };
  }

  return { ok: true, po, item: proposal.item, newEta };
}
