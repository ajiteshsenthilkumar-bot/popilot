// Who is allowed to feed POPilot. Anyone not on this list is dropped BEFORE any AI sees the message,
// and nothing about it is stored. An empty list means nobody is allowed (fails closed).
//
// WHATSAPP_ALLOWED looks like:
//   919812345678=Rajesh Labels, 919800000001=Pack Wale, 919876500000=*, group:120363012345@g.us=Vendor Group
//   - phone=Name   a vendor's own number (their messages are treated as coming from that vendor)
//   - phone=*      YOUR number (or a teammate's): you forward vendor messages; the AI works out the vendor
//   - group:ID=Name  a WhatsApp group (only if Meta's group messages are available to you)
export interface AllowEntry {
  key: string; // digits only for phones, or "group:<id>"
  vendor: string | null; // null = forwarder, vendor must come from the message itself
}

export function normalizePhone(p: string): string {
  return p.replace(/\D/g, "");
}

export function parseAllowList(raw: string | undefined | null): AllowEntry[] {
  const out: AllowEntry[] = [];
  for (const part of (raw ?? "").split(/[,;\n]+/)) {
    const i = part.indexOf("=");
    const left = (i === -1 ? part : part.slice(0, i)).trim();
    const name = i === -1 ? "" : part.slice(i + 1).trim();
    if (!left) continue;
    let key: string;
    if (left.toLowerCase().startsWith("group:")) {
      const id = left.slice(6).trim();
      if (!id) continue;
      key = `group:${id}`;
    } else {
      key = normalizePhone(left);
      if (key.length < 8) continue; // not a real phone number
    }
    out.push({ key, vendor: !name || name === "*" ? null : name });
  }
  return out;
}

// Telegram version, TELEGRAM_ALLOWED, e.g.:  123456789=*,987654321=Rajesh Labels,-1001234567890=Vendor Group
//   - a positive id is a person (name = the vendor, or * for you when you forward vendor messages)
//   - a NEGATIVE id is a group chat the bot has been added to
export function parseTelegramAllowList(raw: string | undefined | null): AllowEntry[] {
  const out: AllowEntry[] = [];
  for (const part of (raw ?? "").split(/[,;\n]+/)) {
    const i = part.indexOf("=");
    const left = (i === -1 ? part : part.slice(0, i)).trim();
    const name = i === -1 ? "" : part.slice(i + 1).trim();
    const vendor = !name || name === "*" ? null : name;
    if (/^-\d{5,}$/.test(left)) out.push({ key: `group:${left}`, vendor });
    else if (/^\d{5,}$/.test(left)) out.push({ key: left, vendor });
  }
  return out;
}

export type SenderMatch = { allowed: true; vendor: string | null } | { allowed: false };

export function matchSender(entries: AllowEntry[], from: string, groupId?: string | null): SenderMatch {
  const phone = entries.find((e) => e.key === normalizePhone(from));
  if (groupId) {
    // a group message needs the GROUP to be listed; the sender's own entry (if any) names the vendor
    const group = entries.find((e) => e.key === `group:${groupId}`);
    if (!group) return { allowed: false };
    return { allowed: true, vendor: phone?.vendor ?? group.vendor };
  }
  return phone ? { allowed: true, vendor: phone.vendor } : { allowed: false };
}
