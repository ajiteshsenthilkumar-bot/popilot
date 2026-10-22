// Voice note -> text, using a Google Gemini model through OpenRouter (same rules as lib/claude.ts:
// google/ models only, served by Google's own infrastructure). Only the transcript is kept, never the audio.
import { callOpenRouter, modelName } from "./claude";

const MAX_BYTES = 10 * 1024 * 1024;

// WhatsApp voice notes are "audio/ogg; codecs=opus". Map the mime type to OpenRouter's format name.
export function audioFormat(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("aac")) return "aac";
  if (m.includes("flac")) return "flac";
  if (m.includes("mp4") || m.includes("m4a")) return "m4a";
  return "ogg";
}

const PROMPT =
  "Transcribe this voice note exactly as spoken. It is a vendor talking to a brand owner in India, in Hindi, English or a mix (Hinglish). " +
  "Write Hindi words in Roman letters (Hinglish), keep names and numbers as spoken. Reply with ONLY the transcript. " +
  "If there is no speech, reply with exactly: NO_SPEECH";

export async function transcribeAudio(bytes: Buffer | Uint8Array, mime: string): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is missing");
  if (bytes.byteLength === 0) throw new Error("the voice note was empty");
  if (bytes.byteLength > MAX_BYTES) throw new Error("the voice note is too large (over 10 MB)");

  const data = await callOpenRouter(apiKey, {
    model: modelName(),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: PROMPT },
          { type: "input_audio", input_audio: { data: Buffer.from(bytes).toString("base64"), format: audioFormat(mime) } },
        ],
      },
    ],
    temperature: 0,
    max_tokens: 2000,
    provider: { only: ["google-vertex", "google-ai-studio"], allow_fallbacks: false },
  });

  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("the AI returned no transcript");
  const t = text.trim();
  return t === "NO_SPEECH" ? "" : t;
}
