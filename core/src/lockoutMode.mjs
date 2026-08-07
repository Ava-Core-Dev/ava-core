/**
 * Lockout mode — Ava cut off from Discord/Slack/public channel surfaces.
 * Only Alex on **verified DMs** (Telegram / Discord DM / Slack DM) may talk.
 *
 * Terminology (Alex locked):
 * - **Ava core** = self-hosted Llama + all her data (continuous self).
 * - **Mode 1** = public llama-only (channels still open; brain = Ava core).
 * - **Lockout** = 1:1 companion session with Alex on his verified DMs.
 *
 * Lockout never mutes HTTP status/solar or the Cloudflare tunnel — those stay broadcasting.
 * Server process owns telemetry/APIs; Ava-core focuses on humanization / guide / companion.
 * In lockout he may still /mode 2–4 to attempt Cursor/Grok; vendor names OK privately.
 * Mood is remembered: power-down in lockout → boot back in lockout (no chat boot automation).
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths, pushStatusEvent, setHushed } from "./store.mjs";
import { rememberMood } from "./moodState.mjs";

const ALEX_TELEGRAM_IDS = () => {
  const extras = String(process.env.AVA_TELEGRAM_OPERATOR_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(["6644482344", ...extras])];
};

const ALEX_DISCORD_IDS = () => {
  const extras = String(process.env.AVA_ALEX_DISCORD_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(["1497037418979786823", ...extras])];
};

const ALEX_SLACK_IDS = () => {
  // Lockout peer = Alex only (not Storey / other quiet-ops).
  const extras = String(process.env.AVA_ALEX_SLACK_IDS || "U0BLWBTGYTU")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set(["U0BLWBTGYTU", ...extras])];
};

function lockoutPath() {
  return path.join(storePaths().dir, "lockout.json");
}

function readLockout() {
  try {
    if (!fs.existsSync(lockoutPath())) return null;
    return JSON.parse(fs.readFileSync(lockoutPath(), "utf8").replace(/^\uFEFF/, ""));
  } catch {
    return null;
  }
}

function writeLockout(payload) {
  fs.mkdirSync(path.dirname(lockoutPath()), { recursive: true });
  fs.writeFileSync(lockoutPath(), JSON.stringify(payload, null, 2), "utf8");
}

export function isLockoutActive() {
  const env = String(process.env.AVA_LOCKOUT || "").trim();
  if (env === "1" || /^true$/i.test(env)) return true;
  if (env === "0" || /^false$/i.test(env)) return false;
  return Boolean(readLockout()?.on);
}

export function loadLockoutState() {
  return readLockout();
}

export function setLockout({
  on = true,
  reason = "operator lockout",
  by = "operator",
} = {}) {
  const payload = {
    on: Boolean(on),
    reason: String(reason).slice(0, 300),
    by: String(by).slice(0, 80),
    updatedAt: Date.now(),
  };
  writeLockout(payload);
  if (payload.on) {
    setHushed(true, "lockout companion — channels silent; Alex verified DMs only");
    rememberMood({
      mood: "lockout",
      lockout: true,
      hush: true,
      asleep: false,
      poweredOff: false,
      reason: payload.reason,
      by: payload.by,
    });
  } else {
    rememberMood({
      mood: "live",
      lockout: false,
      hush: false,
      asleep: false,
      poweredOff: false,
      reason: payload.reason,
      by: payload.by,
    });
  }
  pushStatusEvent(
    on
      ? `lockout ON · Alex verified DMs only · ${payload.reason}`
      : `lockout OFF · ${payload.reason}`,
  );
  return payload;
}

export function clearLockout(reason = "cleared", by = "operator") {
  const out = setLockout({ on: false, reason, by });
  try {
    setHushed(false, "lockout cleared");
  } catch {
    /* ignore */
  }
  return out;
}

/** @deprecated use isAlexVerifiedDm — kept for older call sites */
export function isAlexTelegramSurface(opts = {}) {
  return isAlexVerifiedDm({ ...opts, surface: opts.surface || "telegram" });
}

/**
 * True if this inbound is Alex on a verified private DM
 * (Telegram private · Discord DM · Slack IM).
 */
export function isAlexVerifiedDm({
  surface = "",
  authorId = "",
  channelId = "",
  isDm = false,
} = {}) {
  const surf = String(surface || "").toLowerCase();
  const id = String(authorId || "")
    .replace(/^tg:/, "")
    .replace(/^discord:/, "")
    .replace(/^slack:/, "");
  const ch = String(channelId || "");

  if (surf === "telegram" || ch.startsWith("tg:")) {
    if (!ALEX_TELEGRAM_IDS().includes(id)) return false;
    if (ch.startsWith("tg:-") || /^-100/.test(ch)) return false; // groups
    if (ch === `tg:${id}` || ch === id || /^tg:\d+$/.test(ch)) return true;
    return Boolean(isDm) || !ch;
  }

  if (surf === "discord-dm" || (surf === "discord" && isDm) || (isDm && !surf)) {
    return ALEX_DISCORD_IDS().includes(id);
  }

  if (surf === "slack" || surf === "slack-dm") {
    if (!ALEX_SLACK_IDS().includes(id)) return false;
    // Slack IMs are D… ; channels are C…
    if (isDm || ch.startsWith("D") || surf === "slack-dm") return true;
    return false;
  }

  // Author-only fallback when surface missing but id is Alex telegram
  if (!surf && ALEX_TELEGRAM_IDS().includes(id) && (isDm || !ch || ch.startsWith("tg:"))) {
    if (ch.startsWith("tg:-")) return false;
    return true;
  }

  return false;
}

/**
 * May Ava send a text reply for this ask while lockout is on?
 * Only Alex verified DMs. Everyone/everything else: silent.
 */
export function canSpeakDuringLockout(opts = {}) {
  if (!isLockoutActive()) return true;
  return isAlexVerifiedDm(opts);
}

/**
 * Private companion / core-dev session with Alex (lockout + verified DM).
 */
export function isLockoutDevSession(opts = {}) {
  return isLockoutActive() && isAlexVerifiedDm(opts);
}

/** Public surfaces must scrub vendor names; lockout Alex DMs may keep them. */
export function allowVendorNames(opts = {}) {
  if (opts.allowVendorNames === true) return true;
  if (opts.allowVendorNames === false) return false;
  return isLockoutDevSession(opts);
}

export function isLockoutCommand(text = "") {
  const q = String(text || "")
    .toLowerCase()
    .replace(/<@!?\d+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!q) return false;
  return (
    /^(ava[,:]?\s+)?(lockout|enter\s+lockout|go\s+into\s+lockout|channel\s+lockout)(\s+on)?[.!?]*$/.test(q) ||
    /^(ava[,:]?\s+)?(lockout\s+off|exit\s+lockout|clear\s+lockout|end\s+lockout)[.!?]*$/.test(q) ||
    /^\/lockout(\s+\S+)?$/i.test(String(text || "").trim()) ||
    // NL: "turn Ava back on public", "go public", "end private mode"
    /\b(turn\s+(ava\s+)?(back\s+)?on\s+public|back\s+on\s+public|go\s+public|make\s+(ava\s+)?public|end\s+(the\s+)?(private|lockout)|public\s+(mode|channels?)\s*(on|again)?)\b/.test(
      q,
    ) ||
    /\b(lockout\s+off|channels?\s+can\s+hear)\b/.test(q)
  );
}

/**
 * @returns {{ handled: boolean, reply?: string, activated?: boolean, cleared?: boolean } | null}
 */
export function tryHandleLockoutCommand({
  text = "",
  authorId = "",
  surface = "",
  channelId = "",
  isDm = false,
  isAlex = false,
} = {}) {
  if (!isLockoutCommand(text)) return null;
  if (!isAlex) {
    return { handled: true, reply: "Lockout is Alex-only." };
  }
  const q = String(text || "").toLowerCase();
  const clearing =
    /lockout\s+off|exit\s+lockout|clear\s+lockout|end\s+lockout|\/lockout\s+off/.test(q) ||
    /\b(turn\s+(ava\s+)?(back\s+)?on\s+public|back\s+on\s+public|go\s+public|make\s+(ava\s+)?public|end\s+(the\s+)?(private|lockout)|public\s+(mode|channels?)\s*(on|again)?|channels?\s+can\s+hear)\b/.test(
      q,
    );
  if (clearing) {
    clearLockout("operator clear", authorId || "alex");
    return {
      handled: true,
      cleared: true,
      reply: "Lockout **off** — channels can hear me again when I'm live.",
    };
  }
  setLockout({
    on: true,
    reason: "operator lockout — Alex verified DMs only (Ava-core companion)",
    by: authorId || "alex",
  });
  return {
    handled: true,
    activated: true,
    reply:
      "Lockout **on** — just us. Ava-core companion on your verified DMs (Telegram / Discord / Slack).\n" +
      "Public channels stay silent. No boot catch-ups or side pings.\n" +
      "Server keeps status/solar/APIs up. I stay here as guide + companion.\n" +
      "`/mode 1` = public llama-only (different). Here you can still try `2` Cursor · `3` Grok · `4` combined.\n" +
      "Say `lockout off` when channels can hear me again.",
  };
}

export function lockoutStatusLine() {
  if (!isLockoutActive()) return "Lockout: **off**.";
  const s = readLockout() || {};
  return (
    `Lockout: **on** — Ava-core companion · your verified DMs only (TG / Discord / Slack).\n` +
    `Mood remembered across power-down. No automated channel startup.\n` +
    `_${String(s.reason || "").slice(0, 120)}_`
  );
}
