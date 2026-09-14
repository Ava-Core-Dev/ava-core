/**
 * Post TEST monthly Activity Dividend report to #economy-guide (no payouts queued).
 * Tries Worker API first; falls back to D1 + Grok + Discord locally.
 *
 * Usage:
 *   node scripts/post-rootmc-monthly-dividend-test.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { loadRootMcEnv, rootMcBotToken } from "./lib/rootmc-env.mjs";
import { readCloudYml } from "./lib/rootmc-paths.mjs";

const API = "https://discord.com/api/v10";
const ROOTMC_API = process.env.ROOTMC_API_URL || "https://api.rootmc.info";
const ECONOMY_CHANNEL = "1516804780884889621";
const D1_DATABASE_ID = "6cf71128-67e3-47b2-a802-d6c23d6489e0";
const CF_ACCOUNT_ID = "f3372b30093435bacc35b69972abeb2e";
const HST_OFFSET_MS = 10 * 60 * 60 * 1000;
const MIN_DIVIDEND_SECONDS = 20 * 3600;
const PAYOUT_RATIO = 0.5;
const INFLOW_TYPES = ["OPENING", "TAX", "DEATH", "TOWNY_SINK", "LOAN_PRINCIPAL", "LOAN_INTEREST"];
const OUTFLOW_TYPES = ["GRANT", "DIVIDEND", "LOAN_DISBURSE", "VOTE"];

const env = loadRootMcEnv();
const token = rootMcBotToken(env);

function str(v) {
  return String(v ?? "").trim();
}

function roundGold(n) {
  return Math.round(Math.max(0, Number(n) || 0) * 100) / 100;
}

function previousHstMonthKey(at = new Date()) {
  const hst = new Date(at.getTime() - HST_OFFSET_MS);
  let y = hst.getUTCFullYear();
  let m = hst.getUTCMonth();
  if (m === 0) {
    y -= 1;
    m = 11;
  } else {
    m -= 1;
  }
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

function monthLabel(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

function monthBoundsIso(monthKey) {
  const [y, m] = monthKey.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1, 10, 0, 0));
  const end = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, 10, 0, 0));
  return { start: start.toISOString(), end: end.toISOString() };
}

function formatPlaytime(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function formatGoldExact(value) {
  const n = Math.max(0, Number(value) || 0);
  return `${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} Gold`;
}

function cfToken() {
  return str(process.env.CLOUDFLARE_API_TOKEN || env.CLOUDFLARE_API_TOKEN);
}

async function d1Query(sql) {
  const cf = cfToken();
  if (cf.length < 20) throw new Error("CLOUDFLARE_API_TOKEN missing");
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${cf}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql }),
    },
  );
  const data = await res.json();
  if (!data.success) throw new Error(JSON.stringify(data.errors || data).slice(0, 400));
  return data.result?.[0]?.results || [];
}

async function resolveServerId() {
  const rows = await d1Query(`SELECT id FROM rootmc_servers WHERE featured = 1 LIMIT 1`);
  return str(rows[0]?.id);
}

async function monthPoolAmount(serverId, monthKey) {
  const { start, end } = monthBoundsIso(monthKey);
  const inList = INFLOW_TYPES.map((t) => `'${t}'`).join(",");
  const outList = OUTFLOW_TYPES.map((t) => `'${t}'`).join(",");
  const inRow = await d1Query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM rootmc_treasury_ledger
     WHERE server_id = '${serverId}' AND entry_type IN (${inList})
       AND created_at >= '${start}' AND created_at < '${end}'`,
  );
  const outRow = await d1Query(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM rootmc_treasury_ledger
     WHERE server_id = '${serverId}' AND entry_type IN (${outList})
       AND created_at >= '${start}' AND created_at < '${end}'`,
  );
  return Math.max(0, roundGold(Number(inRow[0]?.total) - Number(outRow[0]?.total)));
}

async function computePlan(serverId, monthKey) {
  const poolNet = await monthPoolAmount(serverId, monthKey);
  const pool = roundGold(poolNet * PAYOUT_RATIO);
  if (pool < 0.01) {
    return { month_key: monthKey, pool_net: poolNet, pool_distributable: 0, status: "empty", payouts: [] };
  }
  const rows = await d1Query(
    `SELECT p.minecraft_uuid, p.playtime_seconds, l.minecraft_username
     FROM rootmc_playtime_monthly p
     LEFT JOIN rootstat_minecraft_links l ON l.minecraft_uuid = p.minecraft_uuid
     WHERE p.server_id = '${serverId}' AND p.month_key = '${monthKey}'
       AND p.playtime_seconds >= ${MIN_DIVIDEND_SECONDS}`,
  );
  if (!rows.length) {
    return { month_key: monthKey, pool_net: poolNet, pool_distributable: pool, status: "no_eligible", payouts: [] };
  }
  const totalSeconds = rows.reduce((s, r) => s + Math.max(0, Math.floor(Number(r.playtime_seconds) || 0)), 0);
  const payouts = [];
  for (const row of rows) {
    const seconds = Math.max(0, Math.floor(Number(row.playtime_seconds) || 0));
    const amount = roundGold(pool * (seconds / totalSeconds));
    if (amount < 0.01) continue;
    payouts.push({
      minecraft_username: str(row.minecraft_username) || "Unknown",
      playtime_seconds: seconds,
      amount,
    });
  }
  payouts.sort((a, b) => b.amount - a.amount);
  const distributed = roundGold(payouts.reduce((s, p) => s + p.amount, 0));
  return {
    month_key: monthKey,
    pool_net: poolNet,
    pool_distributable: distributed,
    status: "ready",
    payouts,
    eligible_count: payouts.length,
    total_eligible_seconds: totalSeconds,
  };
}

function buildContext(plan) {
  return {
    report_kind: "monthly_activity_dividend",
    month_key: plan.month_key,
    month_label: monthLabel(plan.month_key),
    timezone: "Pacific/Honolulu",
    eligibility_hours_required: 20,
    payout_ratio: PAYOUT_RATIO,
    treasury_pool_net_month: plan.pool_net,
    treasury_pool_distributable: plan.pool_distributable,
    eligible_players: plan.eligible_count || plan.payouts.length,
    status: plan.status,
    payout_lines: plan.payouts.map((row, idx) => ({
      rank: idx + 1,
      minecraft_username: row.minecraft_username,
      playtime_label: formatPlaytime(row.playtime_seconds),
      amount_gold: row.amount,
      amount_label: formatGoldExact(row.amount),
    })),
    total_distributed_gold: plan.pool_distributable,
    test_mode: true,
    payouts_queued_ingame: false,
  };
}

const GROK_PROMPT =
  "Audience: RootMC players in public Discord. Currency is Gold only. " +
  "Write the monthly Activity Dividend announcement. List EVERY payout_lines entry with exact amount_label. " +
  "Sections: ## Summary, ## Treasury Pool, ## Eligibility, ## Payouts, ## Notes. " +
  "State this is a preview — no wallet credits issued. No AI self-reference. " +
  'Return JSON only: {"summary_text":"<=220 chars","report_text":"<=2400 chars markdown"}';

async function callGrok(context) {
  const grokToken = str(process.env.GROK_API_BEARER_TOKEN || env.GROK_API_BEARER_TOKEN);
  if (grokToken.length < 20) return null;
  let bearer = grokToken;
  try {
    bearer = decodeURIComponent(grokToken);
  } catch {
    /* keep */
  }
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: str(env.GROK_MODEL) || "grok-3-latest",
      messages: [
        { role: "system", content: GROK_PROMPT },
        { role: "user", content: JSON.stringify(context) },
      ],
      temperature: 0.12,
      response_format: { type: "json_object" },
    }),
  });
  const data = await res.json().catch(() => ({}));
  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function formatAppendix(plan) {
  if (plan.status === "empty") return "_No treasury inflows — Activity Dividend pool was empty._";
  if (plan.status === "no_eligible") {
    return `_Pool **${formatGoldExact(plan.pool_distributable)}** available; no players met **20 hour** requirement._`;
  }
  return plan.payouts
    .map(
      (row, idx) =>
        `${idx + 1}. **${row.minecraft_username}** — **${formatGoldExact(row.amount)}** (${formatPlaytime(row.playtime_seconds)})`,
    )
    .join("\n");
}

function splitMarkdown(text, max = 1900) {
  const chunks = [];
  let rest = text.trim();
  while (rest.length > 0) {
    if (rest.length <= max) {
      chunks.push(rest);
      break;
    }
    let cut = rest.lastIndexOf("\n\n", max);
    if (cut < max * 0.45) cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.45) cut = max;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  return chunks.filter(Boolean);
}

async function postDiscord(parts) {
  let firstId = null;
  for (const part of parts) {
    const res = await fetch(`${API}/channels/${ECONOMY_CHANNEL}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ content: part.slice(0, 2000) }),
    });
    if (!res.ok) throw new Error(`Discord ${res.status}: ${await res.text().catch(() => "")}`);
    const msg = await res.json();
    if (!firstId) firstId = msg.id;
    await new Promise((r) => setTimeout(r, 600));
  }
  return firstId;
}

async function tryWorkerApi(serverId, serverSecret) {
  const res = await fetch(`${ROOTMC_API.replace(/\/$/, "")}/api/rootmc/treasury/dividends/preview-report`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-RootStat-Server-Id": serverId,
      "X-RootStat-Server-Secret": serverSecret,
    },
    body: "{}",
  });
  if (res.status === 404) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok !== true) {
    throw new Error(`Worker API ${res.status}: ${JSON.stringify(data).slice(0, 500)}`);
  }
  return data;
}

async function runLocal(serverIdOverride) {
  if (token.length < 40) throw new Error("Need DISCORD_ROOTMC_BOT_TOKEN");
  const serverId = str(serverIdOverride) || (await resolveServerId());
  if (!serverId) throw new Error("Could not resolve server id (cloud.yml server-id or D1)");
  const monthKey = previousHstMonthKey();
  const plan = await computePlan(serverId, monthKey);
  const context = buildContext(plan);
  const grok = await callGrok(context);
  const summary = str(grok?.summary_text);
  const report = str(grok?.report_text) || formatAppendix(plan);
  const md = [
    `# Activity Dividend (TEST — no payouts issued) — ${monthLabel(monthKey)}`,
    `*${monthKey} HST*`,
    summary ? `\n> ${summary}` : "",
    "",
    report,
    "",
    "— *Preview only — wallet credits were not queued or applied*",
  ]
    .filter((x) => x !== "")
    .join("\n");
  const messageId = await postDiscord(splitMarkdown(md));
  return { monthKey, messageId, plan };
}

const cloud = readCloudYml();
const serverId = str(process.env.ROOTSTAT_SERVER_ID || env.ROOTSTAT_SERVER_ID || cloud?.serverId);
const serverSecret = str(process.env.ROOTSTAT_SERVER_SECRET || env.ROOTSTAT_SERVER_SECRET || cloud?.serverSecret);

let result;
if (serverId && serverSecret) {
  result = await tryWorkerApi(serverId, serverSecret).catch((e) => {
    console.warn("Worker API unavailable, using local fallback:", e.message);
    return null;
  });
}

if (!result) {
  console.log("Running local D1 + Grok + Discord fallback…");
  result = await runLocal(serverId);
  console.log("TEST dividend report posted (local)", result.monthKey, result.messageId);
  if (result.plan?.payouts?.length) {
    console.log(
      "Payout preview:",
      result.plan.payouts.map((p) => `${p.minecraft_username}: ${formatGoldExact(p.amount)}`).join(", "),
    );
  }
} else {
  console.log("TEST dividend report posted (Worker API)", result.monthKey, result.messageId);
}

console.log(`https://discord.com/channels/1516108585740800042/${ECONOMY_CHANNEL}/${result.messageId || ""}`);
