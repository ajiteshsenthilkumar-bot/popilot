// Split an exported WhatsApp chat (.txt) into individual messages.
// Handles both common export styles:
//   12/10/24, 3:45 pm - Rajesh Labels: message
//   [12/10/24, 3:45:12 PM] Rajesh Labels: message
export interface ChatMessage {
  timestamp: string;
  sender: string;
  text: string;
}

const LINE = /^\[?(\d{1,2}\/\d{1,2}\/\d{2,4}),?\s+(\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]m)?)\]?\s*(?:-\s*)?([^:]+?):\s([\s\S]*)$/i;

// a line that starts with a date/time but has no "Sender:" is a WhatsApp system line
const STAMP = /^\[?\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}/;

export function parseChatExport(raw: string): ChatMessage[] {
  const out: ChatMessage[] = [];
  let skipping = false;
  for (const line of raw.replace(/\r/g, "").split("\n")) {
    const clean = line.replace(/[‎‏]/g, "");
    const m = LINE.exec(clean);
    if (m) {
      skipping = false;
      out.push({ timestamp: `${m[1]} ${m[2]}`.trim(), sender: m[3].trim(), text: m[4].trim() });
    } else if (STAMP.test(clean)) {
      skipping = true; // system line: drop it, and don't attach it to the previous message
    } else if (!skipping && out.length && line.trim()) {
      // continuation of a multi-line message
      out[out.length - 1].text += "\n" + line.trim();
    }
  }
  return out.filter((m) => m.text && !/^<media omitted>$/i.test(m.text));
}
