/**
 * Daily error/warn digest → Telegram operator.
 * Combines ops/actions index + journal (ava-ivy) skim; filters Discord ack-react spam.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { AVA_HANDOFF, telegramBotToken, loadEnv } from "./config.mjs";
import { telegramSendMessage } from "./telegramApi.mjs";
import { storePaths } from "./store.mjs";
import { syncLogIndex, queryLogIndex } from "./logIndex.mjs";
import { rotateHotLogs } from "./logRotate.mjs";
import { logOps } from "./logOps.mjs";

function statePath() {
  return path.join(storePaths().dir, "error-digest.json");
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return { lastDay: "", lastAt: 0 };
  }
}

function saveState(s) {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(s, null, 2), "utf8");
}

function hstDayKey(d = new Date()) {
  return d.toLocaleDateString("en-CA", { timeZone: "Pacific/Honolulu" });
}

function opsChatId() {
  return String(
    process.env.AVA_TELEGRAM_OPERATOR_CHAT_ID ||
      process.env.AVA_TELEGRAM_OPERATOR_IDS ||
      "6644482344",
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)[0];
}

function isNoise(row) {
  const blob = `${row.type || ""} ${row.error || ""} ${row.summary || ""}`.toLowerCase();
  if (/ack\.react|discord ack react/.test(blob) && /tg:|not snowflake|invalid form body/.test(blob)) {
    return true;
  }
  if (/rate limited/.test(blob) && /ack\.react|reactions/.test(blob)) return true;
  if (/experimentalsqlite|experimentalwarning/.test(blob)) return true;
  // High-volume RCON flight rows without an error string are not digest-worthy
  if (/^flight\.rcon$/i.test(String(row.type || "")) && !row.error) return true;
  if (/^log\.index$/i.test(String(row.type || "")) && row.level === "debug") return true;
  return false;
}

function journalSkim() {
  try {
    const out = execFileSync(
      "journalctl",
      ["-u", "ava-ivy.service", "-u", "ava-local-api.service", "--since", "24 hours ago", "-n", "200", "--no-pager"],
      { encoding: "utf8", timeout: 15_000 },
    );
    const lines = out.split(/\r?\n/).filter(Boolean);
    const hits = lines.filter((l) => {
      if (!/error|fail|exception|fatal|warn/i.test(l)) return false;
      if (/ack react|not snowflake|rate limited|ExperimentalWarning/i.test(l)) return false;
      return true;
    });
    return hits.slice(-12);
  } catch (err) {
    return [`journal skim unavailable: ${err.message}`];
  }
}

export async function runErrorDigest({ env = {}, force = false } = {}) {
  try {
    if (!telegramBotToken(env) && !telegramBotToken(process.env)) {
      env = { ...process.env, ...(await loadEnv()), ...env };
    } else {
      env = { ...process.env, ...env };
    }
  } catch {
    env = { ...process.env, ...env };
  }
  const day = hstDayKey();
  const prev = loadState();
  if (!force && prev.lastDay === day) {
    return { skipped: true, reason: "already_ran_today", day };
  }

  // Maintain index + rotate as part of daily hygiene
  let rotate = { rotated: [] };
  let index = { ingested: 0 };
  try {
    rotate = rotateHotLogs();
  } catch (err) {
    logOps({ type: "log.rotate", level: "warn", error: err.message, ok: false });
  }
  try {
    index = syncLogIndex();
  } catch (err) {
    logOps({ type: "log.index", level: "warn", error: err.message, ok: false });
  }

  const sinceMs = Date.now() - 24 * 60 * 60 * 1000;
  const rows = queryLogIndex({ sinceMs, levels: ["error", "warn"], limit: 60 }).filter(
    (r) => !isNoise(r),
  );
  const journal = journalSkim();

  const lines = [
    `Ava error digest (${day} HST)`,
    `index+${index.ingested || 0} · rotated=${(rotate.rotated || []).length}`,
    `warn/error (24h, de-noised): ${rows.length}`,
  ];
  for (const r of rows.slice(0, 12)) {
    const when = new Date(r.at).toLocaleString("en-US", { timeZone: "Pacific/Honolulu", hour12: false });
    lines.push(
      `• ${when} [${r.level}] ${r.type}${r.job_id ? ` · ${r.job_id}` : ""}${r.status != null ? ` · HTTP ${r.status}` : ""}`,
    );
    if (r.error) lines.push(`  ${String(r.error).slice(0, 140)}`);
  }
  if (journal.length) {
    lines.push("", "journal:");
    for (const j of journal.slice(0, 6)) lines.push(`- ${j.slice(0, 160)}`);
  }
  if (!rows.length && journal.every((j) => /unavailable/.test(j))) {
    lines.push("", "quiet night — no structured warn/error.");
  }

  const text = lines.join("\n").slice(0, 3500);
  const chatId = opsChatId();
  const sendEnv = { ...process.env, ...env };
  let sent = false;
  if (chatId && telegramBotToken(sendEnv)) {
    try {
      await telegramSendMessage(chatId, text, { env: sendEnv });
      sent = true;
    } catch (err) {
      logOps({ type: "errorDigest.tg", level: "warn", error: err.message, ok: false });
    }
  } else if (chatId) {
    logOps({
      type: "errorDigest.tg",
      level: "warn",
      error: "telegram_not_configured",
      ok: false,
    });
  }

  saveState({ lastDay: day, lastAt: Date.now(), rows: rows.length, sent });
  logOps({
    type: "errorDigest",
    level: "info",
    ok: true,
    meta: { day, rows: rows.length, sent, rotated: (rotate.rotated || []).length },
  });
  return { ok: true, day, rows: rows.length, sent, text };
}
