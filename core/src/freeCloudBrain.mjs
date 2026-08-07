/**
 * Free-cloud LLM fallbacks — dormant until API keys exist in env.
 * Used after Ollama fail (not llamaOnly) and after xAI dream fail.
 * Never name vendors on public Discord (caller scrubs).
 *
 * Env:
 *   GROQ_API_KEY (+ GROQ_MODEL)
 *   GEMINI_API_KEY / GOOGLE_AI_API_KEY (+ GEMINI_MODEL)
 *   OPENROUTER_API_KEY (+ OPENROUTER_MODEL)
 *   CEREBRAS_API_KEY (+ CEREBRAS_MODEL)
 *   SAMBANOVA_API_KEY / SAMBA_API_KEY (+ SAMBANOVA_MODEL)
 *   DEEPSEEK_API_KEY (+ DEEPSEEK_MODEL)
 *   GITHUB_MODELS_TOKEN (+ GITHUB_MODELS_MODEL)
 *   HF_TOKEN / HUGGINGFACE_API_KEY (+ HF_MODEL)
 *   AVA_FREE_LLM=0 to force off · AVA_FREE_LLM_ORDER · AVA_FREE_LLM_TIMEOUT_MS
 */
import { pushStatusEvent, storePaths } from "./store.mjs";
import { settleLlmUsage } from "./avaUsageBilling.mjs";
import fs from "node:fs";
import path from "node:path";

function trainingDir() {
  const dir = path.join(storePaths().dir, "training");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function appendTrainingJsonl(file, row) {
  try {
    fs.appendFileSync(
      path.join(trainingDir(), file),
      `${JSON.stringify(row)}\n`,
      "utf8",
    );
  } catch {
    /* non-fatal */
  }
}

function scrubForTrain(s = "") {
  return String(s || "")
    .replace(/gsk_[A-Za-z0-9]+/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [redacted]")
    .slice(0, 8000);
}

const DEFAULT_ORDER = [
  "groq",
  "cerebras",
  "sambanova",
  "gemini",
  "openrouter",
  "deepseek",
  "github",
  "huggingface",
];

function envTrim(...keys) {
  for (const k of keys) {
    const v = String(process.env[k] || "").trim();
    if (v) return v;
  }
  return "";
}

function freeLlmEnabled() {
  const v = String(process.env.AVA_FREE_LLM || "").trim();
  if (v === "0" || /^false$/i.test(v) || /^off$/i.test(v)) return false;
  return true;
}

function timeoutMs() {
  return Number(process.env.AVA_FREE_LLM_TIMEOUT_MS || 25_000) || 25_000;
}

function promptBudgets() {
  const maxTokens = Math.max(
    64,
    Number(process.env.AVA_FREE_LLM_MAX_TOKENS || 400) || 400,
  );
  const systemChars = Math.max(
    500,
    Number(process.env.AVA_FREE_LLM_SYSTEM_CHARS || 4000) || 4000,
  );
  const userChars = Math.max(
    500,
    Number(process.env.AVA_FREE_LLM_USER_CHARS || 6000) || 6000,
  );
  return { maxTokens, systemChars, userChars };
}

/** Block gpt-4o / paid models unless AVA_ALLOW_PAID_LLM=1 */
function assertCheapModel(providerId, model) {
  const allow = String(process.env.AVA_ALLOW_PAID_LLM || "").trim();
  if (allow === "1" || /^true$/i.test(allow)) return model;
  const m = String(model || "").toLowerCase();
  const paid =
    /gpt-4|claude-3|claude-4|\bo1\b|\bo3\b|gemini-1\.5-pro|gemini-2\.5-pro/i.test(
      m,
    ) && !m.includes(":free");
  if (!paid) return model;
  if (providerId === "openrouter") {
    return "meta-llama/llama-3.1-8b-instruct:free";
  }
  if (providerId === "groq") {
    return "llama-3.1-8b-instant";
  }
  if (providerId === "github") {
    return "openai/gpt-4o-mini";
  }
  return model;
}


function orderList() {
  const raw = String(process.env.AVA_FREE_LLM_ORDER || "").trim();
  if (!raw) return [...DEFAULT_ORDER];
  const parts = raw
    .split(/[,|\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return parts.length ? parts : [...DEFAULT_ORDER];
}

/** @typedef {{ id: string, label: string, configured: boolean, model: string }} FreeProvider */

/** @returns {FreeProvider[]} */
export function listFreeCloudProviders() {
  const catalog = {
    groq: {
      label: "Groq",
      key: () => envTrim("GROQ_API_KEY"),
      model: () =>
        envTrim("GROQ_MODEL") || "llama-3.1-8b-instant",
    },
    cerebras: {
      label: "Cerebras",
      key: () => envTrim("CEREBRAS_API_KEY"),
      model: () => envTrim("CEREBRAS_MODEL") || "gemma-4-31b",
    },
    sambanova: {
      label: "SambaNova",
      key: () => envTrim("SAMBANOVA_API_KEY", "SAMBA_API_KEY"),
      model: () =>
        envTrim("SAMBANOVA_MODEL") || "Meta-Llama-3.3-70B-Instruct",
    },
    gemini: {
      label: "Gemini",
      key: () => envTrim("GEMINI_API_KEY", "GOOGLE_AI_API_KEY"),
      model: () => envTrim("GEMINI_MODEL") || "gemini-2.0-flash",
    },
    openrouter: {
      label: "OpenRouter",
      key: () => envTrim("OPENROUTER_API_KEY"),
      model: () =>
        envTrim("OPENROUTER_MODEL") || "meta-llama/llama-3.1-8b-instruct:free",
    },
    deepseek: {
      label: "DeepSeek",
      key: () => envTrim("DEEPSEEK_API_KEY"),
      model: () => envTrim("DEEPSEEK_MODEL") || "deepseek-chat",
    },
    github: {
      label: "GitHub Models",
      key: () => envTrim("GITHUB_MODELS_TOKEN"),
      model: () =>
        envTrim("GITHUB_MODELS_MODEL") || "openai/gpt-4o-mini",
    },
    huggingface: {
      label: "Hugging Face",
      key: () => envTrim("HF_TOKEN", "HUGGINGFACE_API_KEY"),
      model: () =>
        envTrim("HF_MODEL") || "meta-llama/Meta-Llama-3-8B-Instruct",
    },
  };

  const seen = new Set();
  const out = [];
  for (const id of orderList()) {
    const meta = catalog[id];
    if (!meta || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      label: meta.label,
      configured: Boolean(meta.key()),
      model: meta.model(),
    });
  }
  for (const id of Object.keys(catalog)) {
    if (seen.has(id)) continue;
    const meta = catalog[id];
    out.push({
      id,
      label: meta.label,
      configured: Boolean(meta.key()),
      model: meta.model(),
    });
  }
  return out;
}

export function freeCloudConfigured() {
  if (!freeLlmEnabled()) return false;
  return listFreeCloudProviders().some((p) => p.configured);
}

export function gatherFreeCloudBrief() {
  if (!freeLlmEnabled()) {
    return {
      brief: "### Free cloud LLMs\ndisabled (AVA_FREE_LLM=0)",
      configured: [],
    };
  }
  const all = listFreeCloudProviders();
  const ready = all.filter((p) => p.configured);
  const missing = all.filter((p) => !p.configured).map((p) => p.id);
  const lines = ready.length
    ? ready.map((p) => `- ${p.id}: ready (${p.model})`)
    : ["- (none — add GROQ_API_KEY / GEMINI_API_KEY / … to .env)"];
  return {
    brief: `### Free cloud LLMs
configured: ${ready.length ? ready.map((p) => p.id).join(", ") : "none"}
order: ${orderList().join(" → ")}
${lines.join("\n")}
pending keys: ${missing.length ? missing.join(", ") : "—"}`,
    configured: ready.map((p) => p.id),
  };
}

async function openAiCompatChat({
  url,
  key,
  model,
  system,
  user,
  extraHeaders = {},
}) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(String(url || "").includes("api.cerebras.ai")
        ? { "User-Agent": "ava-ivy/1.0 cerebras-client" }
        : {}),
      ...extraHeaders,
    },
    body: JSON.stringify((() => {
      const b = promptBudgets();
      const body = {
        model,
        temperature: 0.55,
        max_tokens: b.maxTokens,
        messages: [
          { role: "system", content: String(system || "").slice(0, b.systemChars) },
          { role: "user", content: String(user || "").slice(0, b.userChars) },
        ],
      };
      if (String(url || "").includes("api.cerebras.ai")) {
        body.max_completion_tokens = b.maxTokens;
        delete body.max_tokens;
      }
      return body;
    })()),
    signal: AbortSignal.timeout(timeoutMs()),
  });
  const body = await res.text();
  if (!res.ok) {
    return {
      ok: false,
      reason: `http_${res.status}`,
      text: null,
      detail: body.slice(0, 180),
    };
  }
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return { ok: false, reason: "bad_json", text: null };
  }
  const reply =
    data?.choices?.[0]?.message?.content?.trim() ||
    data?.choices?.[0]?.text?.trim() ||
    "";
  if (!reply) return { ok: false, reason: "empty", text: null };
  return { ok: true, reason: "ok", text: reply, usage: data?.usage || null };
}

async function geminiChat({ key, model, system, user }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: String(system || "").slice(0, promptBudgets().systemChars) }] },
      contents: [
        {
          role: "user",
          parts: [{ text: String(user || "").slice(0, promptBudgets().userChars) }],
        },
      ],
      generationConfig: { temperature: 0.55, maxOutputTokens: promptBudgets().maxTokens },
    }),
    signal: AbortSignal.timeout(timeoutMs()),
  });
  const body = await res.text();
  if (!res.ok) {
    return {
      ok: false,
      reason: `http_${res.status}`,
      text: null,
      detail: body.slice(0, 180),
    };
  }
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    return { ok: false, reason: "bad_json", text: null };
  }
  const parts = data?.candidates?.[0]?.content?.parts;
  const reply = Array.isArray(parts)
    ? parts.map((p) => p?.text || "").join("").trim()
    : "";
  if (!reply) return { ok: false, reason: "empty", text: null };
  return { ok: true, reason: "ok", text: reply };
}

async function hfChat({ key, model, system, user }) {
  // OpenAI-compatible router on HF Inference
  return openAiCompatChat({
    url: "https://router.huggingface.co/v1/chat/completions",
    key,
    model,
    system,
    user,
  });
}

async function callProvider(id, { system, user }) {
  switch (id) {
    case "groq":
      return openAiCompatChat({
        url: "https://api.groq.com/openai/v1/chat/completions",
        key: envTrim("GROQ_API_KEY"),
        model: assertCheapModel(
          "groq",
          envTrim("GROQ_MODEL") || "llama-3.1-8b-instant",
        ),
        system,
        user,
      });
    case "cerebras":
      return openAiCompatChat({
        url: "https://api.cerebras.ai/v1/chat/completions",
        key: envTrim("CEREBRAS_API_KEY"),
        model: assertCheapModel(
          "cerebras",
          envTrim("CEREBRAS_MODEL") || "gemma-4-31b",
        ),
        system,
        user,
      });
    case "sambanova":
      return openAiCompatChat({
        url: "https://api.sambanova.ai/v1/chat/completions",
        key: envTrim("SAMBANOVA_API_KEY", "SAMBA_API_KEY"),
        model: assertCheapModel(
          "sambanova",
          envTrim("SAMBANOVA_MODEL") || "Meta-Llama-3.3-70B-Instruct",
        ),
        system,
        user,
      });
    case "gemini":
      return geminiChat({
        key: envTrim("GEMINI_API_KEY", "GOOGLE_AI_API_KEY"),
        model: envTrim("GEMINI_MODEL") || "gemini-2.0-flash",
        system,
        user,
      });
    case "openrouter":
      return openAiCompatChat({
        url: "https://openrouter.ai/api/v1/chat/completions",
        key: envTrim("OPENROUTER_API_KEY"),
        model: assertCheapModel(
          "openrouter",
          envTrim("OPENROUTER_MODEL") ||
            "meta-llama/llama-3.1-8b-instruct:free",
        ),
        system,
        user,
        extraHeaders: {
          "HTTP-Referer": "https://ava.rootmc.net",
          "X-Title": "Ava Ivy RootMC",
        },
      });
    case "deepseek":
      return openAiCompatChat({
        url: "https://api.deepseek.com/chat/completions",
        key: envTrim("DEEPSEEK_API_KEY"),
        model: envTrim("DEEPSEEK_MODEL") || "deepseek-chat",
        system,
        user,
      });
    case "github":
      return openAiCompatChat({
        url: "https://models.inference.ai.azure.com/chat/completions",
        key: envTrim("GITHUB_MODELS_TOKEN"),
        model: envTrim("GITHUB_MODELS_MODEL") || "openai/gpt-4o-mini",
        system,
        user,
      });
    case "huggingface":
      return hfChat({
        key: envTrim("HF_TOKEN", "HUGGINGFACE_API_KEY"),
        model:
          envTrim("HF_MODEL") || "meta-llama/Meta-Llama-3-8B-Instruct",
        system,
        user,
      });
    default:
      return { ok: false, reason: "unknown_provider", text: null };
  }
}

/**
 * Try configured free providers in order.
 * @returns {Promise<{ ok: boolean, reason: string, text: string|null, brain?: string, provider?: string }>}
 */
export async function freeCloudChat({
  system = "",
  user = "",
  surface = "",
  accountId = "",
  isOps = false,
} = {}) {
  if (!freeCloudConfigured()) {
    return { ok: false, reason: "free_cloud_not_configured", text: null };
  }
  const providers = listFreeCloudProviders().filter((p) => p.configured);
  const tried = [];
  for (const p of providers) {
    try {
      const modelUsed = assertCheapModel(p.id, p.model);
      const r = await callProvider(p.id, { system, user });
      if (r.ok && r.text) {
        const settled = settleLlmUsage({
          accountId: accountId || `surface:${String(surface || "unknown")}`,
          provider: p.id,
          model: modelUsed,
          surface: String(surface || ""),
          systemChars: String(system || "").length,
          userChars: String(user || "").length,
          replyChars: String(r.text || "").length,
          usage: r.usage || null,
          isOps: Boolean(isOps),
        });
        const cost = settled.cost;
        appendTrainingJsonl("free-cloud-calls.jsonl", {
          at: Date.now(),
          provider: p.id,
          model: modelUsed,
          surface: String(surface || ""),
          ok: true,
          systemChars: String(system || "").length,
          costUsd: cost.costUsd,
          sellUsd: cost.sellUsd,
          accountId: accountId || null,
          user: scrubForTrain(user).slice(0, 4000),
          reply: scrubForTrain(r.text).slice(0, 4000),
        });
        try {
          pushStatusEvent(
            `free-llm · ${p.id} · ${String(surface || "ask").slice(0, 24)}`,
          );
        } catch {
          /* ignore */
        }
        return {
          ok: true,
          reason: "ok",
          text: r.text,
          brain: "free_cloud",
          provider: p.id,
        };
      }
      appendTrainingJsonl("free-cloud-calls.jsonl", {
        at: Date.now(),
        provider: p.id,
        model: p.model,
        surface: String(surface || ""),
        ok: false,
        reason: r.reason || "fail",
        user: scrubForTrain(user).slice(0, 2000),
      });
      tried.push(`${p.id}:${r.reason || "fail"}`);
      // skip auth / rate-limit / empty → next
    } catch (err) {
      const msg = String(err?.message || err || "");
      const reason = /abort|timeout/i.test(msg) ? "timeout" : "error";
      appendTrainingJsonl("free-cloud-calls.jsonl", {
        at: Date.now(),
        provider: p.id,
        surface: String(surface || ""),
        ok: false,
        reason,
      });
      tried.push(`${p.id}:${reason}`);
    }
  }
  return {
    ok: false,
    reason: `free_cloud_exhausted:${tried.join(",") || "none"}`,
    text: null,
  };
}
