/**
 * Night power-down blast — post gn on recent Ava-active channels + soft sleep.
 * Usage: node scripts/night-powerdown-blast.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnv, botToken } from "../src/config.mjs";
import { storePaths, pushStatusEvent, writeHeartbeat } from "../src/store.mjs";
import { setAsleep, nextWakeAt10amHst, discordStamp } from "../src/sleepMode.mjs";
import { postAvaDiscord, postAvaSlack, postAvaTelegram } from "../src/avaPost.mjs";
import { makeFetchJson, sendDm } from "../src/discordApi.mjs";
import { notifyAlexDreaming } from "../src/offlineNotes.mjs";
import { isTelegramChannelId } from "../src/telegramApi.mjs";
import { isSlackChannelId } from "../src/slackGateway.mjs";
import { allowsUnsolicitedPost } from "../src/channelPolicy.mjs";

const WINDOW_MS = 10 * 60 * 60 * 1000;
const MSG = "powering down for the night — gn lov";

const SKIP = new Set(["training"]);

function recentChannels() {
  const log = path.join(storePaths().dir, "logs", "outbound.jsonl");
  const cut = Date.now() - WINDOW_MS;
  const by = new Map();
  for (const line of fs.readFileSync(log, "utf8").trim().split(/\n+/)) {
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    if (!m?.at || m.at < cut) continue;
    const ch = String(m.channelId || "");
    if (!ch || SKIP.has(ch) || ch.startsWith("rcon:")) continue;
    // Skip #admins unsolicited; DMs / TG / Slack always ok for this blast
    if (
      !ch.startsWith("dm:") &&
      !isTelegramChannelId(ch) &&
      !isSlackChannelId(ch) &&
      !allowsUnsolicitedPost(ch)
    ) {
      continue;
    }
    const prev = by.get(ch);
    if (!prev || m.at > prev.at) by.set(ch, { at: m.at, channelId: ch });
  }
  return [...by.values()].sort((a, b) => b.at - a.at);
}

await loadEnv();
storePaths();

const wake = nextWakeAt10amHst();
const state = setAsleep({
  reason: "operator — powering down for the night · gn lov",
  by: "cli-night-blast",
  wakeAt: wake,
});
writeHeartbeat({ live: true, mode: "sleep", asleep: true });
pushStatusEvent(`night power-down · wake ${state.wakeAtIso} · gn lov`);

const channels = recentChannels();
const results = [];

for (const { channelId } of channels) {
  try {
    if (channelId.startsWith("dm:")) {
      const userId = channelId.slice(3);
      const env = await loadEnv();
      const token = botToken(env);
      const msg = await sendDm(makeFetchJson(token), userId, MSG);
      results.push({ channelId, ok: true, id: msg?.id || null, surface: "discord-dm" });
    } else if (isTelegramChannelId(channelId)) {
      const msg = await postAvaTelegram({
        chatId: channelId,
        content: MSG,
        kind: "operator_directed",
        source: "night-powerdown-blast",
      });
      results.push({ channelId, ok: true, id: msg?.id || null, surface: "telegram" });
    } else if (isSlackChannelId(channelId)) {
      const data = await postAvaSlack({
        channelId,
        content: MSG,
        kind: "operator_directed",
        source: "night-powerdown-blast",
      });
      results.push({ channelId, ok: true, id: data?.ts || null, surface: "slack" });
    } else {
      const msg = await postAvaDiscord({
        channelId,
        content: MSG,
        kind: "operator_directed",
        source: "night-powerdown-blast",
      });
      results.push({ channelId, ok: true, id: msg?.id || null, surface: "discord" });
    }
    console.log("ok", channelId);
  } catch (err) {
    results.push({ channelId, ok: false, error: err.message });
    console.warn("fail", channelId, err.message);
  }
}

try {
  const env = await loadEnv();
  const token = botToken(env);
  await notifyAlexDreaming(makeFetchJson(token), {
    reason: `powering down for the night — gn lov · soft sleep til ~10am HST (${discordStamp(state.wakeAt)})`,
    kind: "sleep",
    wakeAt: state.wakeAt,
  });
  console.log("alex dream dm ok");
} catch (err) {
  console.warn("alex dream dm:", err.message);
}

// Gold mine → normal 1.0× while host is off for the night
try {
  const { buildHostSiteHourlyBlock, pushHostSiteTelemetry } = await import(
    "../src/hostSite.mjs"
  );
  const env = await loadEnv();
  const block = await buildHostSiteHourlyBlock({ refreshPower: false });
  const push = await pushHostSiteTelemetry(env, block.payload);
  console.log("mining offline push", push);
} catch (err) {
  console.warn("mining offline push:", err.message);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      message: MSG,
      asleep: true,
      wakeAtIso: state.wakeAtIso,
      posted: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    },
    null,
    2,
  ),
);
