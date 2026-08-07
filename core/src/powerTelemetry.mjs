/**
 * Live solar / power / weather / CPU pack for Ava status + /solar dashboard.
 * Numbers only from EcoFlow buckets, host-site telemetry, host-metrics — never invent.
 */
import {
  loadEcoSnapshot,
  loadEcoMinuteSeries,
  summarizeMorningSolar,
  isEcoOffCircuit,
  isEcoRemoved,
  isEcoSampleLive,
  ECO_NICKNAMES,
  ECO_STALE_MS,
  moodFromPower,
  configuredSerials,
  hydrateEcoMinutesFromD1,
} from "./ecoflow.mjs";
import {
  loadHostSite,
  loadHostSiteTelemetry,
  fetchHostSiteWeather,
  fetchSunTimes,
} from "./hostSite.mjs";
import { loadSolarProfile } from "./solarProfile.mjs";
import {
  loadHostSnapshot,
  loadHostMetricsMinuteSeries,
  itemizeHostMetricsTimeframes,
} from "./hostMetrics.mjs";
import { loadHeartbeat } from "./store.mjs";
import { readLiveness } from "./liveness.mjs";
import { miningMultiplierFromLive } from "./solarMiningMultiplier.mjs";
import { publicSolarLinksPayload } from "./solarLinks.mjs";
import { isAsleep } from "./sleepMode.mjs";
import { buildPublicOpsPayload } from "./opsStatus.mjs";
import { isPoweredOff } from "./powerDown.mjs";

const NICK_BY_SN = {
  R331ZAB5SG6S2858: "Delta 2",
  R621ZA16XH6K1155: "River 2 Pro",
};

function snLabel(sn, snap) {
  if (NICK_BY_SN[sn]) return NICK_BY_SN[sn];
  const nicks = { ...ECO_NICKNAMES, ...(snap?.nicknames || {}) };
  for (const [nick, serial] of Object.entries(nicks)) {
    // Prefer product labels; skip kebab slugs + retired casual aliases.
    if (String(serial) !== String(sn)) continue;
    if (/^(delta-2-|river-2-|cucumbers?|shackas|shakas|shockas)$/i.test(nick)) continue;
    return nick;
  }
  return String(sn || "").slice(-6);
}

function publicSite(site) {
  return {
    id: site?.id || "host-site-primary-v1",
    label: site?.label || "HI Pacific Solar Root Server",
    locale: "HI Pacific",
    tz_offset_hours: site?.tz_offset_hours ?? -10,
  };
}

function avg(nums) {
  const vals = nums.filter((n) => n != null && Number.isFinite(Number(n))).map(Number);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** Watt-minutes → Wh (one sample per minute ≈ W * 1/60 h). */
function whFromMinuteWatts(wattSamples) {
  const vals = wattSamples.filter((n) => n != null && Number.isFinite(Number(n)));
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + Number(b), 0) / 60) * 10) / 10;
}

function localDayBounds(tzOffsetHours = -10) {
  const tz = Number(tzOffsetHours);
  const now = Date.now();
  const localNow = new Date(now + tz * 3600_000);
  const y = localNow.getUTCFullYear();
  const m = localNow.getUTCMonth();
  const d = localNow.getUTCDate();
  const dayStart = Date.UTC(y, m, d, 0, 0, 0) - tz * 3600_000;
  return { dayStart, dayEnd: now, now };
}

function deviceRows(snap, { ecoStale = false } = {}) {
  const per = snap?.perSn || {};
  const configured = configuredSerials();
  const seen = new Set(Object.keys(per).filter((sn) => !isEcoRemoved(sn)));
  const rows = Object.entries(per)
    .filter(([sn]) => !isEcoRemoved(sn))
    .map(([sn, v]) => {
    const offCircuit = Boolean(v?.offCircuit || isEcoOffCircuit(sn));
    const live = isEcoSampleLive(v);
    const ok = Boolean(v?.ok) && live;
    let status = "online";
    if (!v?.ok || v?.deviceOnline === false) status = "offline";
    else if (ecoStale || !live) status = "stale";
    else if (offCircuit) status = "off-circuit";
    return {
      sn,
      label: snLabel(sn, snap),
      ok,
      status,
      online: ok && !ecoStale,
      disconnected: !ok,
      stale: Boolean(v?.ok && (ecoStale || !live)),
      soc: ok ? v?.soc ?? null : null,
      solarW: ok ? v?.solarW ?? null : null,
      inW: ok ? v?.inW ?? null : null,
      outW: ok ? v?.outW ?? null : null,
      offCircuit,
      message: ok
        ? ecoStale
          ? "last sample stale"
          : offCircuit
            ? "off-circuit (not host load)"
            : null
        : v?.message || "disconnected / offline",
    };
  });
  for (const sn of configured) {
    if (seen.has(sn)) continue;
    rows.push({
      sn,
      label: snLabel(sn, snap),
      ok: false,
      status: "offline",
      online: false,
      disconnected: true,
      stale: false,
      soc: null,
      solarW: null,
      inW: null,
      outW: null,
      offCircuit: isEcoOffCircuit(sn),
      message: "no quota sample — disconnected / missing",
    });
  }
  return rows;
}

function siteSolarNow(snap) {
  let solar = 0;
  let out = 0;
  let inW = 0;
  let any = false;
  for (const [sn, v] of Object.entries(snap?.perSn || {})) {
    if (isEcoRemoved(sn)) continue;
    if (!isEcoSampleLive(v)) continue;
    if (v.offCircuit || isEcoOffCircuit(sn)) continue;
    any = true;
    if (v.solarW != null) solar += Number(v.solarW) || 0;
    if (v.outW != null) out += Number(v.outW) || 0;
    if (v.inW != null) inW += Number(v.inW) || 0;
  }
  return {
    solarW: any ? Math.round(solar) : null,
    outW: any ? Math.round(out) : null,
    inW: any ? Math.round(inW) : null,
  };
}

function mergeSeries(ecoSeries, cpuSeries) {
  const byT = new Map();
  for (const row of ecoSeries || []) {
    byT.set(row.t, {
      t: row.t,
      solarW: row.solarW,
      outW: row.outW,
      inW: row.inW,
      bankSoc: row.bankSoc,
      cpu: null,
      ram: null,
      disk: null,
      devices: row.devices || {},
    });
  }
  for (const row of cpuSeries || []) {
    const t = row.t;
    let hit = byT.get(t);
    if (!hit) {
      let best = null;
      let bestAbs = Infinity;
      for (const k of byT.keys()) {
        const d = Math.abs(k - t);
        if (d < bestAbs && d <= 90_000) {
          bestAbs = d;
          best = k;
        }
      }
      if (best != null) hit = byT.get(best);
    }
    if (hit) {
      hit.cpu = row.cpu;
      hit.ram = row.ram;
      hit.disk = row.disk;
    } else {
      byT.set(t, {
        t,
        solarW: null,
        outW: null,
        inW: null,
        bankSoc: null,
        cpu: row.cpu,
        ram: row.ram,
        disk: row.disk,
        devices: {},
      });
    }
  }
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

/**
 * Build a 1-minute grid so charts don't stretch sparse Eco points into triangles.
 * Daytime (HST ~06–20): linear-interp between known samples up to maxInterpMin,
 * then forward-carry up to maxCarryMin. Overnight: leave nulls (honest night gap).
 */
function densifyMinuteSeries(rows, opts = {}) {
  if (!rows?.length) return rows || [];
  const tz = Number(opts.tzOffsetHours ?? -10);
  const maxCarryMin = Math.max(1, Number(opts.maxCarryMin ?? 120));
  const maxInterpMin = Math.max(
    maxCarryMin,
    Number(opts.maxInterpMin ?? 180),
  );
  const dayStartH = Number(opts.dayStartHour ?? 6);
  const dayEndH = Number(opts.dayEndHour ?? 20);
  const sorted = [...rows].sort((a, b) => a.t - b.t);
  const t0 = Math.floor(Number(sorted[0].t) / 60000) * 60000;
  const t1 = Math.floor(Number(sorted[sorted.length - 1].t) / 60000) * 60000;
  if (!Number.isFinite(t0) || !Number.isFinite(t1) || t1 < t0) return sorted;

  const byT = new Map();
  for (const r of sorted) {
    const t = Math.floor(Number(r.t) / 60000) * 60000;
    byT.set(t, { ...r, t });
  }

  const ecoKeys = ["solarW", "outW", "inW", "bankSoc"];
  const hasEco = (row) =>
    row &&
    ecoKeys.some((k) => row[k] != null && Number.isFinite(Number(row[k])));

  // Real anchors only (not previously bridged)
  const anchors = [];
  for (let t = t0; t <= t1; t += 60000) {
    const hit = byT.get(t);
    if (hit && hasEco(hit) && !hit.bridged) anchors.push(hit);
  }

  const out = [];
  for (let t = t0; t <= t1; t += 60000) {
    const hit = byT.get(t) || {
      t,
      solarW: null,
      outW: null,
      inW: null,
      bankSoc: null,
      cpu: null,
      ram: null,
      disk: null,
      devices: {},
    };
    const localH = new Date(t + tz * 3600_000).getUTCHours();
    const isDay = localH >= dayStartH && localH < dayEndH;

    if (hasEco(hit) && !hit.bridged) {
      // Still fill short CPU holes on eco-anchor minutes
      const filled = { ...hit };
      if (filled.cpu == null || filled.ram == null) {
        let p = null;
        let n = null;
        for (let u = t - 60000; u >= t - 10 * 60000; u -= 60000) {
          const row = byT.get(u);
          if (row && (row.cpu != null || row.ram != null)) {
            p = row;
            break;
          }
        }
        for (let u = t + 60000; u <= t + 10 * 60000; u += 60000) {
          const row = byT.get(u);
          if (row && (row.cpu != null || row.ram != null)) {
            n = row;
            break;
          }
        }
        if (filled.cpu == null) filled.cpu = p?.cpu ?? n?.cpu ?? null;
        if (filled.ram == null) filled.ram = p?.ram ?? n?.ram ?? null;
      }
      out.push(filled);
      continue;
    }

    // CPU-only continuity (host sampler gaps) — short bridge any hour
    if (hit.cpu == null || hit.ram == null) {
      let p = null;
      for (let u = t - 60000; u >= t - 15 * 60000; u -= 60000) {
        const row = byT.get(u) || out.find((r) => r.t === u);
        if (row && row.cpu != null) {
          p = row;
          break;
        }
      }
      if (p) {
        hit.cpu = hit.cpu != null ? hit.cpu : p.cpu;
        hit.ram = hit.ram != null ? hit.ram : p.ram;
      }
    }

    // Keep overnight eco fields null; CPU may still be present.
    if (!isDay) {
      out.push(hit);
      continue;
    }

    // Find surrounding anchors
    let prev = null;
    let next = null;
    for (const a of anchors) {
      if (a.t < t) prev = a;
      else if (a.t > t) {
        next = a;
        break;
      }
    }

    const blend = (key) => {
      const a = prev?.[key];
      const b = next?.[key];
      if (a != null && b != null && next.t !== prev.t) {
        const span = next.t - prev.t;
        if (span / 60000 > maxInterpMin) return null;
        const w = (t - prev.t) / span;
        return Math.round(Number(a) + (Number(b) - Number(a)) * w);
      }
      if (a != null && (t - prev.t) / 60000 <= maxCarryMin) return Number(a);
      if (b != null && (next.t - t) / 60000 <= maxCarryMin) return Number(b);
      return null;
    };

    const solarW = hit.solarW != null ? hit.solarW : blend("solarW");
    const outW = hit.outW != null ? hit.outW : blend("outW");
    const inW = hit.inW != null ? hit.inW : blend("inW");
    const bankSoc = hit.bankSoc != null ? hit.bankSoc : blend("bankSoc");

    if (solarW != null || outW != null || inW != null || bankSoc != null) {
      out.push({
        ...hit,
        solarW,
        outW,
        inW,
        bankSoc,
        bridged: true,
        bridgeKind:
          prev && next && next.t - prev.t <= maxInterpMin * 60000
            ? "interp"
            : "carry",
      });
    } else {
      out.push(hit);
    }
  }
  return out;
}

function buildStats({ minutes, morning, live, hostFrames, dayStart }) {
  const dayRows = minutes.filter((m) => m.t >= dayStart);
  const rollSolar = avg(minutes.map((m) => m.solarW));
  const daySolar = avg(dayRows.map((m) => m.solarW));
  const rollOut = avg(minutes.map((m) => m.outW));
  const dayOut = avg(dayRows.map((m) => m.outW));
  const rollBank = avg(minutes.map((m) => m.bankSoc));
  const dayBank = avg(dayRows.map((m) => m.bankSoc));
  const rollCpu = avg(minutes.map((m) => m.cpu));
  const dayCpu = avg(dayRows.map((m) => m.cpu));

  return {
    solar: {
      currentW: live.solarW,
      morningAvgW:
        morning?.siteAvgW != null ? Math.round(morning.siteAvgW) : null,
      morningMaxW:
        morning?.siteMaxW != null ? Math.round(morning.siteMaxW) : null,
      morningMinutes: morning?.siteMinutes ?? 0,
      morningNote: morning?.note || null,
      dayAvgW: daySolar != null ? Math.round(daySolar) : null,
      rollingAvgW: rollSolar != null ? Math.round(rollSolar) : null,
      dayWh: whFromMinuteWatts(dayRows.map((m) => m.solarW)),
      rollingWh: whFromMinuteWatts(minutes.map((m) => m.solarW)),
      dayMinutes: dayRows.filter((m) => m.solarW != null).length,
      rollingMinutes: minutes.filter((m) => m.solarW != null).length,
    },
    load: {
      currentOutW: live.outW,
      currentInW: live.inW,
      dayAvgOutW: dayOut != null ? Math.round(dayOut) : null,
      rollingAvgOutW: rollOut != null ? Math.round(rollOut) : null,
      dayOutWh: whFromMinuteWatts(dayRows.map((m) => m.outW)),
      rollingOutWh: whFromMinuteWatts(minutes.map((m) => m.outW)),
    },
    bank: {
      currentPct: live.batteryPct,
      dayAvgPct: dayBank != null ? Math.round(dayBank) : null,
      rollingAvgPct: rollBank != null ? Math.round(rollBank) : null,
      mood: live.mood,
    },
    cpu: {
      currentPct: live.cpu,
      currentRamPct: live.ram,
      hourAvgPct: hostFrames?.last_hour?.cpu_avg_pct ?? null,
      dayAvgPct:
        dayCpu != null
          ? Math.round(dayCpu * 10) / 10
          : hostFrames?.today?.cpu_avg_pct ?? null,
      rollingAvgPct: rollCpu != null ? Math.round(rollCpu * 10) / 10 : null,
      allTimeAvgPct: hostFrames?.all_time?.cpu_avg_pct ?? null,
    },
  };
}

function resolveOnline(statusHttpUptimeMs) {
  const liv = readLiveness();
  const hb = loadHeartbeat();
  let onlineSinceMs = null;
  let source = null;
  if (liv?.parentStartedAt) {
    onlineSinceMs = Number(liv.parentStartedAt);
    source = "liveness.parentStartedAt";
  } else if (liv?.updatedAt != null && liv?.parentUptimeMs != null) {
    onlineSinceMs = Number(liv.updatedAt) - Number(liv.parentUptimeMs);
    source = "liveness.uptime";
  } else if (hb?.bootAt) {
    onlineSinceMs = Number(hb.bootAt);
    source = "heartbeat.bootAt";
  }
  const uptimeMs =
    onlineSinceMs != null
      ? Math.max(0, Date.now() - onlineSinceMs)
      : statusHttpUptimeMs ?? null;
  return {
    onlineSinceMs,
    onlineSinceIso: onlineSinceMs != null ? new Date(onlineSinceMs).toISOString() : null,
    uptimeMs,
    uptimeHuman: formatUptime(uptimeMs),
    statusHttpUptimeMs: statusHttpUptimeMs ?? null,
    heartbeatAgeMs:
      hb?.updatedAt != null ? Date.now() - Number(hb.updatedAt) : null,
    pollerLive: Boolean(hb?.live),
    source,
  };
}

function formatUptime(ms) {
  if (ms == null || !Number.isFinite(ms)) return null;
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}


function roundN(n, d = 1) {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const f = 10 ** d;
  return Math.round(Number(n) * f) / f;
}

function hstDayKey(ms) {
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "Pacific/Honolulu" });
}

/** Aggregate live minute samples for one lookback window — never invent watts. */
function aggregateWindow(rows, cpuRows, { key, label, windowMs, now }) {
  const tsAll = [...rows, ...cpuRows]
    .map((r) => Number(r.t))
    .filter((n) => Number.isFinite(n));
  const since =
    windowMs == null
      ? (tsAll.length ? Math.min(...tsAll) : now)
      : now - windowMs;
  const slice = rows.filter((r) => Number.isFinite(Number(r.t)) && r.t >= since);
  const cpuSlice = cpuRows.filter(
    (r) => Number.isFinite(Number(r.t)) && r.t >= since,
  );
  const solarVals = slice
    .map((r) => r.solarW)
    .filter((n) => n != null && Number.isFinite(Number(n)))
    .map(Number);
  const outVals = slice
    .map((r) => r.outW)
    .filter((n) => n != null && Number.isFinite(Number(n)))
    .map(Number);
  const inVals = slice
    .map((r) => r.inW)
    .filter((n) => n != null && Number.isFinite(Number(n)))
    .map(Number);
  const bankVals = slice
    .map((r) => r.bankSoc)
    .filter((n) => n != null && Number.isFinite(Number(n)))
    .map(Number);
  const cpuVals = cpuSlice
    .map((r) => r.cpu)
    .filter((n) => n != null && Number.isFinite(Number(n)))
    .map(Number);
  const ramVals = cpuSlice
    .map((r) => r.ram)
    .filter((n) => n != null && Number.isFinite(Number(n)))
    .map(Number);
  const producing = solarVals.filter((w) => w > 0);
  const solarWh = whFromMinuteWatts(solarVals);
  const outWh = whFromMinuteWatts(outVals);
  const inWh = whFromMinuteWatts(inVals);
  const ts = slice.map((r) => r.t).filter((n) => Number.isFinite(n));
  const cpuTs = cpuSlice.map((r) => r.t).filter((n) => Number.isFinite(n));
  const allTs = [...ts, ...cpuTs];
  const fromMs = allTs.length ? Math.min(...allTs) : null;
  const toMs = allTs.length ? Math.max(...allTs) : null;
  const spanMs =
    fromMs != null && toMs != null ? Math.max(0, toMs - fromMs) : 0;
  const daysSpanned = spanMs > 0 ? spanMs / 86400_000 : null;
  const solarDays = new Set(
    slice
      .filter((r) => r.solarW != null && Number.isFinite(Number(r.solarW)))
      .map((r) => hstDayKey(r.t)),
  );
  const outDays = new Set(
    slice
      .filter((r) => r.outW != null && Number.isFinite(Number(r.outW)))
      .map((r) => hstDayKey(r.t)),
  );
  const daysWithSolar = solarDays.size;
  const daysWithOut = outDays.size;
  const requestedMs = windowMs;
  const partial =
    requestedMs != null && spanMs > 0 ? spanMs < requestedMs * 0.9 : false;
  const mineVals = bankVals.map((soc) => 1 + soc / 100);
  return {
    key,
    label,
    windowMs: requestedMs,
    from: fromMs != null ? new Date(fromMs).toISOString() : null,
    to: toMs != null ? new Date(toMs).toISOString() : null,
    partial,
    availableHours: spanMs > 0 ? roundN(spanMs / 3600_000, 2) : null,
    samples: {
      solar: solarVals.length,
      out: outVals.length,
      in: inVals.length,
      bank: bankVals.length,
      cpu: cpuVals.length,
      ram: ramVals.length,
    },
    solar: {
      avgW: solarVals.length ? Math.round(avg(solarVals)) : null,
      maxW: solarVals.length ? Math.round(Math.max(...solarVals)) : null,
      producingAvgW: producing.length ? Math.round(avg(producing)) : null,
      producingMinutes: producing.length,
      totalWh: solarWh,
    },
    load: {
      avgOutW: outVals.length ? Math.round(avg(outVals)) : null,
      maxOutW: outVals.length ? Math.round(Math.max(...outVals)) : null,
      totalOutWh: outWh,
      avgInW: inVals.length ? Math.round(avg(inVals)) : null,
      totalInWh: inWh,
    },
    bank: {
      avgPct: bankVals.length ? Math.round(avg(bankVals)) : null,
      minPct: bankVals.length ? Math.round(Math.min(...bankVals)) : null,
      maxPct: bankVals.length ? Math.round(Math.max(...bankVals)) : null,
    },
    host: {
      avgCpuPct: cpuVals.length ? roundN(avg(cpuVals), 1) : null,
      avgRamPct: ramVals.length ? roundN(avg(ramVals), 1) : null,
    },
    mining: {
      avgMultiplier: mineVals.length ? roundN(avg(mineVals), 3) : null,
    },
    net: {
      solarMinusOutWh:
        solarWh != null && outWh != null
          ? roundN(solarWh - outWh, 1)
          : solarWh != null
            ? solarWh
            : outWh != null
              ? roundN(-outWh, 1)
              : null,
    },
    daily: {
      daysSpanned: daysSpanned != null ? roundN(daysSpanned, 2) : null,
      daysWithSolar,
      daysWithOut,
      avgSolarWh:
        solarWh != null && daysWithSolar > 0
          ? roundN(solarWh / daysWithSolar, 1)
          : null,
      avgOutWh:
        outWh != null && daysWithOut > 0
          ? roundN(outWh / daysWithOut, 1)
          : null,
    },
  };
}

/**
 * Hour / 24h / 7d / 1m / all-time totals + averages from live minute buckets.
 * Average daily production = Wh / HST days that actually have samples.
 */
function buildFullTotals({ ecoRows = [], cpuRows = [], hostFrames = null, morning = null } = {}) {
  const now = Date.now();
  const windows = [
    { key: "hour", label: "1 hour", windowMs: 3600_000 },
    { key: "h24", label: "24 hours", windowMs: 24 * 3600_000 },
    { key: "d7", label: "7 days", windowMs: 7 * 24 * 3600_000 },
    { key: "d30", label: "1 month", windowMs: 30 * 24 * 3600_000 },
    { key: "all", label: "All time", windowMs: null },
  ].map((w) => aggregateWindow(ecoRows, cpuRows, { ...w, now }));

  const all = windows.find((w) => w.key === "all");
  if (all && hostFrames?.all_time) {
    if (hostFrames.all_time.cpu_avg_pct != null) {
      all.host.avgCpuPct = hostFrames.all_time.cpu_avg_pct;
    }
    if (hostFrames.all_time.ram_avg_pct != null) {
      all.host.avgRamPct = hostFrames.all_time.ram_avg_pct;
    }
    all.host.fromLifetime = true;
    all.host.lifetimeMinutes = hostFrames.all_time.minute_count ?? null;
  }
  const hour = windows.find((w) => w.key === "hour");
  if (hour && hostFrames?.last_hour) {
    if (hour.host.avgCpuPct == null && hostFrames.last_hour.cpu_avg_pct != null) {
      hour.host.avgCpuPct = hostFrames.last_hour.cpu_avg_pct;
    }
    if (hour.host.avgRamPct == null && hostFrames.last_hour.ram_avg_pct != null) {
      hour.host.avgRamPct = hostFrames.last_hour.ram_avg_pct;
    }
  }

  const byKey = Object.fromEntries(windows.map((w) => [w.key, w]));
  const longest = [...windows]
    .reverse()
    .find((w) => (w.daily?.daysWithSolar || 0) > 0);
  return {
    windows: byKey,
    order: windows.map((w) => w.key),
    labels: Object.fromEntries(windows.map((w) => [w.key, w.label])),
    morning: {
      avgW: morning?.siteAvgW != null ? Math.round(morning.siteAvgW) : null,
      maxW: morning?.siteMaxW != null ? Math.round(morning.siteMaxW) : null,
      minutes: morning?.siteMinutes ?? 0,
      note: morning?.note || null,
    },
    avgDailyProduction: {
      solarWh: longest?.daily?.avgSolarWh ?? null,
      loadOutWh: longest?.daily?.avgOutWh ?? null,
      basisDays: longest?.daily?.daysWithSolar ?? 0,
      basisWindow: longest?.key ?? null,
      note:
        "Avg daily = total Wh / HST calendar days with samples (not invented).",
    },
    note:
      "Totals from on-circuit minute watts (Wh ~ sum W/60). Longer windows show partial coverage until history grows.",
    ecoSamples: ecoRows.length,
    cpuSamples: cpuRows.length,
  };
}


/**
 * Full dashboard payload for /api/solar (and Discord link replies).
 * @param {{ refreshWeather?: boolean, hours?: number, statusHttpUptimeMs?: number }} [opts]
 */
export async function buildSolarDashboardPayload(opts = {}) {
  const hours = Math.max(1, Math.min(24, Number(opts.hours ?? 8)));
  const maxAgeMs = hours * 3600_000;
  const site = loadHostSite();
  const snap = loadEcoSnapshot();
  const solar = loadSolarProfile();
  const morning = summarizeMorningSolar({
    tzOffsetHours: site.tz_offset_hours ?? -10,
  });
  const hostSnap = loadHostSnapshot();
  const hostFrames = itemizeHostMetricsTimeframes();
  // Soft-fill local minute buckets from Worker/D1 when Discord/offline gaps starved Ava
  if (opts.hydrateD1 !== false) {
    try {
      await hydrateEcoMinutesFromD1({
        maxAgeMs,
        limit: Math.max(240, hours * 60),
      });
    } catch {
      /* charts still render from whatever local buckets exist */
    }
  }
  const historyMs = 45 * 24 * 3600_000;
  const ecoLongHist = loadEcoMinuteSeries({ maxAgeMs: historyMs, limit: 45000 });
  const cpuLongHist = loadHostMetricsMinuteSeries({
    maxAgeMs: historyMs,
    limit: 45000,
  });
  const chartSince = Date.now() - maxAgeMs;
  const ecoHist = {
    series: ecoLongHist.series.filter((r) => r.t >= chartSince).slice(-(hours * 60)),
    sampleCount: 0,
    sns: ecoLongHist.sns,
  };
  ecoHist.sampleCount = ecoHist.series.filter(
    (r) => r.solarW != null || r.bankSoc != null,
  ).length;
  const cpuHist = {
    series: cpuLongHist.series.filter((r) => r.t >= chartSince).slice(-(hours * 60)),
    sampleCount: cpuLongHist.series.filter((r) => r.t >= chartSince).length,
  };
  const { dayStart } = localDayBounds(site.tz_offset_hours ?? -10);

  let weather = loadHostSiteTelemetry()?.weather || null;
  if (opts.refreshWeather !== false) {
    try {
      weather = await fetchHostSiteWeather(site);
    } catch (err) {
      weather = weather || { ok: false, detail: err.message };
    }
  }
  if (weather && typeof weather === "object") {
    weather = { ...weather, city: null, state: null };
  }
  if (!weather?.sun) {
    try {
      const sunOnly = await fetchSunTimes(site.lat, site.lon);
      if (sunOnly) {
        weather = { ...(weather || { ok: false }), sun: sunOnly };
      }
    } catch {
      /* leave sun empty */
    }
  }

  const ecoAgeMs =
    snap?.updatedAt != null ? Date.now() - Number(snap.updatedAt) : null;
  const ecoStale = ecoAgeMs != null ? ecoAgeMs > ECO_STALE_MS : !snap;
  const ecoOffline =
    !snap ||
    snap.status === "unconfigured" ||
    snap.status === "needs_sn" ||
    (!Object.keys(snap?.perSn || {}).length && snap.status !== "live");

  const totals = siteSolarNow(snap);
  const devices = deviceRows(snap, { ecoStale: ecoStale && !ecoOffline });
  const anyDisconnected = devices.some((d) => d.disconnected);
  const curCpu =
    hostSnap?.current?.cpu ??
    hostFrames?.current?.cpu_avg_pct ??
    hostFrames?.current?.cpu ??
    null;
  const curRam =
    hostSnap?.current?.ram ??
    hostFrames?.current?.ram_avg_pct ??
    hostFrames?.current?.ram ??
    null;

  const live = {
    batteryPct: snap?.batteryPct ?? null,
    mood: moodFromPower(snap),
    ...totals,
    morningAvgW:
      morning?.siteAvgW != null ? Math.round(morning.siteAvgW) : null,
    morningMaxW:
      morning?.siteMaxW != null ? Math.round(morning.siteMaxW) : null,
    morningNote: morning?.note || null,
    morningMinutes: morning?.siteMinutes ?? 0,
    ecoStatus: snap?.status || (ecoOffline ? "offline" : null),
    ecoAgeMs,
    ecoStale,
    ecoOffline,
    hostOnline: !isAsleep() && !isPoweredOff(),
    devices,
    anyDisconnected,
    cpu: curCpu != null ? Number(curCpu) : null,
    ram: curRam != null ? Number(curRam) : null,
    cpuHour: hostFrames?.last_hour?.cpu_avg_pct ?? null,
    hostKey: hostSnap?.host_key || hostFrames?.host_key || null,
    hostname: hostSnap?.hostname || null,
  };

  const minutes = densifyMinuteSeries(
    mergeSeries(ecoHist.series, cpuHist.series),
    {
      tzOffsetHours: site.tz_offset_hours ?? -10,
      maxCarryMin: Number(process.env.AVA_SOLAR_DAY_BRIDGE_MIN || 120),
      maxInterpMin: Number(process.env.AVA_SOLAR_DAY_INTERP_MIN || 180),
    },
  );
  const stats = buildStats({
    minutes,
    morning,
    live,
    hostFrames,
    dayStart,
  });
  const fullTotals = buildFullTotals({
    ecoRows: ecoLongHist.series,
    cpuRows: cpuLongHist.series,
    hostFrames,
    morning,
  });
  const online = resolveOnline(opts.statusHttpUptimeMs);
  const mining = miningMultiplierFromLive(live);

  return {
    ops: buildPublicOpsPayload(),
    ok: true,
    service: "ava-ivy",
    page: "solar",
    updatedAt: new Date().toISOString(),
    links: publicSolarLinksPayload(),
    site: publicSite(site),
    array: {
      panels: solar?.panels?.count ?? 10,
      circuits: solar?.panels?.circuits ?? 2,
      batteries: solar?.batteries?.count ?? 3,
      notes: solar?.panels?.notes || solar?.batteries?.notes || null,
    },
    online,
    mining,
    sun: weather?.sun || null,
    live,
    stats,
    totals: fullTotals,
    weather,
    series: {
      hours,
      minutes,
      ecoSamples: ecoHist.sampleCount,
      cpuSamples: cpuHist.sampleCount,
      dayStart,
    },
  };
}
