// What happens to each chat message (WhatsApp or Telegram) that reaches a webhook, in this order:
//   1. sender not on the allow-list      -> dropped (never read by the AI, nothing stored)
//   2. already handled (re-delivered)    -> skipped
//   3. voice note                         -> transcribed to text (audio is not kept)
//   4. trivial chit-chat ("ok", "🙏")     -> dropped without calling the AI
//   5. the AI decides if it is about supply status; if not -> dropped, nothing stored
//   6. otherwise the normal pipeline: safety gate -> PO update or "needs your review"
import { matchSender, parseAllowList, type AllowEntry } from "./allowlist";
import { ID_PREFIX, type InboundMessage } from "./channels";
import { processMessage, type ProcessInput } from "./pipeline";
import { isTrivial } from "./relevance";
import { appendUpdate, getUpdates } from "./store";
import { downloadTelegramFile } from "./telegram";
import { transcribeAudio } from "./transcribe";
import { downloadMedia } from "./whatsapp-cloud";
import type { UpdateRow } from "./types";

export interface InboundSummary {
  processed: number;
  applied: number;
  needsReview: number;
  notAllowed: number;
  duplicates: number;
  irrelevant: number;
  unsupported: number;
  errors: number;
}

export interface InboundDeps {
  process: (input: ProcessInput & { dropIrrelevant: true }) => Promise<UpdateRow | null>;
  transcribe: (bytes: Buffer, mime: string) => Promise<string>;
  download: (m: InboundMessage) => Promise<{ bytes: Buffer; mime: string }>;
  knownIds: () => Promise<Set<string>>;
  logReview: (row: UpdateRow) => Promise<void>;
}

// Message ids being worked on right now. A chat app can deliver the same message twice within a moment,
// and the second copy would otherwise read the log before the first has written to it.
const inFlight = new Set<string>();

async function defaultDownload(m: InboundMessage): Promise<{ bytes: Buffer; mime: string }> {
  if (!m.mediaId) throw new Error("no file id on the voice note");
  if (m.channel === "telegram") {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error("TELEGRAM_BOT_TOKEN is missing");
    const f = await downloadTelegramFile(m.mediaId, token);
    return { bytes: f.bytes, mime: m.mime ?? "audio/ogg" };
  }
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!token) throw new Error("WHATSAPP_ACCESS_TOKEN is missing");
  return downloadMedia(m.mediaId, token);
}

const defaultDeps: InboundDeps = {
  process: (i) => processMessage(i),
  transcribe: transcribeAudio,
  download: defaultDownload,
  knownIds: async () => new Set((await getUpdates()).map((u) => u.id)),
  logReview: appendUpdate,
};

function reviewRow(id: string, original: string, source: "text" | "voice", vendor: string, reason: string): UpdateRow {
  return {
    id, timestamp: new Date().toISOString(), original_text: original, source, vendor, po_id: "", item: "",
    eta_expression: "", old_eta: "", new_eta: "", confidence: 0, status: "needs_review",
    reason: `Needs your review: ${reason}`,
  };
}

// `allow` is the parsed allow-list for the channel these messages came from.
export async function handleInbound(
  messages: InboundMessage[],
  allow: AllowEntry[] | string | undefined = process.env.WHATSAPP_ALLOWED,
  deps: InboundDeps = defaultDeps,
): Promise<InboundSummary> {
  const s: InboundSummary = { processed: 0, applied: 0, needsReview: 0, notAllowed: 0, duplicates: 0, irrelevant: 0, unsupported: 0, errors: 0 };
  const list = Array.isArray(allow) ? allow : parseAllowList(allow);

  // only look at what we have already stored if at least one message is from an allowed sender
  const candidates = messages.filter((m) => matchSender(list, m.from, m.groupId).allowed);
  s.notAllowed = messages.length - candidates.length;
  if (!candidates.length) return s;

  let known = new Set<string>();
  try {
    known = await deps.knownIds();
  } catch {
    // if we can't read the log we still process; a rare duplicate is better than losing an update
  }

  for (const m of candidates) {
    const match = matchSender(list, m.from, m.groupId);
    if (!match.allowed) continue;
    const id = `${ID_PREFIX[m.channel]}${m.id}`;
    if (known.has(id) || inFlight.has(id)) { s.duplicates++; continue; }
    inFlight.add(id);

    try {
      let text = "";
      let source: "text" | "voice" = "text";

      if (m.type === "text") {
        text = (m.text ?? "").trim();
      } else if (m.type === "audio" && m.mediaId) {
        source = "voice";
        try {
          const media = await deps.download(m);
          text = (await deps.transcribe(media.bytes, media.mime)).trim();
        } catch (e) {
          // an allowed vendor's voice note we couldn't read: tell the human, never guess
          await deps.logReview(reviewRow(id, "[voice note could not be transcribed]", "voice", match.vendor ?? "", `couldn't read this voice note (${(e as Error).message})`));
          known.add(id);
          s.needsReview++;
          continue;
        }
      } else {
        s.unsupported++; // images, documents, stickers, reactions...
        continue;
      }

      if (isTrivial(text)) { s.irrelevant++; continue; }

      const row = await deps.process({ text, source, sender: match.vendor ?? undefined, id, dropIrrelevant: true });
      if (!row) { s.irrelevant++; continue; }
      known.add(id);
      s.processed++;
      if (row.status === "applied" || row.status === "confirmed") s.applied++;
      else s.needsReview++;
    } catch {
      s.errors++; // never log message text
    } finally {
      inFlight.delete(id);
    }
  }
  return s;
}
