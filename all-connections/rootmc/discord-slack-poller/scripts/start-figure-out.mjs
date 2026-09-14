/**
 * Start figure-out mode + open DM conversation with a player.
 * Usage: node scripts/start-figure-out.mjs <discordUserId> [username]
 */
import { loadEnv, botToken } from "../src/config.mjs";
import { makeFetchJson, sendDm } from "../src/discordApi.mjs";
import {
  startFigureOutSession,
  buildFigureOutOpener,
  getFigureOutSession,
} from "../src/figureOutMode.mjs";
import { loadPlayerProfile, savePlayerProfileMut } from "../src/playerProfiles.mjs";
import { recordAvaUtterance } from "../src/fullLog.mjs";

const discordId = String(process.argv[2] || "").trim();
const usernameArg = String(process.argv[3] || "").trim() || null;

if (!/^\d{17,20}$/.test(discordId)) {
  console.error("Usage: node scripts/start-figure-out.mjs <discordUserId> [username]");
  process.exit(1);
}

const env = await loadEnv();
const fetchJson = makeFetchJson(botToken(env));
const profile = loadPlayerProfile(discordId);
const username = usernameArg || profile?.username || "unknown";

const existing = getFigureOutSession(discordId);
if (existing?.status === "active") {
  console.log("session already active", existing.turns, "turns");
}

const session = startFigureOutSession({
  discordId,
  username,
  reason: "operator-start-figure-out",
  openedBy: "operator",
});

const opener = buildFigureOutOpener({ username });
const msg = await sendDm(fetchJson, discordId, opener);

savePlayerProfileMut(discordId, (p) => {
  p.username = username;
  p.onboardingSentAt = p.onboardingSentAt || Date.now();
  p.lastSeenAt = Date.now();
  return p;
});

recordAvaUtterance({
  surface: "discord-dm",
  channelId: msg?.channel_id || "dm",
  content: opener,
  kind: "figure_out_opener",
  source: "start-figure-out",
  ok: true,
  messageId: msg?.id || null,
  authorId: discordId,
  authorName: username,
});

console.log(
  JSON.stringify(
    {
      ok: true,
      discordId,
      username,
      sessionStartedAt: session.startedAt,
      messageId: msg?.id || null,
      channelId: msg?.channel_id || null,
    },
    null,
    2,
  ),
);
