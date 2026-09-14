#!/usr/bin/env node
/**
 * End-of-phase Ava catch-up (daily plan / Absolute Ops style).
 * Usage:
 *   node scripts/phase-catchup.mjs [label]
 *   node scripts/phase-catchup.mjs channel-scan-all
 *   node scripts/phase-catchup.mjs phase-x --all
 */
import { runPhaseCatchup } from "../src/phaseCatchup.mjs";

const raw = process.argv.slice(2);
const allFlag = raw.some((a) => a === "--all" || a === "-a");
const labelParts = raw.filter((a) => a !== "--all" && a !== "-a");
const label = labelParts.join(" ").trim() || "manual";
const allChannels = allFlag || /^channel-scan-all$/i.test(label);

const result = await runPhaseCatchup({
  label,
  force: true,
  allChannels,
});
if (!result.ok) {
  console.error(result);
  process.exit(1);
}
process.exit(0);
