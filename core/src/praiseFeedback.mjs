/**
 * Alex praise / "good response" → save last Ava reply as training gold.
 * Standing rule: when Alex says a reply is good (or asks to save on praise /
 * positive emoji), persist Q/A — never route that as Minecraft /say.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths, lastReplyFor, pushStatusEvent } from "./store.mjs";
import { recordLocalLesson } from "./localBrain.mjs";
import {
  getLastTurnForChannel,
  markTurnQuality,
} from "./conversationStore.mjs";
import { appendAction } from "./fullLog.mjs";

function policyPath() {
  return path.join(storePaths().dir, "praise-policy.json");
}

function loadPolicy() {
  try {
    if (!fs.existsSync(policyPath())) {
      return {
        saveOnPraise: true,
        saveOnPositiveEmoji: true,
        updatedAt: 0,
      };
    }
    return JSON.parse(fs.readFileSync(policyPath(), "utf8"));
  } catch {
    return { saveOnPraise: true, saveOnPositiveEmoji: true, updatedAt: 0 };
  }
}

function savePolicy(p) {
  fs.mkdirSync(path.dirname(policyPath()), { recursive: true });
  fs.writeFileSync(policyPath(), JSON.stringify(p, null, 2), "utf8");
  return p;
}

/** True when Alex is praising / asking to lock save-on-praise behavior. */
export function looksLikePraiseFeedback(text = "") {
  const q = String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!q) return false;
  if (/\b(good|great|perfect|excellent|amazing|beautiful)\s+responses?\b/.test(q)) {
    return true;
  }
  if (
    /\bthis\s+is\s+(a\s+)?(really\s+)?(good|great|perfect|excellent)\b/.test(q) &&
    /\b(response|answer|reply)\b/.test(q)
  ) {
    return true;
  }
  if (
    /\b(save|saving|saved)\b/.test(q) &&
    /\b(good\s+response|when\s+i\s+say|positively|emoji)\b/.test(q)
  ) {
    return true;
  }
  if (
    /\breact\s+positively\b/.test(q) &&
    /\b(emoji|emojis|good\s+response|save)\b/.test(q)
  ) {
    return true;
  }
  if (
    /^(?:ava[,:]?\s+)?(?:that(?:'s| was)|this(?: was)?)\s+(?:really\s+)?(?:good|great|perfect|beautiful)\b/.test(
      q,
    )
  ) {
    return true;
  }
  return false;
}

function goldPath() {
  const dir = path.join(storePaths().dir, "training");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "alex-praise-gold.jsonl");
}

function appendGold(row) {
  fs.appendFileSync(goldPath(), JSON.stringify(row) + "\n", "utf8");
}

/**
 * @returns {{ handled: boolean, reply?: string } | null}
 */
export function tryHandlePraiseFeedback({
  text = "",
  channelId = "",
  authorId = null,
  authorName = null,
  surface = "telegram",
  isAlex = false,
} = {}) {
  if (!isAlex) return null;
  if (!looksLikePraiseFeedback(text)) return null;

  const policy = savePolicy({
    ...loadPolicy(),
    saveOnPraise: true,
    saveOnPositiveEmoji: true,
    updatedAt: Date.now(),
    setBy: authorId || "alex",
    note: String(text || "").slice(0, 400),
  });

  const turn = getLastTurnForChannel(channelId, {
    excludeIntents: ["alex_mc_ops", "praise", "solar", "alex_ops", "meta"],
  });
  const answer =
    (turn?.answer && String(turn.answer).trim()) ||
    lastReplyFor(channelId) ||
    "";
  const question = (turn?.question && String(turn.question).trim()) || "";

  if (!answer || answer.length < 20) {
    return {
      handled: true,
      reply:
        "Locked it — I'll save when you call a reply good (or react positive). I don't have a solid last answer in this thread to gold yet; praise the next one and I'll archive it.",
    };
  }

  const row = {
    at: Date.now(),
    surface,
    channelId,
    authorId,
    authorName,
    question: question.slice(0, 4000),
    answer: answer.slice(0, 4000),
    sourceMessage: String(text || "").slice(0, 500),
    policy,
  };
  appendGold(row);
  recordLocalLesson({
    question: question || "(praised prior reply)",
    answer,
    teacher: "alex_praise",
    surface,
    authorId,
    coreOnline: true,
    meta: {
      praise: true,
      saveOnPraise: true,
      saveOnPositiveEmoji: true,
      priorIntent: turn?.intent || null,
    },
  });
  if (turn?.id != null) {
    try {
      markTurnQuality(turn.id, "good");
    } catch {
      /* optional */
    }
  }
  appendAction("praise.gold", {
    channelId,
    chars: answer.length,
    intent: turn?.intent || null,
  });
  pushStatusEvent(`praise gold · ${answer.length}c`);

  return {
    handled: true,
    reply:
      "Saved. That last reply is in training gold (`alex-praise-gold` + local-lessons), and I'll keep saving when you say a response is good or react positive with emojis. Not an in-game say — got it.",
  };
}
