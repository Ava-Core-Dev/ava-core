/**
 * CLI: incremental Discord+Slack dumps → text files + Telegram.
 *   node scripts/dump-channels-incremental.mjs
 *   node scripts/dump-channels-incremental.mjs --seed
 */
import {
  runIncrementalChannelDump,
  seedChannelDumpWatermarks,
} from "../src/channelDump.mjs";

const seed = process.argv.includes("--seed");
if (seed) {
  const wm = await seedChannelDumpWatermarks();
  console.log(
    "seeded",
    "discord",
    Object.keys(wm.discord || {}).length,
    "slack",
    Object.keys(wm.slack || {}).length,
  );
  process.exit(0);
}

const result = await runIncrementalChannelDump();
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
