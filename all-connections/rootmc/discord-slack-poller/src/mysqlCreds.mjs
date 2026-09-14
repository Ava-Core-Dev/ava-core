/**
 * Ava MySQL credentials — load from core config / .env; rotate + Telegram Alex.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { AVA_HANDOFF } from "./config.mjs";
import { telegramBotToken } from "./config.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ALEX_TG = "6644482344";

function homeRoot() {
  return String(process.env.AVA_HANDOFF || AVA_HANDOFF || "/home/ava-core/ava").trim();
}

export function mysqlConfigPaths() {
  const home = homeRoot();
  return {
    envFile: path.join(home, ".env"),
    jsonFile: path.join(home, "core", "config", "mysql.json"),
    altJson: path.join(home, "data", "mysql-login.json"),
  };
}

export function loadMysqlCreds() {
  const { envFile, jsonFile, altJson } = mysqlConfigPaths();
  let fromJson = null;
  for (const p of [jsonFile, altJson]) {
    try {
      if (fs.existsSync(p)) {
        fromJson = JSON.parse(fs.readFileSync(p, "utf8"));
        break;
      }
    } catch {
      /* ignore */
    }
  }
  const env = {};
  try {
    const raw = fs.readFileSync(envFile, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* ignore */
  }
  return {
    host: fromJson?.host || env.AVA_MYSQL_HOST || "127.0.0.1",
    port: Number(fromJson?.port || env.AVA_MYSQL_PORT || 3306),
    database: fromJson?.database || env.AVA_MYSQL_DATABASE || "ava_core",
    user: fromJson?.user || env.AVA_MYSQL_USER || "ava",
    password: fromJson?.password || env.AVA_MYSQL_PASSWORD || "",
  };
}

function upsertEnvKey(raw, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(raw)) return raw.replace(re, line);
  const marker = "# --- Ava MySQL (do not duplicate) ---";
  if (raw.includes(marker)) {
    return raw.replace(marker, `${marker}\n${line}`);
  }
  return `${raw.trimEnd()}\n\n${marker}\n${line}\n`;
}

export function saveMysqlCreds(creds) {
  const { envFile, jsonFile, altJson } = mysqlConfigPaths();
  const payload = {
    host: creds.host || "127.0.0.1",
    port: Number(creds.port || 3306),
    database: creds.database || "ava_core",
    user: creds.user || "ava",
    password: creds.password || "",
  };
  fs.mkdirSync(path.dirname(jsonFile), { recursive: true });
  fs.mkdirSync(path.dirname(altJson), { recursive: true });
  const body = JSON.stringify(payload, null, 2) + "\n";
  fs.writeFileSync(jsonFile, body, { mode: 0o600 });
  fs.writeFileSync(altJson, body, { mode: 0o600 });
  try {
    fs.chmodSync(jsonFile, 0o600);
    fs.chmodSync(altJson, 0o600);
  } catch {
    /* ignore */
  }
  let raw = "";
  try {
    raw = fs.readFileSync(envFile, "utf8");
  } catch {
    raw = "";
  }
  raw = upsertEnvKey(raw, "AVA_MYSQL_HOST", payload.host);
  raw = upsertEnvKey(raw, "AVA_MYSQL_PORT", String(payload.port));
  raw = upsertEnvKey(raw, "AVA_MYSQL_DATABASE", payload.database);
  raw = upsertEnvKey(raw, "AVA_MYSQL_USER", payload.user);
  raw = upsertEnvKey(raw, "AVA_MYSQL_PASSWORD", payload.password);
  fs.writeFileSync(envFile, raw, { mode: 0o600 });
  try {
    fs.chmodSync(envFile, 0o600);
  } catch {
    /* ignore */
  }
  return payload;
}

export async function notifyAlexMysqlCreds(creds, reason = "MySQL credentials") {
  const token = telegramBotToken() || process.env.AVA_TELEGRAM_BOT_TOKEN || "";
  if (!token) {
    console.warn("[mysqlCreds] no Telegram bot token — skip notify");
    return { ok: false, detail: "no token" };
  }
  const text = [
    `Ava ${reason}`,
    `host: ${creds.host}`,
    `port: ${creds.port}`,
    `database: ${creds.database}`,
    `user: ${creds.user}`,
    `password: ${creds.password}`,
    `files: core/config/mysql.json + .env (AVA_MYSQL_*)`,
    `phpMyAdmin: https://ava.rootmc.net/phpmyadmin`,
  ].join("\n");
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: ALEX_TG, text }),
  });
  const j = await res.json().catch(() => ({}));
  return { ok: Boolean(j.ok), detail: j.description || res.status };
}

function strongPassword(bytes = 24) {
  return Buffer.from(
    Array.from({ length: bytes }, () => Math.floor(Math.random() * 256)),
  )
    .toString("base64url")
    .slice(0, 32);
}

export async function rotateMysqlPassword({ notify = true } = {}) {
  const cur = loadMysqlCreds();
  const password = strongPassword();
  const sql = `ALTER USER '${cur.user}'@'localhost' IDENTIFIED BY '${password.replace(/'/g, "''")}'; ALTER USER '${cur.user}'@'127.0.0.1' IDENTIFIED BY '${password.replace(/'/g, "''")}'; FLUSH PRIVILEGES;`;
  await execFileAsync("sudo", ["mysql", "-e", sql], { timeout: 30000 });
  const next = saveMysqlCreds({ ...cur, password });
  if (notify) await notifyAlexMysqlCreds(next, "MySQL password rotated");
  return next;
}