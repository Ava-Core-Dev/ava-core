/**
 * Solar gold + skills bonus from Ava host feed.
 *
 * Disconnected → 1.00× gold/skills, +1% env tax.
 * Connected → 1 + 0.01 + 0.01 per 10% battery + 0.01 per 100 W.
 * Example: 50% bank + 500 W → 1.11× (11%) on gold and skills.
 * No CPU / underpowered solar tax.
 */
export const CONNECTED_BASE = 0.01;
export const PER_10_BATTERY = 0.01;
export const PER_100W = 0.01;
export const OFFLINE_ENV_TAX = 0.01;

function round3(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/** @deprecated CPU tax removed. Always 0. */
export function cpuTaxRate(_cpuPercent) {
  return 0;
}

export function solarXpMultiplier(solarW, batteryPercent, hostOnline) {
  return resolveGamingBonus(batteryPercent, hostOnline, { solarW }).xp_multiplier;
}

/**
 * @param {number|null|undefined} batteryPercent
 * @param {boolean} online host + live bank feed
 */
export function computeSolarMiningMultiplier(batteryPercent, online, extras = {}) {
  return resolveGamingBonus(batteryPercent, online, extras).multiplier;
}

/**
 * @param {number|null|undefined} batteryPercent
 * @param {boolean} hostOnline
 * @param {{ cpuPct?: number|null, solarW?: number|null }} [extras]
 */
export function resolveGamingBonus(batteryPercent, hostOnline, extras = {}) {
  const bank =
    batteryPercent != null && Number.isFinite(Number(batteryPercent))
      ? clamp(Number(batteryPercent), 0, 100)
      : null;
  const cpu =
    extras.cpuPct != null && Number.isFinite(Number(extras.cpuPct))
      ? clamp(Number(extras.cpuPct), 0, 100)
      : null;
  const solarW =
    extras.solarW != null && Number.isFinite(Number(extras.solarW))
      ? Math.max(0, Number(extras.solarW))
      : null;
  const connected = Boolean(hostOnline);
  const volcanoActive = extras.volcanoActive === true;

  if (!connected) {
    return {
      battery_percent: bank,
      track_percent: bank,
      multiplier: 1,
      tax_rate: OFFLINE_ENV_TAX,
      underpowered_tax_rate: OFFLINE_ENV_TAX,
      cpu_tax_rate: 0,
      cpu_percent: cpu,
      solar_w: solarW,
      xp_multiplier: 1,
      bonus: 0,
      online: false,
      host_online: false,
      underpowered: false,
      cpu_hot: false,
      mode: "tax",
      detail: "host_offline",
    };
  }

  const batterySteps = bank != null ? Math.floor(bank / 10) : 0;
  const wattSteps = solarW != null ? Math.floor(solarW / 100) : 0;
  const solar = round3(1 + CONNECTED_BASE + batterySteps * PER_10_BATTERY + wattSteps * PER_100W);
  const multiplier = volcanoActive ? round3(solar * 2) : solar;
  return {
    battery_percent: bank,
    track_percent: bank,
    multiplier,
    solar_multiplier: solar,
    volcano_active: volcanoActive,
    tax_rate: 0,
    underpowered_tax_rate: 0,
    cpu_tax_rate: 0,
    cpu_percent: cpu,
    solar_w: solarW,
    xp_multiplier: multiplier,
    bonus: round3(multiplier - 1),
    online: true,
    host_online: true,
    underpowered: false,
    cpu_hot: false,
    mode: volcanoActive ? "volcano" : "bonus",
    detail: volcanoActive ? "volcano_watch" : "live",
  };
}

/**
 * From Ava /api/solar live block.
 */
export function miningMultiplierFromLive(live = {}) {
  const battery =
    live?.batteryPct != null && Number.isFinite(Number(live.batteryPct))
      ? Number(live.batteryPct)
      : null;
  const hostOnline = live?.hostOnline !== false;
  const cpu =
    live?.cpuHour != null && Number.isFinite(Number(live.cpuHour))
      ? Number(live.cpuHour)
      : live?.cpu != null && Number.isFinite(Number(live.cpu))
        ? Number(live.cpu)
        : null;
  const solarW =
    live?.solarW != null && Number.isFinite(Number(live.solarW))
      ? Number(live.solarW)
      : null;
  const resolved = resolveGamingBonus(battery, hostOnline, {
    cpuPct: cpu,
    solarW,
    volcanoActive: live?.volcanoActive === true,
  });
  return {
    ...resolved,
    source: "ecoflow.bankSoc+host.solarW",
  };
}
