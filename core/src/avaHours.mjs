/**
 * Typical Ava "open" window from host-metrics + sleep policy.
 * Home TZ is HST; clients convert to local.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths } from "./store.mjs";
import { isAsleep, loadSleepState, nextWakeAt10amHst } from "./sleepMode.mjs";
import { loadEcoSnapshot } from "./ecoflow.mjs";
import { loadHostSnapshot } from "./hostMetrics.mjs";

const HOME_TZ = "Pacific/Honolulu";
const POLICY_WAKE_HOUR = 10; // ~10:00 HST auto-wake

function minutesLogPath() {
  return path.join(storePaths().dir, "host-metrics", "minutes.jsonl");
}

function hourHistogramHst(maxLines = 20000) {
  const file = minutesLogPath();
  const counts = Array.from({ length: 24 }, () => 0);
  let samples = 0;
  let first = null;
  let last = null;
  if (!fs.existsSync(file)) {
    return { counts, samples, first, last, days: 0 };
  }
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  const slice = lines.slice(-maxLines);
  const daySet = new Set();
  for (const line of slice) {
    try {
      const row = JSON.parse(line);
      const ts = Date.parse(row.minute_ts);
      if (!Number.isFinite(ts)) continue;
      const hst = new Date(ts - 10 * 3600_000);
      const hour = hst.getUTCHours();
      counts[hour] += 1;
      samples += 1;
      if (first == null || ts < first) first = ts;
      if (last == null || ts > last) last = ts;
      daySet.add(
        `${hst.getUTCFullYear()}-${String(hst.getUTCMonth() + 1).padStart(2, "0")}-${String(hst.getUTCDate()).padStart(2, "0")}`,
      );
    } catch {
      /* skip */
    }
  }
  return { counts, samples, first, last, days: daySet.size };
}

function bandFromCounts(counts) {
  const max = Math.max(...counts, 0);
  if (max <= 0) return { startHour: POLICY_WAKE_HOUR, endHour: 22, weak: true };
  const threshold = Math.max(1, Math.floor(max * 0.35));
  let start = counts.findIndex((c) => c >= threshold);
  let end = 23;
  for (let h = 23; h >= 0; h--) {
    if (counts[h] >= threshold) {
      end = h;
      break;
    }
  }
  if (start < 0) start = POLICY_WAKE_HOUR;
  // Prefer policy wake when observed starts earlier than sleep policy
  const openStart = Math.max(start, POLICY_WAKE_HOUR);
  return { startHour: openStart, endHour: Math.max(openStart, end), weak: false, threshold };
}

/** Draft Ava credit model — rails still off until AVA_USAGE_BILLING=1. */
export function avaCreditsPricingDraft() {
  return {
    decided: {
      model: "prepaid_usd_credits",
      sellMarkup: 2,
      sellMarkupNote: "Per LLM turn billed at ≥2× measured cost (host floor included).",
      hostFloorUsd: Number(process.env.AVA_LLM_HOST_FLOOR_USD || 0.0002) || 0.0002,
      usageBillingEnabled: String(process.env.AVA_USAGE_BILLING || "0") === "1",
      stripeCreditsEnabled: String(process.env.AVA_STRIPE_CREDITS_ENABLED || "0") === "1",
    },
    proposed: {
      packaging: {
        pro: {
          priceUsd: 5,
          note: "Pro stays basic membership / ad-free — no Ava usage allotment bundled by default.",
        },
        proPlusAva: {
          note: "Pro + Ava package — membership plus monthly Ava credits (candidate +$5 Ava / ~$10 total, TBD).",
          monthlyAvaCreditsUsd: 5,
        },
      },
      monthlyIncludedUsd: 5,
      monthlyIncludedNote:
        "Candidate: $5 Ava credits / month inside Pro+Ava (not inside bare Pro). Open window ~365 h/mo; Llama turns make $5 cover casual use. Not charged yet.",
      extraPacksUsd: [5, 10, 25],
      extraPacksNote: "Top-up packs when the monthly allotment runs out.",
      unit: "USD credits (1 credit = $1.00 prepaid balance)",
      hoursNote: "Calendar ~730 h/mo; Ava typically open ~12 h/day (~365 h/mo).",
    },
    status: "framework_ready_not_charging",
  };
}

export function buildAvaHoursPayload() {
  const hist = hourHistogramHst();
  const band = bandFromCounts(hist.counts);
  const sleep = loadSleepState();
  const asleep = isAsleep();
  const snap = loadEcoSnapshot();
  const host = loadHostSnapshot();
  const wakeAt = asleep
    ? Number(sleep?.wakeAt) || nextWakeAt10amHst().getTime()
    : null;

  const fmtHst = (h, m = 0) =>
    `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

  return {
    ok: true,
    service: "ava-ivy",
    solarPowered: true,
    solarNote: "Ava runs on the HI Pacific solar Root Server — bank + panels, not a cloud-only bot.",
    asleep,
    awake: !asleep,
    homeTz: HOME_TZ,
    homeTzLabel: "HST",
    policy: {
      wakeHour: POLICY_WAKE_HOUR,
      wakeLabel: "≈10:00 HST",
      note: "Sleep mode dreams until ~10:00 HST, then auto-wakes.",
    },
    typicalOpen: {
      startHour: band.startHour,
      endHour: band.endHour,
      startMinute: 0,
      endMinute: 0,
      hstLabel: `${fmtHst(band.startHour)}–${fmtHst(band.endHour)} HST`,
      method: "host-metrics histogram + 10:00 HST wake policy",
      sampleMinutes: hist.samples,
      sampleDays: hist.days,
      firstSample: hist.first ? new Date(hist.first).toISOString() : null,
      lastSample: hist.last ? new Date(hist.last).toISOString() : null,
      hourCounts: hist.counts,
    },
    nextWakeAt: wakeAt,
    nextWakeAtIso: wakeAt ? new Date(wakeAt).toISOString() : null,
    live: {
      bankPct: snap?.batteryPct ?? null,
      hostOnline: Boolean(host?.current || host?.status === "ok" || !asleep),
      mood: snap ? undefined : null,
    },
    credits: avaCreditsPricingDraft(),
    updatedAt: new Date().toISOString(),
  };
}
