#!/usr/bin/env node
/**
 * Empty all Cloudflare Worker cron triggers (RootMC + Root Record accounts).
 * Ava cronRunner becomes the only scheduler.
 * Usage: node scripts/disable-cf-crons.mjs [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AVA_HANDOFF = process.env.AVA_HANDOFF || path.resolve(__dirname, "../..");
const dryRun = process.argv.includes("--dry-run");

function loadEnv() {
  const envPath = path.join(AVA_HANDOFF, ".env");
  const out = { ...process.env };
  if (!fs.existsSync(envPath)) return out;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (out[k] == null || out[k] === "") out[k] = v;
  }
  return out;
}

async function cf(env, url, { method = "GET", body } = {}) {
  const headers = {
    "content-type": "application/json",
    "X-Auth-Email": env.CLOUDFLARE_EMAIL,
    "X-Auth-Key": env.CLOUDFLARE_GLOBAL_API_KEY,
  };
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok && json.success !== false, status: res.status, json };
}

async function main() {
  const env = loadEnv();
  const accounts = (
    await cf(env, "https://api.cloudflare.com/client/v4/accounts?per_page=50")
  ).json.result;
  console.log(
    "accounts",
    accounts.map((a) => a.name),
  );

  const report = [];
  for (const acct of accounts) {
    const scripts = (
      await cf(
        env,
        `https://api.cloudflare.com/client/v4/accounts/${acct.id}/workers/scripts`,
      )
    ).json.result;
    for (const s of scripts || []) {
      const name = s.id;
      const sch = await cf(
        env,
        `https://api.cloudflare.com/client/v4/accounts/${acct.id}/workers/scripts/${name}/schedules`,
      );
      let schedules = sch.json.result || [];
      if (schedules && !Array.isArray(schedules) && schedules.schedules) {
        schedules = schedules.schedules;
      }
      const crons = (schedules || []).map((x) => x.cron || x).filter(Boolean);
      if (!crons.length) continue;
      console.log(`${acct.name} / ${name}: ${crons.join(", ")}`);
      if (dryRun) {
        report.push({ account: acct.name, worker: name, crons, action: "dry-run" });
        continue;
      }
      // PUT empty schedules
      const put = await cf(
        env,
        `https://api.cloudflare.com/client/v4/accounts/${acct.id}/workers/scripts/${name}/schedules`,
        { method: "PUT", body: [] },
      );
      console.log("  cleared →", put.ok, put.status, JSON.stringify(put.json?.errors || put.json?.result || "").slice(0, 200));
      report.push({
        account: acct.name,
        worker: name,
        crons,
        cleared: put.ok,
        status: put.status,
      });
    }
  }

  const outDir = path.join(AVA_HANDOFF, "core", "data", "cron");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, `cf-crons-disabled-${Date.now()}.json`),
    JSON.stringify({ dryRun, at: new Date().toISOString(), report }, null, 2),
  );
  console.log(JSON.stringify({ dryRun, cleared: report.length }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
