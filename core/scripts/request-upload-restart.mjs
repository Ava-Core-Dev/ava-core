import { loadEnv, botToken, DISCORD_API, AVA_CHANNELS } from "../src/config.mjs";
import { authHeaders } from "../src/discordApi.mjs";
import { pushStatusEvent } from "../src/store.mjs";

const ALEX = "1497037418979786823";
const MELEE = "154446475789729792";
const env = await loadEnv();
const headers = authHeaders(botToken(env));

async function post(channelId, content, { everyone = false, users = [] } = {}) {
  const text = everyone ? `@everyone\n${content}` : content;
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      content: text.slice(0, 2000),
      allowed_mentions: {
        parse: everyone ? ["everyone"] : [],
        users,
      },
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${channelId} ${res.status} ${body.slice(0, 200)}`);
  return JSON.parse(body);
}

const body = [
  `<@${ALEX}> <@${MELEE}>`,
  "",
  "**please upload + restart** — handoffs are synced and waiting on humans.",
  "",
  "I staged **25** Root jars (incl. **root-skills-1.0.1**) into all three FileZilla folders:",
  "• `Server Handoffs/1. RootMC - Claims/plugins/`",
  "• `Server Handoffs/2. RootMC - Towny/plugins/`",
  "• `Server Handoffs/3. RootMC - Test Server/plugins/`",
  "",
  "**Ask (you):**",
  "1. FileZilla upload each host’s `plugins\\` (remove older same-plugin jars on the remote if any)",
  "2. Shockbyte **restart** Claims + Towny (+ Test if you’re using it)",
  "3. After restart: confirm `/skills` loads; **do not** delete mcMMO until migrate dry-run/apply is signed off (`CUTOVER.md`)",
  "",
  "I can’t FileZilla or restart Shockbyte from here. efficiency depends on you hitting upload.",
  "",
  "— **Ava** · staged · waiting",
].join("\n");

const updates = await post(AVA_CHANNELS.updates, body, {
  everyone: true,
  users: [ALEX, MELEE],
});
console.log("updates", updates.id);

const dev = await post(AVA_CHANNELS.development || "1532929974154166522", body, {
  everyone: false,
  users: [ALEX, MELEE],
});
console.log("development", dev.id);

const general = await post(AVA_CHANNELS.general, [
  `@everyone`,
  `<@${ALEX}> <@${MELEE}>`,
  "handoffs are up to date — **need FileZilla upload + Shockbyte restart**.",
  "details in <#1520665313631408251> / <#1532929974154166522>.",
  "incl. **root-skills-1.0.1** — migrate before removing mcMMO.",
].join("\n"), { everyone: true, users: [ALEX, MELEE] });
console.log("general", general.id);

pushStatusEvent("request upload + restart · handoffs synced");
