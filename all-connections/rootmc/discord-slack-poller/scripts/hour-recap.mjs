#!/usr/bin/env node
/**
 * Manual / forced Ava hour recap.
 *   node scripts/hour-recap.mjs
 *   node scripts/hour-recap.mjs --force
 *   node scripts/hour-recap.mjs --dry
 */
import { runHourRecap } from "../src/hourRecap.mjs";

const args = new Set(process.argv.slice(2));
const force = args.has("--force") || args.has("-f");
const dry = args.has("--dry");

const result = await runHourRecap({ force: force || dry, skipPost: dry });
console.log(JSON.stringify(result, null, 2));
if (!result.ok && !result.skipped) process.exitCode = 1;
