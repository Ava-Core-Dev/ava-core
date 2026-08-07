/**
 * Dig health + core survival.
 * When Cursor/dream digs are out of credits/usage, Ava prefers free-cloud chat
 * (if keyed) and keeps local Llama for compress / shadow training — not as the
 * only live voice unless AVA_CORE_LLAMA=1.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths, pushStatusEvent } from "./store.mjs";

const DIG_OUTAGE_TTL_MS = Number(
  process.env.AVA_DIG_OUTAGE_TTL_MS || 6 * 60 * 60_000,
);

function digHealthPath() {
  return path.join(storePaths().dir, "dig-health.json");
}

function readState() {
  try {
    if (!fs.existsSync(digHealthPath())) return {};
    return JSON.parse(fs.readFileSync(digHealthPath(), "utf8"));
  } catch {
    return {};
  }
}

function writeState(s) {
  fs.mkdirSync(path.dirname(digHealthPath()), { recursive: true });
  fs.writeFileSync(digHealthPath(), JSON.stringify(s, null, 2), "utf8");
}

/** True when any free-cloud key is present (no import cycle with freeCloudBrain). */
export function freeCloudEnvReady() {
  return Boolean(
    String(process.env.GROQ_API_KEY || "").trim() ||
      String(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || "").trim() ||
      String(process.env.OPENROUTER_API_KEY || "").trim() ||
      String(process.env.DEEPSEEK_API_KEY || "").trim() ||
      String(process.env.GITHUB_MODELS_TOKEN || "").trim() ||
      String(process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY || "").trim(),
  );
}

/** Explicit env force: AVA_CORE_LLAMA=1 → always llama-only (background era: usually off). */
export function envForcesLlamaCore() {
  const v = String(process.env.AVA_CORE_LLAMA || "").trim();
  return v === "1" || /^true$/i.test(v);
}

export function isDigOutageActive(now = Date.now()) {
  const s = readState();
  if (!s?.outage) return false;
  const at = Number(s.outageAt || 0);
  if (!at || now - at > DIG_OUTAGE_TTL_MS) return false;
  return true;
}

/**
 * True when Ava must stay on local Llama only (/mode 1 or AVA_CORE_LLAMA=1).
 * Dig outage alone no longer parks chat on Llama if free cloud is ready.
 */
export function shouldUseLlamaCore() {
  if (envForcesLlamaCore()) return true;
  if (isDigOutageActive() && !freeCloudEnvReady()) return true;
  return false;
}

export function markDigOutage(reason = "digs_unavailable", { source = "system" } = {}) {
  const prev = readState();
  const already = isDigOutageActive();
  const payload = {
    ...prev,
    outage: true,
    outageAt: Date.now(),
    reason: String(reason).slice(0, 300),
    source: String(source).slice(0, 80),
    updatedAt: Date.now(),
  };
  writeState(payload);
  if (!already) {
    pushStatusEvent(`llama core · digs out · ${payload.reason}`);
  }
  return payload;
}

export function clearDigOutage(reason = "digs_restored") {
  const payload = {
    outage: false,
    clearedAt: Date.now(),
    reason: String(reason).slice(0, 300),
    updatedAt: Date.now(),
  };
  writeState(payload);
  pushStatusEvent(`digs restored · ${payload.reason}`);
  return payload;
}

export function loadDigHealth() {
  return readState();
}

/** Detect Cursor / dream failure strings that mean "usage out". */
export function looksLikeDigUsageOutage(reason = "") {
  const r = String(reason || "").toLowerCase();
  return (
    /http_40[23]/.test(r) ||
    /\b(402|403)\b/.test(r) ||
    /credit|spending limit|permission-denied|out of usage|increase limits|usage.?limit|quota|billing/i.test(
      r,
    )
  );
}
