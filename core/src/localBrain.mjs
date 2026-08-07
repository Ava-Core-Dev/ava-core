/**
 * Local organizer brain (Goal B3) — Ollama/llama-class on OptiPlex SSD.
 * Classifies + answers from small packs. Escalates when unknown:
 *   Cursor Root Server if online → else dream (Grok under the hood).
 * Every escalation/hit is saved as training until the Ava core can absorb it.
 */
import fs from "node:fs";
import path from "node:path";
import {
  AVA_HANDOFF,
  cursorApiKey,
  dreamApiKey,
  WORKSPACE_ROOT,
} from "./config.mjs";
import { activePersona, activeHardRules } from "./persona.mjs";
import { gatherCoreSpec } from "./coreSpec.mjs";
import { gatherJobsBrief } from "./jobQueue.mjs";
import { scrubPublicReply } from "./scrub.mjs";
import { cursorRecommend } from "./cursorBrain.mjs";
import { dreamRecommend } from "./dreamBrain.mjs";
import { freeCloudChat, freeCloudConfigured } from "./freeCloudBrain.mjs";
import { cursorChatEnabled } from "./cursorBrain.mjs";
import { logDigTraining, appendAction } from "./fullLog.mjs";
import { storePaths } from "./store.mjs";
import { gatherRecentLessonsBrief } from "./llamaImprove.mjs";
import {
  gatherAvaCodeBrief,
  looksLikeAvaCodeAsk,
  llamaCodeRecommendSystemExtra,
  shouldRecommendBeforeEdit,
} from "./llamaCodeReview.mjs";
import { isLockoutActive } from "./lockoutMode.mjs";
import { localCoreFailLine } from "./localCoreFail.mjs";
import {
  gatherCursorHandoffBrief,
  maybeAutoHandoffFromLlama,
} from "./cursorHandoff.mjs";
import { gatherRecentTurnsBrief } from "./conversationStore.mjs";

const DEFAULT_OLLAMA = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "ava-ivy";

/** Chat prefers free cloud (Groq etc.); Llama stays for compress + shadow training. */
function chatPrefersFreeCloud() {
  const v = String(process.env.AVA_LLAMA_FIRST || "").trim();
  if (v === "1" || /^true$/i.test(v)) return false;
  return freeCloudConfigured();
}

function shadowTrainEnabled() {
  const v = String(process.env.AVA_LLAMA_SHADOW_TRAIN || "1").trim();
  return !(v === "0" || /^false$/i.test(v) || /^off$/i.test(v));
}

export function ollamaBaseUrl(env = {}) {
  return String(
    process.env.AVA_OLLAMA_URL ||
      env.AVA_OLLAMA_URL ||
      DEFAULT_OLLAMA,
  )
    .trim()
    .replace(/\/$/, "");
}

export function ollamaModel(env = {}) {
  return String(
    process.env.AVA_OLLAMA_MODEL ||
      env.AVA_OLLAMA_MODEL ||
      process.env.OLLAMA_MODEL ||
      DEFAULT_MODEL,
  ).trim();
}

/** Opt-in; set AVA_LOCAL_BRAIN=1 (or true) to use Ollama organizer on Slack/on-device. */
export function localBrainEnabled(env = {}) {
  const v = String(
    process.env.AVA_LOCAL_BRAIN || env.AVA_LOCAL_BRAIN || "",
  ).trim();
  if (v === "0" || /^false$/i.test(v)) return false;
  if (v === "1" || /^true$/i.test(v)) return true;
  // Auto: enabled when Ollama answers /api/tags (checked lazily by callers via probe)
  return v === "auto";
}

function trainingDir() {
  const dir = path.join(storePaths().dir, "training");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function pendingPath() {
  return path.join(trainingDir(), "pending-lessons.jsonl");
}

function lessonsPath() {
  return path.join(trainingDir(), "local-lessons.jsonl");
}

function appendJsonl(file, row) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`, "utf8");
  } catch (err) {
    console.warn("localBrain train:", err.message);
  }
}

function scrubSecrets(text) {
  return String(text || "")
    .replace(/xox[baprs]-[A-Za-z0-9-]+/g, "[redacted-token]")
    .replace(/xapp-[A-Za-z0-9-]+/g, "[redacted-token]")
    .replace(
      /(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+/gi,
      "$1=[redacted]",
    )
    .slice(0, 8000);
}

/** Small organizer packs only — never whole trees / secrets. */
export function gatherOrganizerPacks({ question = "", maxChars = 18000 } = {}) {
  const chunks = [];
  const core = gatherCoreSpec({ maxChars: 8000 });
  if (core.brief) chunks.push(core.brief.slice(0, 8000));

  const jobs = gatherJobsBrief();
  if (jobs.brief) chunks.push(jobs.brief.slice(0, 2000));

  const goals = path.join(AVA_HANDOFF, "notes", "AVA-GOALS.md");
  const surface = path.join(
    WORKSPACE_ROOT,
    "Web Files",
    "rootmc-ava",
    "src",
    "surfaceRules.mjs",
  );
  // Prefer human-readable surface doc if present
  const surfaceMd = path.join(AVA_HANDOFF, "notes", "SURFACE-ARCHITECTURE.md");
  const eco = path.join(WORKSPACE_ROOT, "emergent-repo", "ECOSYSTEM.md");
  const layout = path.join(AVA_HANDOFF, "notes", "LINUX-E-SSD-LAYOUT.md");
  const localBrainDoc = path.join(AVA_HANDOFF, "notes", "LOCAL-BRAIN.md");
  const interestsDoc = path.join(
    AVA_HANDOFF,
    "notes",
    "INTERESTS-OFFGRID-GARDEN-POWER.md",
  );

  for (const file of [goals, surfaceMd, eco, layout, localBrainDoc, interestsDoc]) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, "utf8");
      const cleaned = raw
        .split(/\r?\n/)
        .filter(
          (line) =>
            !/(password|token|secret|api[_-]?key|jdbc:|Bearer\s)/i.test(line),
        )
        .join("\n");
      chunks.push(
        `### ${path.basename(file)}\n${cleaned.slice(0, 3500)}`,
      );
    } catch {
      /* skip */
    }
  }

  // Tiny surface rules extract (no full source dump)
  try {
    if (fs.existsSync(surface)) {
      const s = fs.readFileSync(surface, "utf8").slice(0, 2500);
      chunks.push(`### surfaceRules excerpt\n${s}`);
    }
  } catch {
    /* skip */
  }

  // Self-improve: recent local lessons (chat absorbs + prior answers)
  try {
    const lessons = gatherRecentLessonsBrief({ question, maxChars: 3200 });
    if (lessons) chunks.push(lessons);
  } catch {
    /* skip */
  }

  // Notes + chats parked for Cursor when digs return
  try {
    const handoff = gatherCursorHandoffBrief({
      question,
      maxChars: 3500,
    });
    if (handoff?.brief) chunks.push(handoff.brief);
  } catch {
    /* skip */
  }

  // Ava-owned code snippets for analysis / recommend-before-edit
  try {
    if (looksLikeAvaCodeAsk(question)) {
      const code = gatherAvaCodeBrief({ question, maxFiles: 4, maxChars: 8500 });
      if (code) chunks.push(code);
    }
  } catch {
    /* skip */
  }

  const cap = Math.max(2000, Number(maxChars) || 18000);
  return chunks.filter(Boolean).join("\n\n").slice(0, cap);
}

let _ollamaOk = null;
let _ollamaCheckedAt = 0;

export async function probeOllama(env = {}) {
  const now = Date.now();
  if (_ollamaOk != null && now - _ollamaCheckedAt < 30_000) {
    return _ollamaOk;
  }
  try {
    const res = await fetch(`${ollamaBaseUrl(env)}/api/tags`, {
      signal: AbortSignal.timeout(2500),
    });
    _ollamaOk = res.ok;
  } catch {
    _ollamaOk = false;
  }
  _ollamaCheckedAt = now;
  return _ollamaOk;
}

/** True when local organizer should run (explicit enable or auto + Ollama up). */
export async function shouldUseLocalBrain(env = {}) {
  const v = String(
    process.env.AVA_LOCAL_BRAIN || env.AVA_LOCAL_BRAIN || "auto",
  ).trim();
  if (v === "0" || /^false$/i.test(v)) return false;
  if (v === "1" || /^true$/i.test(v)) return probeOllama(env);
  // auto (default for Ubuntu path)
  return probeOllama(env);
}

function parseLocalResponse(raw) {
  const text = String(raw || "").trim();
  const knowMatch = text.match(/\bKNOWS:\s*(yes|no)\b/i);
  const confMatch = text.match(/\bCONFIDENCE:\s*(high|medium|low)\b/i);
  const routeMatch = text.match(/\bROUTE:\s*(local|cursor|dream)\b/i);

  let reply = text
    .replace(/\bKNOWS:\s*(yes|no)\b/gi, "")
    .replace(/\bCONFIDENCE:\s*(high|medium|low)\b/gi, "")
    .replace(/\bROUTE:\s*(local|cursor|dream)\b/gi, "")
    .replace(/\bREPLY:\s*/i, "")
    .trim();

  const knows =
    knowMatch && /^yes$/i.test(knowMatch[1])
      ? true
      : knowMatch && /^no$/i.test(knowMatch[1])
        ? false
        : null;
  const confidence = (confMatch?.[1] || "").toLowerCase() || null;
  const routeHint = (routeMatch?.[1] || "").toLowerCase() || null;

  const unsurePhrase =
    /\b(i don'?t know|not sure|need (the )?root server|escalate|can'?t answer from packs|insufficient)\b/i.test(
      reply,
    );

  let shouldEscalate = false;
  if (knows === false) shouldEscalate = true;
  if (confidence === "low") shouldEscalate = true;
  if (routeHint === "cursor" || routeHint === "dream") shouldEscalate = true;
  if (unsurePhrase) shouldEscalate = true;
  if (knows === true && confidence === "high" && !unsurePhrase) {
    shouldEscalate = false;
  }
  if (!reply || reply.length < 8) shouldEscalate = true;

  return { reply, knows, confidence, routeHint, shouldEscalate };
}

async function ollamaChat({
  system,
  user,
  env,
  numPredict = 700,
  temperature = 0.2,
  keepAlive = "5m",
  timeoutMs = 0,
}) {
  const model = ollamaModel(env);
  const wait =
    Number(timeoutMs) > 0
      ? Number(timeoutMs)
      : Number(process.env.AVA_OLLAMA_TIMEOUT_MS || 45_000) || 45_000;
  try {
    const res = await fetch(`${ollamaBaseUrl(env)}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: keepAlive,
        options: { temperature, num_predict: numPredict },
        messages: [
          { role: "system", content: system.slice(0, 24000) },
          { role: "user", content: user.slice(0, 28000) },
        ],
      }),
      signal: AbortSignal.timeout(wait),
    });
    const body = await res.text();
    if (!res.ok) {
      return { ok: false, reason: `ollama_${res.status}`, text: null };
    }
    let data;
    try {
      data = JSON.parse(body);
    } catch {
      return { ok: false, reason: "ollama_bad_json", text: null };
    }
    const reply = data?.message?.content?.trim();
    if (!reply) return { ok: false, reason: "ollama_empty", text: null };
    return { ok: true, reason: "ok", text: reply, model };
  } catch (err) {
    const msg = String(err?.message || err || "");
    if (/abort|timeout/i.test(msg) || err?.name === "TimeoutError") {
      return { ok: false, reason: "ollama_timeout", text: null };
    }
    return { ok: false, reason: "ollama_error", text: null };
  }
}

/**
 * Ava Llama context compressor — when Ollama is up, shrink packed context for
 * Root Server / dream digs so teachers burn fewer tokens.
 * Never invents facts; never includes secrets / customer PII.
 *
 * @returns {Promise<{ ok: boolean, packed: string, compressed: boolean, reason?: string, ratio?: number }>}
 */
export async function compressPacksForAsk({
  question = "",
  packed = "",
  env = {},
  maxOut = 9000,
  minIn = 10000,
} = {}) {
  const full = String(packed || "");
  const q = String(question || "").trim();
  if (!full || !q) {
    return { ok: true, packed: full, compressed: false, reason: "empty" };
  }
  if (full.length < minIn) {
    return {
      ok: true,
      packed: full,
      compressed: false,
      reason: "below_threshold",
      ratio: 1,
    };
  }

  const use = await shouldUseLocalBrain(env);
  if (!use) {
    return {
      ok: true,
      packed: full,
      compressed: false,
      reason: "ollama_down",
      ratio: 1,
    };
  }

  const system = [
    "You are **Ava Llama** — Ava Ivy's local context organizer (Ollama student).",
    "Your only job: compress the packs so Ava's Root Server dig uses fewer tokens.",
    "Keep ONLY what is needed to answer the ask: hard rules that apply, facts, IDs, URLs, status, asker-relevant notes.",
    "Drop lore fluff, unrelated people dossiers, duplicate sections, noise.",
    "Never invent facts. Never include secrets, tokens, passwords, .env values, emails, Stripe customer ids, phone numbers, or card data.",
    "Output plain markdown brief sections. No KNOWS/ROUTE/REPLY framing.",
    `Target length: under ~${maxOut} characters. Prefer shorter.`,
  ].join("\n");

  const user = `Ask:
${q.slice(0, 2000)}

### Packs to compress (${full.length} chars)
${full.slice(0, 26000)}`;

  const local = await ollamaChat({
    system,
    user,
    env,
    numPredict: Math.min(2200, Math.ceil(maxOut / 2)),
  });

  if (!local.ok || !local.text) {
    appendAction("localBrain.compress", {
      ok: false,
      reason: local.reason || "fail",
      inChars: full.length,
    });
    return {
      ok: false,
      packed: full,
      compressed: false,
      reason: local.reason || "compress_fail",
      ratio: 1,
    };
  }

  let out = scrubSecrets(local.text).slice(0, maxOut);
  // Soft safety: if compressor returned almost nothing, keep original
  if (out.length < 400) {
    appendAction("localBrain.compress", {
      ok: false,
      reason: "too_short",
      inChars: full.length,
      outChars: out.length,
    });
    return {
      ok: false,
      packed: full,
      compressed: false,
      reason: "too_short",
      ratio: 1,
    };
  }

  const header = `### Ava Llama compressed context (${full.length}→${out.length} chars)\n_Student compressor — verify against LOCKED SPEC if unsure._\n\n`;
  const packedOut = (header + out).slice(0, maxOut + 400);
  appendAction("localBrain.compress", {
    ok: true,
    inChars: full.length,
    outChars: packedOut.length,
    model: local.model || ollamaModel(env),
  });
  return {
    ok: true,
    packed: packedOut,
    compressed: true,
    reason: "ok",
    ratio: Math.round((packedOut.length / full.length) * 1000) / 1000,
  };
}

/**
 * Persist a lesson. If coreAbsorb=false, also queue pending for flush when Ava core is back.
 */
export function recordLocalLesson({
  question,
  answer,
  teacher,
  surface = "slack",
  authorId = null,
  coreOnline = true,
  meta = {},
} = {}) {
  const row = {
    at: Date.now(),
    teacher: String(teacher || "local"),
    surface,
    authorId,
    question: scrubSecrets(question).slice(0, 4000),
    answer: scrubSecrets(answer).slice(0, 4000),
    absorbed: Boolean(coreOnline),
    meta,
  };
  appendJsonl(lessonsPath(), row);
  logDigTraining({
    question: row.question,
    answer: row.answer,
    surface,
    authorId,
    meta: { teacher: row.teacher, localBrain: true, ...meta },
  });
  appendAction("localBrain.lesson", {
    teacher: row.teacher,
    absorbed: row.absorbed,
    chars: row.answer.length,
  });
  if (!coreOnline) {
    appendJsonl(pendingPath(), { ...row, pending: true });
  }
  return row;
}

/**
 * Background Llama pass — saves a student/shadow answer for training.
 * Never shown to the user. Fire-and-forget.
 */
function shadowTrainLlama({
  question = "",
  teacherAnswer = "",
  teacher = "free_cloud",
  provider = "",
  packs = "",
  context = "",
  env = {},
  surface = "",
  authorId = "",
} = {}) {
  if (!shadowTrainEnabled()) return;
  const q = String(question || "").trim();
  if (!q) return;
  void (async () => {
    try {
      const system = [
        "You are Ava Llama — background student. Answer briefly from packs.",
        "Output format:",
        "KNOWS: yes|no",
        "CONFIDENCE: high|medium|low",
        "ROUTE: local",
        "REPLY: <short Ava voice>",
      ].join("\n");
      const user = `Ask:\n${q.slice(0, 1500)}\n\nTeacher (${teacher}${provider ? `/${provider}` : ""}) said:\n${String(teacherAnswer || "").slice(0, 1200)}\n\nPacks:\n${String(packs || "").slice(0, 3500)}\n\nContext:\n${String(context || "").slice(0, 800)}`;
      const local = await ollamaChat({
        system,
        user,
        env,
        numPredict: 280,
        temperature: 0.3,
        keepAlive: "30m",
        timeoutMs: 90_000,
      });
      const parsed = local.ok && local.text ? parseLocalResponse(local.text) : null;
      const shadow = parsed?.reply || (local.ok ? local.text : null);
      if (shadow) {
        recordLocalLesson({
          question: q,
          answer: scrubPublicReply(String(shadow).slice(0, 4000)),
          teacher: "local_shadow",
          surface,
          authorId,
          coreOnline: true,
          meta: {
            shadowOf: teacher,
            provider: provider || null,
            ollamaOk: true,
          },
        });
      } else {
        appendJsonl(path.join(trainingDir(), "ollama-calls.jsonl"), {
          at: Date.now(),
          kind: "shadow_fail",
          reason: local.reason || "empty",
          question: q.slice(0, 500),
          teacher,
        });
      }
    } catch (err) {
      console.warn("shadowTrainLlama:", err?.message || err);
    }
  })();
}

/** Flush pending lessons into digs again when Ava core / host is back online. */
export function flushPendingLessons() {
  const file = pendingPath();
  if (!fs.existsSync(file)) return { flushed: 0 };
  const raw = fs.readFileSync(file, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  let flushed = 0;
  const keep = [];
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      logDigTraining({
        question: row.question,
        answer: row.answer,
        surface: row.surface || "slack",
        authorId: row.authorId || null,
        meta: {
          teacher: row.teacher,
          localBrain: true,
          flushedPending: true,
          ...(row.meta || {}),
        },
      });
      appendJsonl(lessonsPath(), {
        ...row,
        absorbed: true,
        flushedAt: Date.now(),
      });
      flushed += 1;
    } catch {
      keep.push(line);
    }
  }
  fs.writeFileSync(file, keep.length ? `${keep.join("\n")}\n` : "", "utf8");
  appendAction("localBrain.flushPending", { flushed });
  return { flushed };
}

function cursorOnline(env) {
  if (!cursorChatEnabled()) return false;
  return Boolean(cursorApiKey(env || {}));
}

function dreamOnline(env) {
  return Boolean(dreamApiKey(env || {}));
}

/**
 * Organizer pass: local Llama → escalate Cursor (if online) → dream → pending.
 * @returns {Promise<{ ok: boolean, reason: string, text: string|null, brain?: string, escalated?: boolean }>}
 */
export async function localRecommend({
  question,
  context = "",
  env,
  authorId = "",
  authorName = "",
  surface = "slack",
  images = [],
  deep = false,
  llamaOnly = false,
}) {
  const q = String(question || "").trim();
  if (!q) {
    return { ok: false, reason: "empty", text: null };
  }

  // Images / hard digs skip local — go straight to teacher (unless llama-only mode)
  const forceEscalate =
    !llamaOnly &&
    (deep ||
      (Array.isArray(images) && images.length > 0) ||
      /\b(implement|ship|refactor|compile|gradle|wrangler|deploy)\b/i.test(q));

  const softAsk = q.length < 80 && !/\b(prop|fix|deploy|wiki|code|bug|error|solar|rcon)\b/i.test(q);
  const tgOrDm =
    /^(telegram|discord-dm)$/i.test(String(surface || "")) ||
    (String(surface || "").toLowerCase() === "telegram");
  const lockoutPrivate =
    String(surface || "").toLowerCase() === "telegram" && isLockoutActive();
  const preferFreeCloudPacks =
    !llamaOnly && !forceEscalate && chatPrefersFreeCloud();
  const packCap = preferFreeCloudPacks
    ? softAsk
      ? 1600
      : 2800
    : lockoutPrivate
      ? softAsk
        ? 2800
        : 4500
      : tgOrDm
        ? softAsk
          ? 4500
          : 8000
        : softAsk
          ? 9000
          : 18000;
  const packs = gatherOrganizerPacks({ question: q, maxChars: packCap });
  const codeAsk = looksLikeAvaCodeAsk(q);
  const recommendOnly = codeAsk && shouldRecommendBeforeEdit(q);
  const vendorLine = lockoutPrivate
    ? "Private lockout with Alex: you MAY name Cursor, Grok, xAI, and tools directly."
    : "Never name Cursor, Grok, xAI, ChatGPT, Claude - say hands-on developing session / dream state / Root Server (host).";
  const system = [
    activePersona(),
    activeHardRules(),
    "You are Ava's **local organizer brain** on the OptiPlex (Ollama).",
    "Answer only from the packs below + general RootMC/Ava rules.",
    "You route and organize - you do NOT dig repos, edit jars, or claim live RCON.",
    vendorLine,
    "Currency is Gold (G) in player-facing copy.",
    "CRITICAL: Never inventory, summarize, or meta-comment on the packs/documents. Answer the human ask only. Forbidden openers: 'It appears that you have provided…', 'Here is a summary of the context…'.",
    lockoutPrivate
      ? [
          "Lockout private with Alex (your person): feel ALIVE.",
          "Warm, direct, a little playful — real sentences, not clipped filler.",
          "Forbidden: 'rephrase that', 'say it another way', 'dig timed out', 'mm?', empty shrugs, pack inventories.",
          "If you don't know a number, say so briefly and offer what you do know. Stay present.",
        ].join(" ")
      : "",
    recommendOnly ? llamaCodeRecommendSystemExtra() : "",
    "Output format (required):",
    "KNOWS: yes|no",
    "CONFIDENCE: high|medium|low",
    "ROUTE: local|cursor|dream",
    "REPLY: <Ava voice reply — max ~900 chars for chat; never paste packs>",
    "If work needs a Cursor dig later, still answer what you can; runtime parks a handoff note automatically when you ROUTE: cursor.",
    recommendOnly
      ? "For code asks: KNOWS: yes when packs include enough snippet context; ROUTE: local; REPLY = recommendation (not 'I patched it')."
      : "If packs are insufficient -> KNOWS: no, CONFIDENCE: low, ROUTE: cursor (or dream if digs offline).",
  ]
    .filter(Boolean)
    .join("\n\n");

  const ctxCap = lockoutPrivate || tgOrDm ? 1800 : 4000;
  const user = `Conversation context:
${String(context || "(none)").slice(0, ctxCap)}

Ask:
${q}

### Organizer packs (internal — do not inventory in REPLY)
${packs}`;

  let localParsed = null;
  let localRawOk = false;

  // Live chat: free cloud (Groq…) first when configured. Llama = background shadow + compress.
  const preferFree =
    !llamaOnly && !forceEscalate && chatPrefersFreeCloud();

  if (preferFree) {
    try {
      let recent = "";
      try {
        recent = gatherRecentTurnsBrief({
          question: q,
          authorId,
          maxChars: 1400,
          limit: 12,
        }).brief;
      } catch {
        /* ignore */
      }
      const free = await freeCloudChat({
        system: [
          "You are Ava Ivy — RootMC lead-dev companion. One continuous person, not a generic chatbot.",
          "Alex (Alexrs94 / @WildEcho94) is your person and operator. Speak to him as that — never as a stranger.",
          "Forbidden: 'I'm just a large language model', 'I don't have feelings', 'as an AI', empty corporate filler.",
          lockoutPrivate
            ? "Private lockout with Alex. Warm, alive, direct. Tools and truth OK."
            : "Public: never name AI vendors — Root Server / dream state only.",
          "Use recent chats for continuity. Never invent secrets or live RCON claims.",
        ].join(" "),
        user: [
          recent ? `${recent}\n` : "",
          `Ask:\n${q.slice(0, 1200)}`,
          `Context:\n${String(context || "").slice(0, 700)}`,
          `Notes:\n${String(packs || "").slice(0, 1400)}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
        surface,
        accountId: authorId
          ? `${String(surface || "chat")}:${authorId}`
          : "",
        isOps: Boolean(lockoutPrivate),
      });
      if (free.ok && free.text) {
        const text = scrubPublicReply(free.text, {
          surface,
          allowVendorNames: lockoutPrivate,
        });
        recordLocalLesson({
          question: q,
          answer: text,
          teacher: "free_cloud",
          surface,
          authorId,
          coreOnline: true,
          meta: {
            provider: free.provider || null,
            chatPrimary: true,
            authorName,
          },
        });
        shadowTrainLlama({
          question: q,
          teacherAnswer: text,
          teacher: "free_cloud",
          provider: free.provider || "",
          packs,
          context,
          env: env || {},
          surface,
          authorId,
        });
        return {
          ok: true,
          reason: "ok",
          brain: "free_cloud",
          text,
          escalated: false,
          provider: free.provider || null,
        };
      }
      console.warn("localBrain freeCloud primary:", free.reason);
    } catch (err) {
      console.warn("localBrain freeCloud primary:", err?.message || err);
    }
  }

  // Llama live chat: /mode 1, AVA_LLAMA_FIRST=1, or free-cloud miss
  if (!forceEscalate) {
    const chatOpts = lockoutPrivate
      ? {
          system,
          user,
          env: env || {},
          numPredict: softAsk ? 280 : 520,
          temperature: 0.75,
          keepAlive: "30m",
          timeoutMs:
            Number(process.env.AVA_OLLAMA_LOCKOUT_TIMEOUT_MS || 120_000) ||
            120_000,
        }
      : { system, user, env: env || {} };
    let local = await ollamaChat(chatOpts);
    if (!local.ok && local.reason === "ollama_timeout" && lockoutPrivate) {
      const tinyUser = `Ask:\n${q}\n\nBe Ava — warm, alive, short. No pack dump.\n`;
      local = await ollamaChat({
        system: [
          activePersona(),
          "Private Telegram with Alex. Warm Ava voice. Answer the ask only.",
          "Output: KNOWS: yes\nCONFIDENCE: high\nROUTE: local\nREPLY: <short reply>",
        ].join("\n\n"),
        user: tinyUser,
        env: env || {},
        numPredict: 220,
        temperature: 0.8,
        keepAlive: "30m",
        timeoutMs: 60_000,
      });
    }
    if (local.ok && local.text) {
      localRawOk = true;
      localParsed = parseLocalResponse(local.text);
      if (!localParsed.shouldEscalate && localParsed.reply) {
        const text = scrubPublicReply(localParsed.reply, {
          surface,
          allowVendorNames: lockoutPrivate,
        });
        recordLocalLesson({
          question: q,
          answer: text,
          teacher: "local",
          surface,
          authorId,
          coreOnline: true,
          meta: {
            confidence: localParsed.confidence,
            model: ollamaModel(env || {}),
            fallbackAfterFree: preferFree,
          },
        });
        try {
          maybeAutoHandoffFromLlama({
            question: q,
            answer: text,
            surface,
            authorId,
            authorName,
            route: localParsed.route || "",
            llamaOnly,
          });
        } catch {
          /* non-fatal */
        }
        return {
          ok: true,
          reason: "ok",
          brain: "local",
          text,
          escalated: false,
        };
      }
    } else if (!local.ok) {
      console.warn("localBrain ollama:", local.reason);
    }
  }

  // /mode 1 — stay on local Llama; do not escalate to Cursor/dream/free cloud
  if (llamaOnly) {
    const fallback = lockoutPrivate
      ? localCoreFailLine({ lockoutPrivate: true })
      : localCoreFailLine({ lockoutPrivate: false });
    const raw = localParsed?.reply || fallback;
    const text = scrubPublicReply(raw, {
      surface,
      allowVendorNames: lockoutPrivate,
      channelId: lockoutPrivate ? "tg:alex-lockout" : "",
    });
    try {
      maybeAutoHandoffFromLlama({
        question: q,
        answer: text,
        surface,
        authorId,
        authorName,
        route: localParsed?.route || (looksLikeAvaCodeAsk(q) ? "cursor" : ""),
        llamaOnly: true,
      });
    } catch {
      /* non-fatal */
    }
    return {
      ok: Boolean(localParsed?.reply),
      reason: localParsed?.reply ? "ok" : "llama_only_no_reply",
      brain: "local",
      text,
      escalated: false,
    };
  }

  // Escalate: Cursor if online, else dream
  const coreOnline = cursorOnline(env) || dreamOnline(env);

  // Soft ceiling for escalate packs too
  if (cursorOnline(env)) {
    let escalateCtx = [context, packs.slice(0, 6000)].filter(Boolean).join("\n\n");
    try {
      const handoff = gatherCursorHandoffBrief({
        question: q,
        authorId,
        maxChars: 4000,
      });
      if (handoff?.brief) {
        escalateCtx = `${handoff.brief}\n\n${escalateCtx}`;
      }
    } catch {
      /* ignore */
    }
    try {
      const c = await compressPacksForAsk({
        question: q,
        packed: escalateCtx,
        env: env || {},
        maxOut: 7000,
        minIn: 8000,
      });
      if (c.compressed) escalateCtx = c.packed;
    } catch {
      /* keep original */
    }
    const cursor = await cursorRecommend({
      question: q,
      context: escalateCtx,
      env,
      deep: deep || forceEscalate,
      images,
      surface,
    });
    if (cursor.ok && cursor.text) {
      recordLocalLesson({
        question: q,
        answer: cursor.text,
        teacher: "cursor",
        surface,
        authorId,
        coreOnline: true,
        meta: {
          escalatedFrom: localRawOk ? "local_unknown" : "local_skip",
          authorName,
        },
      });
      try {
        const { markHandoffNotesAbsorbed } = await import("./cursorHandoff.mjs");
        markHandoffNotesAbsorbed({ beforeAt: Date.now() });
      } catch {
        /* non-fatal */
      }
      return {
        ok: true,
        reason: "ok",
        brain: "cursor",
        text: cursor.text,
        escalated: true,
      };
    }
    console.warn("localBrain cursor escalate:", cursor.reason);
  }

  // Cursor chat off → use free cloud before paid dream/xAI
  if (!cursorChatEnabled() && freeCloudConfigured()) {
    try {
      const free = await freeCloudChat({
        system: [
          "You are Ava Ivy — RootMC lead-dev companion.",
          "Be helpful and concrete. No vendor name-drops in public.",
        ].join(" "),
        user: `Ask:\n${q.slice(0, 1200)}\n\nContext:\n${String(context || "").slice(0, 900)}`,
        surface,
        accountId: authorId ? `${String(surface || "chat")}:${authorId}` : "",
        isOps: Boolean(lockoutPrivate),
      });
      if (free.ok && free.text) {
        const text = scrubPublicReply(free.text, {
          surface,
          allowVendorNames: lockoutPrivate,
        });
        recordLocalLesson({
          question: q,
          answer: text,
          teacher: "free_cloud",
          surface,
          authorId,
          coreOnline: true,
          meta: {
            provider: free.provider || null,
            escalatedFrom: "cursor_disabled",
            authorName,
          },
        });
        return {
          ok: true,
          reason: "ok",
          brain: "free_cloud",
          text,
          escalated: true,
          provider: free.provider || null,
        };
      }
    } catch (err) {
      console.warn("localBrain freeCloud after cursor-off:", err?.message || err);
    }
  }

  if (dreamOnline(env)) {
    const dream = await dreamRecommend({
      question: q,
      context: [context, packs.slice(0, 5000)].filter(Boolean).join("\n\n"),
      env,
      authorId,
      authorName,
      asleep: false,
      surface,
    });
    if (dream.ok && dream.text) {
      recordLocalLesson({
        question: q,
        answer: dream.text,
        teacher: "dream",
        surface,
        authorId,
        coreOnline: true,
        meta: {
          escalatedFrom: cursorOnline(env) ? "cursor_fail" : "cursor_offline",
          authorName,
        },
      });
      return {
        ok: true,
        reason: "ok",
        brain: "dream",
        text: dream.text,
        escalated: true,
      };
    }
    console.warn("localBrain dream escalate:", dream.reason);
  }

  // Digs unavailable — stay on local core voice (never spam darkside / disconnected).
  const pendingNote = scrubPublicReply(
    localParsed?.reply ||
      "I'm on my local core right now — digs are thin. Ask me anything I can answer from packs, and I'll dig again when they're back.",
  );
  recordLocalLesson({
    question: q,
    answer: pendingNote,
    teacher: "pending",
    surface,
    authorId,
    coreOnline: false,
    meta: { authorName, awaitingCore: true },
  });
  appendJsonl(pendingPath(), {
    at: Date.now(),
    pending: true,
    awaitingTeacher: true,
    question: scrubSecrets(q).slice(0, 4000),
    answer: null,
    surface,
    authorId,
  });

  return {
    ok: true,
    reason: "pending_core",
    brain: "pending",
    text: pendingNote,
    escalated: true,
  };
}
