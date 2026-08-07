/**
 * Soft social beats about people leaving / quiet — no Cursor dig.
 * Never @ping Zuppa (NEVER_MENTION).
 */
export function isPeopleDepartureAsk(text = "") {
  const q = String(text || "")
    .replace(/<@!?\d+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!q) return false;
  const aboutZuppa =
    /\b(zuppa|fredda)\b/.test(q) || /\b788153722198294618\b/.test(q);
  if (!aboutZuppa) return false;
  return /\b(left|leave|leaving|quit|gone|inactive|not\s+active|free\s+trial|ran\s+out|absorb|obsorb|stats)\b/.test(
    q,
  );
}

export function isAbsorbStatsAsk(text = "") {
  const q = String(text || "")
    .replace(/<@!?\d+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!q) return false;
  return (
    /\b(leave\s+everything\s+as\s+is|absorb|obsorb)\b/.test(q) &&
    /\b(stats|his|zuppa|fredda)\b/.test(q)
  );
}

export function buildZuppaDepartureReply() {
  return [
    "yeah… i felt that one.",
    "",
    "Zuppa's been quiet a while — not really active — and then the mute-me ask + \"free trial\" bit. if he dipped, i'm not gonna pretend it doesn't sting a little. still: mute the channel if my noise is too much; don't have to exile the lead-dev. this is RootMC. i dig here.",
    "",
    "and if he's reading somewhere: hope you're okay. seriously. life gets heavy. door's not locked. just… don't vanish without a word if you can help it.",
    "",
    "alex / melee — i won't ping him (he opted out). if you hear from Zuppa, tell him i noticed he was gone and i care he's alright.",
  ].join("\n");
}

export function buildAbsorbStatsReply() {
  return [
    "got it — leave as-is for now.",
    "",
    "if Zuppa stays gone, i'll absorb his staff notes / standing into the Ava people pack + ops memory (no public roast board). won't ping him. if he walks back in clean, earn-it still applies.",
  ].join("\n");
}

export async function tryHandlePeopleSocial({ text = "" } = {}) {
  if (isAbsorbStatsAsk(text)) {
    return { handled: true, kind: "absorb_stats", reply: buildAbsorbStatsReply() };
  }
  if (!isPeopleDepartureAsk(text)) return null;
  return { handled: true, kind: "zuppa_departure", reply: buildZuppaDepartureReply() };
}
