#!/usr/bin/env node
/**
 * Idempotent offline catch-up — run after local API is up / before enabling steady crons.
 * Usage: node scripts/ava-core-catchup.mjs
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CRON_JOBS, getEnv, postLocalCron, postRrAdmin, rootrecordApi, solanaTxApi } from "../src/cronJobs.mjs";
import { recordCatchupReport } from "../src/cronWatermarks.mjs";
import { runCronJobNow } from "../src/cronRunner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CATCHUP_ORDER = [
  "rootmc-ops-10m",
  "rootmc-hourly",
  "rootmc-weekly",
  "rr-minute-suite",
  "rr-stripe-reconcile",
  "rr-noaa",
  "rr-kilauea",
  "rr-inactive-cleanup",
  "rrtt-custodial-payout",
  "treasury-sol-lp",
];

async function forceMissedMoney(env) {
  const out = [];
  // Always attempt RRTT + treasury on catch-up (they had no CF cron)
  out.push({
    id: "rrtt-custodial-payout-force",
    ...(await postRrAdmin(env, rootrecordApi(env), "/api/internal/run-rrtt-custodial-cron", {
      reason: "ava-catchup",
    })),
  });
  const base = solanaTxApi(env);
  out.push({
    id: "treasury-sol-lp-force",
    ...(await postRrAdmin(env, base, "/api/internal/run-treasury-sol-lp-check", {
      reason: "ava-catchup",
    })),
  });
  out.push({
    id: "treasury-liquidity-force",
    ...(await postRrAdmin(env, base, "/api/internal/run-treasury-liquidity-check", {
      reason: "ava-catchup",
    })),
  });
  return out;
}

async function main() {
  const env = getEnv();
  const startedAt = Date.now();
  console.log("ava-core-catchup starting…");

  // Health local API
  let localOk = false;
  try {
    const r = await fetch(`${String(env.AVA_LOCAL_API_BASE || "http://127.0.0.1:8791").replace(/\/$/, "")}/health`);
    localOk = r.ok;
    console.log("local-api health", r.status);
  } catch (err) {
    console.warn("local-api not up yet:", err.message);
  }

  const results = [];

  if (localOk) {
    const boot = await postLocalCron(env, "catchup-boot", { reason: "ava-catchup" });
    results.push({ id: "catchup-boot", ...boot });
  }

  for (const id of CATCHUP_ORDER) {
    const job = CRON_JOBS.find((j) => j.id === id);
    if (!job?.catchup) continue;
    console.log("catchup job", id);
    // Bypass time gates for catch-up via local force endpoints where possible
    if (localOk && id.startsWith("rootmc-")) {
      const r = await postLocalCron(env, id, { reason: "ava-catchup", force: true });
      results.push({ id, ok: r.ok, status: r.status, json: r.json });
      continue;
    }
    if (localOk && id.startsWith("rr-") && id !== "rrtt-custodial-payout") {
      const r = await postLocalCron(env, id, { reason: "ava-catchup", force: true });
      results.push({ id, ok: r.ok, status: r.status, json: r.json });
      continue;
    }
    const r = await runCronJobNow(id, { reason: "ava-catchup" });
    results.push({ id, ok: r.ok, error: r.error, json: r.result?.json });
  }

  const money = await forceMissedMoney(env);
  results.push(...money.map((m) => ({ id: m.id, ok: m.ok, status: m.status, json: m.json })));

  const finishedAt = Date.now();
  const ok = results.every((r) => r.ok || r.json?.skipped);
  const report = {
    startedAt,
    finishedAt,
    ok,
    localApi: localOk,
    results,
  };
  await recordCatchupReport(report);
  console.log(JSON.stringify({ ok, count: results.length, ms: finishedAt - startedAt }, null, 2));
  for (const r of results) {
    console.log(` - ${r.id}: ok=${r.ok} status=${r.status || ""} ${(r.error || "").slice(0, 80)}`);
  }
  process.exit(ok ? 0 : 2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
