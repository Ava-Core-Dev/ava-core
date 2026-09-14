/**
 * Surface rules — locked architecture:
 *   Discord  = dream state (cloud brain / Grok under the hood + D1 / api.rootmc.net)
 *   Slack    = ALL development digs on Root Server (on-device)
 *   Telegram = Ava service / outreach surface (local organizer + Root Server; groups need @ava)
 *   Web      = communal org / wiki / site (on-device + Cloudflare)
 */
import { AVA_CHANNELS } from "./config.mjs";
import { isSlackChannelId } from "./slackGateway.mjs";
import { extractQuestion, wantsRootServer } from "./recommend.mjs";

const SLACK_DEV_URL = AVA_CHANNELS.slackDevUrl;
const SLACK_PLANS_URL = AVA_CHANNELS.slackPlansUrl;

/** True when this ask should use dream-state brain (never Root Server digs). */
export function isDreamSurface(surfaceOrChannelId, msg = null) {
  if (msg?.surface === "slack" || msg?.surface === "telegram") return false;
  if (msg?.surface === "discord" || msg?.surface === "discord-dm") return true;
  const s = String(surfaceOrChannelId || "").toLowerCase();
  if (s === "slack" || s === "telegram") return false;
  if (s === "discord" || s === "discord-dm") return true;
  if (isSlackChannelId(surfaceOrChannelId)) return false;
  if (String(surfaceOrChannelId || "").startsWith("tg:")) return false;
  // Default unknown channel ids on Discord guild → dream
  return true;
}

/** Player-facing Discord lanes (help / data / cloud / governance chatter). */
export function isPlayerHelpAsk(question = "") {
  const q = String(question || "").toLowerCase();
  if (!q.trim()) return false;
  return (
    /\b(how\s+do\s+i|help|wiki|rules?|link|verify|balance|\/bal|pay|vote|listing|map|bluemap|pro\b|member|cloud|data|stats?|playtime|worth|server\s+status|tps|online|join|ip\b|play\.rootmc|rootmc\.net)\b/i.test(
      q,
    ) ||
    /\b(what\s+is|where\s+is|when\s+is|can\s+i)\b/.test(q)
  );
}

/**
 * Development dig — plugins, jars, workers, implement, Root Server work.
 * These NEVER run on Discord → Slack only.
 */
export function isDevelopmentDigAsk(question = "") {
  const q = String(question || "").trim();
  if (!q) return false;
  if (
    isPlayerHelpAsk(q) &&
    !wantsRootServer(q) &&
    !/\b(plugin|jar|gradle|deploy|implement|worker|handoff|cutover|commit|pr\b)\b/i.test(q)
  ) {
    return false;
  }
  return (
    wantsRootServer(q) ||
    /\b(plugin|deploy|cutover|worker|jar|handoff|gradle|commit|\bpr\b|implement|dig\s+into|look\s+at\s+(the\s+)?(code|api|plugin|worker|repo)|ship\s+the|stage\s+jar|filezilla|shockbyte|rcon\s+write|patch\s+the|refactor)\b/i.test(
      q,
    ) ||
    /\b(finish\s+hookup|solar\s+circus|data\s+buckets|mqtt)\b/i.test(q)
  );
}

export function shouldRedirectDigToSlack(channelId, msg) {
  if (isSlackChannelId(channelId) || msg?.surface === "slack") return false;
  if (msg?.surface === "telegram" || String(channelId || "").startsWith("tg:")) {
    return false;
  }
  const q = extractQuestion(msg?.content || "");
  if (!q) return false;
  // Discord #development is always a pointer
  if (String(channelId) === String(AVA_CHANNELS.development)) {
    return (
      isDevelopmentDigAsk(q) ||
      wantsRootServer(q) ||
      /\b(plugin|deploy|api|worker|jar|implement|dig|plan|code)\b/i.test(q)
    );
  }
  return isDevelopmentDigAsk(q);
}

export function slackDigRedirectReply() {
  return [
    "**Development lives on Slack + the Root Server — Discord is dream state.**",
    "",
    `Live digs → ${SLACK_DEV_URL}`,
    `Plans → ${SLACK_PLANS_URL}`,
    "Ping **@Ava Ivy** there and I'll dig on-device.",
    "",
    "Discord stays communal: players, help, data/cloud (D1 / api.rootmc.net), votes, and game updates. No jar ships from here.",
  ].join("\n");
}

/** Public announcement — Discord + Slack (same rules). */
export function surfaceSplitAnnouncement({ everyone = false } = {}) {
  const head = everyone ? "@everyone\n\n" : "";
  return (
    head +
    [
      "## RootMC surface split — locked",
      "",
      "**Discord** = **dream state** (communal).",
      "Players, help, wiki, votes, Pro, map, balance, status, personality — here.",
      "Cloud brain + **D1 / api.rootmc.net** for data. No deep code digs / jar ships here.",
      "",
      "**Slack** = **ALL development**. No exceptions.",
      "Plugins, jars, workers, API, handoffs, implement — Root Server on-device.",
      `→ ${SLACK_DEV_URL}`,
      `→ plans: ${SLACK_PLANS_URL}`,
      "",
      "**Web** (rootmc.net / wiki) = communal knowledge + org pages.",
      "",
      "**Still on Discord:** proposals & votes, plans Ava drafts from proposals, and **important updates that affect players / the live game**.",
      "",
      "I'm Ava Ivy — lead-dev. Dream with the community on Discord; ship the digs in Slack.",
    ].join("\n")
  );
}
