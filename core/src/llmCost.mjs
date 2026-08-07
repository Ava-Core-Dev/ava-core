/**
 * Per-call LLM cost meter — basis for Ava per-use sell price (≥2× cost).
 * Free providers still get a tiny host floor so margin isn't $0.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths } from "./store.mjs";

/** USD per 1M tokens — rough list prices; free routes = 0 API + host floor. */
const RATES = {
  "openai/gpt-4o": { in: 2.5, out: 10 },
  "openai/gpt-4o-mini": { in: 0.15, out: 0.6 },
  "meta-llama/llama-3.1-8b-instruct:free": { in: 0, out: 0 },
  "llama-3.1-8b-instant": { in: 0.05, out: 0.08 }, // groq ballpark
  "gemma-4-31b": { in: 0, out: 0 }, // cerebras free tier
  "Meta-Llama-3.3-70B-Instruct": { in: 0, out: 0 }, // sambanova free
  ollama: { in: 0, out: 0 },
};

const HOST_FLOOR_USD = Number(process.env.AVA_LLM_HOST_FLOOR_USD || 0.0002) || 0.0002;
const MARGIN_MULT = Number(process.env.AVA_LLM_SELL_MULT || 2) || 2;

function ratesFor(model = "", provider = "") {
  const m = String(model || "").toLowerCase();
  if (RATES[model]) return RATES[model];
  if (m.includes(":free") || provider === "ollama") return { in: 0, out: 0 };
  if (m.includes("gpt-4o-mini")) return RATES["openai/gpt-4o-mini"];
  if (m.includes("gpt-4o")) return RATES["openai/gpt-4o"];
  if (provider === "groq") return RATES["llama-3.1-8b-instant"];
  if (provider === "cerebras") return { in: 0, out: 0 };
  if (provider === "sambanova") return { in: 0, out: 0 };
  return { in: 0.2, out: 0.2 }; // unknown cloud — conservative
}

export function estimateCharsToTokens(chars = 0) {
  return Math.max(1, Math.ceil(Number(chars || 0) / 4));
}

/**
 * @returns {{ costUsd: number, sellUsd: number, inTok: number, outTok: number, apiUsd: number, hostUsd: number }}
 */
export function estimateLlmCost({
  provider = "",
  model = "",
  systemChars = 0,
  userChars = 0,
  replyChars = 0,
  usage = null,
} = {}) {
  const inTok =
    Number(usage?.prompt_tokens || usage?.input_tokens || 0) ||
    estimateCharsToTokens(systemChars + userChars);
  const outTok =
    Number(usage?.completion_tokens || usage?.output_tokens || 0) ||
    estimateCharsToTokens(replyChars);
  const rate = ratesFor(model, provider);
  const apiUsd = (inTok * rate.in + outTok * rate.out) / 1_000_000;
  const hostUsd = HOST_FLOOR_USD;
  const costUsd = apiUsd + hostUsd;
  const sellUsd = Math.max(costUsd * MARGIN_MULT, HOST_FLOOR_USD * MARGIN_MULT);
  return {
    costUsd: round6(costUsd),
    sellUsd: round6(sellUsd),
    inTok,
    outTok,
    apiUsd: round6(apiUsd),
    hostUsd: round6(hostUsd),
    marginMult: MARGIN_MULT,
  };
}

function round6(n) {
  return Math.round(Number(n) * 1e6) / 1e6;
}

function costDir() {
  const dir = path.join(storePaths().dir, "billing");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function recordLlmCost(row = {}) {
  try {
    const line = {
      at: Date.now(),
      ...row,
    };
    fs.appendFileSync(
      path.join(costDir(), "llm-calls.jsonl"),
      `${JSON.stringify(line)}\n`,
      "utf8",
    );
    return line;
  } catch {
    return null;
  }
}

/** Rolling month totals for ops / future Stripe metering. */
export function monthLlmCostBrief() {
  const file = path.join(costDir(), "llm-calls.jsonl");
  let cost = 0;
  let sell = 0;
  let n = 0;
  const month = new Date().toISOString().slice(0, 7);
  try {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      const d = new Date(o.at || 0).toISOString().slice(0, 7);
      if (d !== month) continue;
      n += 1;
      cost += Number(o.costUsd || 0);
      sell += Number(o.sellUsd || 0);
    }
  } catch {
    /* empty */
  }
  return {
    month,
    calls: n,
    costUsd: round6(cost),
    sellUsd: round6(sell),
    profitUsd: round6(sell - cost),
    marginMult: MARGIN_MULT,
  };
}
