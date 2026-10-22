// A free first filter, before any AI call: obvious chit-chat is dropped without being read by the model.
// The AI then makes the real "is this about supply status?" decision (the `relevant` field).
const SOCIAL =
  /^(ok(ay)?|k|thanks?( you)?|thx|ty|hi|hii+|hello|hey|namaste|namaskar|good (morning|afternoon|evening|night)|gm|gn|noted|sure|fine|ji|ok ji|ok sir|ok bhaiya|theek hai|thik hai|shukriya|dhanyavad|haan|han|hmm+|lol|👍|🙏)(\s+(sir|bhaiya|bhai|ji|madam))?[\s.!,🙏👍]*$/i;

export function isTrivial(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t) return true;
  if (!/[\p{L}\p{N}]/u.test(t)) return true; // only emoji / punctuation
  if (t.length <= 40 && SOCIAL.test(t)) return true;
  return false;
}
