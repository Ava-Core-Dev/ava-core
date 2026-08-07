/**
 * Discord DM / Telegram private brain-mode override for operators.
 * /mode 1 = Ava core public llama-only · 2 cursor · 3 grok · 4 combined · 5 normal
 * Modes 1–4 idle-expire to normal after AVA_MODE_IDLE_MS (default 5 min).
 * Lockout = separate surface gate (TG-Alex only); also Ava-core private time.
 * In lockout, modes 2–4 may still attempt even if digs are thin.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths } from "./store.mjs";
import { shouldUseLlamaCore } from "./digHealth.mjs";
import { isLockoutActive } from "./lockoutMode.mjs";
import { gatherFreeCloudBrief } from "./freeCloudBrain.mjs";

function freeCloudStatusSuffix() {
  try {
    const { configured } = gatherFreeCloudBrief();
    if (configured.length) {
      return `\nFree cloud fallbacks: **${configured.join(", ")}** (after Llama / if dream fails).`;
    }
    return "\nFree cloud fallbacks: wired, awaiting keys (GROQ / GEMINI / OPENROUTER / …).";
  } catch {
    return "";
  }
}

export const MODE_IDLE_MS = Number(
  process.env.AVA_MODE_IDLE_MS || 5 * 60_000,
);

/** Longer idle while locked in with Alex — uninterrupted Ava-core private session. */
export function effectiveModeIdleMs() {
  if (isLockoutActive()) {
    const n = Number(process.env.AVA_LOCKOUT_MODE_IDLE_MS || 2 * 60 * 60_000);
    if (Number.isFinite(n) && n >= 5 * 60_000) return n;
    return 2 * 60 * 60_000;
  }
  return MODE_IDLE_MS;
}

/** @typedef {"llama"|"cursor"|"grok"|"combined"|"normal"} BrainMode */

const MODE_BY_NUM = {
  1: "llama",
  2: "cursor",
  3: "grok",
  4: "combined",
  5: "normal",
};

const MODE_LABELS = {
  llama: "mode 1 · Ava core (public llama-only)",
  cursor: "mode 2 · Cursor (Root Server digs)",
  grok: "mode 3 · Grok (dream)",
  combined: "mode 4 · combined (llama → cursor → dream)",
  normal: "mode 5 · normal (stock Discord dream)",
};

const ALIASES = {
  llama: "llama",
  local: "llama",
  ollama: "llama",
  core: "llama",
  "ava-core": "llama",
  avacore: "llama",
  cursor: "cursor",
  dig: "cursor",
  root: "cursor",
  grok: "grok",
  dream: "grok",
  xai: "grok",
  combined: "combined",
  mix: "combined",
  ladder: "combined",
  normal: "normal",
  default: "normal",
  stock: "normal",
  off: "normal",
};

function statePath() {
  return path.join(storePaths().dir, "brain-mode-sessions.json");
}

function loadState() {
  try {
    if (!fs.existsSync(statePath())) return { sessions: {} };
    const raw = JSON.parse(fs.readFileSync(statePath(), "utf8"));
    return { sessions: raw?.sessions && typeof raw.sessions === "object" ? raw.sessions : {} };
  } catch {
    return { sessions: {} };
  }
}

function saveState(s) {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(s, null, 2), "utf8");
}

/**
 * @param {string} text
 * @returns {{ kind: "status"|"set"|"help", mode?: BrainMode } | null}
 */
export function parseModeCommand(text = "") {
  const t = String(text || "")
    .trim()
    .replace(/^(\/[a-z0-9_]+)@[A-Za-z0-9_]+/i, "$1");
  if (!t) return null;
  const m = t.match(/^\/mode(?:\s+(.+))?\s*$/i);
  if (m) {
    const arg = m[1] ? String(m[1]).trim().toLowerCase().replace(/\s+/g, " ") : "";
    if (!arg) return { kind: "status" };
    if (arg === "help" || arg === "?" || arg === "list") return { kind: "help" };
    if (/^[1-5]$/.test(arg)) {
      return { kind: "set", mode: /** @type {BrainMode} */ (MODE_BY_NUM[Number(arg)]) };
    }
    if (/^ava[\s_-]*core$/.test(arg) || arg === "core") {
      return { kind: "set", mode: "llama" };
    }
    const aliased = ALIASES[arg.replace(/\s+/g, "")] || ALIASES[arg];
    if (aliased) return { kind: "set", mode: /** @type {BrainMode} */ (aliased) };
    return { kind: "help" };
  }
  // Natural language (operator DMs): "go into normal mode", "switch to mode 3", etc.
  const nl = t.toLowerCase().replace(/\s+/g, " ").trim();
  if (
    /\b(go\s+(into\s+)?|switch\s+to\s+|set\s+|use\s+|enter\s+)?normal\s+mode\b/.test(nl) ||
    /\bmode\s+(5|normal|default|stock)\b/.test(nl) ||
    /^(ava[,:]?\s+)?(normal\s+mode|mode\s+5)\s*(plz|please|now)?[.!?]*$/.test(nl)
  ) {
    return { kind: "set", mode: "normal" };
  }
  if (
    /\b(go\s+(into\s+)?|switch\s+to\s+|set\s+|use\s+)?(ava[\s_-]*core|llama(\s+only)?|mode\s+1)\b/.test(
      nl,
    ) &&
    /\b(mode|llama|core)\b/.test(nl)
  ) {
    return { kind: "set", mode: "llama" };
  }
  const num = nl.match(/\b(?:switch\s+to\s+|go\s+(?:into\s+)?|set\s+|use\s+)?mode\s+([1-5])\b/);
  if (num) {
    return { kind: "set", mode: /** @type {BrainMode} */ (MODE_BY_NUM[Number(num[1])]) };
  }
  if (/\b(brain\s+)?mode\s+(status|help|\?)\b/.test(nl) || /^what\s+mode\b/.test(nl)) {
    return /\bhelp\b|\?/.test(nl) ? { kind: "help" } : { kind: "status" };
  }
  return null;
}

export function isModeCommand(text = "") {
  return parseModeCommand(text) != null;
}

/**
 * @param {string} userId
 * @returns {BrainMode}
 */
export function getActiveBrainMode(userId) {
  const id = String(userId || "");
  if (!id) return "normal";
  const s = loadState();
  const row = s.sessions[id];
  if (!row?.mode || row.mode === "normal") return "normal";
  const last = Number(row.lastInputAt || row.setAt || 0);
  if (!last || Date.now() - last > effectiveModeIdleMs()) {
    delete s.sessions[id];
    saveState(s);
    return "normal";
  }
  return /** @type {BrainMode} */ (row.mode);
}

/**
 * @param {string} userId
 * @param {BrainMode} mode
 */
export function setBrainMode(userId, mode) {
  const id = String(userId || "");
  if (!id) return getModeStatus(id);
  const s = loadState();
  const now = Date.now();
  if (mode === "normal") {
    delete s.sessions[id];
  } else {
    s.sessions[id] = {
      mode,
      setAt: now,
      lastInputAt: now,
    };
  }
  saveState(s);
  return getModeStatus(id);
}

/** Refresh idle timer on any DM input while override active. */
export function touchBrainMode(userId) {
  const id = String(userId || "");
  if (!id) return;
  const s = loadState();
  const row = s.sessions[id];
  if (!row?.mode || row.mode === "normal") return;
  const last = Number(row.lastInputAt || row.setAt || 0);
  if (!last || Date.now() - last > effectiveModeIdleMs()) {
    delete s.sessions[id];
    saveState(s);
    return;
  }
  row.lastInputAt = Date.now();
  s.sessions[id] = row;
  saveState(s);
}

export function modeLabel(mode) {
  return MODE_LABELS[mode] || MODE_LABELS.normal;
}

export function getModeStatus(userId) {
  const id = String(userId || "");
  const mode = getActiveBrainMode(id);
  const s = loadState();
  const row = s.sessions[id];
  let idleSec = null;
  if (mode !== "normal" && row) {
    const last = Number(row.lastInputAt || row.setAt || 0);
    const left = Math.max(0, effectiveModeIdleMs() - (Date.now() - last));
    idleSec = Math.ceil(left / 1000);
  }
  return { mode, idleSec, label: modeLabel(mode) };
}

export function formatModeStatusLine(status) {
  const st = status || { mode: "normal", label: modeLabel("normal"), idleSec: null };
  const idleMin = Math.round(effectiveModeIdleMs() / 60000);
  const freeSuffix = freeCloudStatusSuffix();
  if (isLockoutActive()) {
    if (st.mode === "normal") {
      return (
        `**Lockout** (Ava-core private · TG only with you).\n` +
        `Brain: **normal** right now.\n` +
        `Live chat: **free cloud (Groq…)** when keyed · Llama = compress + shadow training.\n` +
        `\`/mode 1\` = Ava core public llama-only · \`2\` Cursor · \`3\` Grok · \`4\` combined · \`5\` normal\n` +
        `I can name Cursor/Grok here. Digs-thin still lets 2–4 *attempt*. Idle ~${idleMin}m.` +
        freeSuffix
      );
    }
    const mins = st.idleSec != null ? Math.ceil(st.idleSec / 60) : "?";
    return (
      `**Lockout** · brain **${st.mode}** — ${st.label}\n` +
      `Ava-core private · Cursor/Grok naming OK · idle ~${mins} min.\n` +
      `\`/mode 5\` clears mode override (lockout stays until \`lockout off\`).` +
      freeSuffix
    );
  }
  if (shouldUseLlamaCore() || st.mode === "llama") {
    return (
      `Brain: **mode 1 · Ava core** (public llama-only — self-hosted Llama + your data).\n` +
      `Channels stay open; digs parked unless you **lockout** and try \`/mode 2–4\` privately.\n` +
      `\`/mode 1\` / \`/mode core\` = home.` +
      freeSuffix
    );
  }
  if (st.mode === "normal") {
    return (
      `Brain mode: **normal** (stock Discord dream).\n` +
      `\`/mode 1\` Ava core (public llama-only) · \`2\` Cursor · \`3\` Grok · \`4\` combined · \`5\` normal\n` +
      `Idle override auto-clears after ${idleMin} min quiet. \`lockout\` = TG-only with Alex.` +
      freeSuffix
    );
  }
  const mins = st.idleSec != null ? Math.ceil(st.idleSec / 60) : "?";
  return (
    `Brain mode: **${st.mode}** — ${st.label}\nIdle reset in ~${mins} min (no DM input). \`/mode 5\` for normal now.` +
    freeSuffix
  );
}

export function formatModeHelpLine() {
  const lock = isLockoutActive();
  return [
    lock
      ? "**Modes** (you're in lockout — TG Ava-core private with Alex):"
      : "**Modes** (operator DMs / Telegram private):",
    "`/mode 1` / `/mode core` — **Ava core** · public llama-only (self-hosted Llama + all data)",
    "`/mode 2` — Cursor (Root Server digs)",
    "`/mode 3` — Grok (dream)",
    "`/mode 4` — combined (llama → cursor → dream)",
    "`/mode 5` — normal (stock Discord dream)",
    "**Lockout** (`lockout` / `go into lockout`) — TG-Alex only; not the same as mode 1.",
    lock
      ? `Vendor names OK here. Idle ~${Math.round(effectiveModeIdleMs() / 60000)} min.`
      : `Overrides idle-clear after ${Math.round(effectiveModeIdleMs() / 60000)} min. Public chat still scrubs vendor names.`,
  ].join("\n");
}

/**
 * Handle /mode in a Discord DM or Telegram private chat.
 * @param {{ text?: string, authorId?: string, isDm?: boolean, isOperator?: boolean }} opts
 */
export function tryHandleModeCommand({
  text = "",
  authorId = "",
  isDm = false,
  isOperator = false,
} = {}) {
  const parsed = parseModeCommand(text);
  if (!parsed) return null;
  if (!isDm) {
    return {
      handled: true,
      reply: "Brain `/mode` is DM/Telegram-private only — hop into our private chat.",
    };
  }
  if (!isOperator) {
    return {
      handled: true,
      reply: "Brain `/mode` is operator-only.",
    };
  }
  if (parsed.kind === "help") {
    return { handled: true, reply: formatModeHelpLine() };
  }
  if (parsed.kind === "status") {
    return { handled: true, reply: formatModeStatusLine(getModeStatus(authorId)) };
  }
  const status = setBrainMode(authorId, parsed.mode);
  return { handled: true, reply: formatModeStatusLine(status) };
}
