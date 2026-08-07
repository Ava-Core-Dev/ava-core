/**
 * Boot Telegram relay ? every stage start/complete to Alex (primary controller).
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths, pushStatusEvent } from "./store.mjs";
import { telegramBotToken, AVA_HANDOFF } from "./config.mjs";

function handoffRoot() {
  return String(
    process.env.AVA_HANDOFF ||
      AVA_HANDOFF ||
      "/home/ava-core/ava",
  ).trim();
}

/** Parse KEY=VAL from Ava /.env or ROOTMC_ENV_FILE (same pattern as mysqlCreds). */
function readEnvFileMap() {
  const candidates = [
    process.env.ROOTMC_ENV_FILE,
    path.join(handoffRoot(), ".env"),
    "/home/ava-core/ava/.env",
  ].filter(Boolean);
  const out = {};
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf8");
      for (const line of raw.split(/\r?\n/)) {
        const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
        if (!m) continue;
        out[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
      if (Object.keys(out).length) return out;
    } catch {
      /* try next */
    }
  }
  return out;
}

function resolveBotToken() {
  const fromFn = (() => {
    try {
      return telegramBotToken() || "";
    } catch {
      return "";
    }
  })();
  if (fromFn) return fromFn;
  if (process.env.AVA_TELEGRAM_BOT_TOKEN) return String(process.env.AVA_TELEGRAM_BOT_TOKEN).trim();
  if (process.env.TELEGRAM_BOT_TOKEN) return String(process.env.TELEGRAM_BOT_TOKEN).trim();
  const fileEnv = readEnvFileMap();
  return String(
    fileEnv.AVA_TELEGRAM_BOT_TOKEN || fileEnv.TELEGRAM_BOT_TOKEN || "",
  ).trim();
}

function resolveAlexChatId() {
  const fileEnv = readEnvFileMap();
  const raw = String(
    process.env.AVA_TELEGRAM_OPERATOR_CHAT_ID ||
      process.env.AVA_TELEGRAM_ALEX_CHAT_ID ||
      process.env.AVA_TELEGRAM_OPERATOR_IDS ||
      fileEnv.AVA_TELEGRAM_OPERATOR_CHAT_ID ||
      fileEnv.AVA_TELEGRAM_ALEX_CHAT_ID ||
      fileEnv.AVA_TELEGRAM_OPERATOR_IDS ||
      "6644482344",
  );
  return raw.split(",")[0].trim() || "6644482344";
}

function telegramEnabledFlag() {
  const fileEnv = readEnvFileMap();
  const v = String(
    process.env.AVA_TELEGRAM_ENABLED || fileEnv.AVA_TELEGRAM_ENABLED || "",
  ).trim();
  if (v === "0" || /^false$/i.test(v)) return false;
  return true;
}

function bootLogPath() {
  return path.join(storePaths().dir, "boot-sequence.log");
}

export function appendBootLog(line) {
  try {
    const dir = storePaths().dir;
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(
      bootLogPath(),
      `[${new Date().toISOString()}] ${line}\n`,
      "utf8",
    );
  } catch {
    /* ignore */
  }
}

export async function notifyBoot(text, { silentFail = true } = {}) {
  const body = String(text || "").slice(0, 3500);
  appendBootLog(body.replace(/\n/g, " | "));
  pushStatusEvent(`boot ? ${body.slice(0, 120)}`);
  const token = resolveBotToken();
  if (!token || !telegramEnabledFlag()) {
    console.log("[boot-tg] (no token)", body.slice(0, 200));
    return { ok: false, reason: "no_token" };
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: resolveAlexChatId(),
        text: body,
        disable_web_page_preview: true,
      }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.ok === false) {
      console.warn("[boot-tg] fail", res.status, j.description || "");
      return { ok: false, reason: j.description || String(res.status) };
    }
    console.log("[boot-tg] ok", body.slice(0, 80).replace(/\n/g, " ? "));
    return { ok: true };
  } catch (err) {
    console.warn("[boot-tg]", err.message);
    return { ok: false, reason: err.message };
  }
}

export async function stageStart(stage, title, detail = "") {
  const lines = [
    `? Stage ${stage} ? START`,
    title,
    detail && detail.trim() ? detail.trim() : null,
  ].filter(Boolean);
  return notifyBoot(lines.join("\n"));
}

export async function stageDone(stage, title, detail = "") {
  const lines = [
    `? Stage ${stage} ? COMPLETE`,
    title,
    detail && detail.trim() ? detail.trim() : null,
  ].filter(Boolean);
  return notifyBoot(lines.join("\n"));
}

export async function stageFail(stage, title, detail = "") {
  const lines = [
    `? Stage ${stage} ? FAILED`,
    title,
    detail && detail.trim() ? detail.trim() : null,
    "I will continue what I can and wait for your call.",
  ].filter(Boolean);
  return notifyBoot(lines.join("\n"));
}
