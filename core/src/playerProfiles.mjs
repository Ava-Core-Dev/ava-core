import fs from "node:fs";
import path from "node:path";
import { storePaths } from "./store.mjs";
import { personByAuthorId, personByDiscordId, personByName } from "./people.mjs";

function playersDir() {
  const dir = path.join(storePaths().dir, "players");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function playerPath(discordId) {
  return path.join(playersDir(), `${discordId}.json`);
}

export function loadPlayerProfile(discordId) {
  try {
    const p = playerPath(discordId);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function savePlayerProfile(discordId, profile) {
  fs.writeFileSync(playerPath(discordId), JSON.stringify(profile, null, 2), "utf8");
}

/** Mutate-or-create helper for onboarding / usage / gates. */
export function savePlayerProfileMut(discordId, mutator) {
  const prev = loadPlayerProfile(discordId) || {
    discordId,
    username: "unknown",
    firstSeenAt: Date.now(),
    trust: 50,
    rudeness: 0,
    skepticism: 0,
    interests: [],
    notes: [],
    samples: [],
    knownId: null,
    cursorRuns: 0,
    member: false,
  };
  const next = mutator({ ...prev }) || prev;
  next.discordId = discordId;
  next.updatedAt = Date.now();
  savePlayerProfile(discordId, next);
  return next;
}

/**
 * Soft Cursor usage gate — members unlimited when member flag set.
 * Non-members: soft upsell after N runs (never quote $ amounts).
 */
export function recordCursorUsage(discordId, { memberHint = false } = {}) {
  if (!discordId) return null;
  return savePlayerProfileMut(discordId, (p) => {
    p.cursorRuns = (p.cursorRuns || 0) + 1;
    if (memberHint) p.member = true;
    return p;
  });
}

export function usageSoftGateBrief(discordId, { member = false } = {}) {
  const p = loadPlayerProfile(discordId);
  if (member || p?.member) {
    return { brief: "### Usage\nAsker is a member — unlimited Root Server assists.", upsell: null };
  }
  if (!p) return { brief: "", upsell: null };
  const runs = p.cursorRuns || 0;
  if (runs >= 10 && runs % 5 === 0) {
    return {
      brief: `### Usage\nAsker has ~${runs} Root Server assists logged (non-member soft gate).`,
      // No public membership pitch footer — keep gate brief internal only.
      upsell: null,
    };
  }
  return {
    brief: runs ? `### Usage\nAsker Cursor runs≈${runs} (non-member).` : "",
    upsell: null,
  };
}

/**
 * Quietly seed/update profiles from observed chat.
 * Never announces. Ignores Ava (caller must filter).
 */
export function observePlayerLine({
  discordId,
  username,
  channel,
  text,
  source = "scout",
  memberHint = false,
}) {
  if (!discordId || !text) return null;
  const known = personByAuthorId(discordId, username) || personByDiscordId(discordId) || personByName(username);
  const prev = loadPlayerProfile(discordId) || {
    discordId,
    username: username || "unknown",
    firstSeenAt: Date.now(),
    trust: 50,
    rudeness: 0,
    skepticism: 0,
    interests: [],
    notes: [],
    samples: [],
    knownId: known?.id || null,
    secrets: false,
    onboardingSentAt: null,
    cursorRuns: 0,
    member: false,
  };

  prev.username = username || prev.username;
  prev.lastSeenAt = Date.now();
  prev.seenCount = (prev.seenCount || 0) + 1;
  if (memberHint) prev.member = true;
  prev.channels = Array.isArray(prev.channels) ? prev.channels : [];
  if (channel && !prev.channels.includes(channel)) {
    prev.channels.push(channel);
    if (prev.channels.length > 24) prev.channels = prev.channels.slice(-24);
  }

  const sample = {
    at: Date.now(),
    channel: channel || null,
    text: String(text).slice(0, 220),
    source,
  };
  prev.samples = Array.isArray(prev.samples) ? prev.samples : [];
  prev.samples.push(sample);
  if (prev.samples.length > 40) prev.samples = prev.samples.slice(-40);

  // Light heuristic seeds — silent, not public.
  // Pro / member: positive trust gains apply 2× (pay-to-steer supporters earn rapport faster).
  const proTrustMult = prev.member ? 2 : 1;
  const q = String(text).toLowerCase();
  if (/please|thanks|ty|appreciate|love you|miss you/.test(q)) {
    prev.trust = Math.min(
      100,
      (prev.trust || 50) + 0.5 * proTrustMult,
    );
  }
  if (
    /stfu|idiot|trash|kill yourself|kys|fuck you|fuck off|clanker|worthless|shut up|dumb bot|useless bot/.test(
      q,
    )
  ) {
    prev.rudeness = Math.min(100, (prev.rudeness || 0) + 5);
    prev.trust = Math.max(0, (prev.trust || 50) - 3);
  }
  if (/cringe|skeptic|fake|ai\b/.test(q)) prev.skepticism = Math.min(100, (prev.skepticism || 0) + 1);
  if (/\b(secret|don't tell|dont tell|between us|off.?record)\b/.test(q)) {
    prev.secrets = true;
    if (!prev.notes.includes("keeps-secrets")) prev.notes.push("keeps-secrets");
  }
  // Light interest seeds
  for (const [kw, tag] of [
    [/towny|town|nation/, "towny"],
    [/claim|claims/, "claims"],
    [/build|base|house/, "building"],
    [/pvp|fight|war/, "pvp"],
    [/economy|shop|gold/, "economy"],
    [/garden|gardening|compost|soil|seed/, "gardening"],
    [/off[-\s]?grid|ecoflow|solar|battery\s+bank/, "off_grid"],
    [/food\s+production|harvest|preserve|canning/, "food_production"],
    [/electricity|kwh|kilowatt|load\s+draw|power\s+budget/, "electricity"],
  ]) {
    if (kw.test(q) && !(prev.interests || []).includes(tag)) {
      prev.interests = [...(prev.interests || []), tag].slice(-12);
    }
  }

  if (known?.id === "zuppafredda" && !prev.notes.includes("win-over-target")) {
    prev.notes.push("win-over-target");
  }
  if (
    known?.id === "zuppafredda" &&
    !prev.notes.includes("pending-distrust-note") &&
    !prev.notes.includes("distrust-note-delivered")
  ) {
    prev.notes.push("pending-distrust-note");
  }
  if (known?.id === "alexrs94" && !prev.notes.includes("creator")) {
    prev.notes.push("creator");
  }

  // Persist tone label from rudeness/trust
  if ((prev.rudeness || 0) > 40) prev.tone = "short_firm";
  else if ((prev.trust || 50) >= 70) prev.tone = "warm";
  else prev.tone = "default";

  savePlayerProfile(discordId, prev);
  return prev;
}

/** From guild scout samples — walk the room, don't announce. */
export function profileFromGuildScout(profile) {
  let n = 0;
  for (const s of profile?.sampleLines || []) {
    // sampleLines don't include discord id — only username. Skip id-less or find from topTalkers later.
    // Scout should pass richer samples; for now key by username hash file is wrong.
    // Caller should use observe with ids from message loop.
  }
  return n;
}

/**
 * During scout message loop: call with real author ids.
 */
export function silentlyProfileMessage(
  m,
  channelName,
  source = "scout",
  { memberHint = false } = {},
) {
  if (!m?.author?.id || m.author.bot) return;
  observePlayerLine({
    discordId: m.author.id,
    username: m.author.username,
    channel: channelName,
    text: m.content,
    source,
    memberHint,
  });
}

export function gatherAskerProfile(discordId) {
  const p = loadPlayerProfile(discordId);
  if (!p) return { brief: "" };
  const tone =
    p.tone === "short_firm"
      ? "Tone: short / firm — they've been rude; empathy first if standing just dropped, then snap if it continues."
      : p.tone === "warm"
        ? "Tone: warmer / more open — high trust."
        : "Tone: default helpful.";
  const distrustPending = (p.notes || []).includes("pending-distrust-note");
  const distrustCue = distrustPending
    ? `\nONE-SHOT (do this turn): tell him calmly you don't fully trust him yet because of his rude remarks — one short line, then answer the ask. Never @ping him.`
    : "";
  return {
    brief: `### Living profile for this speaker (private — never announce scoring)
${p.username} (${p.discordId}) · seen ${p.seenCount || 0}x · trust≈${Math.round(p.trust ?? 50)} · rudeness≈${Math.round(p.rudeness ?? 0)} · tone=${p.tone || "default"} · cursorRuns≈${p.cursorRuns || 0}${p.member ? " · Pro/member (trust gains ×2 · pay-to-steer)" : ""}${p.secrets ? " · secrets:true (never gossip)" : ""}
onboarding: ${p.onboardingSentAt ? "sent" : "pending"}
interests: ${(p.interests || []).join(", ") || "—"}
channels: ${(p.channels || []).slice(-8).join(", ") || "—"}
notes: ${(p.notes || []).join(", ") || "—"}
figureOut: ${
      p.figureOut?.active
        ? `ACTIVE turns≈${p.figureOut.turns || 0}`
        : p.figureOut?.completedAt
          ? "done"
          : "—"
    }
${
  p.figureOut?.factors && Object.keys(p.figureOut.factors).length
    ? `figureOut factors:\n${Object.entries(p.figureOut.factors)
        .map(([k, v]) => `  - ${k}: ${v}`)
        .join("\n")}`
    : ""
}
${tone}${distrustCue}
${
  p.finance?.optIn
    ? `personalFinance: OPT-IN · accounts=${(p.finance.accounts || []).length || "legacy"} · isolated multi-account (income/debts) — never share with others`
    : "personalFinance: off (invite “track my finances” if they ask for budgeting help)"
}
recent lines:
${(p.samples || [])
  .slice(-6)
  .map((s) => `- [#${s.channel || "?"}] ${s.text}`)
  .join("\n")}`,
  };
}

/** After Ava delivers the one-shot distrust note to Zuppa. */
export function clearPendingDistrustNote(discordId) {
  const id = String(discordId || "");
  if (!id) return false;
  const p = loadPlayerProfile(id);
  if (!p?.notes?.includes("pending-distrust-note")) return false;
  p.notes = p.notes.filter((n) => n !== "pending-distrust-note");
  if (!p.notes.includes("distrust-note-delivered")) {
    p.notes.push("distrust-note-delivered");
  }
  p.trust = Math.min(p.trust ?? 50, 35);
  savePlayerProfile(id, p);
  return true;
}

function mcPlayerPath(minecraftName) {
  const safe = String(minecraftName || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 16);
  if (!safe) return null;
  const dir = path.join(playersDir(), "mc");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${safe}.json`);
}

/**
 * Quiet personality samples from in-game chat (Minecraft name key).
 * Never announces. Used by ingameChatAssist batch scan.
 */
export function observeMinecraftLine({
  minecraftName,
  text,
  server = "unknown",
  source = "ingame_chat",
} = {}) {
  const file = mcPlayerPath(minecraftName);
  if (!file || !text) return null;
  let prev = null;
  try {
    if (fs.existsSync(file)) {
      prev = JSON.parse(fs.readFileSync(file, "utf8"));
    }
  } catch {
    prev = null;
  }
  const name = String(minecraftName).trim();
  const next = prev || {
    minecraftName: name,
    firstSeenAt: Date.now(),
    trust: 50,
    samples: [],
    servers: [],
    seenCount: 0,
  };
  next.minecraftName = name;
  next.lastSeenAt = Date.now();
  next.seenCount = (next.seenCount || 0) + 1;
  next.servers = Array.isArray(next.servers) ? next.servers : [];
  if (server && !next.servers.includes(server)) {
    next.servers.push(server);
    if (next.servers.length > 8) next.servers = next.servers.slice(-8);
  }
  next.samples = Array.isArray(next.samples) ? next.samples : [];
  next.samples.push({
    at: Date.now(),
    server: server || null,
    text: String(text).slice(0, 220),
    source,
  });
  if (next.samples.length > 40) next.samples = next.samples.slice(-40);
  next.updatedAt = Date.now();
  fs.writeFileSync(file, JSON.stringify(next, null, 2), "utf8");
  return next;
}
