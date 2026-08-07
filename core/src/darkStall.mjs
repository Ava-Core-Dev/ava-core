/**
 * Dark-stall guard — kill "Root Server / dream dark / disconnected" spam.
 * Llama core is online: never post that lore. React-only or rewrite once.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths } from "./store.mjs";

const COOLDOWN_MS = Number(process.env.AVA_DARK_STALL_MS || 24 * 60 * 60_000) || 24 * 60 * 60_000;

function statePath() {
  return path.join(storePaths().dir, "dark-stall.json");
}

function load() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return { channels: {} };
  }
}

function save(s) {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(s, null, 2), "utf8");
}

/** True when text is the redundant darkside / server-down boilerplate. */
export function isDarkStallText(text = "") {
  const t = String(text || "").toLowerCase();
  if (!t.trim()) return false;
  return (
    /\bboth dark\b/.test(t) ||
    /\bstill dark on the (deep )?dig\b/.test(t) ||
    /\bqueued this for when (my |the )?core\b/.test(t) ||
    /\broot server'?s dark\b/.test(t) ||
    /\bi'?m in a dream state for now\b/.test(t) ||
    /\bdream state for now\b/.test(t) ||
    /\bpending_core\b/.test(t) ||
    /\bleave a note and i'?ll catch it\b/.test(t) ||
    /\bdeep digs and ships wait\b/.test(t) ||
    /\boperators:\s*i dm when i go under\b/.test(t) ||
    /\bping me again after the host wakes\b/.test(t) ||
    /\bwhen my core is back online\b/.test(t) ||
    /\bask again when the root server'?s up\b/.test(t) ||
    /\bcloud-side\s*\/\s*dreaming\b/.test(t) ||
    /\broot server unreachable\b/.test(t) ||
    /\bi'?m (a bit )?offline on the deep-dig\b/.test(t)
  );
}

/** One calm line — used at most once per channel; prefer silence after. */
export function darkStallRescueLine() {
  return "Still here on my local core — ask me anything I can answer without a deep dig.";
}

/** @deprecated — never post this; kept so old imports don't crash. */
export function darkStallShortLine() {
  return darkStallRescueLine();
}

/**
 * If text is dark spam → rescue line (or empty when already said recently).
 * Returns { text, suppressed }.
 */
export function sanitizeDarkStallReply(text, channelId = "") {
  if (!isDarkStallText(text)) {
    return { text: String(text || ""), suppressed: false };
  }
  if (channelId && shouldSuppressDarkStall(channelId)) {
    return { text: "", suppressed: true };
  }
  if (channelId) markDarkStall(channelId);
  return { text: darkStallRescueLine(), suppressed: false };
}

/** True = do not post another dark-stall text. */
export function shouldSuppressDarkStall(channelId) {
  const id = String(channelId || "");
  if (!id) return false;
  const s = load();
  const at = Number(s.channels?.[id] || 0);
  return at > 0 && Date.now() - at < COOLDOWN_MS;
}

export function markDarkStall(channelId) {
  const id = String(channelId || "");
  if (!id) return;
  const s = load();
  s.channels = s.channels || {};
  s.channels[id] = Date.now();
  const cutoff = Date.now() - 24 * 3600_000;
  for (const [k, v] of Object.entries(s.channels)) {
    if (Number(v) < cutoff) delete s.channels[k];
  }
  save(s);
}

/** Wipe dark boilerplate from last-reply cache so near-dupe doesn't re-echo it. */
export function clearDarkLastReplies() {
  const p = path.join(storePaths().dir, "last-reply.json");
  let all = {};
  try {
    all = JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return { cleared: 0 };
  }
  let cleared = 0;
  for (const [k, v] of Object.entries(all)) {
    if (typeof v === "string" && isDarkStallText(v)) {
      delete all[k];
      cleared += 1;
    }
  }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(all, null, 2), "utf8");
  return { cleared };
}
