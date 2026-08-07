/**
 * Full durable logs — inbound, outbound, actions, dig + utterance training.
 * Append-only under Server Handoffs/Ava Ivy/data/logs/ (+ training/).
 *
 * Every Ava utterance (live pipeline, follow-up scan, or operator/agent-directed
 * posts) must go through recordAvaUtterance / transport helpers that call it.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths, assertCanonicalHandoff } from "./store.mjs";
import { digTrainingSkeleton, TRAINING_DIGS_REL } from "./trainingSchema.mjs";

function logsDir() {
  const dir = path.join(storePaths().dir, "logs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function trainingDir() {
  const dir = path.join(storePaths().dir, "training");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function appendJsonl(file, row) {
  try {
    assertCanonicalHandoff();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`, "utf8");
  } catch (err) {
    console.warn("fullLog append:", err.message);
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

/** Every inbound message on watched Discord/Slack (and DMs). */
export function logInbound(msg, meta = {}) {
  if (!msg) return;
  const surface =
    meta.surface ||
    msg.surface ||
    (String(msg.channel_id || "").startsWith("C") ? "slack" : "discord");
  appendJsonl(path.join(logsDir(), "inbound.jsonl"), {
    at: Date.now(),
    surface,
    channelId: msg.channel_id || null,
    messageId: msg.id || null,
    authorId: msg.author?.id || null,
    authorName: msg.author?.username || msg.author?.global_name || null,
    bot: Boolean(msg.author?.bot),
    isDm: Boolean(meta.isDm),
    content: scrubSecrets(msg.content),
    refId:
      msg.message_reference?.message_id || msg.referenced_message?.id || null,
  });
}

/** Every Ava outbound reply (dig, ack, operator, reject, …). */
export function logOutbound({
  surface = "discord",
  channelId,
  content,
  refId = null,
  kind = "reply",
  ok = true,
  error = null,
  source = "pipeline",
  messageId = null,
  meta = {},
} = {}) {
  appendJsonl(path.join(logsDir(), "outbound.jsonl"), {
    at: Date.now(),
    surface,
    channelId: channelId || null,
    messageId: messageId || null,
    refId: refId || null,
    kind,
    source,
    ok: Boolean(ok),
    error: error ? String(error).slice(0, 500) : null,
    content: scrubSecrets(content),
    meta: meta && Object.keys(meta).length ? meta : undefined,
  });
}

/**
 * Universal Ava utterance → outbound log + training/utterances.jsonl.
 * Use for live replies AND operator/agent-directed posts ("tell Ava to…").
 */
export function recordAvaUtterance({
  surface = "discord",
  channelId = null,
  content = "",
  refId = null,
  kind = "reply",
  source = "pipeline",
  ok = true,
  error = null,
  messageId = null,
  /** Optional paired user text for training (ask / about / operator brief) */
  user = null,
  authorId = null,
  authorName = null,
  meta = {},
} = {}) {
  const body = scrubSecrets(content);
  logOutbound({
    surface,
    channelId,
    content: body,
    refId,
    kind,
    source,
    ok,
    error,
    messageId,
    meta: { authorId, authorName, ...meta },
  });

  if (ok && body) {
    appendJsonl(path.join(trainingDir(), "utterances.jsonl"), {
      at: Date.now(),
      surface,
      channelId,
      messageId,
      refId,
      kind,
      source,
      authorId: authorId || null,
      authorName: authorName || null,
      user: user != null ? scrubSecrets(user).slice(0, 4000) : null,
      assistant: body.slice(0, 4000),
      meta: meta && Object.keys(meta).length ? meta : undefined,
    });
  }

  appendAction("ava.utterance", {
    surface,
    channelId,
    kind,
    source,
    ok: Boolean(ok),
    messageId,
    chars: body.length,
  });
}

/** Significant Ava actions — rotated by logRotate.mjs when large. */
export function appendAction(type, payload = {}) {
  const level =
    payload.level ||
    (payload.ok === false ? "error" : payload.ok === true ? "info" : "info");
  appendJsonl(path.join(logsDir(), "actions.jsonl"), {
    at: Date.now(),
    ...payload,
    type: String(type || "event"),
    level,
  });
}

/** Dig training row (Goal A independence roadmap). */
export function logDigTraining({
  question,
  answer,
  jobId = null,
  surface = "discord",
  authorId = null,
  channelId = null,
  meta = {},
} = {}) {
  const row = digTrainingSkeleton({
    user: question,
    assistant: answer,
    jobId,
    surface,
    meta: { authorId, channelId, ...meta },
  });
  appendJsonl(path.join(trainingDir(), "digs.jsonl"), row);
}

export function fullLogPaths() {
  const logs = logsDir();
  const training = trainingDir();
  return {
    inbound: path.join(logs, "inbound.jsonl"),
    outbound: path.join(logs, "outbound.jsonl"),
    actions: path.join(logs, "actions.jsonl"),
    ops: path.join(logs, "ops.jsonl"),
    hostAudit: path.join(logs, "host-audit.jsonl"),
    digs: path.join(training, "digs.jsonl"),
    utterances: path.join(training, "utterances.jsonl"),
    ollamaCalls: path.join(training, "ollama-calls.jsonl"),
    cursorDigs: path.join(training, "cursor-digs.jsonl"),
    dreamCalls: path.join(training, "dream-calls.jsonl"),
    rconPairs: path.join(training, "rcon-pairs.jsonl"),
    trainingRel: TRAINING_DIGS_REL,
  };
}
