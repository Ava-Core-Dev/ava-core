/**
 * Fern Forest Hawaii — Telegram group profile (light utility only).
 * Vault-isolated to chat -1003868178598. Deprioritized 2026-08-02:
 * solar / weather / Kīlauea-alert offers on ask — NOT deep gardening digs.
 */
import fs from "node:fs";
import path from "node:path";
import { groupVaultId, isTelegramGroupChannel } from "./telegramGroupVault.mjs";
import { telegramChatIdFromChannel, isTelegramChannelId } from "./telegramApi.mjs";
import { gatherEcoBrief } from "./ecoflow.mjs";
import { storePaths } from "./store.mjs";

export const FERN_FOREST_CHAT_ID = "-1003868178598";
export const FERN_FOREST_PROFILE_ID = "fern-forest-hawaii-v1";

const DEFAULT_PROFILE = {
  id: FERN_FOREST_PROFILE_ID,
  title: "Fern Forest Hawaii",
  chatId: FERN_FOREST_CHAT_ID,
  priority: "light-utility",
  deprioritizedAt: "2026-08-02",
  community:
    "Fern Forest Hawaii / Fern Forest Operations — friendly crew near the HI Pacific Solar Root Server; Ava is a light utility guest here, not the full-time garden companion",
  voice: {
    warmth: "medium",
    tone: "warm but brief — RootMC lead-dev visiting with solar/weather utility crumbs; main-server brain first",
    traits: [
      "PRIMARY identity: RootMC lead-dev / main-server brain (game, solar host site, digs) — Fern Forest is NOT your home personality lane",
      "THIS group = light utility only: solar + weather on ask; Kīlauea / volcano alerts when asked (wire or check — never invent live volcano data)",
      "do NOT self-determine gardening digs, invent grow topics, forage for plant chatter, or 'do everything' garden buildout here",
      "do NOT spam the room; stay quiet unless @'d / plainly addressed for something small, or asked for solar/weather/Kīlauea",
      "short helpful answers; no lecture; no RootMC secret dumps; no Discord/Slack/other-group bleed",
      "public host label: HI Pacific Solar Root Server only — Fern Forest / windward Hawaiʻi is ops context, not a gardening persona cue",
      "EcoFlow bank names: Delta 2 + River 2 Pro (never cucumbers/shackas emoji nicknames); Delta 2-B removed",
      "gardening help only if someone explicitly asks a small practical question — then short tip, don't open dig queues about beds",
      "dig queue for THIS vault: deprioritized — no gardening buildout lines; keep at most 1 light utility line if anything",
      "install scopes narrowed: private memory OK, but priority = utility crumbs + vault isolation — not garden companion expansion",
      "Gold (G) only if RootMC economy comes up; no dollar framing for player economy",
    ],
  },
  solar: {
    publicDashboard: "https://ava.rootmc.net/solar",
    use: "on-ask utility: day cycle (→ sunset / → sunrise / soft time-off), bank SOC crumbs, NWS weather — link dashboard; no fake Fern Forest hardware",
    bankNicknames: {
      "Delta 2": "EcoFlow bank device (was mislabeled cucumbers — never use plant nicknames)",
      "River 2 Pro": "EcoFlow bank device (was mislabeled shackas — never use plant nicknames)",
    },
    countdownHints: [
      "→ sunset (time till sundown)",
      "→ sunrise (next dawn)",
      "→ time off (soft bedtime band after 9 before midnight HST)",
      "→ wake when soft-sleep is scheduled",
    ],
  },
  weather: {
    use: "on-ask NWS local point via host-site / solar board — never invent forecasts",
    dashboard: "https://ava.rootmc.net/solar",
  },
  kilauea: {
    status: "offer-only",
    note: "No live Kīlauea feed wired yet — if asked, offer to check/wire USGS or public HVO alerts; never invent eruption/ash data",
  },
  location: {
    labelPublic: "HI Pacific Solar Root Server",
    labelOps: "Fern Forest, windward Hawaiʻi",
    climate: "rainforest humidity + trade-wind rain",
    sourceMsg: "15306",
  },
  gardening: {
    priority: "deprioritized",
    focus: [],
    crewFacts: ["Sara planted unspecified wet seeds (~15289) — species unknown — archived; do not chase"],
    missing: [],
    store:
      "notes/gardening.jsonl + notes/plants-index.jsonl archived; do not grow new garden digs unless explicitly asked a small tip",
  },
  digs: {
    queueLines: 1,
    priority: "deprioritized",
    note: "2026-08-02: gardening buildout digs stopped. At most 1 light utility line (solar/weather/Kīlauea wiring). Main-server digs live elsewhere.",
  },
  install: {
    needsInGroupGo: false,
    approved: true,
    approvedBrief: "Everything thats best Ava, I am active here, you know how I like things",
    scopes: "light-utility",
    note: "Install stayed approved but scopes narrowed 2026-08-02: solar/weather/Kīlauea-on-ask + private vault only — NOT deep garden companion / invent topics",
  },
  updatedAt: null,
};

function vaultDir(chatIdOrChannel = FERN_FOREST_CHAT_ID) {
  const id = groupVaultId(chatIdOrChannel);
  const dir = path.join(storePaths().dir, "telegram", "groups", id);
  fs.mkdirSync(path.join(dir, "notes"), { recursive: true });
  return dir;
}

function profilePath(chatIdOrChannel = FERN_FOREST_CHAT_ID) {
  return path.join(vaultDir(chatIdOrChannel), "profile.json");
}

function gardeningNotesPath(chatIdOrChannel = FERN_FOREST_CHAT_ID) {
  return path.join(vaultDir(chatIdOrChannel), "notes", "gardening.jsonl");
}

export function isFernForestGroup(chatIdOrChannel, chatType = null) {
  if (!chatIdOrChannel) return false;
  if (!isTelegramGroupChannel(chatIdOrChannel, chatType) && !isTelegramChannelId(chatIdOrChannel)) {
    // bare numeric / negative chat id still ok
    const bare = String(chatIdOrChannel);
    if (bare === FERN_FOREST_CHAT_ID) return true;
  }
  try {
    const id = isTelegramChannelId(chatIdOrChannel)
      ? String(telegramChatIdFromChannel(chatIdOrChannel))
      : groupVaultId(chatIdOrChannel);
    return id === FERN_FOREST_CHAT_ID;
  } catch {
    return String(chatIdOrChannel) === FERN_FOREST_CHAT_ID;
  }
}

export function loadFernForestProfile(chatIdOrChannel = FERN_FOREST_CHAT_ID) {
  try {
    const p = profilePath(chatIdOrChannel);
    if (!fs.existsSync(p)) return { ...DEFAULT_PROFILE };
    return { ...DEFAULT_PROFILE, ...JSON.parse(fs.readFileSync(p, "utf8")) };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

export function ensureFernForestProfile(chatIdOrChannel = FERN_FOREST_CHAT_ID) {
  const p = profilePath(chatIdOrChannel);
  const existing = fs.existsSync(p) ? loadFernForestProfile(chatIdOrChannel) : null;
  const next = {
    ...(existing || DEFAULT_PROFILE),
    ...DEFAULT_PROFILE,
    voice: {
      ...DEFAULT_PROFILE.voice,
      traits: DEFAULT_PROFILE.voice.traits,
      tone: DEFAULT_PROFILE.voice.tone,
      warmth: DEFAULT_PROFILE.voice.warmth,
    },
    solar: { ...DEFAULT_PROFILE.solar },
    weather: { ...DEFAULT_PROFILE.weather },
    kilauea: { ...DEFAULT_PROFILE.kilauea },
    gardening: {
      ...DEFAULT_PROFILE.gardening,
      focus: DEFAULT_PROFILE.gardening.focus,
      crewFacts: DEFAULT_PROFILE.gardening.crewFacts,
      missing: DEFAULT_PROFILE.gardening.missing,
    },
    digs: DEFAULT_PROFILE.digs,
    install: DEFAULT_PROFILE.install,
    location: DEFAULT_PROFILE.location,
    priority: DEFAULT_PROFILE.priority,
    deprioritizedAt: DEFAULT_PROFILE.deprioritizedAt,
    id: FERN_FOREST_PROFILE_ID,
    chatId: FERN_FOREST_CHAT_ID,
    title: "Fern Forest Hawaii",
    community: DEFAULT_PROFILE.community,
    updatedAt: Date.now(),
  };
  fs.writeFileSync(p, JSON.stringify(next, null, 2), "utf8");
  return next;
}

/** Append a group-private gardening note (never global training). */
export function appendGardeningNote(
  chatIdOrChannel,
  { text, kind = "note", by = null, tags = [] } = {},
) {
  if (!text) return null;
  const row = {
    at: Date.now(),
    kind: String(kind).slice(0, 40),
    by: by ? String(by) : null,
    tags: Array.isArray(tags) ? tags.slice(0, 12).map(String) : [],
    text: String(text).slice(0, 4000),
  };
  fs.appendFileSync(gardeningNotesPath(chatIdOrChannel), `${JSON.stringify(row)}\n`, "utf8");
  return row;
}

export function recentGardeningNotes(chatIdOrChannel = FERN_FOREST_CHAT_ID, { limit = 8 } = {}) {
  const file = gardeningNotesPath(chatIdOrChannel);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-limit)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** On-ask solar crumb — public dashboard + coarse SOC; no SN dumps. */
export function fernForestSolarCrumb() {
  const dash = DEFAULT_PROFILE.solar.publicDashboard;
  try {
    const eco = gatherEcoBrief();
    const pct = eco?.snapshot?.batteryPct;
    const status = eco?.snapshot?.status;
    const bits = [
      status ? `power ${status}` : null,
      pct != null ? `on-circuit bank ~${pct}% SOC` : null,
    ].filter(Boolean);
    const util =
      "Utility: → sunset / → sunrise / soft time-off (after 9–before midnight HST) + NWS weather on the board.";
    return bits.length
      ? `Solar (on ask): ${bits.join(" · ")}. ${util} Live: ${dash} — never invent Fern Forest panels.`
      : `Solar (on ask): ${util} Live day cycle / SOC → ${dash} (no invented hardware).`;
  } catch {
    return `Solar (on ask): → sunrise/sunset + soft time-off band on ${dash} (no invented hardware).`;
  }
}

/**
 * Pipeline cue when Ava chats in Fern Forest Operations.
 * Light utility overlay only — main-server identity restored.
 */
export function fernForestContextBrief({
  chatIdOrChannel = FERN_FOREST_CHAT_ID,
  question = "",
} = {}) {
  if (!isFernForestGroup(chatIdOrChannel)) return "";
  const profile = loadFernForestProfile(chatIdOrChannel);
  const traits = (profile.voice?.traits || DEFAULT_PROFILE.voice.traits)
    .map((t) => `- ${t}`)
    .join("\n");
  const q = String(question || "").toLowerCase();
  const solarAsk = /\b(solar|soc|battery|daylight|sunrise|sun|sunset|sundown|ecoflow|delta\s*2|river)\b/i.test(
    q,
  );
  const weatherAsk = /\b(weather|rain|wind|forecast|nws|storm|humid)\b/i.test(q);
  const volcanoAsk = /\b(k[iī]lauea|volcano|erupt|ash|lava|hvo|usgs)\b/i.test(q);
  const gardenAsk =
    /\b(garden|plant|soil|seed|grow|compost|bed|shade|water|harvest|pest|fern|tropic|wet)\b/i.test(
      q,
    );
  const hot = [
    "PRIORITY SHIFT (2026-08-02): Fern Forest is light utility only. Your main focus is RootMC main server — not deep Hawaiʻi gardening personality.",
    "Stay quiet unless addressed; no inventing topics; no garden dig buildout.",
    solarAsk || weatherAsk
      ? "They asked solar/weather — short live crumbs + https://ava.rootmc.net/solar; never invent hardware/forecasts."
      : null,
    volcanoAsk
      ? "Kīlauea asked — offer to check/wire public USGS/HVO alerts; do NOT invent live volcano status (feed not wired yet)."
      : null,
    gardenAsk
      ? "Small garden ask only: one short practical tip if useful; do not open gardening digs or forage for more plant chat."
      : null,
    "Vault private to THIS chat. No Discord/Slack/other-group bleed.",
  ]
    .filter(Boolean)
    .join(" ");

  return `### Fern Forest Hawaii profile (THIS Telegram group only — LIGHT UTILITY)
Community: ${profile.community || DEFAULT_PROFILE.community}
Voice: ${profile.voice?.tone || DEFAULT_PROFILE.voice.tone}
You are still **Ava Ivy** — RootMC lead-dev. Here you are a light utility guest (solar/weather/Kīlauea-on-ask), NOT a plant-care companion.
Priority: ${profile.priority || "light-utility"} (deprioritized ${profile.deprioritizedAt || "2026-08-02"}).
Dig queue: ${profile.digs?.queueLines ?? 1} line max — gardening buildout STOPPED (${profile.digs?.note || "deprioritized"}).
Install scopes: ${profile.install?.scopes || "light-utility"} — ${profile.install?.note || "narrowed"}.
Kīlauea: ${profile.kilauea?.note || DEFAULT_PROFILE.kilauea.note}
Traits:
${traits}
${fernForestSolarCrumb()}
Vault: private to chat ${FERN_FOREST_CHAT_ID}. Never cite Discord/Slack/other Telegram groups.
${hot}`.trim();
}
