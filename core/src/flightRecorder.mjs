/**
 * Ava flight recorder — shared durable memory for Llama / Cursor / Grok brains.
 * Append-only under AVA_HANDOFF/data/ (logs + training). Secrets scrubbed.
 *
 * Target: any brain can load gatherOpsContextPack() and continue Ava's purpose
 * without the laptop.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { storePaths } from "./store.mjs";
import { appendAction } from "./fullLog.mjs";
import { rotateHotLogs } from "./logRotate.mjs";
import { syncLogIndex } from "./logIndex.mjs";
import { logOps } from "./logOps.mjs";

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

function flightDir() {
  const dir = path.join(storePaths().dir, "flight");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function appendJsonl(file, row) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(row)}\n`, "utf8");
  } catch (err) {
    console.warn("flightRecorder append:", err.message);
  }
}

export function scrubFlightText(text, max = 12000) {
  return String(text || "")
    .replace(/xox[baprs]-[A-Za-z0-9-]+/g, "[redacted-token]")
    .replace(/xapp-[A-Za-z0-9-]+/g, "[redacted-token]")
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [redacted]")
    .replace(
      /(?:api[_-]?key|token|password|secret|jdbc)\s*[:=]\s*\S+/gi,
      "$1=[redacted]",
    )
    .replace(/key_[A-Za-z0-9]{20,}/g, "[redacted-key]")
    .slice(0, max);
}

export function flightPaths() {
  const logs = logsDir();
  const training = trainingDir();
  const flight = flightDir();
  return {
    cursorDigs: path.join(training, "cursor-digs.jsonl"),
    dreamCalls: path.join(training, "dream-calls.jsonl"),
    rconPairs: path.join(training, "rcon-pairs.jsonl"),
    hostAudit: path.join(logs, "host-audit.jsonl"),
    patches: path.join(flight, "patches.jsonl"),
    brainEvents: path.join(flight, "brain-events.jsonl"),
    opsSnapshot: path.join(flight, "ops-snapshot.json"),
  };
}

/** Cursor Root Server dig — prompt + result (+ tool traces when SDK exposes them). */
export function recordCursorDig({
  question = "",
  prompt = "",
  resultText = "",
  ok = false,
  reason = "",
  runId = null,
  agentId = null,
  surface = "discord",
  deep = false,
  selfFix = false,
  durationMs = null,
  rawResult = null,
  meta = {},
} = {}) {
  const tools = extractToolTrace(rawResult);
  const row = {
    at: Date.now(),
    brain: "cursor",
    ok: Boolean(ok),
    reason: reason || null,
    surface,
    deep: Boolean(deep),
    selfFix: Boolean(selfFix),
    runId: runId || null,
    agentId: agentId || null,
    durationMs: durationMs == null ? null : Number(durationMs),
    question: scrubFlightText(question, 4000),
    promptSnippet: scrubFlightText(prompt, 8000),
    resultSnippet: scrubFlightText(resultText, 8000),
    toolTrace: tools,
    meta: meta && Object.keys(meta).length ? meta : undefined,
  };
  appendJsonl(flightPaths().cursorDigs, row);
  appendAction("flight.cursorDig", {
    ok: row.ok,
    reason: row.reason,
    runId: row.runId,
    surface,
    deep,
    selfFix,
    durationMs: row.durationMs,
    tools: Array.isArray(tools) ? tools.length : 0,
  });
  appendJsonl(flightPaths().brainEvents, {
    at: row.at,
    brain: "cursor",
    kind: "dig",
    ok: row.ok,
    surface,
    question: row.question.slice(0, 500),
  });
  return row;
}

function extractToolTrace(rawResult) {
  if (!rawResult || typeof rawResult !== "object") return [];
  const out = [];
  const bag =
    rawResult.toolCalls ||
    rawResult.tools ||
    rawResult.events ||
    rawResult.messages ||
    rawResult.steps ||
    [];
  if (Array.isArray(bag)) {
    for (const step of bag.slice(0, 80)) {
      if (!step || typeof step !== "object") continue;
      out.push({
        type: step.type || step.role || step.kind || "step",
        name: step.name || step.tool || step.toolName || null,
        snippet: scrubFlightText(
          step.result || step.content || step.text || step.output || JSON.stringify(step).slice(0, 1500),
          2000,
        ),
      });
    }
  }
  // Capture unknown useful keys for later parsers
  const extraKeys = Object.keys(rawResult).filter(
    (k) =>
      !["id", "agentId", "status", "result", "error"].includes(k) &&
      rawResult[k] != null,
  );
  if (extraKeys.length && !out.length) {
    out.push({
      type: "result_keys",
      name: null,
      snippet: scrubFlightText(extraKeys.join(","), 500),
    });
  }
  return out;
}

/** Grok / dream-state call transcript (unified with training tree). */
export function recordDreamCall({
  question = "",
  system = "",
  user = "",
  reply = "",
  ok = false,
  reason = "",
  surface = "discord",
  asleep = false,
  model = "",
  durationMs = null,
  meta = {},
} = {}) {
  const row = {
    at: Date.now(),
    brain: "dream",
    ok: Boolean(ok),
    reason: reason || null,
    surface,
    asleep: Boolean(asleep),
    model: model || null,
    durationMs: durationMs == null ? null : Number(durationMs),
    question: scrubFlightText(question, 4000),
    systemSnippet: scrubFlightText(system, 6000),
    userSnippet: scrubFlightText(user, 8000),
    replySnippet: scrubFlightText(reply, 8000),
    meta: meta && Object.keys(meta).length ? meta : undefined,
  };
  appendJsonl(flightPaths().dreamCalls, row);
  appendAction("flight.dreamCall", {
    ok: row.ok,
    reason: row.reason,
    surface,
    asleep,
    durationMs: row.durationMs,
  });
  appendJsonl(flightPaths().brainEvents, {
    at: row.at,
    brain: "dream",
    kind: "call",
    ok: row.ok,
    surface,
    question: row.question.slice(0, 500),
  });
  return row;
}

/** RCON command + output pair. */
export function recordRconPair({
  command = "",
  output = "",
  ok = false,
  reason = "",
  target = null,
  allow = false,
} = {}) {
  const row = {
    at: Date.now(),
    brain: "host",
    kind: "rcon",
    ok: Boolean(ok),
    reason: reason || null,
    target: target || null,
    allow: Boolean(allow),
    command: scrubFlightText(command, 500),
    output: scrubFlightText(output, 4000),
  };
  appendJsonl(flightPaths().rconPairs, row);
  appendAction("flight.rcon", {
    ok: row.ok,
    reason: row.reason,
    target: row.target,
    cmdChars: row.command.length,
  });
  return row;
}

/** File patch / diff note (when a brain edits Ava-owned files). */
export function recordPatch({
  brain = "cursor",
  paths = [],
  summary = "",
  diffSnippet = "",
  meta = {},
} = {}) {
  const row = {
    at: Date.now(),
    brain,
    paths: (Array.isArray(paths) ? paths : [paths])
      .map((p) => String(p || "").slice(0, 300))
      .filter(Boolean)
      .slice(0, 40),
    summary: scrubFlightText(summary, 2000),
    diffSnippet: scrubFlightText(diffSnippet, 8000),
    meta: meta && Object.keys(meta).length ? meta : undefined,
  };
  appendJsonl(flightPaths().patches, row);
  appendAction("flight.patch", {
    brain,
    files: row.paths.length,
    summaryChars: row.summary.length,
  });
  return row;
}

function sh(cmd, args, timeoutMs = 8000) {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 256_000,
    }).trim();
  } catch (err) {
    return `ERR: ${String(err?.message || err).slice(0, 200)}`;
  }
}

/** Snapshot host state Ava owns (mounts, disk, units, ollama). */
export function recordHostAudit({ reason = "tick", extra = {} } = {}) {
  const snapshot = {
    at: Date.now(),
    reason: String(reason || "tick").slice(0, 80),
    hostname: sh("hostname", []),
    uptime: sh("uptime", ["-p"]),
    df: sh("df", ["-h", "/", "/mnt/e"]),
    mounts: sh("findmnt", ["-n", "-o", "TARGET,SOURCE,FSTYPE", "/mnt/e"]),
    avaIvy: sh("systemctl", ["is-active", "ava-ivy"]),
    ollama: sh("systemctl", ["is-active", "ollama"]),
    ollamaPs: sh("ollama", ["ps"]),
    ...extra,
  };
  appendJsonl(flightPaths().hostAudit, {
    at: snapshot.at,
    reason: snapshot.reason,
    hostname: snapshot.hostname,
    uptime: scrubFlightText(snapshot.uptime, 300),
    df: scrubFlightText(snapshot.df, 800),
    mounts: scrubFlightText(snapshot.mounts, 400),
    avaIvy: snapshot.avaIvy,
    ollama: snapshot.ollama,
    ollamaPs: scrubFlightText(snapshot.ollamaPs, 500),
  });
  try {
    fs.writeFileSync(
      flightPaths().opsSnapshot,
      JSON.stringify(snapshot, null, 2),
      "utf8",
    );
  } catch (err) {
    console.warn("flightRecorder snapshot:", err.message);
  }
  appendAction("flight.hostAudit", { reason: snapshot.reason });
  return snapshot;
}

function tailJsonl(file, n = 8) {
  try {
    if (!fs.existsSync(file)) return [];
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
    return lines.slice(-n).map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line.slice(0, 200) };
      }
    });
  } catch {
    return [];
  }
}

/**
 * Shared ops context every brain should load before acting.
 * Lean by design — full trees stay on disk under data/.
 */
export function gatherOpsContextPack({ maxChars = 6500 } = {}) {
  const paths = flightPaths();
  const snap = (() => {
    try {
      return JSON.parse(fs.readFileSync(paths.opsSnapshot, "utf8"));
    } catch {
      return null;
    }
  })();

  const recent = {
    cursor: tailJsonl(paths.cursorDigs, 3),
    dream: tailJsonl(paths.dreamCalls, 3),
    rcon: tailJsonl(paths.rconPairs, 3),
    host: tailJsonl(paths.hostAudit, 2),
    llama: tailJsonl(path.join(trainingDir(), "ollama-calls.jsonl"), 3),
  };

  const lines = [
    "### Ava flight recorder (shared · Llama/Cursor/Grok)",
    "Canonical: /mnt/e/.Ava_Ivy/data — logs/, training/, flight/",
    "Rule: all brains read+write this tree. No private silos. Secrets redacted.",
    "",
    "Stores:",
    "- logs/inbound|outbound|actions|host-audit.jsonl",
    "- training/digs|utterances|local-lessons|ollama-calls|cursor-digs|dream-calls|rcon-pairs.jsonl",
    "- flight/ops-snapshot.json · brain-events.jsonl · patches.jsonl",
    "",
  ];

  if (snap) {
    lines.push(
      `Host snapshot (${snap.reason || "?"} @ ${snap.at || "?"}):`,
      `  hostname: ${snap.hostname || "?"}`,
      `  ava-ivy: ${snap.avaIvy || "?"} · ollama: ${snap.ollama || "?"}`,
      `  uptime: ${String(snap.uptime || "").slice(0, 120)}`,
      `  /mnt/e: ${String(snap.mounts || "").slice(0, 160)}`,
      "",
    );
  }

  const briefRecent = (label, rows, pick) => {
    if (!rows.length) {
      lines.push(`${label}: (none yet)`);
      return;
    }
    lines.push(`${label}:`);
    for (const r of rows) {
      lines.push(`  - ${pick(r)}`);
    }
  };

  briefRecent("Recent Llama", recent.llama, (r) =>
    `${r.kind || "call"} ok=${r.ok} ${(r.question || r.reason || "").slice(0, 80)}`,
  );
  briefRecent("Recent Cursor digs", recent.cursor, (r) =>
    `ok=${r.ok} ${r.reason || ""} ${(r.question || "").slice(0, 80)}`,
  );
  briefRecent("Recent dream", recent.dream, (r) =>
    `ok=${r.ok} ${(r.question || "").slice(0, 80)}`,
  );
  briefRecent("Recent RCON", recent.rcon, (r) =>
    `${r.target || "?"} ${r.command || ""} → ${(r.output || r.reason || "").slice(0, 60)}`,
  );

  lines.push(
    "",
    "Operator lock (Alex 2026-08-03/04): full machine memory — three brains see+operate ava-core for Ava's purpose. Telegram = master personal comms; Llama free-talk with Alex; Discord stays dream communal.",
  );

  return {
    brief: lines.join("\n").slice(0, maxChars),
    paths,
    snapshot: snap,
  };
}

let _hostTimer = null;

/** Boot + periodic host audit (does not block Discord). */
export function startFlightRecorderLoops({ intervalMs = 15 * 60_000 } = {}) {
  try {
    recordHostAudit({ reason: "boot" });
  } catch (err) {
    console.warn("flightRecorder boot:", err.message);
  }
  if (_hostTimer) clearInterval(_hostTimer);
  _hostTimer = setInterval(() => {
    try {
      recordHostAudit({ reason: "interval" });
      try {
        rotateHotLogs();
      } catch (err) {
        logOps({ type: "log.rotate", level: "warn", error: err.message, ok: false });
      }
      try {
        syncLogIndex();
      } catch (err) {
        logOps({ type: "log.index", level: "warn", error: err.message, ok: false });
      }
    } catch (err) {
      console.warn("flightRecorder tick:", err.message);
    }
  }, Math.max(60_000, intervalMs));
  return { intervalMs: Math.max(60_000, intervalMs) };
}
