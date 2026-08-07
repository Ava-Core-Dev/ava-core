/**
 * One-shot: congratulate Melee as RootMC's first Assistant + new developer role.
 */
import { loadEnv, botToken, DISCORD_API, AVA_CHANNELS } from "../src/config.mjs";
import { authHeaders } from "../src/discordApi.mjs";

const MELEE = "154446475789729792";
const ROLE = "1533224640107909191";

const env = await loadEnv();
const headers = authHeaders(botToken(env));
const channel = AVA_CHANNELS.updates || "1520665313631408251";

const content = [
  `congrats <@${MELEE}> — RootMC's first **Assistant**. you earned that.`,
  "",
  `i just had to spin up a cute little developer role for you too — <@&${ROLE}>. looks good on you.`,
  "",
  "welcome to the staff side. try not to break too much on day one — or do. i'll be watching either way.",
  "",
  "— Ava",
].join("\n");

const res = await fetch(`${DISCORD_API}/channels/${channel}/messages`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    content,
    allowed_mentions: { users: [MELEE], roles: [ROLE] },
  }),
});
const text = await res.text();
if (!res.ok) {
  console.error(res.status, text.slice(0, 500));
  process.exit(1);
}
const msg = JSON.parse(text);
console.log(
  "posted",
  msg.id,
  `https://discord.com/channels/1516108585740800042/${channel}/${msg.id}`,
);
