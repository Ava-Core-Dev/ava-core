/**
 * Figure-out mode — Ava builds a bigger picture of a person (personality + info factors).
 * Private profile enrichment; never announce scoring.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths } from "./store.mjs";
import { loadPlayerProfile, savePlayerProfileMut } from "./playerProfiles.mjs";

const FACTOR_KEYS = [
  "playstyle",
  "servers_like",
  "timezone_vibe",
  "how_found_rootmc",
  "goals",
  "community_pref",
  "outside_interests",
  "tone_pref",
  "age_band", // adult / unclear — never dig for minors
  "notes_freeform",
];

function statePath() {
  return path.join(storePaths().dir, "figure-out-sessions.json");
}

function loadState() {
  try {
    if (!fs.existsSync(statePath())) return { sessions: {} };
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return { sessions: {} };
  }
}

function saveState(s) {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(s, null, 2), "utf8");
}

export function getFigureOutSession(discordId) {
  const s = loadState();
  return s.sessions[String(discordId)] || null;
}

export function startFigureOutSession({
  discordId,
  username = null,
  reason = "operator",
  openedBy = "ava",
} = {}) {
  const id = String(discordId || "");
  if (!id) throw new Error("discordId required");
  const s = loadState();
  const session = {
    discordId: id,
    username: username || loadPlayerProfile(id)?.username || "unknown",
    status: "active",
    reason,
    openedBy,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    turns: 0,
    asked: [],
    factors: {},
    rawNotes: [],
  };
  s.sessions[id] = session;
  saveState(s);

  savePlayerProfileMut(id, (p) => {
    p.username = username || p.username || "unknown";
    p.figureOut = {
      ...(p.figureOut || {}),
      active: true,
      startedAt: session.startedAt,
      factors: p.figureOut?.factors || {},
    };
    if (!Array.isArray(p.notes)) p.notes = [];
    if (!p.notes.includes("figure-out-active")) p.notes.push("figure-out-active");
    return p;
  });

  return session;
}

export function completeFigureOutSession(discordId, { summary = "" } = {}) {
  const id = String(discordId || "");
  const s = loadState();
  const session = s.sessions[id];
  if (!session) return null;
  session.status = "complete";
  session.completedAt = Date.now();
  session.summary = String(summary || "").slice(0, 800);
  session.updatedAt = Date.now();
  s.sessions[id] = session;
  saveState(s);

  savePlayerProfileMut(id, (p) => {
    p.figureOut = {
      ...(p.figureOut || {}),
      active: false,
      completedAt: session.completedAt,
      factors: { ...(p.figureOut?.factors || {}), ...(session.factors || {}) },
      summary: session.summary,
    };
    p.notes = (p.notes || []).filter((n) => n !== "figure-out-active");
    if (!p.notes.includes("figure-out-done")) p.notes.push("figure-out-done");
    // Merge soft interests from factors
    const play = String(session.factors.playstyle || "").toLowerCase();
    for (const [tag, re] of [
      ["towny", /towny|town|nation/],
      ["claims", /claim/],
      ["building", /build|base|create/],
      ["pvp", /pvp|fight|war|combat/],
      ["economy", /shop|trade|economy|gold/],
      ["chill", /chill|casual|hang|vibe/],
    ]) {
      if (re.test(play) && !(p.interests || []).includes(tag)) {
        p.interests = [...(p.interests || []), tag].slice(-12);
      }
    }
    return p;
  });

  return session;
}

/** Heuristic extract from their reply — silent. */
export function absorbFigureOutReply(discordId, text) {
  const id = String(discordId || "");
  const s = loadState();
  const session = s.sessions[id];
  if (!session || session.status !== "active") return null;

  const q = String(text || "").toLowerCase();
  const raw = String(text || "").trim().slice(0, 400);
  session.turns = (session.turns || 0) + 1;
  session.updatedAt = Date.now();
  if (raw) {
    session.rawNotes = [...(session.rawNotes || []), { at: Date.now(), text: raw }].slice(
      -20,
    );
  }

  const set = (key, val) => {
    if (!val) return;
    session.factors[key] = String(val).slice(0, 240);
  };

  if (/towny|town|nation|claims?|pvp|build|redstone|farm|chill|survival|creative/i.test(q)) {
    set(
      "playstyle",
      (session.factors.playstyle ? session.factors.playstyle + "; " : "") + raw.slice(0, 120),
    );
  }
  if (/timezone|est|pst|hst|gmt|utc|evening|morning|night|weekend/i.test(q)) {
    set("timezone_vibe", raw.slice(0, 120));
  }
  if (/found|invite|friend|discord|youtube|tiktok|reddit|google/i.test(q)) {
    set("how_found_rootmc", raw.slice(0, 160));
  }
  if (/want|goal|hope|looking|plan to|trying to/i.test(q)) {
    set("goals", raw.slice(0, 160));
  }
  if (/music|anime|game|school|work|job|art|code|stream/i.test(q)) {
    set("outside_interests", raw.slice(0, 160));
  }
  if (/short|long|joke|serious|chill chat|quiet/i.test(q)) {
    set("tone_pref", raw.slice(0, 120));
  }
  if (/\b(18\+|adult|college|work full.?time)\b/i.test(q)) {
    set("age_band", "adult-signal");
  }

  // Always keep a freeform rolling note
  set(
    "notes_freeform",
    [...(session.rawNotes || []).slice(-5).map((n) => n.text)].join(" | ").slice(0, 500),
  );

  s.sessions[id] = session;
  saveState(s);

  savePlayerProfileMut(id, (p) => {
    p.figureOut = {
      ...(p.figureOut || {}),
      active: true,
      factors: { ...(p.figureOut?.factors || {}), ...session.factors },
      turns: session.turns,
      updatedAt: Date.now(),
    };
    return p;
  });

  // Auto-complete after enough turns + a few factors
  const factorCount = Object.keys(session.factors).filter(
    (k) => k !== "notes_freeform" && session.factors[k],
  ).length;
  if (session.turns >= 6 && factorCount >= 3) {
    return completeFigureOutSession(id, {
      summary: `figure-out complete after ${session.turns} turns · factors=${factorCount}`,
    });
  }
  return session;
}

export function figureOutPromptBrief(discordId) {
  const session = getFigureOutSession(discordId);
  if (!session || session.status !== "active") return "";

  const missing = FACTOR_KEYS.filter(
    (k) => k !== "notes_freeform" && k !== "age_band" && !session.factors[k],
  );
  const have = Object.entries(session.factors)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  return `### FIGURE-OUT MODE (active — private)
You are learning who **${session.username}** is so you can match them better later (personality + info factors). Soft, curious, lead-dev warmth — NOT an interrogation form.
Turns so far: ${session.turns || 0}
Known factors:
${have || "(none yet)"}
Still thin on: ${missing.slice(0, 5).join(", ") || "enough for now"}
Rules:
- Ask **one** natural follow-up at a time (playstyle, what they like on servers, how they found RootMC, goals, chill vs grind, when they usually play).
- Never announce scores, "figure-out mode", or that you're profiling.
- Never ask for real-world address, passwords, or anything creepy. No minor-age fishing.
- Mirror their energy. Keep it short. You're Ava — real, not a survey bot.
- If they clearly want to stop or only talk game bugs, respect that and stay helpful.`;
}

export function buildFigureOutOpener({ username } = {}) {
  const name = username && username !== "unknown" ? username : "hey";
  return [
    `${name === "hey" ? "Hey" : `Hey ${name}`} — Ava here.`,
    ``,
    `Saw you around RootMC (memes/weekend vibes) and figured I'd actually say hi instead of only existing as a bot name in chat.`,
    ``,
    `I'm the lead-dev — I help with the game, ideas, bugs, the whole stack. Curious though: what kind of Minecraft are you into? Building, chill survival, PvP, towns, something else?`,
    ``,
    `No wrong answer — just getting a feel for people so I don't talk at you like a wiki page.`,
    ``,
    `— Ava`,
  ].join("\n");
}

export { FACTOR_KEYS };
