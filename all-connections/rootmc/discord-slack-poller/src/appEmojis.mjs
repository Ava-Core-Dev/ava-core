/**
 * Ava Ivy Discord application emojis (Developer Portal uploads).
 * Mention form: <:name:id>
 * Reaction API form: name:id (via appEmojiReaction)
 *
 * Ack defaults: seen/recorded → ⏱️ · writing → ✏️
 */
export const AVA_APP_EMOJIS = {
  warn: "1533005801818685603",
  vote_yes: "1533005800908525698",
  vote_no: "1533005790829346937",
  sleepy: "1533005789961257162",
  ship_it: "1533005788501512262",
  pickaxe: "1533005787155402762",
  party_pop: "1533005785901301800",
  on_fire: "1533005784726638774",
  hologram: "1533005783447502938",
  heart: "1533005781346291732",
  grass_block: "1533005779773427792",
  gold_coin: "1533005778397433896",
  diamond_gem: "1533005777269297354",
  creeper_face: "1533005776220586075",
  bug_report: "1533005774710898869",
  ava_wave: "1533005773565591614",
  ava_think: "1533005772668145694",
  ava_peek: "1533005771254534314",
  ava_love: "1533005770248032326",
  ava_hush: "1533005769132474498",
  ava_code: "1533005767811137656",
  ava_blush: "1533005766636605612",
};

/** <:name:id> for message content, or "" if unknown. */
export function appEmoji(name) {
  const id = AVA_APP_EMOJIS[name];
  if (!id) return "";
  return `<:${name}:${id}>`;
}

/** Reaction API param `name:id`, or "" if unknown. */
export function appEmojiReaction(name) {
  const id = AVA_APP_EMOJIS[name];
  if (!id) return "";
  return `${name}:${id}`;
}

export function hasAppEmoji(name) {
  return Boolean(AVA_APP_EMOJIS[name]);
}

/** All app emoji names (for prompts / pickers). */
export function appEmojiNames() {
  return Object.keys(AVA_APP_EMOJIS);
}

/**
 * Pick a light vibe reaction for a finished Discord reply.
 * Returns app emoji name or "" (skip). Keep rare — don't spray.
 */
export function pickVibeReaction({ intent = "", question = "", content = "" } = {}) {
  const q = `${question}\n${content}`.toLowerCase();
  const intentKey = String(intent || "").toLowerCase();
  if (intentKey.includes("bug") || /\bbug\b|\bcrash\b|\berror\b|\bbroken\b/.test(q)) {
    return "bug_report";
  }
  if (intentKey.includes("governance") || intentKey.includes("vote") || /\bprop-?\d+\b|\bvot(e|ing)\b/.test(q)) {
    return "vote_yes";
  }
  if (/\bship\b|\bdeploy\b|\blive\b|\bdone\b|\bfixed\b/.test(q)) {
    return "ship_it";
  }
  if (/\blove\b|\bcrush\b|\bcute\b|\b<3\b|❤|💕/.test(q)) {
    return "ava_love";
  }
  if (/\bhi\b|\bhey\b|\bhello\b|\bgood morning\b|\bwave\b/.test(q)) {
    return "ava_wave";
  }
  if (/\bgold\b|\bwallet\b|\beconomy\b|\btreasury\b/.test(q)) {
    return "gold_coin";
  }
  if (/\bmine\b|\bpickaxe\b|\bore\b|\bmcmmo\b|\bskills?\b/.test(q)) {
    return "pickaxe";
  }
  if (/\bsorry\b|\bhush\b|\bquiet\b|\bstfu\b/.test(q)) {
    return "ava_hush";
  }
  if (intentKey.includes("chat") || intentKey.includes("meme")) {
    return "ava_peek";
  }
  return "";
}
