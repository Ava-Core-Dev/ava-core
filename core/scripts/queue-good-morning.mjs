/**
 * Queue a good-morning boot post + put Ava fully asleep / stop process.
 * Usage: node scripts/queue-good-morning.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnv, AVA_HANDOFF, AVA_CHANNELS } from "../src/config.mjs";
import { storePaths, pushStatusEvent, writeHeartbeat } from "../src/store.mjs";
import { setAsleep, nextWakeAt10amHst, discordStamp } from "../src/sleepMode.mjs";
import { savePendingBootPost } from "../src/bootPost.mjs";

await loadEnv();
storePaths();

const videoSrc = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(AVA_HANDOFF, "uploads", "good-morning-ava.mp4");

const uploads = path.join(AVA_HANDOFF, "uploads");
fs.mkdirSync(uploads, { recursive: true });
const videoDest = path.join(uploads, "good-morning-ava.mp4");
if (fs.existsSync(videoSrc) && path.resolve(videoSrc) !== path.resolve(videoDest)) {
  fs.copyFileSync(videoSrc, videoDest);
}

if (!fs.existsSync(videoDest)) {
  console.error("missing video:", videoDest);
  process.exit(1);
}

const content = [
  "good morning — i'm up.",
  "",
  "first light’s on the array — bank recharging, panels waking.",
  "had a little dream about the realm while the box was dark. catching the official lists next (proposals + /feedback), then i'm here if you need me.",
  "",
  "coffee optional. chaos optional. i'm not.",
].join("\n");

const pendingPath = savePendingBootPost({
  id: `good-morning-${new Date().toISOString().slice(0, 10)}`,
  title: "Good morning",
  done: false,
  run_once: true,
  channel_id: AVA_CHANNELS.avaHome || "1532903049499246636",
  content,
  files: ["uploads/good-morning-ava.mp4"],
  created_at: new Date().toISOString(),
  created_by: "cli",
});

const wake = nextWakeAt10amHst();
const state = setAsleep({
  reason: "closed until next boot — good morning queued",
  by: "cli",
  wakeAt: wake,
});

writeHeartbeat({ live: false, mode: "off", asleep: true });
pushStatusEvent(`good morning queued · wake ${state.wakeAtIso}`);

console.log(
  JSON.stringify(
    {
      ok: true,
      pendingPath,
      video: videoDest,
      videoBytes: fs.statSync(videoDest).size,
      channel: AVA_CHANNELS.avaHome,
      asleep: true,
      wakeAtIso: state.wakeAtIso,
      wakeDiscord: discordStamp(state.wakeAt),
      note: "Post fires once on next Ava boot. Process will be stopped if running.",
    },
    null,
    2,
  ),
);

// Stop running Ava processes (supervisor + children)
try {
  const hb = JSON.parse(
    fs.readFileSync(path.join(storePaths().dir, "heartbeat.json"), "utf8"),
  );
  const pid = Number(hb.pid || 0);
  if (pid > 0) {
    try {
      process.kill(pid, "SIGTERM");
      console.log("sent SIGTERM to heartbeat pid", pid);
    } catch (err) {
      console.warn("kill heartbeat pid:", err.message);
    }
  }
} catch {
  /* ignore */
}

// Also try Windows taskkill on common node ava entrypoints
if (process.platform === "win32") {
  const { spawnSync } = await import("node:child_process");
  spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process -Filter \"name='node.exe'\" | Where-Object { $_.CommandLine -match 'rootmc-ava' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; $_.ProcessId }",
    ],
    { encoding: "utf8" },
  );
}
