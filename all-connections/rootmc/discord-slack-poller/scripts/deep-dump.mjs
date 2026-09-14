#!/usr/bin/env node
/**
 * Manual /deep dump (same engine as Telegram /deep).
 * Usage: node scripts/deep-dump.mjs [delta|full] [--send]
 */
import fs from "node:fs";
import path from "node:path";
import {
  runDeepDump,
  buildDeepDumpArchives,
  deliverDeepDumpToTelegram,
} from "../src/deepDump.mjs";
import { storePaths } from "../src/store.mjs";

const args = process.argv.slice(2);
const send = args.includes("--send");
const arg = String(args.find((a) => !a.startsWith("-")) || "delta").toLowerCase();
if (arg === "status") {
  const p = path.join(storePaths().dir, "deep-dump.json");
  if (fs.existsSync(p)) console.log(fs.readFileSync(p, "utf8"));
  else console.log("No deep-dump.json yet.");
  process.exit(0);
}

const mode = arg === "full" ? "full" : "delta";
console.log(`Running deep dump (${mode})…`);
const result = await runDeepDump({
  mode,
  progress: (line) => console.log(line),
});
console.log("\n--- SUMMARY ---\n");
console.log(result.summaryText);
console.log("\nReport:", result.reportDir);

if (send) {
  console.log("\nSending summary + zip to Telegram…");
  const delivered = await deliverDeepDumpToTelegram({
    summaryText: result.summaryText,
    reportDir: result.reportDir,
    stamp: result.stamp,
    mode,
  });
  console.log("Sent:", delivered.archives.join(", "));
} else {
  const archives = buildDeepDumpArchives(result.reportDir, result.stamp);
  console.log("\nZip(s):");
  for (const a of archives) {
    console.log(`  ${a.path} (${a.label})`);
  }
}
