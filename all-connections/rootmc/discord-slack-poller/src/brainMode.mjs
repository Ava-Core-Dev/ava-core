/**
 * Operator brain swap — Alex can pin Llama / Cursor / dream for testing.
 * Persisted under data/brain-mode.json. Default: auto (normal routing).
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths } from "./store.mjs";
import { appendAction } from "./fullLog.mjs";

const MODES = new Set(["auto", "llama", "cursor", "dream"]);

function isAlexOperator(authorId = "") {
  const id = String(authorId || "");
  const alexDiscord = ["1497037418979786823"];
  const alexSlack = ["U0BLWBTGYTU"];
  const telegramDefaults = ["6644482344"];
  const telegramOps = String(process.env.AVA_TELEGRAM_OPERATOR_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    alexDiscord.includes(id) ||
    alexSlack.includes(id) ||
    telegramDefaults.includes(id) ||
    telegramOps.includes(id)
  );
}

function modePath() {
  return path.join(storePaths().dir, "brain-mode.json");
}

export function getBrainMode() {
  try {
    const raw = JSON.parse(
      fs.readFileSync(modePath(), "utf8").replace(/^\uFEFF/, ""),
    );
    const mode = String(raw.mode || "auto").toLowerCase();
    return {
      mode: MODES.has(mode) ? mode : "auto",
      setBy: raw.setBy || null,
      setByName: raw.setByName || null,
      at: raw.at || 0,
      surface: raw.surface || null,
    };
  } catch {
    return { mode: "auto", setBy: null, setByName: null, at: 0, surface: null };
  }
}

export function setBrainMode(
  mode,
  { authorId = null, authorName = null, surface = null } = {},
) {
  const m = String(mode || "auto").toLowerCase();
  if (!MODES.has(m)) {
    return { ok: false, reason: "bad_mode", mode: getBrainMode().mode };
  }
  const row = {
    mode: m,
    setBy: authorId ? String(authorId) : null,
    setByName: authorName ? String(authorName) : null,
    surface: surface ? String(surface) : null,
    at: Date.now(),
  };
  fs.mkdirSync(path.dirname(modePath()), { recursive: true });
  fs.writeFileSync(modePath(), JSON.stringify(row, null, 2), "utf8");
  appendAction("brain.mode", row);
  return { ok: true, ...row };
}

function cleanAsk(content) {
  return String(content || "")
    .toLowerCase()
    .replace(/@\w+/g, " ")
    .replace(/<@!?\d+>/g, " ")
    .replace(/^\/ava(@\w+)?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @returns {{ handled: true, reply: string, mode?: string } | { handled: false }}
 */
export function parseBrainSwapCommand(content, authorId = "") {
  if (!isAlexOperator(authorId)) {
    return { handled: false };
  }
  const q = cleanAsk(content);
  if (!q) return { handled: false };

  if (
    /^(which\s+brain|brain\s+status|brain\?|what\s+brain)\b/.test(q) ||
    q === "brain"
  ) {
    const cur = getBrainMode();
    return {
      handled: true,
      mode: cur.mode,
      reply: brainStatusReply(cur),
    };
  }

  let next = null;
  if (
    /^(talk\s+to|use|swap\s+to|switch\s+to|pin)?\s*(llama|local(\s+brain)?)\b/.test(
      q,
    ) ||
    /^(brain|mode)\s+llama\b/.test(q) ||
    /^\/llama\b/.test(q) ||
    q === "llama"
  ) {
    next = "llama";
  } else if (
    /^(talk\s+to|use|swap\s+to|switch\s+to|pin)?\s*(cursor|root\s+server)\b/.test(
      q,
    ) ||
    /^(brain|mode)\s+(cursor|root\s+server)\b/.test(q) ||
    /^\/cursor\b/.test(q) ||
    q === "cursor" ||
    q === "root server"
  ) {
    next = "cursor";
  } else if (
    /^(talk\s+to|use|swap\s+to|switch\s+to|pin)?\s*(dream|grok)\b/.test(q) ||
    /^(brain|mode)\s+(dream|grok)\b/.test(q) ||
    /^\/dream\b/.test(q) ||
    q === "dream"
  ) {
    next = "dream";
  } else if (
    /^(brain|mode)\s+auto\b/.test(q) ||
    /^(auto(\s+brain)?|normal(\s+brain)?|swap\s+off|unpin\s+brain)\b/.test(q) ||
    /^\/auto\b/.test(q)
  ) {
    next = "auto";
  }

  if (!next) return { handled: false };

  return {
    handled: true,
    mode: next,
    pendingSet: next,
    reply: null, // caller sets after setBrainMode
  };
}

export function brainSwapAck(mode) {
  const labels = {
    auto: "auto (normal routing)",
    llama: "Llama (local Ollama) — pinned for testing",
    cursor: "Cursor / Root Server — pinned for testing",
    dream: "dream state — pinned for testing",
  };
  const how = {
    auto: "I'll pick Llama → Root Server → dream like usual for this surface.",
    llama: "I'll stay on Llama only (no Cursor escalate) until you say auto or swap.",
    cursor: "I'll skip Llama and dig on Root Server until you say auto or swap.",
    dream: "I'll use dream state until you say auto or swap.",
  };
  return [
    `Brain swap · ${labels[mode] || mode}`,
    "",
    how[mode] || "",
    "",
    "Commands: talk to llama · talk to cursor · talk to dream · brain auto · which brain",
  ].join("\n");
}

function brainStatusReply(cur) {
  const age =
    cur.at && Date.now() - cur.at < 86400_000
      ? `set ${Math.round((Date.now() - cur.at) / 60000)}m ago`
      : cur.at
        ? `set ${new Date(cur.at).toISOString()}`
        : "default";
  return [
    `Brain mode: **${cur.mode}** (${age})`,
    cur.setByName ? `by ${cur.setByName}` : "",
    "",
    "Swap anytime: talk to llama · talk to cursor · talk to dream · brain auto",
  ]
    .filter(Boolean)
    .join("\n");
}
