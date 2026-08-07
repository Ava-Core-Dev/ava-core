/**
 * One-shot: fake /feedback → Ollama triage → Alex Telegram DM + timings.
 *
 *   cd /home/ava-core/ava/core && node scripts/feedback-ollama-tg-once.mjs
 *   node scripts/feedback-ollama-tg-once.mjs "custom feedback text"
 *
 * Does not touch D1/Slack or restart Ava.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, telegramBotToken } from "../src/config.mjs";
import { ollamaBaseUrl, ollamaModel } from "../src/localBrain.mjs";
import { telegramSendMessage } from "../src/telegramApi.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** OptiPlex live .env lives at AVA_HANDOFF/.env; rootmc-paths may resolve one level too high. */
function hydrateAvaEnvFile() {
  const candidates = [
    process.env.ROOTMC_ENV_FILE,
    process.env.CREDENTIALS_ENV,
    process.env.AVA_HANDOFF ? path.join(process.env.AVA_HANDOFF, ".env") : "",
    "/home/ava-core/ava/.env",
    path.resolve(__dirname, "../../.env"),
  ].filter(Boolean);
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    for (const raw of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const i = line.indexOf("=");
      if (i <= 0) continue;
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (!k || process.env[k]) continue;
      process.env[k] = v;
    }
    return p;
  }
  return null;
}

function alexChatId(env = {}) {
  const raw = String(
    process.env.AVA_TELEGRAM_OPERATOR_CHAT_ID ||
      env.AVA_TELEGRAM_OPERATOR_CHAT_ID ||
      process.env.AVA_TELEGRAM_ALEX_CHAT_ID ||
      env.AVA_TELEGRAM_ALEX_CHAT_ID ||
      process.env.AVA_TELEGRAM_OPERATOR_IDS ||
      env.AVA_TELEGRAM_OPERATOR_IDS ||
      "6644482344",
  ).trim();
  return raw.split(/[\s,]+/).filter(Boolean)[0] || "6644482344";
}

function ms(n) {
  return `${Math.round(n)}ms`;
}

async function resolveOllamaModel(env) {
  const preferred = ollamaModel(env) || "llama3.1:8b";
  const base = ollamaBaseUrl(env);
  try {
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(5_000) });
    const data = await res.json();
    const names = (data?.models || []).map((m) => String(m?.name || "")).filter(Boolean);
    if (names.includes(preferred)) return preferred;
    if (names.includes("llama3.1:8b")) return "llama3.1:8b";
    return names[0] || preferred;
  } catch {
    return preferred;
  }
}

async function ollamaTriageFeedback({ feedback, env, model }) {
  const base = ollamaBaseUrl(env);
  // One-shot bench: don't inherit a tight live-chat timeout.
  const timeoutMs = Math.max(
    120_000,
    Number(process.env.AVA_FEEDBACK_OLLAMA_TIMEOUT_MS || process.env.AVA_OLLAMA_TIMEOUT_MS || 120_000) || 120_000,
  );
  const system = [
    "You are Ava Ivy triaging one RootMC in-game /feedback note for staff.",
    "Return ONLY compact JSON with keys:",
    '{"type":"bug|feature|ops|praise|other","priority":"low|med|high","summary":"one sentence","staff_next":"one short next step","player_nudge":"optional short reply tip or empty"}',
    "Rules: currency is Gold (G). Feature asks should nudge /proposal. Never name cloud AI vendors. Be concrete; no fluff.",
  ].join("\n");
  const user = [
    `Feedback id: ${feedback.id}`,
    `Player: ${feedback.minecraft_username} (${feedback.minecraft_uuid})`,
    `Server: ${feedback.server_name || feedback.server_id || "?"}`,
    `Message: ${feedback.message}`,
  ].join("\n");

  const t0 = Date.now();
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: "5m",
        options: { temperature: 0.2, num_predict: 350 },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    const raw = await res.text();
    const ollamaMs = Date.now() - t0;
    if (!res.ok) {
      return { ok: false, model, base, ollamaMs, reason: `ollama_${res.status}`, raw: raw.slice(0, 400) };
    }
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return { ok: false, model, base, ollamaMs, reason: "ollama_bad_json", raw: raw.slice(0, 400) };
    }
    const text = String(data?.message?.content || data?.response || "").trim();
    if (!text) {
      return { ok: false, model, base, ollamaMs, reason: "ollama_empty", raw: "" };
    }
    return { ok: true, model, base, ollamaMs, text };
  } catch (err) {
    const ollamaMs = Date.now() - t0;
    const msg = String(err?.message || err || "");
    const reason = /abort|timeout/i.test(msg) ? "ollama_timeout" : "ollama_error";
    return { ok: false, model, base, ollamaMs, reason, raw: msg.slice(0, 400) };
  }
}

async function main() {
  const tAll = Date.now();
  if (!process.env.AVA_HANDOFF) process.env.AVA_HANDOFF = "/home/ava-core/ava";
  const envFile = hydrateAvaEnvFile();
  const env = await loadEnv();
  const model = await resolveOllamaModel(env);
  const message =
    process.argv.slice(2).join(" ").trim() ||
    "/feedback test — boat still lets me place on Claims spawn water near the shop holograms; also can we get a clearer /claiminfo for guests?";

  const feedback = {
    id: "FB-TEST-ONCE",
    minecraft_uuid: "00000000-0000-0000-0000-000000000001",
    minecraft_username: "AlexTest",
    server_id: "claims-test",
    server_name: "Claims",
    message,
    created_at: new Date().toISOString(),
  };

  console.log("[feedback-once] start", {
    model,
    preferred: ollamaModel(env),
    base: ollamaBaseUrl(env),
    tg: alexChatId(env),
    envFile,
    hasTgToken: Boolean(telegramBotToken(env)),
    message: feedback.message.slice(0, 120),
  });

  let triage;
  try {
    triage = await ollamaTriageFeedback({ feedback, env, model });
  } catch (err) {
    triage = {
      ok: false,
      model,
      base: ollamaBaseUrl(env),
      ollamaMs: Date.now() - tAll,
      reason: String(err?.message || err || "ollama_throw"),
      text: "",
    };
  }
  console.log("[feedback-once] ollama", {
    ok: triage.ok,
    ms: triage.ollamaMs,
    reason: triage.reason || "ok",
    preview: String(triage.text || triage.raw || "").slice(0, 240),
  });

  const token = telegramBotToken(env);
  if (!token) throw new Error("AVA_TELEGRAM_BOT_TOKEN missing");
  const chatId = alexChatId(env);

  const body = [
    "🧪 /feedback → Ollama → TG (one-shot test)",
    `model: ${triage.model}`,
    `ollama: ${ms(triage.ollamaMs)} · ok=${triage.ok}${triage.reason ? ` · ${triage.reason}` : ""}`,
    "",
    "input:",
    feedback.message,
    "",
    "ollama output:",
    String(triage.text || triage.raw || "(empty)").slice(0, 3200),
  ].join("\n");

  const tTg = Date.now();
  await telegramSendMessage(chatId, body.slice(0, 3900), { env });
  const tgMs = Date.now() - tTg;
  const totalMs = Date.now() - tAll;

  console.log("[feedback-once] telegram sent", { chatId, tgMs, totalMs });
  console.log(
    JSON.stringify(
      {
        ok: true,
        ollama_ok: triage.ok,
        ollama_ms: triage.ollamaMs,
        telegram_ms: tgMs,
        total_ms: totalMs,
        model: triage.model,
        chat_id: chatId,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error("[feedback-once] FAIL", err?.message || err);
  process.exitCode = 1;
});
