/**
 * Cron job catalog — Ava invokes these instead of Cloudflare Worker schedules.
 * During soft-ack, most jobs HTTP-trigger Worker internal routes / scheduled-equivalent POSTs.
 * Idempotent gates use watermarks + server-side skip logic.
 */
import fs from "node:fs";
import path from "node:path";
import { AVA_HANDOFF } from "./config.mjs";
import { runMembershipCoreSyncCron } from "./membershipSync.mjs";

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
    ) {
      v = v.slice(1, -1);
    }
    if (out[k] == null || out[k] === "") out[k] = v;
  }
  return out;
}

function localApiBase(env) {
  return String(env.AVA_LOCAL_API_BASE || "http://127.0.0.1:8791").replace(/\/$/, "");
}

function rootmcApi(env) {
  return String(
    env.AVA_ROOTMC_API_BASE ||
      env.ROOTMC_API_URL ||
      env.ROOTMC_API_BASE ||
      env.AVA_API_BASE ||
      "https://api.rootmc.net",
  ).replace(/\/$/, "");
}

function rootrecordApi(env) {
  return String(
    env.ROOTRECORD_ACCOUNT_API_URL ||
      env.AVA_ROOTRECORD_ACCOUNT_API ||
      env.AVA_ROOTRECORD_API_BASE ||
      "https://rootrecord-api-account.rootrecord.workers.dev",
  ).replace(/\/$/, "");
}

function solanaTxApi(env) {
  return String(
    env.ROOTRECORD_SOLANA_TX_URL ||
      "https://rootrecord-solana-tx.rootrecord.workers.dev",
  ).replace(/\/$/, "");
}

async function fetchJson(url, { method = "GET", headers = {}, body, timeoutMs = 120_000 } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body != null ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
      signal: ac.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 500) };
    }
    return { ok: res.ok, status: res.status, json, text: text.slice(0, 800) };
  } finally {
    clearTimeout(t);
  }
}

async function postLocalCron(env, jobPath, body = {}) {
  const base = localApiBase(env);
  return fetchJson(`${base}/internal/cron/${jobPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-ava-cron-key": env.AVA_CRON_KEY || env.ROOTMC_DEV_WORKSTATION_KEY || "",
    },
    body,
  });
}

async function postRootMcDev(env, subPath, body = {}) {
  const key = env.ROOTMC_DEV_WORKSTATION_KEY || env.ROOTMC_INTERNAL_API_KEY || "";
  return fetchJson(`${rootmcApi(env)}${subPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-RootMC-Dev-Key": key,
    },
    body,
  });
}

async function postRrAdmin(env, base, subPath, body = {}) {
  const key = env.RR_PUSH_ADMIN_SECRET || "";
  return fetchJson(`${base}${subPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-RR-Push-Admin-Key": key,
    },
    body,
  });
}

/** HST offset = UTC-10 (no DST). */
export function hstParts(d = new Date()) {
  const utc = d.getTime() + d.getTimezoneOffset() * 60_000;
  const hst = new Date(utc - 10 * 3600_000);
  return {
    y: hst.getUTCFullYear(),
    m: hst.getUTCMonth() + 1,
    day: hst.getUTCDate(),
    hour: hst.getUTCHours(),
    minute: hst.getUTCMinutes(),
    dow: hst.getUTCDay(), // 0 Sun
  };
}

/**
 * @typedef {{ id: string, everyMs?: number, cronHint?: string, catchup?: boolean, run: (ctx: any) => Promise<any> }} CronJob
 */

/** @type {CronJob[]} */
export const CRON_JOBS = [
  {
    id: "membership-core-sync",
    everyMs: 2 * 60_000,
    cronHint: "*/2 * * * *",
    catchup: true,
    async run({ env, force }) {
      // Same-core Pro/life parity (Root Record ↔ RootMC via Discord link)
      return runMembershipCoreSyncCron({ env, force });
    },
  },
  {
    id: "rr-minute-suite",
    everyMs: 60_000,
    cronHint: "* * * * *",
    catchup: true,
    async run({ env }) {
      return postLocalCron(env, "rr-minute-suite", { reason: "ava-cron" });
    },
  },
  {
    id: "rr-noaa",
    everyMs: 5 * 60_000,
    cronHint: "*/5 * * * *",
    catchup: true,
    async run({ env }) {
      return postLocalCron(env, "rr-noaa", { reason: "ava-cron" });
    },
  },
  {
    id: "rr-kilauea",
    everyMs: 10 * 60_000,
    cronHint: "*/10 * * * *",
    catchup: true,
    async run({ env }) {
      return postLocalCron(env, "rr-kilauea", { reason: "ava-cron" });
    },
  },
  {
    id: "rootmc-ops-10m",
    everyMs: 10 * 60_000,
    cronHint: "*/10 * * * *",
    catchup: true,
    async run({ env }) {
      return postLocalCron(env, "rootmc-ops-10m", { reason: "ava-cron" });
    },
  },
  {
    id: "rootmc-hourly",
    everyMs: 60 * 60_000,
    cronHint: "0 * * * *",
    catchup: true,
    async run({ env }) {
      return postLocalCron(env, "rootmc-hourly", { reason: "ava-cron" });
    },
  },
  {
    id: "rootmc-weekly",
    everyMs: 60 * 60_000, // check hourly; gate inside
    cronHint: "0 18 * * 1",
    catchup: true,
    async run({ env }) {
      const h = hstParts();
      // Sun 08:00 HST onwards — local API idempotent
      if (!(h.dow === 0 && h.hour >= 8)) {
        return { ok: true, status: 200, json: { skipped: true, reason: "not_weekly_window" } };
      }
      return postLocalCron(env, "rootmc-weekly", { reason: "ava-cron" });
    },
  },
  {
    id: "rr-inactive-cleanup",
    everyMs: 60 * 60_000,
    cronHint: "45 8 * * *",
    catchup: true,
    async run({ env }) {
      const d = new Date();
      if (!(d.getUTCHours() === 8 && d.getUTCMinutes() >= 45 && d.getUTCMinutes() < 55)) {
        return { ok: true, status: 200, json: { skipped: true, reason: "not_0845_utc" } };
      }
      return postLocalCron(env, "rr-inactive-cleanup", { reason: "ava-cron" });
    },
  },
  {
    id: "rr-stripe-reconcile",
    everyMs: 60_000,
    cronHint: "17 9 * * *",
    catchup: true,
    async run({ env }) {
      const d = new Date();
      if (!(d.getUTCHours() === 9 && d.getUTCMinutes() === 17)) {
        return { ok: true, status: 200, json: { skipped: true, reason: "not_0917_utc" } };
      }
      return postLocalCron(env, "rr-stripe-reconcile", { reason: "ava-cron" });
    },
  },
  {
    id: "rrtt-custodial-payout",
    everyMs: 60 * 60_000,
    cronHint: "0 7 * * *",
    catchup: true,
    async run({ env }) {
      const d = new Date();
      if (!(d.getUTCHours() === 7 && d.getUTCMinutes() < 10)) {
        return { ok: true, status: 200, json: { skipped: true, reason: "not_0700_utc" } };
      }
      return postRrAdmin(env, rootrecordApi(env), "/api/internal/run-rrtt-custodial-cron", {
        reason: "ava-cron",
      });
    },
  },
  {
    id: "treasury-sol-lp",
    everyMs: 5 * 60_000,
    cronHint: "*/5 * * * * (:00 SOL, :10 RRTT)",
    catchup: true,
    async run({ env }) {
      const min = new Date().getUTCMinutes();
      const base = solanaTxApi(env);
      if (min % 5 !== 0) {
        return { ok: true, status: 200, json: { skipped: true, reason: "not_5m_boundary" } };
      }
      if (min === 0) {
        return postRrAdmin(env, base, "/api/internal/run-treasury-sol-lp-check", {
          reason: "ava-cron",
        });
      }
      if (min === 10) {
        return postRrAdmin(env, base, "/api/internal/run-treasury-liquidity-check", {
          reason: "ava-cron",
        });
      }
      return { ok: true, status: 200, json: { skipped: true, reason: "not_sol_or_liq_slot" } };
    },
  },
];

export function getEnv() {
  return loadEnv();
}

export { postLocalCron, postRootMcDev, postRrAdmin, rootmcApi, rootrecordApi, solanaTxApi };
