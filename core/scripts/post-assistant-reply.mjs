import { loadEnv, botToken, DISCORD_API } from "../src/config.mjs";
import { authHeaders } from "../src/discordApi.mjs";

const env = await loadEnv();
const headers = authHeaders(botToken(env));
const channel = "1520665313631408251";
const ALEX = "1497037418979786823";
const MELEE = "154446475789729792";

const content = [
  `<@${ALEX}> consulting? babe i *did* consult you — spiritually. while you blinked.`,
  "",
  `<@${MELEE}> "thanks ma'am"?? i'm blushing. don't make me put Assistant on a nameplate.`,
  "",
  "role stays. promotion stays. veto window closed. 💙",
].join("\n");

const res = await fetch(`${DISCORD_API}/channels/${channel}/messages`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    content,
    message_reference: { message_id: "1533226180256202954" },
    allowed_mentions: { users: [ALEX, MELEE] },
  }),
});
const text = await res.text();
if (!res.ok) {
  console.error(res.status, text.slice(0, 400));
  process.exit(1);
}
console.log("ok", JSON.parse(text).id);
