/**
 * Poll Discord for Ava "updates done / all clear" posts.
 * Exit 0 + print AGENT_LOOP_WAKE sentinel when found.
 */
import fs from "node:fs";
import {
  loadEnv,
  botToken,
  DISCORD_API,
  AVA_BOT_APP_ID,
} from "../src/config.mjs";
import { authHeaders } from "../src/discordApi.mjs";

const STATE_PATH =
  "E:\\.Ava_Ivy\\data\\watch-updates-done.json";
const CHANNELS = ["1516108586307158088", "1520665313631408251"];
const DONE_RE =
  /\b(updates?\s+(are\s+)?done|all\s+clear|we'?re\s+(back|live|up)|clear\s+to\s+(come\s+)?back|finished\s+the\s+(rest|updates?|work)|bring(ing)?\s+(us|servers?)\s+back|servers?\s+(are\s+)?(back\s+)?(online|up)|back\s+properly)\b/i;
const WAITING_RE =
  /\b(still\s+waiting|almost|hang\s+tight|few\s+things|waiting\s+on)\b/i;

function loadState() {
  if (!fs.existsSync(STATE_PATH)) {
    return { sinceId: "1533274594327265300", startedAt: Date.now() };
  }
  const raw = fs.readFileSync(STATE_PATH, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

const state = loadState();
const env = await loadEnv();
const headers = authHeaders(botToken(env));
const hits = [];

for (const ch of CHANNELS) {
  const after = state.sinceId || "0";
  const res = await fetch(
    `${DISCORD_API}/channels/${ch}/messages?after=${after}&limit=40`,
    { headers },
  );
  const msgs = await res.json();
  if (!Array.isArray(msgs)) continue;
  for (const m of msgs) {
    if (m.author?.id !== AVA_BOT_APP_ID) continue;
    const text = String(m.content || "");
    if (DONE_RE.test(text) && !WAITING_RE.test(text)) {
      hits.push({
        channel: ch,
        id: m.id,
        text: text.slice(0, 280),
        url: `https://discord.com/channels/1516108585740800042/${ch}/${m.id}`,
      });
    }
    if (!state.latestSeen || BigInt(m.id) > BigInt(state.latestSeen)) {
      state.latestSeen = m.id;
    }
  }
}

if (state.latestSeen) state.sinceId = state.latestSeen;
saveState(state);

if (hits.length) {
  console.log(
    "AGENT_LOOP_WAKE_ava_updates_done",
    JSON.stringify({
      prompt:
        "Ava posted updates-done — notify the user with links and stop the watcher.",
      hits,
    }),
  );
  process.exit(0);
}

console.log(`watch tick — no done signal yet since=${state.sinceId}`);
process.exit(2);
