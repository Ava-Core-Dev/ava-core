/**
 * Rate-limit "local core / rephrase" honesty lines — one per channel per hour max.
 * After that: empty (caller should react-only or stay quiet).
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths } from "./store.mjs";

const COOLDOWN_MS =
  Number(process.env.AVA_LOCAL_CORE_FAIL_MS || 60 * 60_000) || 60 * 60_000;

const FAIL_RE =
  /\b(i'?m here on (my |ava )?local core|still here on my local core|rephrase that and i'?ll keep trying|digs? are thin|ask me anything i can answer without a deep dig)\b/i;

function statePath() {
  return path.join(storePaths().dir, "local-core-fail.json");
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

export function isLocalCoreFailText(text = "") {
  const t = String(text || "").trim();
  if (!t) return false;
  return FAIL_RE.test(t) || /\brephrase\b/i.test(t) && /\blocal core\b/i.test(t);
}

/** Calm one-liner — use only when rate limit allows. */
export function localCoreFailLine({ lockoutPrivate = false } = {}) {
  if (lockoutPrivate) {
    return "Brain hiccup — still here with you. Ask short and I'll answer from live state.";
  }
  return "Still here — try a shorter ask and I'll answer from what I've got.";
}

export function shouldSuppressLocalCoreFail(channelId = "") {
  const id = String(channelId || "");
  if (!id) return false;
  const s = load();
  const at = Number(s.channels?.[id] || 0);
  return at > 0 && Date.now() - at < COOLDOWN_MS;
}

export function markLocalCoreFail(channelId = "") {
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

/**
 * @returns {{ text: string, suppressed: boolean }}
 */
export function sanitizeLocalCoreFailReply(text, channelId = "", opts = {}) {
  if (!isLocalCoreFailText(text)) {
    return { text: String(text || ""), suppressed: false };
  }
  if (channelId && shouldSuppressLocalCoreFail(channelId)) {
    return { text: "", suppressed: true };
  }
  if (channelId) markLocalCoreFail(channelId);
  return {
    text: localCoreFailLine({ lockoutPrivate: Boolean(opts.lockoutPrivate) }),
    suppressed: false,
  };
}
