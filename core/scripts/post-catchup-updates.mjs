/**
 * Catch-up summary → #updates (1520665313631408251)
 */
import {
  loadEnv,
  botToken,
  AVA_CHANNELS,
} from "../src/config.mjs";
import { makeFetchJson, postMessage } from "../src/discordApi.mjs";
import { listJobs } from "../src/jobQueue.mjs";
import { storePaths } from "../src/store.mjs";

const env = await loadEnv();
storePaths();
const token = botToken(env);
const fetchJson = makeFetchJson(token);

const channelId = AVA_CHANNELS.updates || "1520665313631408251";
const jobs = listJobs(20);
const blocked = jobs.filter((j) => j.status === "blocked");

const body = [
  "## Ava catch-up — live again",
  "",
  "**Channels:** scanned watch list + #updates + open proposal threads. No unanswered text @asks left.",
  "**Unpaused:** not QUIET · not emergency-stopped · hot (not stuck on break).",
  "**Liveness:** parent watchdog respawns `server`/`poller`; `/health` exposes degraded + gateway + child restarts; host load throttles digs (never kills the process).",
  "**Discord portal:** app + bot are **Ava Ivy**; Server Members Intent **on** (join welcome DMs armed).",
  "",
  "**Staged (handoffs — still need your FileZilla + Shockbyte):**",
  "• `root-core-1.7.6` (no leftover root-discord jar)",
  "• `root-skills-1.0.1` (mcMMO still present until Test→live cutover)",
  "",
  "**Still vote-blocked (won't implement until pass):**",
  ...blocked.map((j) => `• \`${j.id}\` — ${j.title}`),
  "",
  "**Human still:** FileZilla upload + Shockbyte restart · skills migrate on Test first · then live mcMMO drop.",
  "",
  "_Posted by Ava Ivy after catch-up pass._",
].join("\n");

const msg = await postMessage(fetchJson, channelId, body);
console.log("posted", channelId, msg?.id || msg);