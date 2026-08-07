/**
 * Token cost board + soft rate limits + per-server reserve isolation.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths } from "./store.mjs";

const DEFAULTS = {
  updatedAt: 0,
  surfaces: {
    cursor: { label: "Cursor Root Server", unit: "digs", used: 0, softCap: null },
    dream: { label: "Dream brain", unit: "replies", used: 0, softCap: null },
    discord: { label: "Discord API", unit: "msgs", used: 0, softCap: 400 },
    slack: { label: "Slack API", unit: "msgs", used: 0, softCap: 400 },
    telegram: { label: "Telegram ops", unit: "msgs", used: 0, softCap: null },
  },
  tiers: {
    free: { softUsdCeiling: 0.5, note: "modest Discord digs" },
    membership: { softUsdCeiling: 3, note: "~$5/mo → ~$3 usage soft ceiling" },
    operator: { softUsdCeiling: null, note: "uncapped ops" },
  },
  goldCredits: {
    enabled: true,
    note: "Gold (G) is Ava credit unit in player copy — never show dollars to players",
  },
  reserves: {
    primary: { gold: 0, pausedPayouts: false, isolated: true },
    claims: { gold: 0, pausedPayouts: false, isolated: true }, // legacy key
    towny: { gold: 0, pausedPayouts: false, isolated: true }, // legacy key
  },
  compareHostsOnlyWhenAsked: true,
};

function configPath() {
  return path.join(storePaths().dir, "token-economy.json");
}

export function loadTokenEconomy() {
  try {
    if (!fs.existsSync(configPath())) {
      const init = { ...DEFAULTS, updatedAt: Date.now() };
      saveTokenEconomy(init);
      return init;
    }
    return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(configPath(), "utf8")) };
  } catch {
    return { ...DEFAULTS, updatedAt: Date.now() };
  }
}

export function saveTokenEconomy(state) {
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  const next = { ...state, updatedAt: Date.now() };
  fs.writeFileSync(configPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

export function bumpSurfaceUse(surface, n = 1) {
  const s = loadTokenEconomy();
  if (!s.surfaces[surface]) return s;
  s.surfaces[surface].used = Number(s.surfaces[surface].used || 0) + n;
  return saveTokenEconomy(s);
}

/** Soft cap check — operators never blocked. */
export function softRateLimited({ surface, isOperator = false } = {}) {
  if (isOperator) return { limited: false };
  const s = loadTokenEconomy();
  const row = s.surfaces[surface];
  if (!row || row.softCap == null) return { limited: false };
  const limited = Number(row.used || 0) >= Number(row.softCap);
  return {
    limited,
    used: row.used,
    softCap: row.softCap,
    reply: limited
      ? "soft cap for now — membership or Gold credits unlock more digs. try again later."
      : null,
  };
}

export function reserveSnapshot() {
  const s = loadTokenEconomy();
  return {
    primary: s.reserves?.primary || s.reserves?.claims || DEFAULTS.reserves.primary,
    claims: s.reserves?.claims || DEFAULTS.reserves.claims,
    towny: s.reserves?.towny || DEFAULTS.reserves.towny,
    compareOnlyWhenAsked: !!s.compareHostsOnlyWhenAsked,
  };
}

export function tokenBoardText() {
  const s = loadTokenEconomy();
  const lines = ["Token / reserve board", ""];
  for (const [k, v] of Object.entries(s.surfaces || {})) {
    lines.push(
      `• ${v.label}: used=${v.used}${v.softCap != null ? ` / softCap=${v.softCap}` : ""} (${v.unit})`,
    );
  }
  const r = reserveSnapshot();
  lines.push(
    "",
    `Reserve primary: ${r.claims?.gold ?? r.primary?.gold ?? 0} G paused=${r.claims?.pausedPayouts ?? false}`,
    "Hosts isolated — compare only when asked.",
  );
  return lines.join("\n");
}
