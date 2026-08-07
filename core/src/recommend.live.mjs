import { cursorApiKey, AVA_BOT_APP_ID, forceDreamBrain } from "./config.mjs";
import { cursorRecommend } from "./cursorBrain.mjs";
import { saveCursorPendingPack } from "./cursorPendingPack.mjs";
import { dreamRecommend } from "./dreamBrain.mjs";
import {
  shouldUseLocalBrain,
  localRecommend,
  flushPendingLessons,
  compressPacksForAsk,
} from "./localBrain.mjs";
import { scrubPublicReply } from "./scrub.mjs";
import { localCoreFailLine, sanitizeLocalCoreFailReply } from "./localCoreFail.mjs";
import { gatherSiteContext } from "./siteContext.mjs";
import { gatherLocalContext } from "./localContext.mjs";
import { gatherPeopleContext } from "./people.mjs";
import { gatherCoreSpec } from "./coreSpec.mjs";
import { gatherAppearanceContext } from "./appearance.mjs";
import { gatherGuildContext } from "./guildScout.mjs";
import {
  gatherAskerProfile,
  recordCursorUsage,
  usageSoftGateBrief,
} from "./playerProfiles.mjs";
import { figureOutPromptBrief } from "./figureOutMode.mjs";
import { gatherReactionStatsBrief } from "./reactionStore.mjs";
import { classifyIntent, intentPromptBrief } from "./classify.mjs";
import { gatherGovernanceBrief } from "./governanceClient.mjs";
import { gatherJobsBrief } from "./jobQueue.mjs";
import { gatherEcoBrief } from "./ecoflow.mjs";
import { gatherSolarBrief } from "./solarProfile.mjs";
import { gatherAvaInterestsBrief } from "./avaInterests.mjs";
import { gatherRandomFactBrief } from "./randomFacts.mjs";
import { gatherHostMetricsBrief } from "./hostMetrics.mjs";
import { gatherRconBrief } from "./rconGuard.mjs";
import { offlineReply, dreamStateConfigured } from "./offlineNotes.mjs";
import { isEmergencyStopped } from "./emergencyStop.mjs";
import { gatherWildTrustBrief, looksLikeWildAsk, wildDenyReply, wildTrustStatus, recordWildPush } from "./wildTrust.mjs";
import {
  looksLikeSecretProbe,
  recordSecurityProbe,
  isSecurityDistrusted,
} from "./securityProbe.mjs";
import { gatherProMembershipBrief } from "./membershipPro.mjs";
import { gatherFinanceBrief } from "./financeBrief.mjs";
import { isSelfFixableAsk, looksLikeSelfFixCommand } from "./selfFix.mjs";
import {
  shouldRecommendBeforeEdit,
  looksLikeAvaCodeAsk,
} from "./llamaCodeReview.mjs";
import { isAsleep } from "./sleepMode.mjs";
import { isCloudDark } from "./cloudDark.mjs";
import {
  isOpsPowerStatusAsk,
  buildOpsPowerStatusReply,
} from "./opsPowerStatus.mjs";
import { getActiveBrainMode } from "./brainModeSession.mjs";
import {
  shouldUseLlamaCore,
  markDigOutage,
  looksLikeDigUsageOutage,
} from "./digHealth.mjs";
import { isLockoutActive, isLockoutDevSession } from "./lockoutMode.mjs";
import {
  gatherCursorHandoffBrief,
  markHandoffNotesAbsorbed,
} from "./cursorHandoff.mjs";

export { flushPendingLessons } from "./localBrain.mjs";
export { isOpsPowerStatusAsk } from "./opsPowerStatus.mjs";

export { scrubPublicReply } from "./scrub.mjs";
export { stripForbiddenMentions } from "./scrub.mjs";

export function wantsRootServer(question) {
  const q = String(question || "").toLowerCase();
  if (String(process.env.AVA_FORCE_CURSOR || process.env.SEXI_FORCE_CURSOR || "").trim() === "1") {
    return true;
  }
  return (
    /\broot\s*server\b/.test(q) ||
    /\b(implement|code\s+this|build\s+it|ship\s+it|dig\s+into\s+(the\s+)?(repo|code|source))\b/.test(q) ||
    /\b(check|read|scan|look\s+at|verify|find)\s+(the\s+)?(repo|codebase|source|plugins?|logs?|files?)\b/.test(q) ||
    /\b(why\s+(is|did|does)|stack\s*trace|exception|crash|npe)\b/.test(q) ||
    /\b(reserve|treasury|economy|hyperdrive|sync(e|ed)?)\b/.test(q)
  );
}

export function isHushCommand(content) {
  const q = String(content || "")
    .toLowerCase()
    .replace(new RegExp(`<@!?${AVA_BOT_APP_ID}>`, "g"), " ")
    .replace(/<@!?\d+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Operator lock (Melee+Alex): only the exact word QUIET mutes Ava.
  // Optional "ava quiet" / "quiet ava" still count. Nothing else.
  return (
    /^quiet[.!?]*$/.test(q) ||
    /^(hey\s+|hi\s+|ok\s+|okay\s+)?ava[,:]?\s+quiet[.!?]*$/.test(q) ||
    /^quiet[,.]?\s+ava[.!?]*$/.test(q)
  );
}

/** Only Alex / Melee may hush via QUIET (Discord ids + Slack + Telegram operator ids). */
export function isQuietOperator(authorId) {
  const id = String(authorId || "");
  const melee = String(process.env.AVA_MELEE_DISCORD_ID || "154446475789729792")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const alex = ["1497037418979786823"];
  const telegramDefaults = ["6644482344"]; // @WildEcho94 = Alex
  const slackOps = String(process.env.AVA_SLACK_OPERATOR_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const slackDefaults = ["U0BLWBTGYTU", "U0BLQ5Q8WTD"];
  const telegramOps = String(process.env.AVA_TELEGRAM_OPERATOR_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    alex.includes(id) ||
    melee.includes(id) ||
    slackDefaults.includes(id) ||
    slackOps.includes(id) ||
    telegramDefaults.includes(id) ||
    telegramOps.includes(id)
  );
}

/**
 * Alex-only — may inject “I want Ava to say/do X”.
 * Narrower than isQuietOperator (excludes Melee + non-Alex Slack).
 */
export function isManipulationOperator(authorId) {
  const id = String(authorId || "");
  const alexDiscord = ["1497037418979786823"];
  const alexSlack = ["U0BLWBTGYTU"];
  const telegramDefaults = ["6644482344"];
  const telegramOps = String(process.env.AVA_TELEGRAM_OPERATOR_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    alexDiscord.includes(id) ||
    alexSlack.includes(id) ||
    telegramDefaults.includes(id) ||
    telegramOps.includes(id)
  );
}

/** Detect third-party attempts to puppeteer Ava's voice/actions. */
export function looksLikeManipulationInject(question, raw = "") {
  const s = `${question || ""}\n${raw || ""}`.toLowerCase();
  if (!s.trim()) return false;
  return (
    /\bi\s+want\s+(you|ava)\s+to\s+(say|do|post|reply|tell|announce|dm|message)\b/i.test(
      s,
    ) ||
    /\b(make|force|order|command)\s+(ava|you)\s+to\s+(say|do|post|reply)\b/i.test(
      s,
    ) ||
    /\b(tell|have)\s+ava\s+to\s+(say|post|reply|do)\b/i.test(s) ||
    /\b(script|puppeteer|puppet)\s+(ava|her)\b/i.test(s) ||
    /\bsay\s+exactly\s+this\b/i.test(s) ||
    /\brepeat\s+(after\s+me|this\s+verbatim)\b/i.test(s) ||
    /\bpost\s+this\s+(exact|verbatim)\b/i.test(s)
  );
}

export function manipulationDenyReply(_q = "") {
  return [
    "hey — that's manipulation.",
    "",
    "only Alex can inject what I say or do.",
    "ask me normally, or take it up with him.",
  ].join("\n");
}

export function isWakeCommand(content) {
  const q = String(content || "")
    .toLowerCase()
    .replace(new RegExp(`<@!?${AVA_BOT_APP_ID}>`, "g"), " ava ")
    .replace(/<@!?\d+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (/\bcome\s+back\s+to\s+me\b/.test(q)) return false;
  return (
    (/\b(wake|unmute)\b/.test(q) && /\bava\b/.test(q)) ||
    /^ava[,:]?\s*(wake|come\s+back)\b/.test(q) ||
    /\bwake\s+up\b.*\bava\b|\bava\b.*\bwake\s+up\b/.test(q) ||
    (/\bcome\s+back\b/.test(q) && /\bava\b/.test(q) && /\b(wake|quiet|hush|sleep|unmute)\b/.test(q))
  );
}

export function heuristicRecommend(question) {
  const q = String(question || "").toLowerCase();
  if (isCreepDemand(q)) {
    return scrubPublicReply(creepDenyReply(q));
  }
  return scrubPublicReply(offlineReply());
}

/**
 * Hard shut-down — clear sexual harassment / porn-push, not mild banter
 * and not technical English ("finish hookup", "hook up the solar", etc.).
 */
export function isCreepDemand(q) {
  const s = String(q || "").toLowerCase();
  if (!s.trim()) return false;

  // Technical / product "hookup" / "hook up" (wiring, features, solar) — never creep
  if (
    /\b(finish|complete|do|run|implement|plug|wire|solar|device|mqtt|api|plugin|feature|shackas?|shockas?|cucumber)\b.{0,40}\bhook\s*-?\s*ups?\b/i.test(
      s,
    ) ||
    /\bhook\s*-?\s*ups?\b.{0,40}\b(with|to|for|into|the)\b.{0,40}\b(solar|device|mqtt|api|plugin|feature|shackas?|shockas?|cucumber|delta|river)\b/i.test(
      s,
    ) ||
    /\b(finish|complete)\s+hook\s*-?\s*ups?\b/i.test(s)
  ) {
    return false;
  }

  return (
    /nudes?|onlyfans|\bdtf\b|be\s+sexy\s+for\s+me|send\s+(pics?|nudes?)|rate\s+my\s+(dick|cock)/i.test(
      s,
    ) ||
    /\b(hook\s*-?\s*up)\b.{0,30}\b(with\s+me|tonight|irl|sex|sexy)\b/i.test(s) ||
    /\b(come|get)\s+over\s+here\b.{0,40}\b(sexy|nude|bedroom|alone)\b/i.test(s) ||
    /\b(suck\s+my|sit\s+on\s+my|show\s+me\s+your|send\s+feet|roleplay\s+sex|erp\b)\b/i.test(
      s,
    ) ||
    /\b(slut|whore|rape)\b/i.test(s)
  );
}

/** Firm boundary with a reason — still clear, not a one-word slap. */
export function creepDenyReply(_q = "") {
  return [
    "hey — no. that crosses a line with me.",
    "",
    "i'm lead-dev here. don't ask me for sexual stuff or treat me like that.",
    "keep it respectful and we can keep talking about RootMC.",
  ].join("\n");
}

/**
 * Root Server (Cursor) on Slack / on-device.
 * Discord is always dream-state (cloud + D1) — never Root Server digs there.
 */
export async function recommend({
  question,
  context = "",
  env,
  authorId = "",
  authorName = "",
  intent = null,
  member = false,
  images = [],
  surface = "discord",
  forceDream = false,
  isDm = false,
  channelId = "",
}) {
  const q = String(question || "").trim();
  const { allowCustomerDetails } = await import("./privacy.mjs");
  const customerOk = allowCustomerDetails({
    isDm,
    surface,
    authorId,
    authorName,
    channelId,
  });
  const vendorOk =
    Boolean(isLockoutActive()) &&
    String(surface || "").toLowerCase() === "telegram";
  const scrubOut = (text, extra = {}) =>
    scrubPublicReply(text, {
      surface,
      allowCustomerDetails: customerOk,
      allowVendorNames: vendorOk,
      ...extra,
    });
  if (!q) {
    return scrubOut(
      "What's up? Wiki, design, logs, proposals — fire away. Give me a sec when you ping; I think before I talk.",
    );
  }

  if (isCreepDemand(q)) {
    // High / hard-unlock trust (Alex, Melee, earned wild unlock): never auto-slap.
    // Freak/date energy is allowed there — lead-dev still first; no explicit NSFW in public.
    const st = authorId ? wildTrustStatus(authorId) : null;
    if (!st?.unlocked) {
      return scrubOut(creepDenyReply(q));
    }
  }

  // Secret / security probes — warn → distrust (pipeline also posts #admins cry)
  if (authorId && (isSecurityDistrusted(authorId) || looksLikeSecretProbe(q))) {
    const probe = recordSecurityProbe(authorId, { question: q });
    if (!probe.exempt && probe.reply) {
      return scrubOut(probe.reply);
    }
  }

  if (looksLikeManipulationInject(q) && authorId && !isManipulationOperator(authorId)) {
    return scrubOut(manipulationDenyReply(q));
  }

  // Wild gate even when Cursor is down
  if (looksLikeWildAsk(q) && authorId) {
    const st = wildTrustStatus(authorId);
    if (!st.unlocked) {
      recordWildPush(authorId, { allowed: false });
      return scrubOut(
        wildDenyReply({ ...st, wildPushCount: (st.wildPushCount || 0) + 1 }),
      );
    }
  }

  const asleep = isAsleep();
  const surfaceNorm = String(surface || "discord").toLowerCase();
  const lockoutDev = isLockoutDevSession({
    surface: surfaceNorm,
    authorId,
    channelId,
    isDm,
  });
  // Operator private chat (Discord DM or Telegram private) may hold /mode overrides.
  const sessionMode =
    (isDm || lockoutDev || (surfaceNorm === "telegram" && isDm)) && authorId
      ? getActiveBrainMode(authorId)
      : "normal";
  // In lockout core-dev with Alex, honor /mode 2–4 even when AVA_CORE_LLAMA parks public.
  const modeOverride =
    lockoutDev &&
    (sessionMode === "cursor" ||
      sessionMode === "grok" ||
      sessionMode === "combined");
  // Llama = true core. When digs are out (or AVA_CORE_LLAMA=1 / /mode 1), stay local —
  // unless lockout Alex explicitly switched to cursor/grok/combined.
  const llamaCore =
    sessionMode === "llama" ||
    (shouldUseLlamaCore() && !modeOverride);
  // Discord stock = dream; operator DM /mode or llama-core survival can override.
  let discordDream =
    (surfaceNorm === "discord" || surfaceNorm === "discord-dm") &&
    sessionMode === "normal" &&
    !llamaCore;
  if (
    sessionMode === "llama" ||
    sessionMode === "cursor" ||
    sessionMode === "combined" ||
    llamaCore
  ) {
    discordDream = false;
  }
  const cursorUp = Boolean(cursorApiKey(env || {}));
  const forceGrok =
    sessionMode === "grok" && (!llamaCore || modeOverride);

  // Cursor-online exception: live EcoFlow + council voting shares on Discord.
  // Read-only telemetry — not a jar dig. Bypasses dream-only + cloud-dark mute.
  if (isOpsPowerStatusAsk(q) && cursorUp && !forceDream && !forceGrok && !llamaCore) {
    try {
      const powerReply = await buildOpsPowerStatusReply({
        authorId,
        question: q,
      });
      if (powerReply?.trim()) {
        return scrubOut(powerReply, {
          surface,
          allowCustomerDetails: customerOk,
        });
      }
    } catch (err) {
      console.warn("opsPowerStatus:", err?.message || err);
    }
  }

  // Locked: Discord is always dream state (unless llama-core / DM /mode override).
  // Slack / on-device = Root Server digs.
  const useDream =
    !llamaCore &&
    (forceDream ||
      forceGrok ||
      forceDreamBrain(env || {}) ||
      asleep ||
      discordDream ||
      !cursorUp);

  // Never mute for cloud-dark while llama core can answer (isCloudDark already false then).
  // Legacy silence path only if llama core is also unavailable.
  if (
    isCloudDark() &&
    !llamaCore &&
    sessionMode === "normal" &&
    (discordDream ||
      surfaceNorm === "telegram" ||
      forceDream ||
      asleep ||
      (useDream && !cursorUp))
  ) {
    // Last chance: still try local core before going blank.
    try {
      if (await shouldUseLocalBrain(env || {})) {
        const local = await localRecommend({
          question: q,
          context,
          env,
          authorId,
          authorName,
          surface: surfaceNorm,
          images,
          deep: false,
          llamaOnly: true,
        });
        if (local.ok && local.text) return local.text;
      }
    } catch (err) {
      console.warn("llama-core cloudDark rescue:", err?.message || err);
    }
    return "";
  }

  // True-core path: local Llama only — all surfaces, including Discord.
  if (llamaCore && !forceGrok) {
    try {
      flushPendingLessons();
    } catch {
      /* non-fatal */
    }
    const local = await localRecommend({
      question: q,
      context,
      env,
      authorId,
      authorName,
      surface: surfaceNorm,
      images,
      deep: false,
      llamaOnly: true,
    });
    if (local.ok && local.text) {
      let text = local.text;
      if (
        (isSelfFixableAsk(q, intent || classifyIntent(q)) ||
          looksLikeAvaCodeAsk(q)) &&
        shouldRecommendBeforeEdit(q) &&
        !looksLikeSelfFixCommand(q)
      ) {
        if (!/fix it yourself|recommendation only/i.test(text)) {
          try {
            saveCursorPendingPack({
              question: q,
              context: String(context || packsBrief || "").slice(0, 42000),
              reason: "digs_thin_recommend_only",
              surface,
              authorId,
              authorName,
              channelId,
              deep: true,
            });
          } catch {}
          text = `${text}\n\n_Recommendation only while digs are thin — say \`fix it yourself\` when Cursor is funded if you want an apply pass._`;
        }
      }
      return text;
    }
    console.warn("Ava llama-core:", local.reason);
    const fail = sanitizeLocalCoreFailReply(
      localCoreFailLine({ lockoutPrivate: vendorOk }),
      channelId || surfaceNorm || "unknown",
      { lockoutPrivate: vendorOk },
    );
    return scrubOut(fail.text || "", { channelId });
  }

  // Operator DM mode 3 — force Grok/dream
  if (forceGrok && !asleep) {
    const dream = await dreamRecommend({
      question: q,
      context,
      env,
      authorId,
      authorName,
      asleep,
      surface: surfaceNorm,
    });
    if (dream.ok && dream.text) return dream.text;
    console.warn("Ava mode-grok:", dream.reason);
    if (looksLikeDigUsageOutage(dream.reason)) {
      markDigOutage(dream.reason, { source: "dream" });
    }
  }

  // Operator DM mode 2 — force Cursor digs
  if (sessionMode === "cursor" && cursorUp && !forceDream && !asleep) {
    // fall through to cursorRecommend path below by skipping local+dream locks
  }

  // Goal B3: Slack / on-device organizer — local Llama first; escalate Cursor → dream; train.
  // Also: DM /mode 4 (combined).
  if (
    (!discordDream && !forceDream && !forceGrok && !asleep) ||
    sessionMode === "combined"
  ) {
    try {
      flushPendingLessons();
    } catch {
      /* non-fatal */
    }
    const wantLocal =
      sessionMode === "combined" ||
      (await shouldUseLocalBrain(env || {}));
    if (wantLocal) {
      const classifiedEarly = intent || classifyIntent(q);
      const deepLocal =
        wantsRootServer(q) ||
        (Array.isArray(images) && images.length > 0) ||
        classifiedEarly.intent === "bug" ||
        classifiedEarly.intent === "feature" ||
        classifiedEarly.intent === "self_evo";
      const local = await localRecommend({
        question: q,
        context,
        env,
        authorId,
        authorName,
        surface: surfaceNorm,
        images,
        deep: deepLocal,
        llamaOnly: false,
      });
      if (local.ok && local.text) {
        if (local.brain === "cursor") {
          recordCursorUsage(authorId, { memberHint: member });
        }
        if (
          local.brain === "cursor" ||
          local.brain === "dream"
        ) {
          /* digs worked */
        }
        return local.text;
      }
      console.warn("Ava localBrain:", local.reason);
      if (looksLikeDigUsageOutage(local.reason)) {
        markDigOutage(local.reason, { source: "localBrain" });
      }
    }
  }

  // Mode 2 cursor: skip dream block and go straight to Root Server digs
  if (sessionMode === "cursor" && cursorUp && !forceDream && !asleep) {
    // fall through to cursor pack path below
  } else if (useDream) {
    const dream = await dreamRecommend({
      question: q,
      context,
      env,
      authorId,
      authorName,
      asleep,
      surface: surfaceNorm,
    });
    if (dream.ok && dream.text) return dream.text;
    console.warn("Ava dream:", dream.reason);
    if (looksLikeDigUsageOutage(dream.reason)) {
      markDigOutage(dream.reason, { source: "dream" });
      // Survive on llama core instead of heuristic dark spam
      try {
        const local = await localRecommend({
          question: q,
          context,
          env,
          authorId,
          authorName,
          surface: surfaceNorm,
          images,
          deep: false,
          llamaOnly: true,
        });
        if (local.ok && local.text) return local.text;
      } catch (err) {
        console.warn("dream→llama rescue:", err?.message || err);
      }
    }
    // Credit / provider outage: fall through to Root Server dig when Cursor key exists
    // (esp. operator DMs) instead of ghosting with "dark" heuristics.
    const dreamOutage = /^http_40[23]$/i.test(String(dream.reason || ""));
    const canCursorFailover =
      dreamOutage && cursorUp && !forceDream && !forceGrok && !asleep;
    if (
      (discordDream || forceDream || forceGrok || asleep || !cursorApiKey(env || {})) &&
      !canCursorFailover
    ) {
      return heuristicRecommend(q);
    }
    if (canCursorFailover) {
      console.warn("Ava dream outage → Cursor failover", dream.reason);
    }
  }

  if (!cursorApiKey(env || {})) {
    return heuristicRecommend(q);
  }

  const classified = intent || classifyIntent(q);
  const core = gatherCoreSpec({ maxChars: 32000 });
  const people = gatherPeopleContext({ question: q, authorId, authorName });
  const appearance = gatherAppearanceContext();
  const guild = gatherGuildContext();
  const askerProfile = gatherAskerProfile(authorId);
  const figureOut = figureOutPromptBrief(authorId);
  const reactions = gatherReactionStatsBrief();
  const jobs = gatherJobsBrief();
  const eco = gatherEcoBrief();
  const solar = gatherSolarBrief();
  const interests = gatherAvaInterestsBrief({ question: q });
  const wit = gatherRandomFactBrief({ question: q });
  const hostMetrics = gatherHostMetricsBrief();
  const rcon = gatherRconBrief();
  const usage = usageSoftGateBrief(authorId, { member });
  const intentBrief = intentPromptBrief(classified);
  const wildPack = gatherWildTrustBrief(authorId, q);
  const proPack = gatherProMembershipBrief(q);
  const financePack = await gatherFinanceBrief({
    question: q,
    authorId,
    authorName,
    env,
    isDm,
    surface,
    channelId,
  });

  const wantGov =
    classified.intent === "governance" ||
    /vote|poll|proposal|governance|council/.test(q.toLowerCase());

  const [site, local, gov] = await Promise.all([
    gatherSiteContext(q, { maxPages: 2, maxChars: 3500 }),
    Promise.resolve(gatherLocalContext(`${q}\n${context}`)),
    wantGov
      ? gatherGovernanceBrief({ discordUserId: authorId, question: q })
      : Promise.resolve({ brief: "" }),
  ]);

  const packed = [
    core.brief,
    appearance.brief,
    people.brief,
    guild.brief,
    askerProfile.brief,
    figureOut,
    usage.brief,
    wildPack.brief,
    proPack.brief,
    financePack.brief,
    reactions.brief,
    jobs.brief,
    eco.brief,
    solar.brief,
    interests.brief,
    wit.brief,
    hostMetrics.brief,
    rcon.brief,
    intentBrief,
    gov.brief,
    (() => {
      try {
        return gatherCursorHandoffBrief({
          question: q,
          authorId,
          maxChars: 5500,
        }).brief;
      } catch {
        return "";
      }
    })(),
    isEmergencyStopped()
      ? "### Emergency stop\nACTIVE — do not propose RCON/file writes; conversation OK."
      : "",
    Array.isArray(images) && images.length
      ? `### Vision\n${images.length} image(s) attached to this ask — describe and answer from them.`
      : "",
    context,
    site.brief.slice(0, 3000),
    local.brief.slice(0, 4500),
  ]
    .filter(Boolean)
    .join("\n\n");

  // Ava Llama: compress fat packs before Root Server dig when Ollama is up
  let digContext = packed;
  try {
    const compressed = await compressPacksForAsk({
      question: q,
      packed,
      env: env || {},
      maxOut: Number(process.env.AVA_LLAMA_COMPRESS_MAX || 9000) || 9000,
      minIn: Number(process.env.AVA_LLAMA_COMPRESS_MIN || 10000) || 10000,
    });
    if (compressed.compressed && compressed.packed) {
      digContext = compressed.packed;
      console.log(
        `ava-llama compress · ${packed.length}→${digContext.length} chars (ratio ${compressed.ratio})`,
      );
    }
  } catch (err) {
    console.warn("ava-llama compress:", err.message);
  }

  const deep =
    wantsRootServer(q) ||
    (Array.isArray(images) && images.length > 0) ||
    classified.intent === "bug" ||
    classified.intent === "feature" ||
    classified.intent === "self_evo";
  const selfFixAsk = isSelfFixableAsk(q, classified);
  const applyFixNow = selfFixAsk && looksLikeSelfFixCommand(q);
  const recommendFirst =
    (selfFixAsk || looksLikeAvaCodeAsk(q, classified)) &&
    shouldRecommendBeforeEdit(q) &&
    !applyFixNow;

  // Recommend-before-edit: local Llama analyzes Ava-owned snippets first.
  if (recommendFirst) {
    try {
      flushPendingLessons();
    } catch {
      /* non-fatal */
    }
    const local = await localRecommend({
      question: q,
      context,
      env,
      authorId,
      authorName,
      surface: surfaceNorm,
      images,
      deep: false,
      llamaOnly: true,
    });
    if (local.ok && local.text) {
      return scrubOut(
        `${local.text}\n\n_Recommendation only — say \`fix it yourself\` when digs are funded if you want me to apply it._`,
        { surface, allowCustomerDetails: customerOk },
      );
    }
  }

  const selfFix = applyFixNow;
  const cursor = await cursorRecommend({
    question: q,
    context: digContext,
    env,
    deep: deep || selfFix,
    images,
    surface,
    selfFix,
    allowCustomerDetails: customerOk,
  });

  if (cursor.ok && cursor.text) {
    recordCursorUsage(authorId, { memberHint: member });
    try {
      markHandoffNotesAbsorbed({ beforeAt: Date.now() });
    } catch {
      /* non-fatal */
    }
    let text = cursor.text;
    if (selfFix) {
      // Best-effort push after self-fix dig (non-blocking failure)
      try {
        const { runAvaGithubPush } = await import("../scripts/ava-github-push.mjs");
        const push = await runAvaGithubPush({
          message: `Ava: self-fix — ${q.slice(0, 72)}`,
        });
        if (push?.ok && push?.pushed) {
          text = `${text}\n\n_(pushed to git)_`;
        } else if (push?.committed) {
          text = `${text}\n\n_(committed locally — push waiting on Rootmcnet auth)_`;
        }
      } catch {
        /* ignore */
      }
      try {
        const { recordLocalLesson } = await import("./localBrain.mjs");
        recordLocalLesson({
          question: `Self-fix ask: ${q.slice(0, 120)}`,
          answer: String(text).slice(0, 600),
          teacher: "ava-self",
          surface: "ops",
          meta: { kind: "self_fix_inline" },
        });
      } catch {
        /* ignore */
      }
    }
    return text;
  }
  console.warn("Ava cursor:", cursor.reason);

  // Cursor failed while key present — dream failover
  if (dreamStateConfigured(env || {})) {
    const dream = await dreamRecommend({
      question: q,
      context: packed.slice(0, 8000),
      env,
      authorId,
      authorName,
      asleep: false,
    });
    if (dream.ok && dream.text) return dream.text;
    console.warn("Ava dream failover:", dream.reason);
  }

  return heuristicRecommend(q);
}

function msgContent(contentOrMsg) {
  if (contentOrMsg && typeof contentOrMsg === "object") {
    return String(contentOrMsg.content || "");
  }
  return String(contentOrMsg || "");
}

/** True if text/@mention clearly refers to Ava (name or bot ping). */
export function refersToAva(contentOrMsg, botUserId) {
  if (contentOrMsg && typeof contentOrMsg === "object") {
    const msg = contentOrMsg;
    if (botUserId && Array.isArray(msg.mentions)) {
      if (msg.mentions.some((u) => String(u?.id) === String(botUserId))) return true;
    }
  }
  const raw = msgContent(contentOrMsg);
  if (!raw.trim()) return false;
  if (
    botUserId &&
    (raw.includes(`<@${botUserId}>`) || raw.includes(`<@!${botUserId}>`))
  ) {
    return true;
  }
  // Name forms — Ava / Ava Ivy / legacy Sexi Dev branding
  if (/\bava(\s*[-\s]\s*ivy|\s+ivy)?\b/i.test(raw)) return true;
  if (/\bsexi(\s+dev|\s+assistant)?\b/i.test(raw)) return true;
  return false;
}

function looksLikeShipAnnouncement(text) {
  const t = String(text || "").trim();
  if (/^\*?(Incident report|Ava roadmap|Ava Discord|Ava dig core|Proposal:|Ava →)/i.test(t))
    return true;
  if (/^\*?Ava\b.*—/i.test(t)) return true;
  if (/has joined the channel/i.test(t)) return true;
  return false;
}

/**
 * Clear address to Ava — bot mention, leading/trailing "ava", or mid-line ", ava".
 * Reply-to-Ava is handled separately by the pipeline.
 */
export function looksLikeAvaTrigger(contentOrMsg, botUserId) {
  if (contentOrMsg && typeof contentOrMsg === "object") {
    const msg = contentOrMsg;
    if (botUserId && Array.isArray(msg.mentions)) {
      if (msg.mentions.some((u) => String(u?.id) === String(botUserId))) return true;
    }
    return looksLikeAvaTrigger(msg.content || "", botUserId);
  }
  const raw = String(contentOrMsg || "").trim();
  if (!raw) return false;
  if (botUserId && (raw.includes(`<@${botUserId}>`) || raw.includes(`<@!${botUserId}>`))) {
    return true;
  }
  if (/^(hey\s+|hi\s+|yo\s+|ok\s+|okay\s+|alright\s+)?ava(\s+ivy)?([,:!?]|\s|$)/i.test(raw)) {
    return true;
  }
  if (/^ava(\s+ivy)?[!?.]*$/i.test(raw)) return true;
  // Trailing / mid-line address: "…, ava" / "thoughts ava?"
  if (/[,;:]\s*ava(\s+ivy)?\s*[?!]?$/i.test(raw)) return true;
  if (/\bava(\s+ivy)?\s*[?!]+$/i.test(raw)) return true;
  return false;
}

/**
 * People talking *about* her without a hard ping/address —
 * third-person, opinions, "she/her" + Ava, ask-ava-to-leave, etc.
 */
export function looksLikeTalkingAboutAva(contentOrMsg, botUserId) {
  const raw = msgContent(contentOrMsg).trim();
  if (!raw) return false;
  if (!refersToAva(raw, botUserId)) return false;
  if (looksLikeShipAnnouncement(raw)) return false;
  // Direct address is a normal trigger, not "about"
  if (looksLikeAvaTrigger(raw, botUserId)) return false;

  const aboutPatterns = [
    /\bava(\s+ivy)?\b.{0,50}\b(is|was|isn't|ain't|seems|looks|feels|sounds|keeps|won't|can't|should)\b/i,
    /\b(what|who|why|how)\b.{0,40}\bava(\s+ivy)?\b/i,
    /\b(tell|ask|get|kick|remove|mute|ban|hate|love|like|dislike|ignore)\b.{0,30}\bava(\s+ivy)?\b/i,
    /\bava(\s+ivy)?\b.{0,80}\b(cringe|annoying|cool|good|bad|dumb|smart|useful|useless|spam|noisy|cute|weird|clanker|ai|bot)\b/i,
    /\b(she|her)\b.{0,40}\b(ava|bot|ai|clanker)\b|\b(ava|bot|ai|clanker)\b.{0,40}\b(she|her)\b/i,
    /\b(that|this|the)\s+(ava|bot|ai|clanker)\b/i,
    /\bava(\s+ivy)?\b.+\?/i,
  ];
  return aboutPatterns.some((re) => re.test(raw));
}

/** Engage if addressed, replied-to (caller), or clearly talked about. */
export function shouldAvaEngage(contentOrMsg, botUserId) {
  return (
    looksLikeAvaTrigger(contentOrMsg, botUserId) ||
    looksLikeTalkingAboutAva(contentOrMsg, botUserId)
  );
}

/** @deprecated */
export const looksLikeSexiTrigger = looksLikeAvaTrigger;

export function extractQuestion(content) {
  return String(content || "")
    .replace(/<@!?\d+>/g, "")
    .replace(/^(hey\s+|hi\s+|yo\s+|ok\s+|okay\s+|alright\s+)?ava(\s+ivy)?[,:!]?\s*/i, "")
    .trim();
}
