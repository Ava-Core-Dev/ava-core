/**
 * RootMC day clock — mirrors plugin McDayClock (HST, 30 real minutes per MC day).
 * HH:00 = noon (6000), HH:15 = midnight (18000). Day rolls at :15 and :45.
 */

export const MC_TICKS_PER_DAY = 24_000;
export const MC_NOON_TICK = 6_000;
export const MC_MIDNIGHT_TICK = 18_000;
export const MC_DAY_LENGTH_MINUTES = 30;
export const MC_MIDDAY_MINUTE = 0;
export const MC_MIDNIGHT_MINUTE = 15;
export const MC_DAY_ZONE = "Pacific/Honolulu";

export type McDaySnapshot = {
  day_id: number;
  time_of_day_ticks: number;
  minutes_into_day: number;
  minutes_remaining: number;
  length_minutes: number;
  timezone: string;
  phase: string;
  phase_detail: string;
  next_midnight_label: string;
};

function partsInZone(at: Date, timeZone: string): { hour: number; minute: number; second: number; epochDay: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const bag: Record<string, string> = {};
  for (const p of dtf.formatToParts(at)) {
    if (p.type !== "literal") bag[p.type] = p.value;
  }
  const y = Number(bag.year) || at.getUTCFullYear();
  const m = Number(bag.month) || 1;
  const d = Number(bag.day) || 1;
  // Civil epoch-day via UTC noon (stable across DST).
  const epochDay = Math.floor(Date.UTC(y, m - 1, d, 12, 0, 0) / 86_400_000);
  return {
    hour: Number(bag.hour) || 0,
    minute: Number(bag.minute) || 0,
    second: Number(bag.second) || 0,
    epochDay,
  };
}

export function mcDayIdAt(at = new Date(), opts?: {
  timezone?: string;
  lengthMinutes?: number;
  midnightMinute?: number;
}): number {
  const zone = opts?.timezone || MC_DAY_ZONE;
  const lengthMinutes = Math.max(1, opts?.lengthMinutes ?? MC_DAY_LENGTH_MINUTES);
  const midnightMinute = Math.floor(((opts?.midnightMinute ?? MC_MIDNIGHT_MINUTE) % 60 + 60) % 60);
  const p = partsInZone(at, zone);
  const epochMinutes = p.epochDay * 1_440 + p.hour * 60 + p.minute;
  // Rollover when minute-of-day hits midnightMinute (:15 / :45 with defaults).
  return Math.floor((epochMinutes - midnightMinute) / lengthMinutes);
}

export function minutesIntoMcDay(at = new Date(), opts?: {
  timezone?: string;
  lengthMinutes?: number;
  midnightMinute?: number;
}): number {
  const zone = opts?.timezone || MC_DAY_ZONE;
  const lengthMinutes = Math.max(1, opts?.lengthMinutes ?? MC_DAY_LENGTH_MINUTES);
  const midnightMinute = Math.floor(((opts?.midnightMinute ?? MC_MIDNIGHT_MINUTE) % 60 + 60) % 60);
  const p = partsInZone(at, zone);
  const minuteOfDay = p.hour * 60 + p.minute;
  const offset = lengthMinutes - midnightMinute;
  return ((minuteOfDay + offset) % lengthMinutes) + p.second / 60;
}

export function timeOfDayTicks(at = new Date(), opts?: {
  timezone?: string;
  lengthMinutes?: number;
  midnightMinute?: number;
}): number {
  const lengthMinutes = Math.max(1, opts?.lengthMinutes ?? MC_DAY_LENGTH_MINUTES);
  const min = minutesIntoMcDay(at, opts);
  const half = lengthMinutes / 2;
  if (min < half) {
    return MC_MIDNIGHT_TICK + Math.round((MC_TICKS_PER_DAY / 2) * (min / half));
  }
  const ticks = MC_NOON_TICK + Math.round((MC_TICKS_PER_DAY / 2) * ((min - half) / half));
  return ((ticks % MC_TICKS_PER_DAY) + MC_TICKS_PER_DAY) % MC_TICKS_PER_DAY;
}

export function phaseFromTicks(ticks: number): { phase: string; detail: string } {
  const t = ((Math.floor(ticks) % MC_TICKS_PER_DAY) + MC_TICKS_PER_DAY) % MC_TICKS_PER_DAY;
  if (t >= 23_000 || t < 1_000) return { phase: "Sunrise", detail: "dawn" };
  if (t < 5_000) return { phase: "Morning", detail: "day" };
  if (t < 7_000) return { phase: "Noon", detail: "midday" };
  if (t < 11_000) return { phase: "Afternoon", detail: "day" };
  if (t < 13_000) return { phase: "Sunset", detail: "dusk" };
  if (t < 17_000) return { phase: "Evening", detail: "night" };
  if (t < 19_000) return { phase: "Midnight", detail: "midnight" };
  return { phase: "Night", detail: "night" };
}

export function snapshotMcDay(at = new Date()): McDaySnapshot {
  const lengthMinutes = MC_DAY_LENGTH_MINUTES;
  const into = minutesIntoMcDay(at);
  const ticks = timeOfDayTicks(at);
  const { phase, detail } = phaseFromTicks(ticks);
  const remaining = Math.max(0, lengthMinutes - into);
  const remMin = Math.floor(remaining);
  const remSec = Math.floor((remaining - remMin) * 60);
  const nextLabel =
    remMin > 0
      ? `${remMin}m ${String(remSec).padStart(2, "0")}s to midnight`
      : `${remSec}s to midnight`;
  return {
    day_id: mcDayIdAt(at),
    time_of_day_ticks: ticks,
    minutes_into_day: Math.round(into * 100) / 100,
    minutes_remaining: Math.round(remaining * 100) / 100,
    length_minutes: lengthMinutes,
    timezone: MC_DAY_ZONE,
    phase,
    phase_detail: detail,
    next_midnight_label: nextLabel,
  };
}
