import { loadEnv, botToken, avaBotAppId, DISCORD_API, watchChannels } from "../src/config.mjs";
import { extractQuestion, looksLikeAvaTrigger, recommend } from "../src/recommend.mjs";
import { buildPlayerContext } from "../src/playerContext.mjs";

const env = await loadEnv();
const token = botToken(env);
const botAppId = avaBotAppId(env);
const headers = {
  Authorization: `Bot ${token}`,
  "User-Agent": "RootMC-Ava/0.4",
  "Content-Type": "application/json",
};

const channelId = process.argv[2] || watchChannels(env)[0];
const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages?limit=30`, { headers });
const messages = await res.json();
if (!Array.isArray(messages)) {
  console.error(messages);
  process.exit(1);
}

const trigger = messages.find((m) => !m.author?.bot && looksLikeAvaTrigger(m, botAppId));
if (!trigger) {
  console.log("no Ava trigger found");
  process.exit(0);
}

const question = extractQuestion(trigger.content) || "you pinged me — what's up?";
const context = buildPlayerContext({ trigger, messages, avaBotId: botAppId });
const answer = await recommend({
  question,
  context,
  env,
  authorId: trigger.author?.id || "",
  authorName: trigger.author?.username || "",
});
const post = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    content: String(answer).slice(0, 2000),
    message_reference: { message_id: trigger.id },
    allowed_mentions: { parse: [] },
  }),
});
console.log("reply", post.status, await post.text().then((t) => t.slice(0, 160)));
