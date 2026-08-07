/**
 * Soft bedtime: Discord post + video, sleep until ~10:00 HST, keep process up
 * so Discord + Telegram dream summons still work. (Hard kill = power down.)
 *
 * Usage: node scripts/go-to-bed.mjs [videoPath]
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  loadEnv,
  botToken,
  AVA_HANDOFF,
  AVA_CHANNELS,
  ROOTMC_GUILD_ID,
} from "../src/config.mjs";
import { storePaths, pushStatusEvent, writeHeartbeat } from "../src/store.mjs";
import {
  setAsleep,
  nextWakeAt10amHst,
  discordStamp,
  isAsleep,
} from "../src/sleepMode.mjs";
import { postMessageWithFiles } from "../src/postWithFiles.mjs";
import { notifyAlexDreaming } from "../src/offlineNotes.mjs";
import { makeFetchJson } from "../src/discordApi.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AVA_ROOT = path.resolve(__dirname, "..");

await loadEnv();
storePaths();

const videoSrc = path.resolve(
  process.argv[2] ||
    String.raw`E:\.1 Work Stations\RootMC\Server Handoffs\Ava Ivy\uploads\going back to bed.mp4`,
);
const uploads = path.join(AVA_HANDOFF, "uploads");
fs.mkdirSync(uploads, { recursive: true });
const videoDest = path.join(uploads, "going-back-to-bed.mp4");

if (fs.existsSync(videoSrc)) {
  fs.copyFileSync(videoSrc, videoDest);
}

const wake = nextWakeAt10amHst();
const state = setAsleep({
  reason: "operator — going back to bed (soft sleep · telegram dream on)",
  by: "cli",
  wakeAt: wake,
});

const channelId = AVA_CHANNELS.development || "1532929974154166522";
const content = [
  "okay… going back to bed",
  "",
  "sun’s down — bank’s carrying the Root Server tonight",
  "dreaming about more developments and analytics",
  `back around **10:00 HST** — ${discordStamp(state.wakeAt)}`,
  "discord + **telegram** (@ava_ivy_bot) stay on dream-state for summons — soft brain, no deep digs",
  "i'll read the chat when the panels wake",
  "alex — catching you in DMs while i'm under",
].join("\n");

const token = botToken(await loadEnv());
let msg = null;
try {
  const files = fs.existsSync(videoDest) ? [videoDest] : [];
  msg = await postMessageWithFiles(token, channelId, content, files);
  console.log("posted", msg?.id, "channel", channelId);
} catch (err) {
  console.warn("bedtime post:", err.message);
}

try {
  await notifyAlexDreaming(makeFetchJson(token), {
    reason: "going back to bed — soft sleep til ~10am HST (telegram dream on)",
    kind: "sleep",
    wakeAt: state.wakeAt,
  });
  console.log("alex DM notified");
} catch (err) {
  console.warn("alex DM:", err.message);
}

writeHeartbeat({ live: true, mode: "sleep", asleep: true });
pushStatusEvent(`bedtime soft · wake ${state.wakeAtIso} · telegram dream on`);

// Ensure Ava process is running so Telegram + Discord can dream-answer
function avaRunning() {
  try {
    const lock = path.join(storePaths().dir, "ava-parent.lock");
    if (!fs.existsSync(lock)) return false;
    const prev = JSON.parse(fs.readFileSync(lock, "utf8"));
    const pid = Number(prev?.pid);
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

if (!avaRunning()) {
  console.log("starting Ava in soft sleep (telegram + discord dream)…");
  const child = spawn(
    process.execPath,
    [path.join(AVA_ROOT, "src", "index.mjs")],
    {
      cwd: AVA_ROOT,
      detached: true,
      stdio: "ignore",
      env: { ...process.env, AVA_NO_STATUS_WINDOW: "1" },
      windowsHide: true,
    },
  );
  child.unref();
  console.log("spawned parent", child.pid);
} else {
  console.log("Ava already running — sleep flag set; telegram dream active");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      softSleep: true,
      asleep: isAsleep(),
      wakeAtIso: state.wakeAtIso,
      telegram: "dream summons while asleep",
      messageId: msg?.id || null,
      url: msg?.id
        ? `https://discord.com/channels/${ROOTMC_GUILD_ID}/${channelId}/${msg.id}`
        : null,
    },
    null,
    2,
  ),
);
