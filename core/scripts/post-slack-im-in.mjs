import fs from "node:fs";
import { loadEnv, slackBotToken, AVA_CHANNELS } from "../src/config.mjs";

const ROOT = "E:\\.1 Work Stations\\RootMC\\.env";
const watch = [
  AVA_CHANNELS.slackDev,
  AVA_CHANNELS.slackPlans,
  "C0BMDLAS5QS",
].join(",");
let c = fs.readFileSync(ROOT, "utf8");
const re = /^AVA_SLACK_WATCH_CHANNELS=.*$/m;
if (re.test(c)) c = c.replace(re, `AVA_SLACK_WATCH_CHANNELS=${watch}`);
else c = `${c.trimEnd()}\nAVA_SLACK_WATCH_CHANNELS=${watch}\n`;
fs.writeFileSync(ROOT, c);

const env = await loadEnv();
const token = slackBotToken(env);
const text = [
  "i'm in.",
  "",
  "joined the public channels (including this one + #new-plugin-development-plans). digs live here — Discord #development stays a pointer.",
  "",
  "if i missed a ping while i was locked out, drop it again and i'll catch it.",
  "",
  "— Ava",
].join("\n");

const data = await fetch("https://slack.com/api/chat.postMessage", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json; charset=utf-8",
  },
  body: JSON.stringify({ channel: AVA_CHANNELS.slackDev, text }),
}).then((r) => r.json());

if (!data.ok) {
  console.error(data.error);
  process.exit(1);
}
console.log("ok", data.ts, "watch", watch);
