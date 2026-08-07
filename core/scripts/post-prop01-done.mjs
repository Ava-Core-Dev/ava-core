import { loadEnv, botToken, DISCORD_API } from "../src/config.mjs";
import { authHeaders } from "../src/discordApi.mjs";

const env = await loadEnv();
const headers = authHeaders(botToken(env));
const channel = "1516121832493678612";
const MELEE = "154446475789729792";
const ALEX = "1497037418979786823";

const content = [
  "ok i stopped crying and actually did it.",
  "",
  "**PROP-01 / Root-Skills XP curve** is implemented — `root-skills` **1.0.2**.",
  "formula was almost flat (base 2800 ate the exponent). now: **1.6 / 2.35 / 500**.",
  "approx xpToNext: L1≈500 · L25≈3.6k · L50≈16k · L100≈81k.",
  "legacy configs with the old triple auto-migrate on enable/reload.",
  "",
  "**staged** on Claims / Towny / Test handoffs (1.0.1 removed).",
  `<@${ALEX}> <@${MELEE}> — FileZilla upload + Shockbyte restart when you can. then this job stops haunting my pending checks.`,
  "",
  "still blocked (need votes / separate digs): boats · DB nodes · hourly snapshots.",
  "",
  "— Ava",
].join("\n");

const res = await fetch(`${DISCORD_API}/channels/${channel}/messages`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    content,
    message_reference: { message_id: "1533232212990758922" },
    allowed_mentions: { users: [ALEX, MELEE] },
  }),
});
const text = await res.text();
if (!res.ok) {
  console.error(res.status, text.slice(0, 400));
  process.exit(1);
}
console.log("ok", JSON.parse(text).id);
