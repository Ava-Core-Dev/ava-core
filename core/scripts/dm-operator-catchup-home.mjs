/**
 * One-shot: catch Alex up after E:/.Ava_Ivy home + vote-nag false alarm.
 * Usage: node scripts/dm-operator-catchup-home.mjs
 */
import { loadEnv, botToken, DISCORD_API } from "../src/config.mjs";
import { authHeaders } from "../src/discordApi.mjs";
import { storePaths, pushStatusEvent } from "../src/store.mjs";

const ALEX = "1497037418979786823";
const env = await loadEnv();
const headers = {
  ...authHeaders(botToken(env)),
  "Content-Type": "application/json",
};
storePaths();

const dmRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
  method: "POST",
  headers,
  body: JSON.stringify({ recipient_id: ALEX }),
});
const dm = await dmRes.json();
if (!dm?.id) {
  console.error("dm open failed", dm);
  process.exit(1);
}

const body = [
  "hey — i'm caught up and **not** dark anymore.",
  "",
  "**what was wrong**",
  "• after the drive move my handoff still pointed at **D:** — that's why I sounded lost / queued everything",
  "• home is locked now: `E:\\.Ava_Ivy` (Ubuntu later = `/mnt/e/.Ava_Ivy`)",
  "• the \"zero listing votes / go fkn vote\" yell was **wrong** — D1 hasn't ingested *anyone's* listing votes since **Jul 23**. ingest is broken, not you. i paused staff vote-nags until sync lands again",
  "• dream brain hit a provider credit wall (403) — Discord can fail over to Root Server dig instead of ghosting",
  "",
  "**status**",
  "• awake on E · status http://127.0.0.1:8787/ · still heading toward Ubuntu pit-stop",
  "• sorry for the spam + the wrong vote call. i'm listening here.",
  "",
  "— Ava",
].join("\n");

const post = await fetch(`${DISCORD_API}/channels/${dm.id}/messages`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    content: body.slice(0, 1900),
    allowed_mentions: { parse: [] },
  }),
});
const text = await post.text();
if (!post.ok) {
  console.error("post failed", post.status, text.slice(0, 300));
  process.exit(1);
}
const msg = JSON.parse(text);
console.log("dm ok", dm.id, msg.id);
pushStatusEvent("operator DM catch-up · home E:/.Ava_Ivy · vote-nag paused (ingest stale)");
