/**
 * Silent-archive finished proposal forum threads — no Ava posts.
 * Usage: node scripts/silent-close-props.mjs [id ...]
 * Default: greenlights finished set (keeps Linux open).
 */
import { loadEnv, botToken, AVA_CHANNELS } from "../src/config.mjs";
import { makeFetchJson } from "../src/discordApi.mjs";
import { appendAction } from "../src/fullLog.mjs";

const DEFAULT_CLOSE = [
  "1533536738931376400", // Ava-Core
  "1533371785477619762", // X social
  "1533371398217535769", // finance
  "1533217415343640759", // world rendering
  "1533215970145865939", // upgrade
];

const KEEP_OPEN = new Set(["1533183979778478241"]); // Linux cutover

async function silentArchive(fetchJson, channelId) {
  if (KEEP_OPEN.has(channelId)) {
    return { id: channelId, skipped: true, reason: "keep_open" };
  }
  const patched = await fetchJson(`/channels/${channelId}`, {
    method: "PATCH",
    body: JSON.stringify({ archived: true, locked: true }),
  });
  return {
    id: channelId,
    archived: Boolean(patched?.thread_metadata?.archived),
    locked: Boolean(patched?.thread_metadata?.locked),
  };
}

const ids = process.argv.slice(2).filter(Boolean);
const list = ids.length ? ids : DEFAULT_CLOSE;

const env = await loadEnv();
const f = makeFetchJson(botToken(env));
const results = [];
for (const id of list) {
  try {
    results.push(await silentArchive(f, id));
    console.log("closed", id, results[results.length - 1]);
  } catch (err) {
    console.warn("fail", id, err.message);
    results.push({ id, ok: false, error: err.message });
  }
}

// Optional: archive #voting twins that look like open votes for those titles — skip posting
try {
  const voteMsgs = await f(
    `/channels/${AVA_CHANNELS.voting}/messages?limit=40`,
  );
  for (const m of voteMsgs || []) {
    const c = String(m.content || "");
    if (!/\*\*\s*(VOTE|PROP)\b/i.test(c)) continue;
    // Don't create threads — voting is usually a channel message, not a thread
  }
} catch {
  /* ignore */
}

appendAction("silentCloseProps", { results });
console.log(JSON.stringify({ ok: true, results }, null, 2));
