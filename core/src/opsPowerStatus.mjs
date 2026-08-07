/**
 * Ops power-status asks — voting shares + EcoFlow/solar (+ morning averages).
 * When Cursor is online, Discord may answer these from live Root Server packs
 * (bypasses dream-only + cloud-dark silence). Not a plugin dig / jar ship.
 */
import {
  refreshEcoFlow,
  gatherEcoBrief,
  loadEcoSnapshot,
  moodFromPower,
  summarizeMorningSolar,
  ECO_NICKNAMES,
  snDisplayLabel,
} from "./ecoflow.mjs";
import { gatherSolarBrief, loadSolarProfile } from "./solarProfile.mjs";
import { gatherGovernanceBrief, getCouncil, listOpenPolls } from "./governanceClient.mjs";

const NICK_BY_SN = {
  R331ZAB5SG6S2858: "Delta 2",
  R331ZAB5SG755642: "Delta 2-B",
  R621ZA16XH6K1155: "River 2 Pro",
};

function wantsMorningSolarAvg(question = "") {
  const q = String(question || "").toLowerCase();
  return (
    (/\b(average|avg|mean)\b/.test(q) &&
      /\b(solar|intake|charge|watts?)\b/.test(q)) ||
    /\b(solar\s+intake|morning\s+solar|solar\s+(this\s+)?morning)\b/.test(q)
  );
}

/**
 * True for live power / voting-share status asks (not solar-circus digs).
 */
export function isOpsPowerStatusAsk(question = "") {
  const q = String(question || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!q) return false;
  if (wantsMorningSolarAvg(q)) return true;
  if (
    /\b(power\s+status|battery|soc|ecoflow|solar)\b/.test(q) &&
    /\b(vot(?:e|ing)|percent|share|council|prop[-\s]?\d+)\b/.test(q)
  ) {
    return true;
  }
  if (
    /\b(ecoflow|solar\s*(?:status|bank|array|panels?)|battery\s*(?:pct|percent|bank|status)|power\s+status|host\s+power)\b/.test(
      q,
    )
  ) {
    return true;
  }
  if (
    /\b(voting\s+(?:power|shares?|percentages?)|council\s+shares?|vote\s+shares?)\b/.test(q)
  ) {
    return true;
  }
  if (
    /\b(cucumbers|shackas|delta\s*2|river\s*2)\b/.test(q) &&
    /\b(soc|battery|solar|watts?|charge|status|power)\b/.test(q)
  ) {
    return true;
  }
  return false;
}

function snLabel(sn, snap) {
  return snDisplayLabel(sn, snap) || NICK_BY_SN[sn] || String(sn || "").slice(-6);
}

function fmtW(n) {
  if (n == null || Number.isNaN(Number(n))) return "?";
  return `${Math.round(Number(n))}W`;
}

function fmtHst(ms) {
  if (ms == null) return "?";
  const d = new Date(Number(ms) - 10 * 3600_000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} HST`;
}

function formatMorningSolarBlock(morning) {
  if (!morning?.siteMinutes) {
    return [
      "**Morning solar**",
      "• No minute buckets in the morning window yet - can't invent an average.",
    ];
  }
  const spanMin =
    morning.sampleStart != null && morning.sampleEnd != null
      ? Math.max(
          1,
          Math.round((morning.sampleEnd - morning.sampleStart) / 60000),
        )
      : morning.siteMinutes;
  const lines = [
    "**Morning solar** - sampled window (not inventing dawn)",
    `• Window: **${fmtHst(morning.sampleStart)}-${fmtHst(morning.sampleEnd)}** (~${spanMin}m · ${morning.siteMinutes} site-minutes)`,
  ];
  if (morning.note && morning.note !== "ok") {
    lines.push(`• Note: ${morning.note}`);
  }
  if (morning.siteAvgW != null) {
    lines.push(
      `• **Site solar avg:** **~${Math.round(morning.siteAvgW)} W**` +
        (morning.siteMaxW != null
          ? ` (max ~${Math.round(morning.siteMaxW)} W)`
          : ""),
    );
  }
  for (const [sn, v] of Object.entries(morning.perSn || {})) {
    if (v?.avgW == null) continue;
    lines.push(
      `• ${snLabel(sn)}: **~${Math.round(v.avgW)} W** avg` +
        (v.minW != null && v.maxW != null
          ? ` (${Math.round(v.minW)}-${Math.round(v.maxW)})`
          : ""),
    );
  }
  return lines;
}

/**
 * Live reply from EcoFlow refresh + governance API. Numbers only from packs.
 */
export async function buildOpsPowerStatusReply({
  authorId = "",
  question = "",
} = {}) {
  let snap = null;
  try {
    snap = await refreshEcoFlow();
  } catch {
    snap = loadEcoSnapshot();
  }
  if (!snap) snap = loadEcoSnapshot();

  const morningOnly = wantsMorningSolarAvg(question);
  const morning = summarizeMorningSolar({ tzOffsetHours: -10 });

  if (morningOnly) {
    const liveSolar = Object.values(snap?.perSn || {}).reduce((sum, v) => {
      return sum + (v?.ok && v.solarW != null ? Number(v.solarW) || 0 : 0);
    }, 0);
    const lines = [
      ...formatMorningSolarBlock(morning),
      liveSolar > 0 ? `• Live right now: ~${Math.round(liveSolar)} W solar in` : null,
      "",
      "Cloudy / rainy mornings = thin sip, not a full-sun blast. Digs stay normal unless SOC gets scary.",
      "",
      "— Ava",
    ].filter((x) => x != null);
    return lines.join("\n");
  }

  const [gov, council, polls] = await Promise.all([
    gatherGovernanceBrief({ discordUserId: authorId || undefined }).catch(() => ({
      brief: "",
    })),
    getCouncil().catch(() => null),
    listOpenPolls().catch(() => null),
  ]);
  const solar = loadSolarProfile();
  const panels = solar?.panels?.count ?? 10;
  const circuits = solar?.panels?.circuits ?? 2;
  const batteries = solar?.batteries?.count ?? 3;

  const lines = ["**Power status** - live just now", ""];

  const councilRows = Array.isArray(council?.council) ? council.council : [];
  if (councilRows.length) {
    lines.push(
      `**Council voting shares** (eligible ${council.eligible_count ?? councilRows.length})`,
    );
    for (const c of councilRows.slice(0, 8)) {
      const name = c.minecraft_username || "?";
      const share =
        c.share_percent != null ? Number(c.share_percent).toFixed(2) : "?";
      const you =
        authorId &&
        gov?.power?.ok &&
        String(gov.power.minecraft_username || "").toLowerCase() ===
          String(name).toLowerCase()
          ? " (you)"
          : name === "Ava Ivy"
            ? " (Alex->Ava seat)"
            : "";
      lines.push(`• ${name} - **${share}%**${you}`);
    }
    lines.push("");
  } else if (gov?.brief) {
    lines.push(gov.brief.split("\n").slice(0, 8).join("\n"), "");
  }

  const open = Array.isArray(polls?.polls) ? polls.polls : [];
  if (open.length) {
    for (const p of open.slice(0, 4)) {
      lines.push(
        `Open **${p.id}** (${String(p.title || "").slice(0, 48)}): weighted **for ${p.weighted_for_pct ?? "?"}%** / against ${p.weighted_against_pct ?? "?"}%`,
      );
    }
    lines.push("");
  }

  const mood = moodFromPower(snap);
  const bank =
    snap?.batteryPct != null ? `**${snap.batteryPct}%** overall - ${mood}` : "unknown";
  lines.push("**EcoFlow / solar**");
  lines.push(`• Bank mood: ${bank}`);

  const per = snap?.perSn || {};
  let solarTotal = 0;
  for (const [sn, v] of Object.entries(per)) {
    if (!v?.ok) {
      lines.push(`• ${snLabel(sn, snap)}: FAIL ${v?.message || "?"}`);
      continue;
    }
    if (v.solarW != null) solarTotal += Number(v.solarW) || 0;
    const bits = [
      v.soc != null ? `SOC **${v.soc}%**` : null,
      v.inW != null ? `in ${fmtW(v.inW)}` : null,
      v.outW != null ? `out ${fmtW(v.outW)}` : null,
      v.solarW != null ? `solar ${fmtW(v.solarW)}` : null,
    ].filter(Boolean);
    lines.push(`• **${snLabel(sn, snap)}**: ${bits.join(" - ") || "ok"}`);
  }
  if (!Object.keys(per).length) {
    lines.push("• EcoFlow snapshot empty - keys/sns may still be wiring up");
  }

  lines.push(
    `• Host array: **${panels} panels / ${circuits} circuits / ${batteries} batteries**` +
      (solarTotal > 0 ? ` - ~${Math.round(solarTotal)}W solar in right now` : ""),
  );

  if (per.R621ZA16XH6K1155?.ok) {
    lines.push(
      "• River 2 Pro online-flag can lie - SOC/watts above are from quota (trust those)",
    );
  }

  if (morning?.siteAvgW != null) {
    lines.push("");
    lines.push(...formatMorningSolarBlock(morning));
  }

  lines.push("", "— Ava");
  return lines.join("\n");
}

/** Packs for Cursor/dream when not using the deterministic formatter. */
export function gatherOpsPowerPacks() {
  const eco = gatherEcoBrief();
  const solar = gatherSolarBrief();
  const morning = summarizeMorningSolar({ tzOffsetHours: -10 });
  const morningBrief =
    morning.siteAvgW != null
      ? `### Morning solar (HST buckets)\nsiteAvg≈${Math.round(morning.siteAvgW)}W · minutes=${morning.siteMinutes} · ${morning.note} · ${fmtHst(morning.sampleStart)}-${fmtHst(morning.sampleEnd)}`
      : "";
  return [eco.brief, solar.brief, morningBrief].filter(Boolean).join("\n\n");
}
