#!/usr/bin/env node
/**
 * Soft-ack complete → delete API Workers (NOT Pages).
 * Run only after api.* DNS points at Ava tunnel and local-api is healthy for 7+ days.
 * Usage: node scripts/undeploy-api-workers.mjs [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AVA_HANDOFF = process.env.AVA_HANDOFF || path.resolve(__dirname, "../..");
const dry = process.argv.includes("--dry-run");

function loadEnv() {
  const out = { ...process.env };
  const p = path.join(AVA_HANDOFF, ".env");
  if (!fs.existsSync(p)) return out;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#") || !t.includes("=")) continue;
    const i = t.indexOf("=");
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    if (out[k] == null || out[k] === "") out[k] = v;
  }
  return out;
}

async function cf(env, url, { method = "GET", email, key, token, body } = {}) {
  const headers = { "content-type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  else {
    headers["X-Auth-Email"] = email;
    headers["X-Auth-Key"] = key;
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
}

const WORKERS = {
  rootmc: ["rootmc-api", "rootmc-webstat-proxy"],
  rootrecord: [
    "rootrecord-api-account",
    "rootrecord-api-weather",
    "rootrecord-api-kilauea",
    "rootrecord-solana-tx",
    "rootrecord-primary",
    "rootrecord-api-token",
    "rootrecord-api-business",
    "rootrecord-api-goals",
  ],
};

async function main() {
  const env = loadEnv();
  const accounts =
    (
      await cf(env, "https://api.cloudflare.com/client/v4/accounts?per_page=50", {
        email: env.CLOUDFLARE_EMAIL,
        key: env.CLOUDFLARE_GLOBAL_API_KEY,
      })
    ).json.result || [];
  const rr = accounts.find((a) => /outlook/i.test(a.name || ""));
  const report = [];
  const rootmcId = env.ROOTMC_CLOUDFLARE_ACCOUNT_ID || env.CLOUDFLARE_ACCOUNT_ID;

  for (const name of WORKERS.rootmc) {
    if (dry) {
      report.push({ account: "rootmc", name, action: "dry-run-delete" });
      continue;
    }
    const url = `https://api.cloudflare.com/client/v4/accounts/${rootmcId}/workers/scripts/${name}`;
    const r = await cf(env, url, { method: "DELETE", token: env.CLOUDFLARE_API_TOKEN });
    report.push({ account: "rootmc", name, ok: r.ok, status: r.status });
  }

  if (rr) {
    for (const name of WORKERS.rootrecord) {
      if (dry) {
        report.push({ account: "rootrecord", name, action: "dry-run-delete" });
        continue;
      }
      const url = `https://api.cloudflare.com/client/v4/accounts/${rr.id}/workers/scripts/${name}`;
      const r = await cf(env, url, {
        method: "DELETE",
        email: env.CLOUDFLARE_EMAIL,
        key: env.CLOUDFLARE_GLOBAL_API_KEY,
      });
      report.push({ account: "rootrecord", name, ok: r.ok, status: r.status });
    }
  }

  const out = path.join(AVA_HANDOFF, "core", "data", "cron", `undeploy-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ dry, at: new Date().toISOString(), report }, null, 2));
  console.log(JSON.stringify({ dry, count: report.length, out }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
