/**
 * Morning boot log skim — handoff logs + short Telegram note to operator.
 */
import fs from "node:fs";
import path from "node:path";
import { AVA_HANDOFF } from "./config.mjs";
import { telegramBotToken } from "./config.mjs";
import { telegramSendMessage } from "./telegramApi.mjs";
import { storePaths } from "./store.mjs";

const OPS_CHAT = () =>
  String(process.env.AVA_TELEGRAM_OPERATOR_IDS || "6644482344")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)[0];

function statePath() {
  return path.join(storePaths().dir, "morning-log-check.json");
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

function skimFile(filePath, maxLines = 40) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const text = fs.readFileSync(filePath, "utf8");
    const lines = text.split(/\r?\n/).filter(Boolean);
    const tail = lines.slice(-maxLines);
    const errors = tail.filter((l) => /error|exception|fatal|offline/i.test(l));
    return {
      file: path.basename(filePath),
      lines: lines.length,
      errorHits: errors.length,
      sample: errors.slice(-3).map((l) => l.slice(0, 160)),
    };
  } catch (err) {
    return { file: path.basename(filePath), error: err.message };
  }
}

function candidateLogPaths() {
  const handoff = AVA_HANDOFF;
  const roots = [
    path.join(handoff, "..", "1. RootMC - Claims", "logs"),
    path.join(handoff, "..", "2. RootMC - Towny", "logs"),
    path.join(handoff, "data", "ava-console.log"),
    path.join(handoff, "data", "restart-stderr.log"),
  ];
  const out = [];
  for (const r of roots) {
    if (fs.existsSync(r) && fs.statSync(r).isFile()) {
      out.push(r);
      continue;
    }
    if (!fs.existsSync(r) || !fs.statSync(r).isDirectory()) continue;
    try {
      const files = fs
        .readdirSync(r)
        .filter((n) => /\.(log|txt)$/i.test(n))
        .map((n) => path.join(r, n))
        .sort(
          (a, b) =>
            fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs,
        )
        .slice(0, 2);
      out.push(...files);
    } catch {
      /* skip */
    }
  }
  return out;
}

/**
 * Run once per HST calendar day on boot (or force).
 */
export async function runMorningLogCheck({ env, force = false } = {}) {
  const day = hstDayKey();
  const prev = loadState();
  if (!force && prev.lastDay === day) {
    return { skipped: true, reason: "already_ran_today", day };
  }

  const skims = candidateLogPaths().map((p) => skimFile(p));
  const errorTotal = skims.reduce((n, s) => n + (s?.errorHits || 0), 0);
  const lines = [
    `Ava morning log check (${day} HST)`,
    `files=${skims.length} errorHits≈${errorTotal}`,
    ...skims.slice(0, 6).map((s) => {
      if (!s) return "";
      if (s.error) return `• ${s.file}: ${s.error}`;
      return `• ${s.file}: lines=${s.lines} errs=${s.errorHits}`;
    }),
  ].filter(Boolean);

  if (errorTotal > 0) {
    const samples = skims.flatMap((s) => s?.sample || []).slice(0, 4);
    if (samples.length) {
      lines.push("", "samples:");
      for (const s of samples) lines.push(`- ${s}`);
    }
  } else {
    lines.push("", "no loud errors in skim — still verify Shockbyte if jars pending.");
  }

  const text = lines.join("\n");
  const token = telegramBotToken(env || {});
  const chat = OPS_CHAT();
  let telegram = false;
  if (token && chat) {
    try {
      await telegramSendMessage(chat, text, { env });
      telegram = true;
    } catch (err) {
      console.warn("morning log telegram:", err.message);
    }
  }

  saveState({ lastDay: day, lastAt: Date.now(), errorTotal, telegram });
  return { ok: true, day, errorTotal, telegram, skims: skims.length };
}
