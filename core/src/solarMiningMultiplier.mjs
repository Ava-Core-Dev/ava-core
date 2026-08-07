/**
 * Solar bank SOC → Gold (G) mining multiplier during online hours.
 * Locked: multiplier = 1 + (batteryPercent / 100), clamp 0–100, max 3 decimals.
 * Aggregate bank % (on-circuit average) — three 100% packs still max 2×.
 * Host / device off (asleep, power-down, EcoFlow device offline) → **1.0× normal**.
 */

/**
 * @param {number|null|undefined} batteryPercent
 * @param {boolean} online
 */
export function computeSolarMiningMultiplier(batteryPercent, online) {
  if (!online || batteryPercent == null || !Number.isFinite(Number(batteryPercent))) {
    return 1;
  }
  const pct = Math.min(100, Math.max(0, Number(batteryPercent)));
  return Math.round((1 + pct / 100) * 1000) / 1000;
}

/**
 * From Ava /api/solar live block — same online rules as API.
 * Offline / stale / no bank / host device off → 1.0× (normal Gold).
 * @param {{ batteryPct?: number|null, ecoOffline?: boolean, ecoStale?: boolean, hostOnline?: boolean, anyDisconnected?: boolean }} live
 */
export function miningMultiplierFromLive(live = {}) {
  const battery =
    live?.batteryPct != null && Number.isFinite(Number(live.batteryPct))
      ? Number(live.batteryPct)
      : null;
  const hostOnline = live?.hostOnline !== false;
  const online = Boolean(
    hostOnline &&
      battery != null &&
      !live?.ecoOffline &&
      !live?.ecoStale &&
      !live?.anyDisconnected,
  );
  return {
    battery_percent: battery,
    multiplier: computeSolarMiningMultiplier(battery, online),
    online,
    host_online: hostOnline,
    source: "ecoflow.bankSoc",
  };
}
