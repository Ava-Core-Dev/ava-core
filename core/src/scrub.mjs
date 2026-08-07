import { NEVER_MENTION } from "./config.mjs";
import { AVA_APP_EMOJIS } from "./appEmojis.mjs";
import { isDarkStallText, darkStallRescueLine } from "./darkStall.mjs";
import { isLockoutActive } from "./lockoutMode.mjs";
import {
  isLocalCoreFailText,
  sanitizeLocalCoreFailReply,
} from "./localCoreFail.mjs";

/**
 * Llama/meta replies that inventory injected packs instead of answering.
 * Highest-pain dump shape from mess-scan ("It appears that you have provided…").
 */
export function isPackDumpText(text = "") {
  const t = String(text || "").trim();
  if (!t) return false;
  if (
    /\bit appears that you have provided\b/i.test(t) ||
    /\byou(?:'ve| have) provided a (?:large|long|huge) amount of (?:text|context|information|data)\b/i.test(
      t,
    ) ||
    /\bhowever,? there is no specific (?:question|problem|ask)\b/i.test(t) ||
    /\b(?:summariz(?:e|ing)|overview of) (?:the )?(?:provided |injected )?(?:packs?|context|documents?|notes)\b/i.test(
      t,
    ) ||
    /\b(?:here(?:'s| is) (?:a |an )?(?:summary|inventory|breakdown) of (?:the |your )?(?:packs?|context|documents?|files))\b/i.test(
      t,
    ) ||
    (/\b(?:routing reminders|surface architecture|ecosystem maps|storage layouts)\b/i.test(
      t,
    ) &&
      /\b(?:provided|context|document|pack)\b/i.test(t))
  ) {
    return true;
  }
  // Long meta wall that lists doc-shaped headings without a human ask answer
  if (
    t.length > 700 &&
    /\b(?:CORE-SPEC|ECOSYSTEM\.md|SURFACE-ARCHITECTURE|LINUX-E-SSD|organizer packs?|###\s+\w+)/i.test(
      t,
    ) &&
    /\b(?:provided|you (?:gave|sent)|large amount|context dump)\b/i.test(t)
  ) {
    return true;
  }
  return false;
}


export function isDigTheaterText(text = "") {
  const t = String(text || "").toLowerCase();
  if (!t) return false;
  const pats = [
    /clock.?s ticking/,
    /still digging/,
    /queue hop/,
    /busy brain/,
    /pulling it up/,
    /digging\u2026|digging\.{2,}/,
    /same answer as last/,
    /don.?t spam me/,
    /patience tax/,
    /\bdigs (live|running)\b/,
    /queue.?s moving/,
  ];
  return pats.some((re) => re.test(t));
}

export function digTheaterRescueLine() {
  return ""; // prefer silence — caller should react instead
}

export function packDumpRescueLine() {
  return "Got the context — what's the actual ask?";
}

export { isLocalCoreFailText };

export function stripForbiddenMentions(text) {
  let out = String(text || "");
  for (const id of NEVER_MENTION) {
    out = out.replace(new RegExp(`<@!?${id}>`, "g"), "that player");
  }
  return out;
}

/** Strip Discord app-emoji markup that does not render on Slack. */
export function stripDiscordAppEmojis(text) {
  let out = String(text || "");
  out = out.replace(/<a?:[a-zA-Z0-9_]+:\d+>/g, "");
  out = out.replace(
    /:(?:ava_[a-z0-9_]+|ship_it|vote_yes|vote_no|sleepy|pickaxe|party_pop|on_fire|hologram|heart|grass_block|gold_coin|diamond_gem|creeper_face|bug_report|warn):/gi,
    "",
  );
  out = out.replace(/[ \t]{2,}/g, " ");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

/**
 * Turn `:ava_wave:` shortcodes into real `<:ava_wave:id>` mentions on Discord.
 * LLMs love typing shortcodes that never render.
 */
export function expandDiscordAppEmojiShortcodes(text) {
  let out = String(text || "");
  out = out.replace(/:([a-zA-Z0-9_]+):/g, (full, name) => {
    const key = String(name).toLowerCase();
    const id = AVA_APP_EMOJIS[key];
    if (!id) return full;
    return `<:${key}:${id}>`;
  });
  return out;
}

/**
 * Discord-safe text: flatten fancy punctuation that Windows pipes turn into ???.
 * Keeps Discord custom emoji markup and normal Unicode letters/emoji.
 */
export function discordSafeText(text) {
  let out = String(text || "");
  out = out
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/\u00A0/g, " ")
    .replace(/\uFFFD/g, "")
    .replace(/[\u00B7\u2022\u2023\u2043\u2219\u25CF\u25E6\u30FB]/g, "-")
    .replace(/\u2192|\u21D2|\u2794|\u279C|\u27A1/g, "->")
    .replace(/\u2190|\u21D0/g, "<-")
    .replace(/[\u2190-\u21FF]/g, "->")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u00AB\u00BB]/g, '"')
    .replace(/\u2039/g, "'")
    .replace(/\u203A/g, "'")
    .replace(/\u00D7/g, "x")
    .replace(/\u00F7/g, "/")
    .replace(/\u2122/g, "(TM)")
    .replace(/\u00AE/g, "(R)");

  // Protect Discord custom emoji / mentions, ASCII-sanitize leftover odd punctuation
  const held = [];
  out = out.replace(/<a?:[\w~]+:\d+>|<@!?\d+>|<@&\d+>|<#\d+>/g, (m) => {
    held.push(m);
    return `\u0000HOLD${held.length - 1}\u0000`;
  });

  // Replace other General Punctuation / fancy symbols that often become ???
  out = out.replace(/[\u2000-\u206F]/g, (ch) => {
    if (ch === "\n" || ch === "\t") return ch;
    return "-";
  });

  out = out.replace(/\u0000HOLD(\d+)\u0000/g, (_, i) => held[Number(i)] || "");
  return out;
}


/** Retired EcoFlow nicknames — never print. Product names only. */
const ECO_NICK_REPLACEMENTS = [
  [/\bshackas\b/gi, "River 2 Pro"],
  [/\bshakas\b/gi, "River 2 Pro"],
  [/\bshockas\b/gi, "River 2 Pro"],
  [/\bcucumbers\b/gi, "Delta 2"],
  [/\bcucumber\b/gi, "Delta 2"],
];

export function sanitizeEcoflowNicknames(text = "") {
  let out = String(text || "");
  for (const [re, label] of ECO_NICK_REPLACEMENTS) {
    out = out.replace(re, label);
  }
  // Kill meta-apologies that re-introduce the nicknames.
  out = out.replace(
    /\s*\(not named by you,? but that'?s what I keep calling it\)/gi,
    "",
  );
  out = out.replace(
    /\s*I'?ll make sure to stop using (?:the )?(?:cucumber|shaka|shacka)[^\n.]*/gi,
    "",
  );
  return out;
}

/** Strip common secret / path / customer-detail leaks before Discord/Slack. */
export function scrubPublicReply(text, opts = {}) {
  const surface = String(opts.surface || "").toLowerCase();
  const allowCustomer = Boolean(opts.allowCustomerDetails);
  // Lockout Alex Telegram = private core-dev — Cursor/Grok names stay.
  const allowVendor =
    opts.allowVendorNames === true ||
    (opts.allowVendorNames !== false &&
      surface === "telegram" &&
      isLockoutActive());
  let out = stripForbiddenMentions(text);
  out = sanitizeEcoflowNicknames(out);

  // Always flatten fancy punctuation first (before any pipe can leave ???)
  out = discordSafeText(out);

  if (surface === "slack") {
    out = stripDiscordAppEmojis(out);
  } else {
    out = expandDiscordAppEmojiShortcodes(out);
  }
  out = out.replace(/```[\s\S]*?```/g, (block) => {
    if (/password|token|secret|api[_-]?key|\.env/i.test(block)) {
      return "_[code omitted]_";
    }
    return block;
  });
  out = out.replace(/D:\\\.1 Work Stations\\RootMC[^\s`]*/gi, "`(workspace)`");
  out = out.replace(/\/(?:srv|opt|home)\/[^\s`]*[Rr]oot[Mm][Cc][^\s`]*/g, "`(workspace)`");
  out = out.replace(/\/(?:Users|home)\/[^\s`]+/gi, "`(path)`");
  out = out.replace(
    /\b(?:CURSOR_API_KEY|DISCORD_(?:ROOTMC_)?BOT_TOKEN|GROK_[A-Z0-9_]+|JWT_[A-Z0-9_]+|XAI_API_KEY|STRIPE_SECRET_KEY)\b\s*[:=]\s*\S+/gi,
    "[redacted]",
  );
  out = out.replace(/\bsk-[a-zA-Z0-9_-]{20,}\b/g, "[redacted]");
  out = out.replace(/\bsk_live_[a-zA-Z0-9]+/gi, "[redacted]");
  out = out.replace(/\bsk_test_[a-zA-Z0-9]+/gi, "[redacted]");
  out = out.replace(/\bcursor_[a-zA-Z0-9_-]{20,}\b/g, "[redacted]");
  out = out.replace(/\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/g, "[redacted-telegram-token]");
  out = out.replace(/\bcrsr_[a-zA-Z0-9_-]{20,}\b/g, "[redacted]");
  // Public surfaces: never leak other AI / vendor names.
  // Lockout Alex Telegram = private core-dev — keep Cursor/Grok/etc. names.
  if (!allowVendor) {
    out = out.replace(/\bcursor\s*sdk\b/gi, "hands-on developing session");
    out = out.replace(/\bcursor\s+(agent|dig|session|brain|mode)\b/gi, "hands-on developing session");
    out = out.replace(/\b(grok|xai|chatgpt|chat\s*gpt|claude|openai|gemini|copilot)\b/gi, "Root Server");
    out = out.replace(/\bcursor\b/gi, "hands-on developing session");
  }
  // Never publish host-site city in public replies (coords stay private)
  out = out.replace(/\bHawaii\s+Mountain\s+View\b/gi, "HI Pacific Solar Root Server");
  out = out.replace(/\bMountain\s+View\s*,?\s*HI\b/gi, "HI Pacific Solar Root Server");
  out = out.replace(/\bMountain\s+View\b/gi, "HI Pacific Solar Root Server");
  out = out.replace(
    /\bRoot Server host(?:\s*\(Starlink\s*\/\s*solar\))?/gi,
    "HI Pacific Solar Root Server",
  );

  // Customer details — only Alex-only DMs may keep these
  if (!allowCustomer) {
    out = out.replace(
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
      "[redacted-email]",
    );
    out = out.replace(/\bcus_[a-zA-Z0-9]+/g, "[redacted-customer]");
    out = out.replace(/\bsub_[a-zA-Z0-9]+/g, "[redacted-sub]");
    out = out.replace(/\bin_[a-zA-Z0-9]+/g, "[redacted-invoice]");
    out = out.replace(/\bpi_[a-zA-Z0-9]+/g, "[redacted-payment]");
    out = out.replace(/\bch_[a-zA-Z0-9]+/g, "[redacted-charge]");
    out = out.replace(/\bcard\s*ending\s*\d{4}\b/gi, "card ending [redacted]");
    out = out.replace(/\b(?:last\s*4|last4)\s*[:=]?\s*\d{4}\b/gi, "last4 [redacted]");
    out = out.replace(
      /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s])\d{3}[-.\s]\d{4}\b/g,
      "[redacted-phone]",
    );
    // Do not treat exit codes / short numbers as phones
    out = out.replace(/\(exit\s+\[redacted-phone\]\)/gi, "(exit code)");
  }

  // Kill pack regurgitation (inventory of injected context) before it ships.
  if (isPackDumpText(out)) {
    out = packDumpRescueLine();
  }
  if (isDigTheaterText(out)) {
    out = digTheaterRescueLine();
  }

  // Kill redundant darkside / "server down" boilerplate — llama core stays online.
  if (isDarkStallText(out)) {
    out = darkStallRescueLine();
  }

  // Rate-limit local-core / rephrase honesty loops (caller may also suppress empty).
  if (isLocalCoreFailText(out) && opts.channelId) {
    const sanitized = sanitizeLocalCoreFailReply(out, opts.channelId, {
      lockoutPrivate: allowVendor && surface === "telegram",
    });
    out = sanitized.text || "";
  }

  // Hard public ceiling — kill walls outside PROP/governance threads.
  // Telegram / Discord DMs skip this 450-char chop (they already have AVA_TG_REPLY_MAX).
  // Mid-sentence "…" cutoffs were shredding Alex TG replies and /solar boards.
  const isPrivateSurface =
    surface === "telegram" || surface === "discord-dm";
  const maxPublic =
    Number(opts.maxChars) ||
    (opts.allowLongProp ? 1900 : isPrivateSurface ? 0 : 450);
  if (
    !opts.allowLongProp &&
    maxPublic > 0 &&
    out.length > maxPublic
  ) {
    out = out.slice(0, maxPublic - 1).trimEnd() + "…";
  }

  // Soft ceiling — Discord/Slack multipost handles platform limits.
  // TG/DM: harder cap so pack walls can't land as "one message".
  let max = surface === "slack" ? 100_000 : 80_000;
  if (surface === "telegram" || surface === "discord-dm") {
    max = Number(process.env.AVA_TG_REPLY_MAX || 3500) || 3500;
  }
  return out.trim().slice(0, max);
}
