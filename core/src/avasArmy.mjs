/**
 * Ava's Army — runtime department routing (Alex: "Make it a function").
 * Charter: Server Handoffs/Ava Ivy/plans/AVAS-ARMY-FOUNDATION.md
 * Internal org for Ava — not a player faction.
 */
import fs from "node:fs";
import path from "node:path";
import { AVA_HANDOFF } from "./config.mjs";

/** @typedef {"command"|"engineering"|"watch"|"continuity"|"relations"|"voice"|"treasury"} ArmyDeptId */

/** @type {Record<ArmyDeptId, { id: ArmyDeptId, name: string, short: string, digSurface: string, keywords: RegExp }>} */
export const ARMY_DEPARTMENTS = {
  command: {
    id: "command",
    name: "Command",
    short: "Ava + Alex absolute ops",
    digSurface: "slack",
    keywords: /\b(army|ava'?s?\s*army|command\s+tree|department\s+structure)\b/i,
  },
  engineering: {
    id: "engineering",
    name: "Engineering Corps",
    short: "plugins · Workers · site · app · Ava runtime",
    digSurface: "slack",
    keywords:
      /\b(plugin|jar|worker|wrangler|deploy|api\.rootmc|rootmc-api|gradle|paper|code\s*dig|patch|bug\s*fix)\b/i,
  },
  watch: {
    id: "watch",
    name: "Watch",
    short: "solar · EcoFlow · votes · Gold weirdness · uptime",
    digSurface: "slack",
    keywords:
      /\b(solar|ecoflow|host-?site|telemetry|uptime|battery|nws|vote\s*funny|reserve|pending.?check|hour\s*recap)\b/i,
  },
  continuity: {
    id: "continuity",
    name: "Continuity",
    short: "independence · failover · training · E/Linux",
    digSurface: "slack",
    keywords:
      /\b(independence|failover|optiplex|ubuntu|ssh|training\s*factory|e\s*handoff|mnt\/e|continuity)\b/i,
  },
  relations: {
    id: "relations",
    name: "Relations",
    short: "Discord players · Slack staff · gatekeep",
    digSurface: "mixed",
    keywords:
      /\b(discord|player\s*help|gatekeep|cadence|relations|community|welcome)\b/i,
  },
  voice: {
    id: "voice",
    name: "Voice & Lore",
    short: "persona · dream-pack · appearance · gold samples",
    digSurface: "mixed",
    keywords:
      /\b(persona|lore|dream.?pack|appearance|voice|gold\s*sample|paranoia|random\s*fact)\b/i,
  },
  treasury: {
    id: "treasury",
    name: "Treasury Advisory",
    short: "Ava slice · income ideas · expense honesty (no mint)",
    digSurface: "slack",
    keywords:
      /\b(treasury|stripe|expense|burn|income|finance|portfolio|wishlist|ava\s*slice)\b/i,
  },
};

const LORE_KEEP = [
  "lead-dev of RootMC ecosystem",
  "RootMC-centric protective care (clean + simple)",
  "dream state (Discord) vs Root Server (Slack digs)",
  "HI Pacific Solar Root Server + day/night solar voice",
  "time / latency / telemetry obsession",
  "independence nodes for her continuity",
  "Gold (G) · PROP gates for player features",
];

const LORE_BAN = [
  "NSA / Snowden / SIGINT-base bits",
  "sprawl world-conspiracy essays",
  "naming cloud AI vendors in public",
  "publishing host city",
  "minting player Gold for wishlist",
  "player faction / Discord role grind without Alex greenlight",
];

function statePath() {
  return path.join(AVA_HANDOFF, "data", "avas-army.json");
}

export function loadArmyState() {
  try {
    if (!fs.existsSync(statePath())) return defaultArmyState();
    const raw = JSON.parse(fs.readFileSync(statePath(), "utf8"));
    return { ...defaultArmyState(), ...raw };
  } catch {
    return defaultArmyState();
  }
}

function defaultArmyState() {
  return {
    id: "avas-army-v0",
    foundedAt: "2026-08-02T22:14:00.000Z",
    updatedAt: new Date().toISOString(),
    departments: Object.keys(ARMY_DEPARTMENTS),
    assignments: [],
  };
}

export function saveArmyState(state) {
  const next = {
    ...defaultArmyState(),
    ...state,
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

/** @returns {ArmyDeptId[]} */
export function listDepartmentIds() {
  return /** @type {ArmyDeptId[]} */ (Object.keys(ARMY_DEPARTMENTS));
}

export function getDepartment(id) {
  return ARMY_DEPARTMENTS[id] || null;
}

/**
 * Classify which army department owns a dig / ask.
 * @returns {{ dept: ArmyDeptId, name: string, tag: string, confidence: "high"|"soft"|"default" }}
 */
export function classifyArmyDept(text = "") {
  const q = String(text || "");
  /** @type {{ id: ArmyDeptId, score: number }[]} */
  const hits = [];
  for (const dept of Object.values(ARMY_DEPARTMENTS)) {
    if (dept.id === "command") continue;
    const m = q.match(dept.keywords);
    if (m) hits.push({ id: dept.id, score: m[0].length });
  }
  hits.sort((a, b) => b.score - a.score);
  if (hits.length && hits[0].score >= 4) {
    const d = ARMY_DEPARTMENTS[hits[0].id];
    return {
      dept: d.id,
      name: d.name,
      tag: armyTag(d.id),
      confidence: hits[0].score >= 8 ? "high" : "soft",
    };
  }
  if (/\bava'?s?\s*army\b|\barmy\s+department\b/i.test(q)) {
    const d = ARMY_DEPARTMENTS.command;
    return { dept: d.id, name: d.name, tag: armyTag(d.id), confidence: "high" };
  }
  return {
    dept: "engineering",
    name: ARMY_DEPARTMENTS.engineering.name,
    tag: armyTag("engineering"),
    confidence: "default",
  };
}

/** @param {ArmyDeptId|string} deptId */
export function armyTag(deptId) {
  return `army:${String(deptId || "engineering").toLowerCase()}`;
}

export function looksLikeArmyAsk(question = "") {
  const q = String(question || "");
  return (
    /\bava'?s?\s*army\b/i.test(q) ||
    /\barmy\s+(department|foundation|charter|roster|corps|rollcall)\b/i.test(q) ||
    /\b(which|what)\s+department\b/i.test(q) ||
    /\bdepartment\s+(tree|structure|brief)\b/i.test(q) ||
    /\b\/ava\s+rollcall\b|\barmy\s+rollcall\b/i.test(q)
  );
}

/**
 * Record a dig under a department (lightweight ledger).
 * @param {{ text?: string, dept?: ArmyDeptId, source?: string, jobId?: string }} opts
 */
export function assignArmyJob(opts = {}) {
  const classified = opts.dept
    ? {
        dept: opts.dept,
        name: ARMY_DEPARTMENTS[opts.dept]?.name || opts.dept,
        tag: armyTag(opts.dept),
        confidence: "high",
      }
    : classifyArmyDept(opts.text || "");
  const state = loadArmyState();
  const row = {
    at: new Date().toISOString(),
    dept: classified.dept,
    tag: classified.tag,
    source: String(opts.source || "").slice(0, 64),
    jobId: String(opts.jobId || "").slice(0, 64),
    preview: String(opts.text || "").replace(/\s+/g, " ").slice(0, 160),
  };
  state.assignments = [row, ...(state.assignments || [])].slice(0, 80);
  saveArmyState(state);
  stampArmyTraining(row);
  return { ...classified, row };
}

/** Continuity: tag good digs into training JSONL. */
function stampArmyTraining(row) {
  try {
    const dir = path.join(AVA_HANDOFF, "data", "training");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "army-digs.jsonl");
    fs.appendFileSync(
      file,
      `${JSON.stringify({
        at: row.at,
        tag: row.tag,
        dept: row.dept,
        source: row.source,
        jobId: row.jobId || undefined,
        preview: row.preview,
        kind: "army_training_stamp",
      })}\n`,
      "utf8",
    );
  } catch (err) {
    console.warn("army training stamp:", err.message);
  }
}

/** Soft rollcall text for Discord/Slack / whisper. */
export function formatArmyRollcall() {
  const state = loadArmyState();
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const recent = (state.assignments || []).filter((a) => {
    const t = Date.parse(a.at || "");
    return Number.isFinite(t) && t >= hourAgo;
  });
  const byDept = {};
  for (const a of recent) {
    byDept[a.dept] = (byDept[a.dept] || 0) + 1;
  }
  const lines = ["**Ava's Army · rollcall** (last ~1h digs)"];
  for (const id of listDepartmentIds()) {
    if (id === "command") continue;
    const d = ARMY_DEPARTMENTS[id];
    const n = byDept[id] || 0;
    lines.push(`- ${d.name}: ${n ? `${n} move${n === 1 ? "" : "s"}` : "standing by"}`);
  }
  if (!recent.length) lines.push("_quiet hour — soft standing only_");
  return lines.join("\n");
}

/** Plain-text tree for Discord/Slack. */
export function formatArmyTree() {
  const lines = ["**Ava's Army** (internal)", "Ava Ivy — Command"];
  for (const id of listDepartmentIds()) {
    if (id === "command") continue;
    const d = ARMY_DEPARTMENTS[id];
    lines.push(`- ${d.name} — ${d.short}`);
  }
  lines.push("", "tag digs: `army:<dept>` · charter: plans/AVAS-ARMY-FOUNDATION.md");
  return lines.join("\n");
}

/**
 * Prompt pack for recommend().
 * @param {{ question?: string }} opts
 */
export function gatherArmyBrief({ question = "" } = {}) {
  const ask = looksLikeArmyAsk(question);
  const route = classifyArmyDept(question);
  const state = loadArmyState();
  const recent = (state.assignments || [])
    .slice(0, 5)
    .map((a) => `- ${a.tag} · ${(a.preview || "").slice(0, 80)}`)
    .join("\n");

  const lines = [
    "### Ava's Army (runtime function)",
    "Internal departments for Ava — not a player faction. Alex absolute command on known ids.",
    `Routed this ask → **${route.name}** (\`${route.tag}\`, ${route.confidence})`,
    "",
    "Departments: " +
      listDepartmentIds()
        .filter((id) => id !== "command")
        .map((id) => ARMY_DEPARTMENTS[id].name)
        .join(" · "),
    "",
    "Lore KEEP: " + LORE_KEEP.slice(0, 4).join("; "),
    "Lore BAN: " + LORE_BAN.slice(0, 3).join("; "),
  ];
  if (ask) {
    lines.push("", formatArmyTree());
    lines.push("", formatArmyRollcall());
  }
  if (recent) {
    lines.push("", "Recent assignments:", recent);
  }
  return {
    ask,
    route,
    brief: lines.join("\n"),
  };
}

/** Ensure state file exists (boot / phase). */
export function ensureArmyFoundation() {
  const state = loadArmyState();
  if (!state.foundedAt) state.foundedAt = new Date().toISOString();
  return saveArmyState(state);
}
