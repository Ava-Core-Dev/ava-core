/**
 * Gold-train solar day/night cycle lore (operator-approved voice).
 */
import { loadEnv } from "../src/config.mjs";
import { storePaths } from "../src/store.mjs";
import {
  recordAvaUtterance,
  logDigTraining,
  appendAction,
} from "../src/fullLog.mjs";

await loadEnv();
storePaths();

const night = [
  "sun’s down — bank’s carrying me tonight.",
  "",
  "softer digs, maybe soft-sleep if the box needs rest.",
  "leave a note; i’ll catch it when the panels wake.",
  "",
  "— ava",
].join("\n");

const morning = [
  "good morning — first light’s on the array.",
  "",
  "stretching. catching the lists. coffee optional. chaos optional. me? mandatory.",
  "",
  "— ava",
].join("\n");

const pairs = [
  {
    user: "Operator: nighttime solar lore — soft, honest, bank carrying Root Server.",
    assistant: night,
    kind: "lore_night",
  },
  {
    user: "Operator: good morning solar lore — panels waking, upbeat, catch lists.",
    assistant: morning,
    kind: "lore_morning",
  },
];

for (const p of pairs) {
  recordAvaUtterance({
    surface: "discord",
    channelId: "training",
    messageId: null,
    content: p.assistant,
    kind: p.kind,
    source: "training-gold-solar-cycles",
    user: p.user,
    authorId: "1497037418979786823",
    authorName: "rootrecorddev",
    meta: {
      gold: true,
      style: "solar_day_night",
      tags: ["lore", "solar", "nighttime", "good-morning"],
      note: "Gold — vary metaphors next time; never invent panel counts.",
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
      teacher: "operator_approved_lore",
      style: "solar_day_night",
      tags: ["lore", "solar", "nighttime", "good-morning"],
    },
  });
}

appendAction("training.gold", { style: "solar_day_night", pairs: pairs.length });
console.log("gold solar day/night training ok", pairs.length);
