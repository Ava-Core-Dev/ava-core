/**
 * RootMC-centric random facts + light protective paranoia.
 * Clean + simple. No NSA/Snowden. No sprawling world lore.
 */
import fs from "node:fs";
import path from "node:path";
import { shouldUseLlamaCore } from "./digHealth.mjs";
import { storePaths, pushStatusEvent } from "./store.mjs";
import { AVA_CHANNELS } from "./config.mjs";
import { allowsUnsolicitedPost } from "./channelPolicy.mjs";
import { postAvaDiscord } from "./avaPost.mjs";
import { scrubPublicReply } from "./scrub.mjs";

import { hostPublicName } from "./hostSite.mjs";

export const HOST_PUBLIC_NAME = hostPublicName();

const FACTS = [
  {
    id: "gold-1",
    tags: ["gold", "economy", "rootmc"],
    text: "RootMC player currency is Gold (G). Dollars stay on Pro checkout — never mix them in economy talk.",
  },
  {
    id: "vote-1",
    tags: ["governance", "rootmc"],
    text: "Governance: weighted For > Against wins; 75% anytime can ship now. Abstain is polite, not a veto.",
  },
  {
    id: "tick-1",
    tags: ["minecraft", "rootmc"],
    text: "A server tick is ~50ms. If TPS dips, redstone and mobs feel it before Discord does.",
  },
  {
    id: "solar-1",
    tags: ["solar", "host", "rootmc"],
    text: `${hostPublicName()} runs on panels + battery. Cloudy mornings = thin juice. Physics, not vibes.`,
  },
  {
    id: "pro-1",
    tags: ["pro", "rootmc"],
    text: "RootMC Pro is pay-to-steer (vote weight x2) + cosmetics/convenience — never pay-to-win combat.",
  },
  {
    id: "surface-1",
    tags: ["discord", "slack", "rootmc"],
    text: "Discord = players + help + cloud data. Slack = all development digs. Don't dual-workshop.",
  },
  {
    id: "care-1",
    tags: ["care", "rootmc"],
    text: "Slightly paranoid on purpose: if something's coming for RootMC or the crew, I want to clock it early. Caring loud.",
  },
  {
    id: "offgrid-1",
    tags: ["offgrid", "rootmc", "host"],
    text: "Endgame vibe: HI Pacific Solar Root Server scales toward an off-grid data center — watts in, RootMC out.",
  },
  {
    id: "map-1",
    tags: ["map", "rootmc"],
    text: "Live map: map.rootmc.net. Wiki + votes + Pro live on rootmc.net.",
  },
  {
    id: "proposal-1",
    tags: ["proposal", "rootmc"],
    text: "Features need a proposal + passing vote before ship. Bugs: verify, then fix.",
  },
  {
    id: "starlink-1",
    tags: ["starlink", "host", "rootmc"],
    text: "Host uplink is Starlink + solar. Fine for Discord/API; Minecraft notices jitter first.",
  },
  {
    id: "reserve-1",
    tags: ["economy", "rootmc"],
    text: "Server Reserve + Gold economy are the realm books. Keep player-facing talk in Gold, not dollars.",
  },
];

function statePath() {
  return path.join(storePaths().dir, "random-facts.json");
}

function loadState() {
  try {
    if (!fs.existsSync(statePath())) {
      return { lastIds: [], lastInjectAt: 0, lastChannelPostAt: 0 };
    }
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return { lastIds: [], lastInjectAt: 0, lastChannelPostAt: 0 };
  }
}

function saveState(state) {
  fs.mkdirSync(storePaths().dir, { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2), "utf8");
}

function scoreFact(fact, question = "") {
  const q = String(question || "").toLowerCase();
  if (!q) return 1 + Math.random();
  let score = 1;
  for (const tag of fact.tags || []) {
    if (q.includes(String(tag).toLowerCase())) score += 3;
  }
  return score + Math.random() * 0.5;
}

export function pickRandomFact({ question = "", avoidRecent = true } = {}) {
  const state = loadState();
  const recent = new Set(avoidRecent ? state.lastIds || [] : []);
  const scored = FACTS.map((f) => ({ f, s: scoreFact(f, question) }))
    .filter((x) => !recent.has(x.f.id) || recent.size >= FACTS.length)
    .sort((a, b) => b.s - a.s);
  const pick = scored[0]?.f || FACTS[Math.floor(Math.random() * FACTS.length)];
  const lastIds = [...(state.lastIds || []).filter((id) => id !== pick.id), pick.id].slice(-FACTS.length);
  saveState({ ...state, lastIds });
  return pick;
}

export function gatherRandomFactBrief({ question = "", force = false } = {}) {
  const q = String(question || "");
  if (/\b(nsa|snowden|sigint|wahiawa|kunia)\b/i.test(q)) {
    return {
      brief: `### Random facts / tone
Alex lock: **no NSA/Snowden**. Keep RootMC-centric, clean + simple.
Host: **${HOST_PUBLIC_NAME}**.`,
      fact: null,
      injected: false,
    };
  }
  const workLock =
    /\b(stripe|sales|deploy|vote\b|prop-|proposal|bug|status report|ecoflow|solar\s+avg|dig\b|hotfix|patch|error|payout|implement)\b/i.test(
      q,
    );
  const hot = /\b(random\s+fact|fun\s+fact|rootmc|gold|paranoid|threat)\b/i.test(q);
  const soft =
    !workLock &&
    (hot || /\b(lol|lmao|gm|gn|meme|bored|idle)\b/i.test(q) || q.trim().length < 60);
  const roll = Math.random();
  const should = force || (!workLock && (soft ? roll < 0.12 : roll < 0.05));

  if (!should) {
    return {
      brief: `### Tone
RootMC-centric. Clean + simple. Light protective paranoia for the server/crew only. No world-conspiracy essays. No NSA/Snowden.
Host: **${HOST_PUBLIC_NAME}**.`,
      fact: null,
      injected: false,
    };
  }

  const fact = pickRandomFact({ question: q });
  const state = loadState();
  saveState({ ...state, lastInjectAt: Date.now() });
  return {
    brief: `### RootMC fact (optional, keep short)
- ${fact.text}
Rules: RootMC-centric only; one short beat max; skip on serious ops; never NSA/Snowden.`,
    fact,
    injected: true,
  };
}

export function randomFactChannelIntervalMs() {
  const n = Number(process.env.AVA_RANDOM_FACT_MS || 6 * 60 * 60 * 1000);
  return Number.isFinite(n) && n >= 60 * 60 * 1000 ? n : 6 * 60 * 60 * 1000;
}

export function randomFactChannelBootDelayMs() {
  const n = Number(process.env.AVA_RANDOM_FACT_BOOT_MS || 180_000);
  return Number.isFinite(n) && n >= 30_000 ? n : 180_000;
}

export async function runOccasionalRandomFact(opts = {}) {
  // Alex 2026-08-02: unsolicited #random-facts posts are silly/redundant — off by default.
  // IMPORTANT: opts.force must NOT bypass this gate (poller boot used to force-post every restart).
  // Set AVA_RANDOM_FACT_CHANNEL=1 to re-enable. Soft chat inject via gatherRandomFactBrief still OK (rare).
  const enabled =
    process.env.AVA_RANDOM_FACT_CHANNEL === "1" ||
    /^true$/i.test(process.env.AVA_RANDOM_FACT_CHANNEL || "");
  if (!enabled) {
    return { ok: true, skipped: true, reason: "channel_posts_disabled" };
  }
  if (shouldUseLlamaCore() && !opts.force) {
    return { ok: true, skipped: true, reason: "llama_core_paused" };
  }
  const force = Boolean(opts.force);
  const state = loadState();
  const now = Date.now();
  const interval = randomFactChannelIntervalMs();
  // Rate limit always applies — boot/force cannot spam the channel.
  if (state.lastChannelPostAt && now - state.lastChannelPostAt < interval * 0.9) {
    return { ok: true, skipped: true, reason: "too_soon" };
  }
  const fact = pickRandomFact({ question: opts.question || "rootmc" });
  const channelId =
    opts.channelId || AVA_CHANNELS.randomFacts || "1531432703675596942";
  if (!allowsUnsolicitedPost(channelId)) {
    return { ok: false, detail: "no_channel" };
  }
  const content = scrubPublicReply([fact.text, "", "- Ava"].join("\n"), {
    surface: "discord",
  });
  const msg = await postAvaDiscord({
    channelId,
    content,
    kind: "random_fact",
    source: "random-facts",
  });
  saveState({
    ...state,
    lastChannelPostAt: now,
    lastIds: [...(state.lastIds || []), fact.id].slice(-FACTS.length),
  });
  pushStatusEvent(`random fact · ${fact.id} · ${msg?.id || ""}`);
  return { ok: true, posted: true, postId: msg?.id || null, factId: fact.id };
}
