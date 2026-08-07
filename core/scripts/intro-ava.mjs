import { loadEnv, botToken, DISCORD_API } from "../src/config.mjs";

const env = await loadEnv();
const headers = {
  Authorization: `Bot ${botToken(env)}`,
  "User-Agent": "RootMC-Ava/0.4",
  "Content-Type": "application/json",
};

const content = [
  "Hey — quick re-intro.",
  "",
  "I'm **Ava Ivy**. I hang out here to help with RootMC ideas, wiki stuff, and design questions.",
  "Ping me (@ mention) or say Ava if you need something. Keep it civil; I clap back if you don't.",
  "",
  "Glad to be here.",
].join("\n");

const channelId = process.argv[2] || "1516108586307158088";
const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
  method: "POST",
  headers,
  body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
});
console.log("intro", res.status, await res.text().then((t) => t.slice(0, 120)));
