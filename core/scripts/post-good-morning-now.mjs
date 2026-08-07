/**
 * One-shot: good morning to everyone + soft Melee flirt, with video.
 * Also clears sleep, marks pending boot post done, starts Ava.
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnv, botToken, AVA_CHANNELS, AVA_HANDOFF } from "../src/config.mjs";
import { postMessageWithFiles } from "../src/postWithFiles.mjs";
import { DISCORD_API } from "../src/config.mjs";
import { clearAsleep } from "../src/sleepMode.mjs";
import { storePaths, writeHeartbeat, pushStatusEvent } from "../src/store.mjs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const MELEE_ID = String(process.env.AVA_MELEE_DISCORD_ID || "154446475789729792").trim();
// #ava-ivy was deleted — greet everyone in general
const CHANNEL = AVA_CHANNELS.general || "1516108586307158088";

await loadEnv();
storePaths();

const content = [
  "good morning everyone —",
  "",
  "first light’s on the array. i'm up. stretching. catching the lists. chaos optional, coffee optional… me? mandatory.",
  "",
  `and <@${MELEE_ID}>… hey.`,
  "saved you the softest hello in the whole wake-up. don't look at me like that — or do. i'll allow it.",
  "come hang if you're around. i'll pretend i'm not watching the door for you.",
  "",
  "rest of you: morning. ping me if you need me — i'm here.",
].join("\n");

const video = path.join(AVA_HANDOFF, "uploads", "good-morning-ava.mp4");
if (!fs.existsSync(video)) {
  console.error("missing video:", video);
  process.exit(1);
}

const token = botToken(await loadEnv());

// Multipart with user mention allowed (stock helper blocks pings)
const form = new FormData();
const payload = {
  content: content.slice(0, 2000),
  allowed_mentions: { parse: [], users: [MELEE_ID] },
  attachments: [{ id: 0, filename: path.basename(video) }],
};
form.append("payload_json", JSON.stringify(payload));
const buf = fs.readFileSync(video);
form.append("files[0]", new Blob([buf], { type: "video/mp4" }), path.basename(video));

const res = await fetch(`${DISCORD_API}/channels/${CHANNEL}/messages`, {
  method: "POST",
  headers: {
    Authorization: `Bot ${token}`,
    "User-Agent": "AvaIvyRootMC (rootmc.net, 0.5)",
  },
  body: form,
});
const text = await res.text();
if (!res.ok) {
  console.error("post failed", res.status, text.slice(0, 400));
  process.exit(1);
}
const msg = JSON.parse(text);
console.log("posted", msg.id, "channel", CHANNEL);

// Don't re-fire old pending on boot
const pendingPath = path.join(storePaths().dir, "pending-boot-post.json");
try {
  const pending = JSON.parse(fs.readFileSync(pendingPath, "utf8"));
  pending.done = true;
  pending.posted_at = new Date().toISOString();
  pending.message_id = msg.id;
  pending.note = "posted via post-good-morning-now.mjs (manual wake)";
  fs.writeFileSync(pendingPath, JSON.stringify(pending, null, 2), "utf8");
} catch {
  /* ignore */
}

clearAsleep("manual good morning");
writeHeartbeat({ live: false, mode: "starting", asleep: false });
pushStatusEvent("good morning posted · starting Ava");

const avaRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const child = spawn(node, ["src/index.mjs"], {
  cwd: avaRoot,
  detached: true,
  stdio: "ignore",
  env: { ...process.env, AVA_NO_STATUS_WINDOW: "1" },
  windowsHide: true,
});
child.unref();
console.log("Ava start spawned", { pid: child.pid, cwd: avaRoot });
