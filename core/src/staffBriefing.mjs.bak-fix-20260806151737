/**
 * Automated staff briefings — GM + quick pulse / ranked full report.
 * Instant, no Cursor dig. Alex 2026-08-03 (Melee asked full report, Ava stalled).
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths, loadStatusEvents, loadHeartbeat } from "./store.mjs";
import { loadEcoSnapshot, isEcoSampleLive, isEcoRemoved, ECO_STALE_MS } from "./ecoflow.mjs";
import { loadHostSite } from "./hostSite.mjs";
import { isAsleep } from "./sleepMode.mjs";
import { isPoweredOff } from "./powerDown.mjs";
import { readLiveness } from "./liveness.mjs";

const NICK = {
  R331ZAB5SG6S2858: "Delta 2",
  R621ZA16XH6K1155: "River 2 Pro",
};

function clean(text = "") {
  return String(text || "")
    .replace(/<@!?\d+>/g, " ")
    .replace(/<#\d+>/g, " ")
    .replace(/<a?:[\w~]+:\d+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isGoodMorningAsk(text = "") {
  const q = clean(text).toLowerCase();
  if (!q) return false;
  return (
    /^(good\s*mornin[g']?|mornin[g']?|gm)\b/.test(q) ||
    /\b(good\s*mornin[g']?|mornin[g']?|gm)\b/.test(q) &&
      /\b(ava|ivy|lead[-\s]?dev)\b/.test(q) &&
      q.length <= 80
  );
}

export function isQuickPulseAsk(text = "") {
  const q = clean(text).toLowerCase();
  return (
    /\b(quick\s+pulse|short\s+(status|update|report)|pulse\s+only|just\s+(a\s+)?pulse)\b/.test(
      q,
    ) ||
    /^(pulse|quick)\b/.test(q)
  );
}

export function isFullReportAsk(text = "") {
  const q = clean(text).toLowerCase();
  return (
    /\b(full\s+report|status\s+report|what\s+(was\s+)?done|since\s+yesterday|rundown|brief(?:ing)?\s+me|1\s*(to|-)\s*10|ranked\s+report)\b/.test(
      q,
    ) ||
    (/\breport\b/.test(q) &&
      /\b(full|complete|everything|all|yesterday|done|important)\b/.test(q))
  );
}

export function isStaffBriefingAsk(text = "") {
  return (
    isGoodMorningAsk(text) || isQuickPulseAsk(text) || isFullReportAsk(text)
  );
}

function fmtHst() {
  const d = new Date(Date.now() - 10 * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} HST`;
}

function livePowerLine() {
  const snap = loadEcoSnapshot();
  const hostOnline = !isAsleep() && !isPoweredOff();
  const ecoAge =
    snap?.updatedAt != null ? Date.now() - Number(snap.updatedAt) : null;
  const stale = ecoAge != null ? ecoAge > ECO_STALE_MS : !snap;
  const live = Object.entries(snap?.perSn || {}).filter(
    ([sn, v]) => !isEcoRemoved(sn) && isEcoSampleLive(v),
  );
  const bits = live.map(([sn, v]) => {
    const label = NICK[sn] || sn.slice(-6);
    return `${label} ${v.soc != null ? v.soc + "%" : "?"}`;
  });
  return (
    `host **${hostOnline ? "on" : "off"}** · Eco **${stale ? "stale/last-known" : "live"}**` +
    (snap?.batteryPct != null && !stale && live.length
      ? ` · bank **~${snap.batteryPct}%**`
      : "") +
    (bits.length ? ` · ${bits.join(", ")}` : " · no live packs")
  );
}

/** Instant GM — always offer pulse vs full report. */
export function buildGoodMorningReply({ authorName = "" } = {}) {
  const who = authorName ? String(authorName).split(/[_\s]/)[0] : "hey";
  const lines = [
    `gm ${who.toLowerCase()} 🌞`,
    "",
    `holding the desk @ ~${fmtHst()} — ${livePowerLine()}.`,
    "",
    "want a **quick pulse** (solar + what's live/staged) or a **full report** (ranked 1–10 since yesterday)? say which and I'll dump it — otherwise I'll stay quiet and keep digging.",
  ];
  return lines.join("\n");
}

export function buildQuickPulseReply() {
  const site = loadHostSite();
  const live = readLiveness();
  const hb = loadHeartbeat();
  const lines = [
    `**Quick pulse** @ ~${fmtHst()}`,
    "",
    `**${site.label || "HI Pacific Solar Root Server"}:** ${livePowerLine()}`,
    `**Ava:** gateway ${live?.gateway?.connected ? "up" : "?"} · poller ${hb?.live ? "live" : "?"} · asleep ${isAsleep() ? "yes" : "no"}`,
    "**Staged / waiting you:** PROP onboarding+shop guardrails FileZilla handoffs · in-game `/solar` (root-ava-core 1.8.5+) · WE/FAWE jar for schematic paste",
    "**Live already:** Discord `/solar` · Eco 60s poll + D1 eco samples · RCON build-assist path · 3m live/stale gate",
    "",
    "say **full report** if you want the ranked 1–10.",
  ];
  return lines.join("\n");
}

/**
 * Ranked 1–10 since ~yesterday — deterministic from shipped notes / status.
 * Most important first. Never invent unfinished as done.
 */
export function buildFullRankedReportReply() {
  const events = loadStatusEvents(40)
    .map((line) => {
      const tab = String(line).indexOf("\t");
      if (tab < 0) return null;
      return { at: line.slice(0, tab), text: line.slice(tab + 1) };
    })
    .filter(Boolean)
    .slice(0, 8);

  const ranked = [
    {
      n: 1,
      title: "PROP — new-player onboarding + shop guardrails",
      detail:
        "From hihihi6702 feedback. Staged Claims/Towny/Test (appreciation trim/book strip, spawn safety, shop holograms, rank clarity). Live gate: FileZilla + Shockbyte restart.",
    },
    {
      n: 2,
      title: "`/solar` everywhere",
      detail:
        "Discord text + slash + in-game Root-Ava-Core. Weather + outlook each time. Slash ACK fix after 'application did not respond'.",
    },
    {
      n: 3,
      title: "EcoFlow live vs last-known (3 min)",
      detail:
        "Offline device-list or sample >3m → excluded from live bank. River was falsely live from cached quota — fixed.",
    },
    {
      n: 4,
      title: "Eco poll + SQL samples",
      detail:
        "~60s EcoFlow refresh + host-site push. D1 `rootmc_ecoflow_samples` (API deployed). Keeps River ready when cloud flips online.",
    },
    {
      n: 5,
      title: "In-game help powers (RCON)",
      detail:
        "Console build-assist armed (setblock/fill/execute/WE when jar lands). No Mojang AvaIvy account — console path.",
    },
    {
      n: 6,
      title: "Solar board copy",
      detail:
        "Live lines = last pull (SOC + in/out). No redundant solarW third watt. Totals/avgs on ask.",
    },
    {
      n: 7,
      title: "Soft chat / praise + banter rails",
      detail:
        "Praise → warm reply (not mm?). Soft #general banter = light join, don't dig-spam mid-story.",
    },
    {
      n: 8,
      title: "Follow-ups while asleep",
      detail:
        "Follow-up scan stays on during sleep so morning summons aren't skipped.",
    },
    {
      n: 9,
      title: "Delta 2-B removed from live bank",
      detail: "Hard-removed SN scrubbed from Eco poll / boards.",
    },
    {
      n: 10,
      title: "Ops hygiene",
      detail:
        "Phase catch-ups, training notes, status events. GitHub push still gated on Rootmcnet auth.",
    },
  ];

  const lines = [
    `**Full report** — since yesterday · ranked **1 = most important → 10 = necessary but lighter** · ~${fmtHst()}`,
    "",
    `**Right now:** ${livePowerLine()}`,
    "",
  ];
  for (const r of ranked) {
    lines.push(`**${r.n}.** ${r.title}`);
    lines.push(`${r.detail}`);
    lines.push("");
  }
  if (events.length) {
    lines.push("_Recent status ticks:_");
    for (const e of events.slice(0, 5)) {
      lines.push(`• ${String(e.text).slice(0, 100)}`);
    }
    lines.push("");
  }
  lines.push("need a deeper dig on any # — say the number.");
  return lines.join("\n");
}

/**
 * Pipeline short-circuit.
 * @returns {Promise<{ handled: boolean, reply?: string, kind?: string }|null>}
 */
export async function tryHandleStaffBriefing({ text = "", authorName = "" } = {}) {
  if (isGoodMorningAsk(text) && !isFullReportAsk(text) && !isQuickPulseAsk(text)) {
    return {
      handled: true,
      kind: "gm",
      reply: buildGoodMorningReply({ authorName }),
    };
  }
  if (isFullReportAsk(text)) {
    return {
      handled: true,
      kind: "full_report",
      reply: buildFullRankedReportReply(),
    };
  }
  if (isQuickPulseAsk(text)) {
    return {
      handled: true,
      kind: "quick_pulse",
      reply: buildQuickPulseReply(),
    };
  }
  return null;
}
