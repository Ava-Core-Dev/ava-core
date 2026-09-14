/**
 * Llama Ava code analysis — recommend before edit.
 * Reads Ava-owned rootmc-ava snippets only. Never writes files.
 * Digs (Cursor) apply patches only after an explicit fix command / operator OK.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { looksLikeAvaOwnedSurface, looksLikeSelfFixCommand } from "./selfFix.mjs";
import { shouldUseLlamaCore } from "./digHealth.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AVA_SRC = __dirname;

/** Safe Ava-owned modules llama may read for analysis. */
const READABLE = [
  "pipeline.mjs",
  "poller.mjs",
  "recommend.mjs",
  "localBrain.mjs",
  "followupScan.mjs",
  "darkStall.mjs",
  "digHealth.mjs",
  "cloudDark.mjs",
  "offlineNotes.mjs",
  "persona.mjs",
  "selfFix.mjs",
  "llamaImprove.mjs",
  "phaseCatchup.mjs",
  "scrub.mjs",
  "store.mjs",
  "brainModeSession.mjs",
  "dreamBrain.mjs",
  "cursorBrain.mjs",
  "channelDump.mjs",
  "guildChannelWatch.mjs",
  "urgentTelegram.mjs",
  "financeBrief.mjs",
  "stripeFinance.mjs",
  "opsPowerStatus.mjs",
  "sleepMode.mjs",
  "overloadSafeMode.mjs",
];

function safeRead(file, max = 3500) {
  try {
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, "utf8");
    const cleaned = raw
      .split(/\r?\n/)
      .filter((line) => !/(password|token|secret|api[_-]?key|Bearer\s|sk_live)/i.test(line))
      .join("\n");
    return cleaned.slice(0, max);
  } catch {
    return null;
  }
}

/** True when the ask is about Ava's own code / stack (analysis or fix). */
export function looksLikeAvaCodeAsk(text = "", classified = null) {
  const q = String(text || "");
  if (looksLikeAvaOwnedSurface(q)) return true;
  if (classified?.intent === "self_evo") return true;
  if (classified?.intent === "bug" && classified?.target === "ava") return true;
  return (
    /\b(rootmc-ava|her\s+(own\s+)?code|your\s+code|ava\s+runtime|poller|followup|local\s*brain|self[-\s]?fix|llama\s+core|dig.?health|dark.?stall)\b/i.test(
      q,
    ) ||
    /\b(analyze|review|read|inspect|what\s+does|how\s+does|recommend|should\s+we\s+(fix|patch|change))\b/i.test(
      q,
    ) &&
      /\b(ava|you|your|rootmc-ava|poller|persona)\b/i.test(q)
  );
}

/**
 * Prefer recommendation (no write) unless operator explicitly said to apply.
 * Digs-out / llama-core → always recommend-only.
 */
export function shouldRecommendBeforeEdit(text = "") {
  if (shouldUseLlamaCore()) return true;
  if (looksLikeSelfFixCommand(text)) return false;
  return true;
}

/**
 * Pull a small set of Ava source snippets matching the ask.
 * @returns {string} pack text
 */
export function gatherAvaCodeBrief({ question = "", maxFiles = 4, maxChars = 9000 } = {}) {
  const q = String(question || "").toLowerCase();
  const scored = READABLE.map((name) => {
    const base = name.replace(/\.mjs$/i, "").toLowerCase();
    let score = 0;
    if (q.includes(base)) score += 5;
    if (q.includes(base.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase())) score += 3;
    // soft defaults for common asks
    if (/followup|catch.?up|all.?channel|overlap/.test(q) && /followup|phase|guild|poller|pipeline/.test(base))
      score += 2;
    if (/dark|spam|disconnect/.test(q) && /dark|cloud|offline|scrub|pipeline/.test(base)) score += 2;
    if (/llama|local|ollama|lesson|improve/.test(q) && /local|llama|dig|brain|persona/.test(base))
      score += 2;
    if (/self.?fix|edit|patch/.test(q) && /selfFix|recommend|cursor/.test(base)) score += 2;
    if (/finance|stripe|ledger/.test(q) && /finance|stripe/.test(base)) score += 3;
    return { name, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const picks = (scored.length ? scored : READABLE.slice(0, 3).map((name) => ({ name, score: 1 })))
    .slice(0, maxFiles);

  const blocks = [
    "### Ava-owned code snippets (read-only analysis)",
    "_Llama may recommend changes. Do not claim you edited files unless an explicit apply/fix command already ran via digs._",
  ];
  for (const { name } of picks) {
    const text = safeRead(path.join(AVA_SRC, name), 2800);
    if (!text) continue;
    blocks.push(`#### ${name}\n\`\`\`js\n${text}\n\`\`\``);
  }
  return blocks.join("\n\n").slice(0, maxChars);
}

export function llamaCodeRecommendSystemExtra() {
  return [
    "## Ava code analysis mode (locked)",
    "You can READ Ava-owned rootmc-ava snippets in the packs and recommend patches.",
    "You cannot write files, restart services, or push git from this brain.",
    "Always structure the reply as:",
    "1) **What I see** (file + behavior)",
    "2) **Recommendation** (concrete change, risk, why)",
    "3) **Apply?** — ask Alex/Melee to say `fix it yourself` / `apply the fix` before any dig edits.",
    "Never claim the patch is already live unless digs applied it.",
    "Never touch player Minecraft plugins / economy / Shockbyte from here.",
  ].join("\n");
}
