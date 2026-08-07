/**
 * Put Ava to sleep until next 10:00 HST (dreaming / summons-only).
 * Usage: node scripts/sleep-ava.mjs [reason]
 */
import { loadEnv } from "../src/config.mjs";
import { storePaths, pushStatusEvent } from "../src/store.mjs";
import {
  setAsleep,
  nextWakeAt10amHst,
  discordStamp,
  loadSleepState,
} from "../src/sleepMode.mjs";

await loadEnv();
storePaths();
const reason = process.argv.slice(2).join(" ").trim() || "goodnight";
const wake = nextWakeAt10amHst();
const state = setAsleep({ reason, by: "cli", wakeAt: wake });
console.log(
  JSON.stringify(
    {
      ok: true,
      asleep: true,
      wakeAtIso: state.wakeAtIso,
      wakeDiscord: discordStamp(state.wakeAt),
      state: loadSleepState(),
    },
    null,
    2,
  ),
);
pushStatusEvent(`cli sleep · ${state.wakeAtIso}`);
