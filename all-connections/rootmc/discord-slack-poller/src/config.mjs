import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Workspace root: Web Files/rootmc-ava/src → RootMC */
export const WORKSPACE_ROOT = path.resolve(__dirname, "../../..");

/**
 * Canonical Ava home after E-drive cutover.
 * Preferred: E:\.Ava_Ivy (or /mnt/e/.Ava_Ivy). Legacy layout-relative
 * `Server Handoffs/Ava Ivy` is a junction into that home.
 * Override anytime with AVA_HANDOFF.
 */
function resolveDefaultAvaHandoff() {
  const candidates = [
    "E:\\.Ava_Ivy",
    "/mnt/e/.Ava_Ivy",
    path.join(WORKSPACE_ROOT, "Server Handoffs", "Ava Ivy"),
  ];
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return candidates[candidates.length - 1];
}

/** Default Ava handoff — prefers E:\.Ava_Ivy. Override with AVA_HANDOFF. */
export const DEFAULT_AVA_HANDOFF = resolveDefaultAvaHandoff();

/** Reuse RootMC realm-api env loader without publishing a package. */
export async function loadEnv() {
  const loaderPath = path.resolve(
    __dirname,
    "../../rootmc-realm-api/scripts/lib/rootmc-env.mjs",
  );
  if (fs.existsSync(loaderPath)) {
    const m = await import(pathToFileURL(loaderPath).href);
    const env = m.loadRootMcEnv();
    for (const [k, v] of Object.entries(env || {})) {
      if (v == null || v === "") continue;
      if (process.env[k] == null || process.env[k] === "") {
        process.env[k] = String(v);
      }
    }
    return env;
  }
  // SSD layout: credentials already exported by start-poller / GUI. Do not crash.
  return { ...process.env };
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
  process.env.AVA_MODEL_REGULAR ||
    process.env.AVA_MODEL ||
    process.env.SEXI_MODEL ||
    "composer-2.5",
)
  .trim()
  .replace(/-fast$/i, "") || "composer-2.5";
/** @deprecated */
export const SEXI_MODEL = AVA_MODEL;

/**
 * Cursor SDK model + Fast param.
 * Composer 2.5 Standard is the cheap tier (~$0.50/$2.50 per M tokens).
 * Fast is the same intelligence at ~6× price — operators / AVA_CURSOR_FAST=1 only.
 *
 * @param {{ premium?: boolean, forceStandard?: boolean }} opts
 */
export function cursorModelSelection({ premium = false, forceStandard = false } = {}) {
  const envFast = String(process.env.AVA_CURSOR_FAST || "").trim();
  let fast = Boolean(premium) && !forceStandard;
  if (envFast === "1" || /^true$/i.test(envFast)) fast = true;
  if (envFast === "0" || /^false$/i.test(envFast)) fast = false;
  return {
    id: AVA_MODEL,
    params: [{ id: "fast", value: fast ? "true" : "false" }],
  };
}

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

/** Default watch list — admins, general, governance, voting, constitution, memes, updates.
 * #proposals: old 1526664180491358419 and wrangler 1533012499320934602 both 404 (GET 2026-09-04).
 * Live guild still has a proposals room (1537333521389977600); not watched until operator confirms.
 */
export const DEFAULT_WATCH_CHANNELS = [
  "1516121832493678612", // admins
  "1545284354157187083", // #general
  "1522406451413385317", // governance
  "1522413185364398090", // voting
  "1522406019152478210", // constitution
  "1545287357618593843", // #memes-and-media
  "1545287392552943768", // #development (staff pointer → Slack)
  "1545284423740563528", // #updates — listen; Ava forwards home posts here
  "1539779979280257054", // Ava home — reports, automations, global chat
];

/** Ava's only unsolicited home — reports, automations, and global chat. */
const _avaHomeEnv = String(process.env.AVA_HOME_CHANNEL_ID || "").trim();
export const AVA_DISCORD_HOME =
  _avaHomeEnv && _avaHomeEnv !== "1516121832493678612"
    ? _avaHomeEnv
    : "1539779979280257054";

/** Named channel fallbacks (aligned with rootmc-discord-channels). */
export const AVA_CHANNELS = {
  general: "1545284354157187083",
  admins: "1516121832493678612",
  /** Not watched. Old/wrangler ids 404; live guild room exists but is unconfirmed. */
  proposals: "1537333521389977600",
  governance: "1522406451413385317",
  voting: "1522413185364398090",
  constitution: "1522406019152478210",
  development: "1545287392552943768",
  memesMedia: "1545287357618593843",
  /** Centralized Ava GIF/media vault */
  avaMedia: "1533268458668687392",
  randomFacts: "1545287379055812638",
  updates: "1545284423740563528",
  /** Hourly realm snapshots now land in Ava home (same ID as avaHome). */
  hourlySnapshots: AVA_DISCORD_HOME,
  /** MC ↔ Discord bridge — Ava batch-scans for quiet in-game assists */
  ingameChat: "1545284399107547179",
  /** Prefer env; empty = no Discord audit spam (status events only) */
  audit: String(process.env.AVA_AUDIT_CHANNEL_ID || "").trim() || "",
  /** Changelog / notable ship notes */
  changelog:
    String(process.env.AVA_CHANGELOG_CHANNEL_ID || "").trim() || AVA_DISCORD_HOME,
  /**
   * Home for reports, automations, and unsolicited global chat.
   * Other channels: listen + reply when mentioned / clearly about her.
   */
  avaHome: AVA_DISCORD_HOME,
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
