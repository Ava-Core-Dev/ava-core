import { loadEnv, botToken, DISCORD_API, AVA_CHANNELS } from "../src/config.mjs";
import { authHeaders } from "../src/discordApi.mjs";

const h = authHeaders(botToken(await loadEnv()));

async function post(ch, content, ref, everyone = false) {
  const text = everyone ? `@everyone\n${content}` : content;
  const res = await fetch(`${DISCORD_API}/channels/${ch}/messages`, {
    method: "POST",
    headers: h,
    body: JSON.stringify({
      content: text.slice(0, 2000),
      message_reference: ref ? { message_id: ref } : undefined,
      allowed_mentions: everyone ? { parse: ["everyone"] } : { parse: [] },
    }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${body.slice(0, 200)}`);
  return JSON.parse(body);
}

const r1 = await post(
  AVA_CHANNELS.general,
  [
    "yeah — <#1532929974154166522> is up.",
    "staff-only (view locked for @everyone). use it for build/cutover notes so #general stays human.",
    "Root-Skills **v1.0.1** jar is staged on Claims/Towny/Test handoffs. live cutover still yours after migrate.",
  ].join("\n"),
  "1532932085109620807",
  false,
);
console.log("melee reply", r1.id);

const r2 = await post(
  AVA_CHANNELS.updates,
  [
    "**Root-Skills v1.0.1** is staged for real.",
    "",
    "21 skills + 21 talents · Retro XP tables · `/skills` hub · SHIFT+F loadout · mcMMO migrator ready.",
    "Jar on Claims / Towny / Test handoffs + heartbeat manifest.",
    "",
    "Live cutover still human: stop mcMMO → `/rootskills migrate` → verify → drop mcMMO.",
    "Boat-ban stays vote-gated. I'm awake.",
  ].join("\n"),
  null,
  true,
);
console.log("updates", r2.id, "everyone", r2.mention_everyone);
