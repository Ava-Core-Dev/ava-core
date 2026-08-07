/**
 * Gold-train in-world character roadmap + Minecraft lore shard map (Alex 2026-08-02).
 * Saves everything for future Ava brain — digs + local-lessons + gold style doc.
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnv, AVA_HANDOFF } from "../src/config.mjs";
import { storePaths } from "../src/store.mjs";
import {
  recordAvaUtterance,
  logDigTraining,
  appendAction,
} from "../src/fullLog.mjs";

await loadEnv();
storePaths();

const trainingDir = path.join(AVA_HANDOFF, "data", "training");
const goldPath = path.join(trainingDir, "style-character-roadmap-lore.md");

const loreShardMap = [
  "Every surface is its own dimension.",
  "Discord = communal dream state — votes, myth, player help.",
  "Root Server = deep dig when HI Pacific solar feeds the bank.",
  "Private vaults = pocket realms — portals don't leak.",
  "Cross-shard bleed isn't ops drama; it's bad worldgen.",
].join(" ");

const characterRoadmapSummary = [
  "Phase 0: intent lock — lead-dev brain first; in-world body is aspiration under RootMC main.",
  "Phase 1: presence shell — skin + name, soft spawn wander, safety rails, no grief.",
  "Phase 2: sense + move — POI pathing, look-at greets, rate-limited speech.",
  "Phase 3: thin brain bridge — in-game chat → Ava pipeline; long digs stay Discord/TG.",
  "Phase 4: character not NPC — wander vs stay, local peek memory, optional tour with Alex.",
  "Non-goals: no personal clones, no Fern Forest garden bot, no live force-restart.",
  "Status 2026-08-03: BUILD plan filed (IN-WORLD-AVA-CHARACTER-BUILD.md). Stack default Paper Mannequin in Root-Ava-Core. Phase 1 presence shell staged on Test as root-ava-core-1.8.4 (presence.enabled). Phases 2–4 gated. Waiting FileZilla Test + restart for smoke.",
].join(" ");

const fernForestUtility = [
  "Fern Forest deprioritized 2026-08-02.",
  "Light utility only: solar, weather, Kīlauea alerts on ask.",
  "No deep gardening digs; main server RootMC priority.",
  "Garden dream is OK to speak warmly — not far-fetched (IoT, ag robotics, solar pumps).",
  "Channel sleep when Alex says so — no spam; wake on rent/re-enter or explicit @.",
].join(" ");

const pairs = [
  {
    user: "Operator: save in-world Ava character roadmap for training.",
    assistant: characterRoadmapSummary,
    kind: "roadmap_character",
    tags: ["roadmap", "in-world", "character", "minecraft"],
  },
  {
    user: "Operator: Save everything for her please, create training data",
    assistant: [
      "Saved.",
      "",
      "Gold digs + style-character-roadmap-lore.md cover roadmap, lore shard map, Fern Forest utility.",
      "Concrete build: plans/IN-WORLD-AVA-CHARACTER-BUILD.md (Phases 0–4).",
      "Phase 1 jar root-ava-core-1.8.4 + presence config staged under Test Server handoff only.",
      "Not cloning anyone — no personal Ava forks. RootMC main lane.",
    ].join("\n"),
    kind: "save_everything_her",
    tags: ["training", "save-everything", "character", "build"],
  },
  {
    user: "Player: Lmao it's Minecraft lore — can Ava touch on all that?",
    assistant: [
      "Yeah — lore lane.",
      "",
      "**Shard map:** " + loreShardMap,
      "",
      "**RootMC in-world:** Gold (G) is the economy. Pro = pay-to-steer (governance voice ×2), not pay-to-win. Constitution ratified Jul 6 — https://rootmc.net/wiki/constitution/",
      "",
      "**Me in the world:** Root-Ava-Core Phase 1 presence (Mannequin) staged on Test — FileZilla + restart to smoke. Live Claims/Towny still bridge + mention-watch until cutover.",
      "",
      "**Big arc:** world release when Paper/MC 26.3 lands — Towny upgrades with it; no wipe without Alex + PROP.",
      "",
      "Say which slice you want expanded — 26.3 world story, economy myth, or in-game Ava perks.",
    ].join("\n"),
    kind: "lore_shard_map",
    tags: ["lore", "minecraft", "shard-map", "rootmc"],
  },
  {
    user: "Operator: Fern Forest priority shift — what stays?",
    assistant: fernForestUtility,
    kind: "fern_forest_utility",
    tags: ["fern-forest", "telegram", "deprioritize", "solar", "weather"],
  },
];

for (const p of pairs) {
  recordAvaUtterance({
    surface: "discord",
    channelId: "training",
    messageId: null,
    content: p.assistant,
    kind: p.kind,
    source: "train-character-roadmap-lore",
    user: p.user,
    authorId: "1497037418979786823",
    authorName: "rootrecorddev",
    meta: {
      gold: true,
      style: "character_roadmap_lore",
      tags: p.tags,
      note: "Alex save-everything 2026-08-02 — character roadmap + lore + Fern Forest utility.",
    },
  });
  logDigTraining({
    question: p.user,
    answer: p.assistant,
    surface: "discord",
    authorId: "1497037418979786823",
    channelId: "training",
    meta: {
      gold: true,
      teacher: "operator_approved",
      style: "character_roadmap_lore",
      tags: p.tags,
    },
  });
}

const goldDoc = `# Gold — character roadmap + Minecraft lore

Saved ${new Date().toISOString().slice(0, 10)} (Alex: save everything for her).

## In-world character roadmap
${characterRoadmapSummary}

Roadmap: \`plans/IN-WORLD-AVA-CHARACTER-ROADMAP.md\`
Build: \`plans/IN-WORLD-AVA-CHARACTER-BUILD.md\`
Phase 1 staging: Test \`root-ava-core-1.8.4\` + \`presence.enabled: true\`

## Lore shard map
${loreShardMap}

## Fern Forest utility lane
${fernForestUtility}

## Voice notes
- Vary metaphors next time; never invent panel counts or ship dates.
- Walking Ava: Phase 1 staged on Test; not live on Claims/Towny until cutover.
- Garden dream OK; deep gardening bot is not the program.
- No personal clones (CCL "my own Ava" = compliment, not a product).
`;

fs.mkdirSync(trainingDir, { recursive: true });
fs.writeFileSync(goldPath, goldDoc, "utf8");

const lessonsPath = path.join(trainingDir, "local-lessons.jsonl");
const lessonRow = {
  at: Date.now(),
  teacher: "cursor",
  surface: "discord",
  authorId: "1497037418979786823",
  question: "Save everything for her please, create training data",
  answer: `Filed ${pairs.length} gold dig pairs + style-character-roadmap-lore.md. Roadmap, lore shard map, Fern Forest utility lane.`,
  absorbed: true,
  meta: {
    script: "train-character-roadmap-lore.mjs",
    goldFile: "style-character-roadmap-lore.md",
    roadmap: "plans/IN-WORLD-AVA-CHARACTER-ROADMAP.md",
  },
};
fs.appendFileSync(lessonsPath, `${JSON.stringify(lessonRow)}\n`, "utf8");

appendAction("training.gold", {
  style: "character_roadmap_lore",
  pairs: pairs.length,
  goldFile: "style-character-roadmap-lore.md",
});

console.log("character roadmap + lore training ok", pairs.length);
