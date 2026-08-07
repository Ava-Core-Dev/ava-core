/**
 * RapidAPI multilanguage translator — explicit /translate only (50 req/mo plan).
 *
 * Env:
 *   RAPIDAPI_KEY / X_RAPIDAPI_KEY
 *   RAPIDAPI_TRANSLATE_HOST (optional)
 *   RAPIDAPI_TRANSLATE_URL (optional)
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths } from "./store.mjs";

const DEFAULT_HOST =
  "advanced-multilanguage-ai-translator-api-with-fast-responses.p.rapidapi.com";
const DEFAULT_URL = `https://${DEFAULT_HOST}/translate.php`;
const MONTHLY_SOFT_CAP = 50;

function envTrim(...keys) {
  for (const k of keys) {
    const v = String(process.env[k] || "").trim();
    if (v) return v;
  }
  return "";
}

function usagePath() {
  const dir = path.join(storePaths().dir, "rapidapi");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "translate-usage.json");
}

function monthKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function readUsage() {
  try {
    return JSON.parse(fs.readFileSync(usagePath(), "utf8"));
  } catch {
    return { month: monthKey(), count: 0 };
  }
}

function bumpUsage() {
  const cur = readUsage();
  const m = monthKey();
  const next = {
    month: m,
    count: cur.month === m ? Number(cur.count || 0) + 1 : 1,
    lastAt: Date.now(),
  };
  try {
    fs.writeFileSync(usagePath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  } catch {
    /* non-fatal */
  }
  return next;
}

export function rapidTranslateConfigured() {
  return Boolean(envTrim("RAPIDAPI_KEY", "X_RAPIDAPI_KEY"));
}

export function rapidTranslateUsage() {
  const u = readUsage();
  const m = monthKey();
  return {
    month: m,
    count: u.month === m ? Number(u.count || 0) : 0,
    softCap: MONTHLY_SOFT_CAP,
  };
}

/**
 * @returns {Promise<{ ok: boolean, translation?: string, source?: string, target?: string, reason?: string, usage?: object }>}
 */
export async function rapidTranslate({
  text = "",
  target = "",
  source = "en",
} = {}) {
  const key = envTrim("RAPIDAPI_KEY", "X_RAPIDAPI_KEY");
  if (!key) return { ok: false, reason: "no_rapidapi_key" };
  const t = String(text || "").trim();
  const tgt = String(target || "").trim();
  if (!t || !tgt) return { ok: false, reason: "text_and_target_required" };

  const usage = rapidTranslateUsage();
  if (usage.count >= MONTHLY_SOFT_CAP) {
    return {
      ok: false,
      reason: "monthly_cap",
      usage,
    };
  }

  const host = envTrim("RAPIDAPI_TRANSLATE_HOST") || DEFAULT_HOST;
  const url = envTrim("RAPIDAPI_TRANSLATE_URL") || DEFAULT_URL;
  const body = {
    text: t.slice(0, 4000),
    source: String(source || "en").trim() || "en",
    target: tgt,
  };

  let res;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-rapidapi-host": host,
        "x-rapidapi-key": key,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(
        Number(process.env.RAPIDAPI_TRANSLATE_TIMEOUT_MS || 20_000) || 20_000,
      ),
    });
  } catch (err) {
    return { ok: false, reason: `network_${err?.message || err}` };
  }

  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, reason: `bad_json_${res.status}`, detail: raw.slice(0, 160) };
  }
  if (!res.ok || data?.ok === false) {
    return {
      ok: false,
      reason: `http_${res.status}`,
      detail: String(data?.error || raw).slice(0, 200),
    };
  }

  const translation =
    data?.translation ||
    data?.translated_text ||
    data?.result ||
    data?.data?.translation ||
    "";
  if (!String(translation).trim()) {
    return { ok: false, reason: "empty_translation", detail: raw.slice(0, 160) };
  }

  const nextUsage = bumpUsage();
  return {
    ok: true,
    translation: String(translation).trim(),
    source: data?.source || body.source,
    target: data?.target || body.target,
    usage: {
      month: nextUsage.month,
      count: nextUsage.count,
      softCap: MONTHLY_SOFT_CAP,
    },
  };
}

/** @returns {{ target: string, text: string, source: string } | null} */
export function parseTranslateCommand(raw = "") {
  const t = String(raw || "").trim();
  if (!t) return null;

  // /translate [from X] to Y: text
  let m = t.match(
    /^\/?translate(?:\s+from\s+(\S+))?\s+to\s+([^:]+)\s*[:\-]\s*(.+)$/is,
  );
  if (m) {
    return {
      source: (m[1] || "en").trim(),
      target: m[2].trim(),
      text: m[3].trim(),
    };
  }

  // /translate Y: text
  m = t.match(/^\/?translate\s+([^:]+)\s*[:\-]\s*(.+)$/is);
  if (m) {
    return { source: "en", target: m[1].trim(), text: m[2].trim() };
  }

  // /translate Y text...
  m = t.match(/^\/?translate\s+(\S+)\s+(.+)$/is);
  if (m) {
    return { source: "en", target: m[1].trim(), text: m[2].trim() };
  }

  return null;
}

export function isTranslateCommand(text = "") {
  return /^\/?translate\b/i.test(String(text || "").trim());
}

/**
 * @returns {Promise<null | { handled: true, reply: string }>}
 */
export async function tryHandleTranslateCommand({
  text = "",
  isAlex = false,
} = {}) {
  if (!isTranslateCommand(text)) return null;
  if (!isAlex) {
    return {
      handled: true,
      reply: "Translate is operator-only (RapidAPI monthly cap).",
    };
  }
  if (!rapidTranslateConfigured()) {
    return {
      handled: true,
      reply: "Translator key not loaded — RAPIDAPI_KEY missing on Ava.",
    };
  }

  const parsed = parseTranslateCommand(text);
  if (!parsed?.text || !parsed?.target) {
    return {
      handled: true,
      reply:
        "Usage: `/translate Russian How are you?` or `/translate to Spanish: good morning`",
    };
  }

  const r = await rapidTranslate(parsed);
  if (!r.ok) {
    if (r.reason === "monthly_cap") {
      return {
        handled: true,
        reply: `Translator monthly cap hit (${r.usage?.count}/${r.usage?.softCap}).`,
      };
    }
    return {
      handled: true,
      reply: `Translate failed: ${r.reason}${r.detail ? ` — ${r.detail}` : ""}`,
    };
  }

  const u = r.usage;
  return {
    handled: true,
    reply: `${r.translation}\n_(${r.source} → ${r.target} · ${u.count}/${u.softCap} this month)_`,
  };
}
