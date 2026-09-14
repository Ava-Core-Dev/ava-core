/** Shared UTC-offset timezone catalog (Discord roles + Root-Activity + /time page). */

export type TimezoneDef = {
  key: string;
  label: string;
  offsetMinutes: number;
  roleName: string;
};

export const TIMEZONE_DEFS: TimezoneDef[] = [
  { key: "utc_minus_12", label: "UTC-12 (AoE)", offsetMinutes: -12 * 60, roleName: "TZ UTC-12 AoE" },
  { key: "utc_minus_11", label: "UTC-11 (NUT/SST)", offsetMinutes: -11 * 60, roleName: "TZ UTC-11 NUT/SST" },
  { key: "utc_minus_10", label: "UTC-10 (HST)", offsetMinutes: -10 * 60, roleName: "TZ UTC-10 HST" },
  { key: "utc_minus_9", label: "UTC-09 (AKST)", offsetMinutes: -9 * 60, roleName: "TZ UTC-09 AKST" },
  { key: "utc_minus_8", label: "UTC-08 (PST)", offsetMinutes: -8 * 60, roleName: "TZ UTC-08 PST" },
  { key: "utc_minus_7", label: "UTC-07 (MST)", offsetMinutes: -7 * 60, roleName: "TZ UTC-07 MST" },
  { key: "utc_minus_6", label: "UTC-06 (CST)", offsetMinutes: -6 * 60, roleName: "TZ UTC-06 CST" },
  { key: "utc_minus_5", label: "UTC-05 (EST)", offsetMinutes: -5 * 60, roleName: "TZ UTC-05 EST" },
  { key: "utc_minus_4", label: "UTC-04 (AST)", offsetMinutes: -4 * 60, roleName: "TZ UTC-04 AST" },
  { key: "utc_minus_3", label: "UTC-03 (BRT)", offsetMinutes: -3 * 60, roleName: "TZ UTC-03 BRT" },
  { key: "utc_minus_2", label: "UTC-02 (GST)", offsetMinutes: -2 * 60, roleName: "TZ UTC-02 GST" },
  { key: "utc_minus_1", label: "UTC-01 (AZOT)", offsetMinutes: -1 * 60, roleName: "TZ UTC-01 AZOT" },
  { key: "utc_plus_0", label: "UTC+00 (GMT/UTC)", offsetMinutes: 0, roleName: "TZ UTC+00 GMT/UTC" },
  { key: "utc_plus_1", label: "UTC+01 (CET)", offsetMinutes: 60, roleName: "TZ UTC+01 CET" },
  { key: "utc_plus_2", label: "UTC+02 (EET)", offsetMinutes: 2 * 60, roleName: "TZ UTC+02 EET" },
  { key: "utc_plus_3", label: "UTC+03 (MSK/AST)", offsetMinutes: 3 * 60, roleName: "TZ UTC+03 MSK/AST" },
  { key: "utc_plus_4", label: "UTC+04 (GST)", offsetMinutes: 4 * 60, roleName: "TZ UTC+04 GST" },
  { key: "utc_plus_5", label: "UTC+05 (PKT)", offsetMinutes: 5 * 60, roleName: "TZ UTC+05 PKT" },
  { key: "utc_plus_6", label: "UTC+06 (BST)", offsetMinutes: 6 * 60, roleName: "TZ UTC+06 BST" },
  { key: "utc_plus_7", label: "UTC+07 (ICT)", offsetMinutes: 7 * 60, roleName: "TZ UTC+07 ICT" },
  { key: "utc_plus_8", label: "UTC+08 (CST/SGT)", offsetMinutes: 8 * 60, roleName: "TZ UTC+08 CST/SGT" },
  { key: "utc_plus_9", label: "UTC+09 (JST/KST)", offsetMinutes: 9 * 60, roleName: "TZ UTC+09 JST/KST" },
  { key: "utc_plus_10", label: "UTC+10 (AEST)", offsetMinutes: 10 * 60, roleName: "TZ UTC+10 AEST" },
  { key: "utc_plus_11", label: "UTC+11 (AEDT/SBT)", offsetMinutes: 11 * 60, roleName: "TZ UTC+11 AEDT/SBT" },
  { key: "utc_plus_12", label: "UTC+12 (NZST/FJT)", offsetMinutes: 12 * 60, roleName: "TZ UTC+12 NZST/FJT" },
  { key: "utc_plus_13", label: "UTC+13 (NZDT)", offsetMinutes: 13 * 60, roleName: "TZ UTC+13 NZDT" },
  { key: "utc_plus_14", label: "UTC+14 (LINT)", offsetMinutes: 14 * 60, roleName: "TZ UTC+14 LINT" },
];

export const HST_TIMEZONE_KEY = "utc_minus_10";
export const HST_OFFSET_MINUTES = -10 * 60;
export const PEAK_HOUR_COUNT = 3;

export function emptyHourBuckets(): number[] {
  return Array.from({ length: 24 }, () => 0);
}

export function shiftBucketsToOffset(
  zoneLocalBuckets: number[],
  zoneOffsetMinutes: number,
  viewerOffsetMinutes: number,
): number[] {
  const out = emptyHourBuckets();
  if (!zoneLocalBuckets || zoneLocalBuckets.length !== 24) return out;
  const shiftHours = Math.floor((viewerOffsetMinutes - zoneOffsetMinutes) / 60);
  for (let h = 0; h < 24; h++) {
    const viewerHour = ((h + shiftHours) % 24 + 24) % 24;
    out[viewerHour] = Math.min(Number.MAX_SAFE_INTEGER, out[viewerHour] + (zoneLocalBuckets[h] || 0));
  }
  return out;
}

function hourLabel(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h === 0) return "12 AM";
  if (h < 12) return `${h} AM`;
  if (h === 12) return "12 PM";
  return `${h - 12} PM`;
}

/** Top local hours by play seconds (same shape as Root-Activity PeakHoursFormatter). */
export function rankPeakHours(buckets: number[], peakHourCount = PEAK_HOUR_COUNT): number[] {
  if (!buckets || buckets.length !== 24) return [];
  let max = 0;
  for (const v of buckets) max = Math.max(max, v || 0);
  if (max <= 0) return [];

  const ranked = Array.from({ length: 24 }, (_, h) => h).sort((a, b) => {
    const d = (buckets[b] || 0) - (buckets[a] || 0);
    return d !== 0 ? d : a - b;
  });

  const picks: number[] = [];
  for (const h of ranked) {
    if ((buckets[h] || 0) <= 0) continue;
    picks.push(h);
    if (picks.length >= Math.max(1, peakHourCount)) break;
  }
  return picks.sort((a, b) => a - b);
}

export function formatPeakHours(buckets: number[], peakHourCount = PEAK_HOUR_COUNT): string {
  const picks = rankPeakHours(buckets, peakHourCount);
  if (!picks.length) return "";

  const parts: string[] = [];
  let i = 0;
  while (i < picks.length) {
    const start = picks[i];
    let end = start;
    while (i + 1 < picks.length && picks[i + 1] === end + 1) {
      i++;
      end = picks[i];
    }
    parts.push(start === end ? hourLabel(start) : `${hourLabel(start)} - ${hourLabel(end)}`);
    i++;
  }
  return parts.join(", ");
}

/** Sum of play-seconds in the top peak-hour set (for “how busy is this band?”). */
export function peakBandPlaySeconds(buckets: number[], peakHourCount = PEAK_HOUR_COUNT): number {
  const picks = rankPeakHours(buckets, peakHourCount);
  let sum = 0;
  for (const h of picks) sum += Math.max(0, buckets[h] || 0);
  return sum;
}

/** Wall-clock hour 0–23 in an IANA zone (falls back to host local). */
export function hourInTimeZone(at: Date, timeZone?: string): number {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        hourCycle: "h23",
      }).formatToParts(at);
      const raw = parts.find((p) => p.type === "hour")?.value;
      const h = Number(raw);
      if (Number.isFinite(h)) return ((h % 24) + 24) % 24;
    } catch {
      /* fall through */
    }
  }
  return at.getHours();
}

/**
 * Longest contiguous low-activity stretch (circular day).
 * Quiet = at or below the ~25th percentile of hourly play seconds.
 * @returns { startHour, lengthHours } or null if no data
 */
export function maintenanceQuietStretch(buckets: number[]): { startHour: number; lengthHours: number } | null {
  if (!buckets || buckets.length !== 24) return null;
  const vals = buckets.map((v) => Math.max(0, Number(v) || 0));
  const total = vals.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;

  const sorted = [...vals].sort((a, b) => a - b);
  const threshold = sorted[5] ?? 0;
  const quiet = vals.map((v) => v <= threshold);

  const doubled = quiet.concat(quiet);
  let bestLen = 0;
  let bestStart = 0;
  let i = 0;
  while (i < 48) {
    if (!doubled[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < 48 && doubled[j] && j - i < 24) j++;
    const len = j - i;
    if (len > bestLen) {
      bestLen = len;
      bestStart = i % 24;
    }
    i = j;
  }
  if (bestLen <= 0) return null;
  return { startHour: bestStart, lengthHours: bestLen };
}

export function isHourInMaintenanceWindow(buckets: number[], hour: number): boolean {
  const stretch = maintenanceQuietStretch(buckets);
  if (!stretch) return false;
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  for (let i = 0; i < stretch.lengthHours; i++) {
    if ((stretch.startHour + i) % 24 === h) return true;
  }
  return false;
}

/**
 * Longest contiguous low-activity stretch in the visitor's clock (circular day).
 * Quiet = at or below the ~25th percentile of hourly play seconds.
 */
export function formatMaintenanceWindow(buckets: number[]): string {
  const stretch = maintenanceQuietStretch(buckets);
  if (!stretch) return "";
  const endHour = (stretch.startHour + stretch.lengthHours - 1) % 24;
  if (stretch.lengthHours === 1) return hourLabel(stretch.startHour);
  return `${hourLabel(stretch.startHour)} - ${hourLabel(endHour)}`;
}

export function timezoneByKey(key: string): TimezoneDef | undefined {
  return TIMEZONE_DEFS.find((t) => t.key === key);
}

export function nearestTimezoneByOffsetMinutes(offsetMinutes: number): TimezoneDef {
  let best = TIMEZONE_DEFS[12]; // UTC+0 fallback
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const def of TIMEZONE_DEFS) {
    const diff = Math.abs(def.offsetMinutes - offsetMinutes);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = def;
    }
  }
  return best;
}

/** Browser/IANA offset: minutes east of UTC (JS getTimezoneOffset is inverted). */
export function offsetMinutesFromDate(at = new Date(), timeZone?: string): number {
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName: "shortOffset",
      }).formatToParts(at);
      const raw = parts.find((p) => p.type === "timeZoneName")?.value || "";
      // GMT-10 / GMT+5:30 / UTC
      const m = raw.match(/([+-])(\d{1,2})(?::(\d{2}))?/);
      if (m) {
        const sign = m[1] === "-" ? -1 : 1;
        const hours = Number(m[2]) || 0;
        const mins = Number(m[3]) || 0;
        return sign * (hours * 60 + mins);
      }
      if (/^(GMT|UTC)$/i.test(raw.trim())) return 0;
    } catch {
      /* fall through */
    }
  }
  return -at.getTimezoneOffset();
}
