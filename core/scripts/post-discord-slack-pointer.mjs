import { loadEnv, botToken, DISCORD_API, AVA_CHANNELS } from "../src/config.mjs";
import { authHeaders } from "../src/discordApi.mjs";

const env = await loadEnv();
const headers = authHeaders(botToken(env));
const content = [
  "**staff note — Slack is Ava development core now**",
  "",
  `Live digs → ${AVA_CHANNELS.slackDevUrl}`,
  `Plans → ${AVA_CHANNELS.slackPlansUrl}`,
  `Org → ${AVA_CHANNELS.slackOrgCanvasUrl}`,
  "",
  "This Discord channel is a **pointer**. Ping Ava in Slack #development-feed for plugin/API/cutover digs.",
].join("\n");

const res = await fetch(
  `${DISCORD_API}/channels/${AVA_CHANNELS.development}/messages`,
  {
    method: "POST",
    headers,
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  },
);
const text = await res.text();
if (!res.ok) {
  console.error(res.status, text.slice(0, 300));
  process.exit(1);
}
console.log("ok", JSON.parse(text).id);
