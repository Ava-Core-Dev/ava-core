import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Workspace root: Web Files/rootmc-ava/src → RootMC */
export const WORKSPACE_ROOT = path.resolve(__dirname, "../../..");

/**
 * Canonical Ava home: OptiPlex SSD `/home/ava-core/ava`.
 * E:\.Ava_Ivy / /mnt/e/.Ava_Ivy are optional mirrors only.
 * `Server Handoffs/Ava Ivy` links to the SSD home.
 * Override anytime with AVA_HANDOFF.
 */
function resolveDefaultAvaHandoff() {
  // OptiPlex SSD is canonical when E is unplugged. Never silently invent an empty tree.
  const candidates = [
    "/home/ava-core/ava",
    "E:\\.Ava_Ivy",
    "/mnt/e/.Ava_Ivy",
    path.join(WORKSPACE_ROOT, "Server Handoffs", "Ava Ivy"),
  ];
  for (const p of candidates) {
    try {
      if (!p || !fs.existsSync(p)) continue;
      const logs = path.join(p, "data", "logs");
      // Prefer homes that already have the flight-recorder tree
      if (fs.existsSync(logs) || p === "/home/ava-core/ava") return p;
      return p;
    } catch {
      /* ignore */
    }
  }
  return "/home/ava-core/ava";
}

/** Default Ava handoff — prefers OptiPlex SSD. Override with AVA_HANDOFF. */
export const DEFAULT_AVA_HANDOFF = resolveDefaultAvaHandoff();

/**
 * Minimal `.env` parser for the public standalone core (no realm-api sibling).
 * Only supports `KEY=value` lines and `#` comments — enough to boot without
 * secrets. The private realm-api loader is preferred whenever it is present.
 */
function parseDotEnvFile(filePath) {
  const env = {};
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return env;
  }
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) env[key] = val;
  }
  return env;
}

/**
 * Load environment for the core runtime.
 *
 * Prefers the private RootMC realm-api loader when the sibling tree is present
 * (OptiPlex / private mirror). In this public `ava-core` subset that sibling
 * does not exist, so we fall back to reading a plain `.env` file (if any) and
 * otherwise rely on the process environment. This lets the public HTTP core
 * host without Discord / secrets, matching the documented behavior.
 */
export async function loadEnv() {
  const loaderPath = path.resolve(
    __dirname,
    "../../rootmc-realm-api/scripts/lib/rootmc-env.mjs",
  );
  let env;
  if (fs.existsSync(loaderPath)) {
    const m = await import(pathToFileURL(loaderPath).href);
    env = m.loadRootMcEnv();
  } else {
    // Public / standalone core — no private realm-api sibling.
    const candidates = [
      process.env.ROOTMC_ENV_FILE,
      path.join(WORKSPACE_ROOT, ".env"),
      path.resolve(__dirname, "..", ".env"),
    ].filter(Boolean);
    env = {};
    for (const candidate of candidates) {
      if (candidate && fs.existsSync(candidate)) {
        env = parseDotEnvFile(candidate);
        break;
      }
    }
  }
  // Mirror into process.env so modules (EcoFlow, etc.) can read without a pass-through.
  for (const [k, v] of Object.entries(env || {})) {
    if (v == null || v === "") continue;
    if (process.env[k] == null || process.env[k] === "") {
      process.env[k] = String(v);
    }
  }
  return env;
}

function firstEnv(env, keys) {
  for (const key of keys) {
    const v = String(process.env[key] || env[key] || "").trim();
    if (v) return v;
  }
  return "";
}

export function botToken(env) {
  // Prefer Ava_* ; legacy SEXI_* still accepted.
  return firstEnv(env, [
    "AVA_DISCORD_BOT_TOKEN",
    "SEXI_DISCORD_BOT_TOKEN",
    "DISCORD_ROOTMC_BOT_TOKEN",
    "DISCORD_BOT_TOKEN",
  ]).replace(/^bot\s+/i, "");
}

/** Discord application / bot user id for Ava (mentions + self-skip). */
export function avaBotAppId(env = {}) {
  return (
    firstEnv(env, [
      "AVA_DISCORD_APPLICATION_ID",
      "AVA_DISCORD_CLIENT_ID",
      "SEXI_DISCORD_APPLICATION_ID",
      "SEXI_DISCORD_CLIENT_ID",
    ]) || AVA_BOT_APP_ID
  );
}

/** @deprecated use avaBotAppId */
export const sexiBotAppId = avaBotAppId;

/**
 * Dream-state (cloud) API key — xAI under the hood; never named in public voice.
 * Prefers AVA_* then SEXI_* then shared RootMC keys.
 */
export function dreamApiKey(env = {}) {
  return firstEnv(env, [
    "AVA_XAI_API_KEY",
    "AVA_GROK_API_KEY",
    "SEXI_XAI_API_KEY",
    "XAI_API_KEY",
    "GROK_API_BEARER_TOKEN",
  ]);
}

/** @deprecated use dreamApiKey — kept for legacy imports */
export function grokToken(env = {}) {
  return dreamApiKey(env);
}

/** Cursor user / service-account API key (Dashboard → Integrations). */
export function cursorApiKey(env) {
  return firstEnv(env, ["CURSOR_API_KEY", "CURSOR_SDK_API_KEY"]);
}

/** Force dream brain even when Cursor key exists (ops testing). */
export function forceDreamBrain(env = {}) {
  const v = firstEnv(env, ["AVA_FORCE_DREAM", "SEXI_FORCE_DREAM"]);
  return v === "1" || /^true$/i.test(v);
}

export const AVA_MODEL = String(
  process.env.AVA_MODEL || process.env.SEXI_MODEL || "composer-2.5",
).trim();
/** @deprecated */
export const SEXI_MODEL = AVA_MODEL;

export const AVA_GROK_MODEL = String(
  process.env.AVA_GROK_MODEL || process.env.SEXI_GROK_MODEL || "grok-3-mini",
).trim();
/** @deprecated */
export const SEXI_GROK_MODEL = AVA_GROK_MODEL;

/** Default: Slack/on-device = Cursor; Discord = dream state (see recommend.mjs). */
export const AVA_BRAIN_DEFAULT = "cursor";
/** @deprecated */
export const SEXI_BRAIN_DEFAULT = AVA_BRAIN_DEFAULT;

/**
 * Local organizer (Goal B3) — Ollama on OptiPlex SSD.
 * AVA_LOCAL_BRAIN=1|true|auto|0  (default auto = use when Ollama is up)
 * AVA_OLLAMA_URL=http://127.0.0.1:11434
 * AVA_OLLAMA_MODEL=ava-ivy (persona baseline) or qwen2.5-coder:7b (organizer)
 */
export const AVA_OLLAMA_URL = String(
  process.env.AVA_OLLAMA_URL || "http://127.0.0.1:11434",
).trim();
export const AVA_OLLAMA_MODEL = String(
  process.env.AVA_OLLAMA_MODEL ||
    process.env.OLLAMA_MODEL ||
    "ava-ivy",
).trim();

/** Override workspace cwd for the local Cursor agent (defaults to RootMC root). */
export const AVA_WORKSPACE = String(
  process.env.AVA_WORKSPACE || process.env.SEXI_WORKSPACE || "",
).trim();
/** @deprecated */
export const SEXI_WORKSPACE = AVA_WORKSPACE;

/** Ava Ivy handoff folder — lead-dev notes + future agent assets. */
export const AVA_HANDOFF = String(
  process.env.AVA_HANDOFF || process.env.SEXI_HANDOFF || DEFAULT_AVA_HANDOFF,
).trim();

/** True when running headless / over SSH (no GUI status window). */
export function isHeadlessHost() {
  if (String(process.env.AVA_NO_STATUS_WINDOW || "").trim() === "1") return true;
  if (String(process.env.AVA_HEADLESS || "").trim() === "1") return true;
  if (process.platform !== "win32") return true;
  if (process.env.SSH_CONNECTION || process.env.SSH_TTY) return true;
  if (!process.stdout.isTTY) return true;
  return false;
}

/** Discord user IDs Ava must never @mention. */
export const NEVER_MENTION = new Set([
  "788153722198294618", // ZuppaFredda — opted out of pings (lead-dev notes / build plan)
]);

export const DISCORD_API = "https://discord.com/api/v10";
export const ROOTMC_GUILD_ID = "1516108585740800042";
/** Legacy RootMC bot — not used for Ava replies when AVA_DISCORD_* is set. */
export const ROOTMC_BOT_APP_ID = "1511794429986345020";
/** Dedicated Ava Discord application / bot user id. */
export const AVA_BOT_APP_ID = "1532751879875072070";
/** @deprecated */
export const SEXI_BOT_APP_ID = AVA_BOT_APP_ID;

/** Default watch list — proposals, admins, general, governance, voting, constitution, memes, updates. */
export const DEFAULT_WATCH_CHANNELS = [
  "1526664180491358419", // proposals
  "1516121832493678612", // admins
  "1516108586307158088", // #general
  "1522406451413385317", // governance
  "1522413185364398090", // voting
  "1522406019152478210", // constitution
  "1516389376198840421", // #memes-and-media
  "1532929974154166522", // #development (staff pointer → Slack)
  "1520665313631408251", // #updates — ops status + staff pings (she posts here; must listen too)
  "1534974849489965197", // #ava-progress — Melee daily progress ask
];

/** Named channel fallbacks (aligned with rootmc-discord-channels). */
export const AVA_CHANNELS = {
  general: "1516108586307158088",
  admins: "1516121832493678612",
  proposals: "1526664180491358419",
  governance: "1522406451413385317",
  voting: "1522413185364398090",
  constitution: "1522406019152478210",
  development: "1532929974154166522",
  memesMedia: "1516389376198840421",
  /** Centralized Ava GIF/media vault */
  avaMedia: "1533268458668687392",
  randomFacts: "1531432703675596942",
  updates: "1520665313631408251",
  /** Melee ask — daily learnings / progress */
  avaProgress: "1534974849489965197",
  /** Hourly realm snapshots (Official/Worker) — Ava enriches host-site solar/weather */
  hourlySnapshots: "1528956490831102093",
  /** MC ↔ Discord bridge — Ava batch-scans for quiet in-game assists */
  ingameChat: "1516706598519832677",
  /** Prefer env; empty = no Discord audit spam (status events only) */
  audit: String(process.env.AVA_AUDIT_CHANNEL_ID || "").trim() || "",
  /** Changelog / notable ship notes */
  changelog:
    String(process.env.AVA_CHANGELOG_CHANNEL_ID || "").trim() ||
    "1520665313631408251",
  /**
   * Home for addressed replies / watch. Unsolicited digests must NOT use this
   * when it is #admins — see channelPolicy.mjs.
   */
  avaHome:
    String(process.env.AVA_HOME_CHANNEL_ID || "").trim() || "1516121832493678612",
  /** Slack staff dig core */
  slackDev: "C0BMCPMDDQR", // #development-feed
  slackPlans: "C0BM4P3GVDX", // #new-plugin-development-plans
  slackDevUrl: "https://rootmcworkspace.slack.com/archives/C0BMCPMDDQR",
  slackPlansUrl: "https://rootmcworkspace.slack.com/archives/C0BM4P3GVDX",
  slackOrgCanvasUrl:
    "https://rootmcworkspace.slack.com/docs/T0BM02SM1FE/F0BM7FRUXJ9",
};

export function slackBotToken(env = {}) {
  return firstEnv(env, ["AVA_SLACK_BOT_TOKEN"]).replace(/^bot\s+/i, "");
}

/** Telegram BotFather token — never commit; live in RootMC .env only. */
export function telegramBotToken(env = {}) {
  return firstEnv(env, ["AVA_TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_TOKEN"]);
}

/** Default on when token present unless AVA_TELEGRAM_ENABLED=0. */
export function telegramEnabled(env = {}) {
  const v = firstEnv(env, ["AVA_TELEGRAM_ENABLED"]);
  if (v === "0" || /^false$/i.test(v)) return false;
  if (v === "1" || /^true$/i.test(v)) return true;
  return Boolean(telegramBotToken(env));
}

export function slackAppToken(env = {}) {
  return firstEnv(env, ["AVA_SLACK_APP_TOKEN"]);
}

export function slackBotUserId(env = {}) {
  return firstEnv(env, ["AVA_SLACK_BOT_USER_ID"]);
}

/** Slack channels Ava listens on for digs (Socket Mode). */
export function slackWatchChannels(env = {}) {
  const fromEnv = String(
    process.env.AVA_SLACK_WATCH_CHANNELS || env.AVA_SLACK_WATCH_CHANNELS || "",
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (fromEnv.length) return [...new Set(fromEnv)];
  return [AVA_CHANNELS.slackDev, AVA_CHANNELS.slackPlans];
}

/** Slack user IDs treated as QUIET / power-down / restart operators. */
export function slackOperatorIds(env = {}) {
  const fromEnv = String(
    process.env.AVA_SLACK_OPERATOR_IDS || env.AVA_SLACK_OPERATOR_IDS || "",
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const defaults = ["U0BLWBTGYTU", "U0BLQ5Q8WTD"]; // Alexrs94 + Alexander Storey
  return [...new Set([...defaults, ...fromEnv])];
}

/** Transport: gateway (preferred) | poller | both */
export const AVA_TRANSPORT = String(
  process.env.AVA_TRANSPORT || "both",
)
  .trim()
  .toLowerCase();

/** Resolve watch channels from env + defaults. */
export function watchChannels(env = {}) {
  const fromEnv = String(
    process.env.AVA_WATCH_CHANNELS ||
      env.AVA_WATCH_CHANNELS ||
      process.env.SEXI_WATCH_CHANNELS ||
      env.SEXI_WATCH_CHANNELS ||
      "",
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const extras = [
    env.DISCORD_ROOTMC_GENERAL_CHAT_CHANNEL_ID,
    process.env.DISCORD_ROOTMC_GENERAL_CHAT_CHANNEL_ID,
  ]
    .map((s) => String(s || "").trim())
    .filter(Boolean);
  return [...new Set([...DEFAULT_WATCH_CHANNELS, ...fromEnv, ...extras])];
}

export const AVA_PORT = Number(process.env.AVA_PORT || process.env.SEXI_PORT || 8787);
/** @deprecated */
export const SEXI_PORT = AVA_PORT;
