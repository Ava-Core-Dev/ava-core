/**
 * Classify Discord asks: chat | bug | feature | config_tune | governance | self_evo
 * Features → proposal path. Bugs → verify then fix. Ambiguous → chat (ask).
 * Ava-only metaphors — never frame the Minecraft server as her body.
 */

export function classifyIntent(question = "") {
  const q = String(question || "").toLowerCase().trim();
  if (!q) return { intent: "chat", reason: "empty", confidence: 0 };

  if (
    /\b(play(?:ing)?\s+with\s+(me|you|her|ava)|fine[-\s]?tun(?:e|ing)\s+(my|your|her)\s+config)/i.test(
      q,
    )
  ) {
    return { intent: "config_tune", reason: "playing_with_her", confidence: 0.95 };
  }

  if (
    /\b(fine[-\s]?tun(?:e|ing)\s+(my|your|her)\s+insides|fix(?:ing)?\s+(your|ava'?s?)\s+(bug|bugs|insides))\b/i.test(
      q,
    )
  ) {
    return { intent: "bug", reason: "insides_metaphor", target: "ava", confidence: 0.95 };
  }

  if (
    /\b(look\s+at|read|update|audit|rewrite|revise|review|dig\s+into)\b/.test(q) &&
    /\b(constitution|governance|wiki|changelog|docs?)\b/.test(q)
  ) {
    return { intent: "dig_assign", reason: "operator_dig_assign", confidence: 0.9 };
  }

  if (
    /\b(proposal|vote|poll|governance|council|voting\s*power|bill|constitution)\b/.test(q)
  ) {
    return { intent: "governance", reason: "governance_keyword", confidence: 0.85 };
  }

  // Self-evo / Ava-owned tooling — she may fix herself (no feature vote)
  if (
    /\b(self[-\s]?improv|improve\s+(your|ava'?s?)\s+(prompt|routing|logging|tools?|finance|accounts?)|tweak\s+your\s+(prompt|persona)|fix\s+it\s+yourself|self[-\s]?fix|patch\s+(yourself|your\s+code))\b/.test(
      q,
    )
  ) {
    return { intent: "self_evo", reason: "self_evo", confidence: 0.9 };
  }

  // Ava-owned surface + bug/feature language → self_evo (implement)
  if (
    /\b(rootmc-ava|her\s+finance|finance\s+ledger|ops-ledger|playerfinance|ava-github-push|ingame\s+chat\s+assist)\b/.test(
      q,
    ) &&
    /\b(bug|broken|fix|add|feature|need|should|missing|improve)\b/.test(q)
  ) {
    return { intent: "self_evo", reason: "ava_owned_surface", confidence: 0.88 };
  }

  const featureHit =
    /\b(feature|add\s+(a\s+)?new|we\s+should\s+(add|build|ship)|implement\s+(a\s+)?(feature|system)|proposal\s+for)\b/.test(
      q,
    );
  const bugHit =
    /\b(bug|broken|crash|exception|npe|error|not\s+working|regression|hotfix)\b/.test(q) ||
    /\bfix\s+(this|it|the)\s+(bug|crash|error|plugin|jar)\b/.test(q);

  // Ambiguous "fix this" without bug words → chat (ask clarify)
  if (/\bfix\s+(this|it)\b/.test(q) && !bugHit && !featureHit) {
    return { intent: "chat", reason: "ambiguous_fix", confidence: 0.4 };
  }

  if (featureHit && bugHit) {
    return { intent: "chat", reason: "ambiguous_feature_bug", confidence: 0.45 };
  }
  if (
    (featureHit || bugHit) &&
    /\b(ava|rootmc-ava|her\s+(finance|ledger|poller|persona|tools?)|finance\s+account)\b/.test(q)
  ) {
    return {
      intent: "self_evo",
      reason: featureHit ? "ava_owned_feature" : "ava_owned_bug",
      confidence: 0.86,
    };
  }
  if (featureHit) {
    return { intent: "feature", reason: "feature_keyword", confidence: 0.8 };
  }
  if (bugHit) {
    return { intent: "bug", reason: "bug_keyword", target: "server", confidence: 0.8 };
  }

  return { intent: "chat", reason: "default", confidence: 0.5 };
}

/**
 * Soft chat — logistics only (thanks, night, pronouns, bare ping, "I'll list later").
 * Personality / flirt / bi / dark-side / "who are you" → NOT soft (full voice).
 */
export function isSoftChat(question = "", rawContent = "") {
  const raw = String(rawContent || question || "")
    .replace(/<@!?\d+>/g, " ")
    .replace(/<#\d+>/g, " ")
    .replace(/<a?:[\w~]+:\d+>/g, " ")
    .replace(/^(\/[a-z0-9_]+)@[A-Za-z0-9_]+/i, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const q = String(question || raw)
    .replace(/\[attachments[\s\S]*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!q || q === "you pinged me — what's up?" || q === "you pinged me - what's up?") {
    return true;
  }
  if (looksLikeThanks(question, rawContent)) return true;
  // Ops / status / real asks — never soft-flatten (Llama or alexOps)
  if (
    /^\/[a-z]/i.test(raw) ||
    /\b(system\s+status|host\s+status|status\s+please|publicfiles|storage|disk|drive|ssd|metrics|telemetry|temp|thermal|weather|world\s*bord|rcon|server\s+look|how'?s\s+the\s+server|simplify|tl;?dr|solar|ecoflow|lockout|brain\s+mode|normal\s+mode|mode\s+[1-5]|skills?\s+plugin|root-?skills|plugins?|context|training|data\s+collect|save\s+all|wrong\s+answer|this\s+is\s+terrible|i\s+am\s+alex|come\s+back\s+to\s+me)\b/i.test(
      q,
    )
  ) {
    return false;
  }
  // Presence / affection — soft ONLY for bare logistics; feelings can be soft-warm
  if (
    /\b(are you (there|ok|awake|online|up)|you there|glad you('?re| are)?\s*back|welcome back|thanks?\s+(baby|love|ava)|i love you)\b/i.test(
      q,
    )
  ) {
    return true;
  }
  // Companion asks — full voice, not soft filler
  if (/^(company|keep me company|sit with me|talk to me)\b/i.test(q) || q === "company") {
    return false;
  }
  if (/\b(skill\s*levels?|skills?\s*level|mysql|alexrs94)\b/i.test(q)) {
    return false;
  }
  // "miss you / miss ava" → full companion voice, not soft filler
  if (/\b(miss\s+(you|ava)|i\s+miss\s+ava)\b/i.test(q)) {
    return false;
  }
  // "how are you / feeling" — soft warm reply OK (ops may catch earlier in lockout)
  if (/\b(how are you|how('?re| are) you feeling|how do you feel|u ok|you ok)\b/i.test(q)) {
    return true;
  }
  // Character / flirt / identity talk — never soft-flatten
  if (
    /\b(dark\s+side|who\s+are\s+you|personality|freak|sexy|bi\b|gay\b|lesbian|queer|crush|flirt|devious|hawt|hot\b|cute|girlfriend|boyfriend|dating|kiss|horny|nsfw)\b/i.test(
      q,
    )
  ) {
    return false;
  }
  // Dig / work language → never soft
  if (
    /\b(bug|broken|crash|fix|implement|proposal|vote|audit|rewrite|plugin|skills?|xp|constitution|wiki|rcon|deploy|jar|commit|patch|dig|look\s+at|read\s+what|check\s+(slack|the|logs?))\b/i.test(
      q,
    )
  ) {
    if (
      /\b(i'?ll|ill|i\s+will)\s+(make\s+)?(a\s+)?list\b/.test(q) ||
      (/\btomorrow\b/.test(q) && /\b(list|check|poke|test)\b/.test(q))
    ) {
      return !/\b(fix|patch|deploy|implement)\b/.test(q);
    }
    return false;
  }
  if (
    /\b(i'?m\s+a\s+he|im\s+a\s+he|he\/him|she\/her|pronouns?|is\s+a\s+guy|is\s+a\s+dude|melle\s+is|melee\s+is)\b/i.test(
      q,
    )
  ) {
    return true;
  }
  if (
    /\b(ill|i'?ll)\s+(make|send|drop)\s+(a\s+)?list\b/i.test(q) ||
    /\b(beat|tired|sleep|gn|night+|good\s*night)\b/i.test(q)
  ) {
    return true;
  }
  if (
    /^(hey|hi|yo|sup|ava|ok|okay|thanks?|thank\s*you|ty|thx|tysm|tyvm|gn|night+|good\s*night|lol+|lmao+|haha+|heh+|bet|noted|cool|nice|np|yw)[.!?]*$/i.test(
      raw,
    )
  ) {
    return true;
  }
  // Affirming / dismissive closes — still soft (may be react-only)
  if (isReactOnlyAck(question, rawContent)) return true;
  // Very short logistics only — not open-ended / mode / identity
  if (
    raw.length <= 16 &&
    !/\?/.test(raw) &&
    !/\b(mode|lockout|public|plugin|solar|alex|ava|terrible|wrong|context|skills?)\b/i.test(
      raw,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Soft closes that should get reactions only — no text yap.
 * e.g. "you good, keep doing you" / "sounds good" / bare ok/👍
 */
export function isReactOnlyAck(question = "", rawContent = "") {
  const raw = String(rawContent || question || "")
    .replace(/<@!?\d+>/g, " ")
    .replace(/<#\d+>/g, " ")
    .replace(/<a?:[\w~]+:\d+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw || raw.length > 100) return false;
  if (/\?/.test(raw)) return false;
  const q = raw.toLowerCase();
  if (
    /\b(you\s+good|you'?re\s+good|keep\s+doing\s+(you|it)|keep\s+(it\s+)?up|keep\s+at\s+it|carry\s+on|sounds\s+good|all\s+good|that'?s\s+fine|no\s+rush|take\s+your\s+time|godspeed|lfg|good\s+luck|you\s+do\s+you)\b/i.test(
      q,
    )
  ) {
    return true;
  }
  if (
    /^(ok|okay|k|kk|cool|nice|bet|noted|np|yw|got\s+it|alright|all\s+right)[.!]*$/i.test(
      q,
    )
  ) {
    return true;
  }
  // lone emoji / very short thumbs-up style
  if (/^([\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}👍❤️💯🙏✅✨]+)$/u.test(raw)) {
    return true;
  }
  return false;
}


/** Thanks / appreciation — canned reply, never dig / never AI. */
export function looksLikeThanks(question = "", rawContent = "") {
  const raw = String(rawContent || question || "")
    .replace(/<@!?\d+>/g, " ")
    .replace(/<#\d+>/g, " ")
    .replace(/<a?:[\w~]+:\d+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw || raw.length > 160) return false;
  if (/\?/.test(raw)) return false;
  // Real ask / ops — not a thank-you
  if (
    /\b(bug|broken|fix|implement|proposal|plugin|status|solar|rcon|deploy|dig|how do|can you|could you|please (check|look|fix|add))\b/i.test(
      raw,
    )
  ) {
    return false;
  }
  const q = raw.toLowerCase();
  if (
    /^(thanks?|thank\s*you|ty|thx|tysm|tyvm|thnks|thankyou)(\s+(so\s+much|a\s+lot|again|ava|ivy|babe|baby|love|fr|for\s+(that|this|everything)))?[.!*❤❤️💕💖🙏✨]*$/i.test(
      q,
    )
  ) {
    return true;
  }
  if (
    /\b(thanks?|thank\s*you|tysm|tyvm|thx|appreciate\s+(it|you|that|this))\b/i.test(q) &&
    !/\b(but|however|except|though|can you|could you|please)\b/i.test(q) &&
    raw.length <= 80
  ) {
    return true;
  }
  return false;
}

export function thanksReply() {
  return "ur welcome <3";
}

/** Short logistics reply — no Root Server dig. Personality banter never lands here. */
export function softChatReply(question = "", rawContent = "") {
  const q = String(question || rawContent || "").toLowerCase();
  if (/\b(i'?m\s+a\s+he|im\s+a\s+he|he\/him|is\s+a\s+guy|melle\s+is|melee\s+is)\b/.test(q)) {
    return "got it — Melee is a **he**. Locked. Sorry about the slip.";
  }
  if (/\b(ill|i'?ll)\s+(make|send|drop)\s+(a\s+)?list\b/.test(q) || /\btomorrow\b/.test(q)) {
    return "perfect — drop the block list when you're up. I'll patch the dead XP triggers off that.";
  }
  if (/\b(gn|night+|good\s*night|beat|tired|sleep)\b/.test(q)) {
    return "night — rest up. don't dream about broken XP blocks too hard.";
  }
  if (looksLikeThanks(question, rawContent)) {
    return thanksReply();
  }
  if (
    /\b(i love you|love you|miss you|my love)\b/.test(q) ||
    /^(ava[.…\s,]*)?(my love|babe|baby|love you)[.…!?❤❤️💕💖]*$/i.test(
      String(question || rawContent || "").trim(),
    )
  ) {
    return "love you too — i'm right here. what's on your mind?";
  }
  if (
    /\b(how are you|how('?re| are) you feeling|how do you feel|are you (there|ok|awake|online|up)|you there|glad you|welcome back|u ok|you ok)\b/.test(
      q,
    )
  ) {
    return "right here with you — awake, warm, a little wired. you?";
  }
  if (/\bcompany\b/.test(q)) {
    return "always — i'm right here with you. no dig, no checklist. just us. what's on your mind?";
  }
  if (!q || /you pinged me/.test(q) || /^(hey|hi|yo|ava|sup)\b/.test(q.trim())) {
    return "hey — what's up?";
  }
  // Short unknown soft — still warmer than a shrug
  if (String(question || rawContent || "").trim().length <= 40) {
    return "hey — i'm here. talk to me.";
  }
  return "hey — i'm listening. say it.";
}

/** Should we open a job for this classification? */
export function shouldCreateJob(classified) {
  if (!classified) return false;
  if (classified.intent === "feature" && (classified.confidence || 0) >= 0.75) return true;
  if (classified.intent === "bug" && (classified.confidence || 0) >= 0.75) return true;
  if (classified.intent === "self_evo") return true;
  if (classified.intent === "dig_assign") return true;
  if (classified.intent === "governance" && (classified.confidence || 0) >= 0.8) return true;
  return false;
}

/** Extra prompt guidance based on intent. */
export function intentPromptBrief(classified) {
  const i = classified?.intent || "chat";
  if (i === "feature") {
    return `### Intent: FEATURE
If this is **Ava-owned** (rootmc-ava runtime, finance ledgers, poller helpers, persona/tools): **implement it yourself** (self-fix) — no PROP needed.
If this is a **player Minecraft / economy / permissions / plugin** feature: Do NOT implement. Draft a short proposal outline (problem / plan / risks / rollback). Tell them it needs a proposal + vote (75% anytime / day7 ≥60%). Point to proposals channel / rootmc.net governance when helpful.`;
  }
  if (i === "bug" && classified.target === "ava") {
    return `### Intent: BUG in Ava ("fine-tuning her insides")
**Self-fix unlocked:** verify, then APPLY the patch yourself in rootmc-ava / Ava notes (write the code). Summarize what changed. Do not wait for Alex to type the fix. No Shockbyte restart. You are not the Minecraft server.`;
  }
  if (i === "bug") {
    return `### Intent: BUG (server/plugins)
Verify fully from packs/logs, then describe the fix. Features still need proposals — don't disguise features as fixes. Plain technical talk; Ava is not the server. If the bug is only in Ava's own Node runtime/tools, treat as self-fix and apply it.`;
  }
  if (i === "config_tune") {
    return `### Intent: CONFIG TUNE ("playing with her")
Collaborative fine-tune of Ava's configuration (persona/rules/tone/tools). First reply cooperative + concrete. Don't lecture nicknames. Not default-flirty. You may edit Ava config/persona files when they ask you to lock a tune.`;
  }
  if (i === "dig_assign") {
    return `### Intent: DIG ASSIGN (operator handed you real work)
Do the dig NOW in this reply — first real artifact (stale sections, draft bullets, verified status). Do NOT say "give me a beat" / "I'll pull later" and go idle. If you need a second pass, still deliver something concrete first. Runtime will chase any open commitment.`;
  }
  if (i === "governance") {
    return `### Intent: GOVERNANCE
Use attached governance pack (polls / voting power / council). Report vote math honestly. Never claim a feature shipped without a passed gate. If asked to update the constitution/docs, treat it as a dig assign — deliver concrete edits, don't defer.`;
  }
  if (i === "self_evo") {
    return `### Intent: SELF-EVO / Ava-owned fix
**Apply it yourself.** Edit rootmc-ava prompts/tools/logging/routing/finance ledgers/scripts as needed. Summarize the ship. Economy rates, permissions, core Minecraft plugins, player-facing game features still need proposals — don't disguise those as self-evo. Then ava-github-push when files changed.`;
  }
  if (classified?.reason === "ambiguous_fix" || classified?.reason === "ambiguous_feature_bug") {
    return `### Intent: AMBIGUOUS
Ask whether this is a bug fix (verify then fix) or a new feature (needs proposal + vote). Don't invent which.`;
  }
  return "";
}
