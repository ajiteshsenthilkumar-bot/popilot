// One shape for a message, whichever chat app it came from.
export type Channel = "whatsapp" | "telegram";

export interface InboundMessage {
  channel: Channel;
  id: string; // unique per message within the channel
  from: string; // sender: phone digits (WhatsApp) or user id (Telegram)
  groupId?: string; // set when the message came from a group chat
  type: string; // "text" | "audio" | anything else (ignored)
  text?: string;
  mediaId?: string; // file id to download a voice note
  mime?: string;
  forwarded: boolean;
  editedAt?: number; // set when the sender EDITED an earlier message (unix seconds); `id` is still the original message's id
}

// prefix for the log row id, so a re-delivered message is recognised and the screen can show where it came from
export const ID_PREFIX: Record<Channel, string> = { whatsapp: "wa_", telegram: "tg_" };
