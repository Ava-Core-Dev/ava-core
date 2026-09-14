import { json } from "./cors";
import {
  validateDevWorkstationAuth,
  type DevWorkstationEnv,
} from "./rootmc-dev-workstation";
import type { D1Database } from "@cloudflare/workers-types";

export type HostSiteEnv = DevWorkstationEnv & {
  ROOTMC_INTERNAL_API_KEY?: string;
};

const NWS_UA = "RootMC Hourly (api.rootmc.net; host-site)";
const DEFAULT_LAT = 19.5558;
const DEFAULT_LON = -155.1069;
/** Host-site D1 feed is pushed ~10m; treat older as offline for mining mult. */
const TELEMETRY_STALE_MS = 15 * 60_000;
/** EcoFlow sample age when Ava includes ecoUpdatedAt (matches Ava ECO_STALE_MS). */
const ECO_STALE_MS = 3 * 60_000;

function str(v: unknown): string {
  return String(v ?? "").trim();
}

/** Connected: 1 + 1% + 1%/10% bank + 1%/100 W. Offline: 1.00× + 1% env tax. */
export const CONNECTED_BASE = 0.01;
export const PER_10_BATTERY = 0.01;
export const PER_100W = 0.01;
export const OFFLINE_ENV_TAX = 0.01;

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** @deprecated CPU tax removed. Always 0. */
export function cpuTaxRate(_cpuPercent?: number | null): number {
  return 0;
}

export function solarXpMultiplier(
  solarW: number | null | undefined,
  batteryPercent?: number | null,
  hostOnline = true,
): number {
  return resolveGamingBonus(batteryPercent, hostOnline, { solarW }).xp_multiplier;
}

export function computeSolarMiningMultiplier(
  batteryPercent: number | null | undefined,
  online: boolean,
  extras: { cpuPct?: number | null; solarW?: number | null; volcanoActive?: boolean } = {},
): number {
  return resolveGamingBonus(batteryPercent, online, extras).multiplier;
}

export function resolveGamingBonus(
  batteryPercent: number | null | undefined,
  hostOnline: boolean,
  extras: { cpuPct?: number | null; solarW?: number | null; volcanoActive?: boolean } = {},
): {
  battery_percent: number | null;
  track_percent: number | null;
  multiplier: number;
  tax_rate: number;
  underpowered_tax_rate: number;
  cpu_tax_rate: number;
  cpu_percent: number | null;
  solar_w: number | null;
  xp_multiplier: number;
  bonus: number;
  online: boolean;
  underpowered: boolean;
  cpu_hot: boolean;
  mode: "bonus" | "tax";
  detail: string;
} {
  const bank =
    batteryPercent != null && Number.isFinite(Number(batteryPercent))
      ? Math.min(100, Math.max(0, Number(batteryPercent)))
      : null;
  const cpu =
    extras.cpuPct != null && Number.isFinite(Number(extras.cpuPct))
      ? Math.min(100, Math.max(0, Number(extras.cpuPct)))
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
    tax_rate: 0,
    underpowered_tax_rate: 0,
    cpu_tax_rate: 0,
    cpu_percent: cpu,
    solar_w: solarW,
    xp_multiplier: multiplier,
    bonus: round3(multiplier - 1),
    online: true,
    underpowered: false,
    cpu_hot: false,
    mode: volcanoActive ? "volcano" : "bonus",
    detail: volcanoActive ? "volcano_watch" : "live",
  };
}

export type SolarMiningMultiplierSnapshot = {
  ok: true;
  battery_percent: number | null;
  track_percent?: number | null;
  multiplier: number;
  tax_rate: number;
  underpowered_tax_rate?: number;
  cpu_tax_rate?: number;
  cpu_percent?: number | null;
  solar_w?: number | null;
  xp_multiplier?: number;
  bonus?: number;
  online: boolean;
  underpowered?: boolean;
  cpu_hot?: boolean;
  mode?: "bonus" | "tax";
  source: string;
  updated_at: string | null;
  detail?: string;
};

/**
 * Connected = fresh host telemetry + EcoFlow live (bank optional).
 * Disconnected → 1.00× + 1% env tax. Connected → 1 + 1% + 1%/10% bank + 1%/100 W.
 */
export function resolveSolarMiningMultiplier(
  telem: Record<string, unknown> | null,
): SolarMiningMultiplierSnapshot {
  const updatedAt =
    str(telem?._updated_at) ||
    str(telem?.updatedAt) ||
    null;
  const solar = (telem?.solar as Record<string, unknown>) || {};
  const batteryRaw = solar.batteryPct;
  const battery =
    batteryRaw != null && Number.isFinite(Number(batteryRaw))
      ? Number(batteryRaw)
      : null;

  let ageMs: number | null = null;
  if (updatedAt) {
    const t = Date.parse(updatedAt);
    if (Number.isFinite(t)) ageMs = Date.now() - t;
  }

  const ecoUpdatedAt = Number(solar.ecoUpdatedAt);
  let ecoAgeMs: number | null = null;
  if (Number.isFinite(ecoUpdatedAt) && ecoUpdatedAt > 0) {
    ecoAgeMs = Date.now() - ecoUpdatedAt;
  }

  const ecoStatus = str(solar.ecoStatus) || null;
  /** Explicit host PC / Root Server off (sleep or power-down) → normal Gold. */
  const hostOnline =
    telem?.hostOnline !== false &&
    solar.hostOnline !== false &&
    ecoStatus !== "host_off";
  const ecoOfflineFlag =
    solar.ecoOffline === true ||
    ecoStatus === "unconfigured" ||
    ecoStatus === "needs_sn" ||
    ecoStatus === "offline" ||
    ecoStatus === "host_off";
  const ecoStaleFlag =
    solar.ecoStale === true ||
    (ecoAgeMs != null && ecoAgeMs > ECO_STALE_MS);
  const telemStale = ageMs != null ? ageMs > TELEMETRY_STALE_MS : !telem;
  const hasBank = battery != null;

  let online =
    Boolean(telem) &&
    hostOnline &&
    !telemStale &&
    !ecoOfflineFlag &&
    !ecoStaleFlag;
  let detail = "live";
  if (!telem) {
    online = false;
    detail = "no_telemetry";
  } else if (!hostOnline) {
    online = false;
    detail = "host_device_off";
  } else if (telemStale) {
    online = false;
    detail = "telemetry_stale";
  } else if (ecoOfflineFlag) {
    online = false;
    detail = "ecoflow_offline";
  } else if (ecoStaleFlag) {
    online = false;
    detail = "ecoflow_stale";
  } else if (!hasBank) {
    online = false;
    detail = "no_on_circuit_bank";
  }

  const cpuRaw =
    solar.cpuHourAvgPct ??
    solar.cpuPct ??
    (telem as Record<string, unknown> | null)?.cpuHourAvgPct ??
    (telem as Record<string, unknown> | null)?.cpuPct;
  const cpu =
    cpuRaw != null && Number.isFinite(Number(cpuRaw)) ? Number(cpuRaw) : null;
  const solarWRaw = solar.solarW ?? (telem as Record<string, unknown> | null)?.solarW;
  const solarW =
    solarWRaw != null && Number.isFinite(Number(solarWRaw)) ? Number(solarWRaw) : null;

  const volcanoActive = solar.volcanoActive === true || telem?.volcanoActive === true;
  const gaming = resolveGamingBonus(battery, online, { cpuPct: cpu, solarW, volcanoActive });
  return {
    ok: true,
    battery_percent: hasBank ? battery : null,
    track_percent: gaming.track_percent,
    multiplier: gaming.multiplier,
    tax_rate: gaming.tax_rate,
    underpowered_tax_rate: gaming.underpowered_tax_rate,
    cpu_tax_rate: gaming.cpu_tax_rate,
    cpu_percent: gaming.cpu_percent,
    solar_w: gaming.solar_w,
    xp_multiplier: gaming.xp_multiplier,
    bonus: gaming.bonus,
    online: gaming.online,
    underpowered: gaming.underpowered,
    cpu_hot: gaming.cpu_hot,
    mode: gaming.mode,
    volcano_active: volcanoActive,
    solar_multiplier: volcanoActive && gaming.multiplier ? gaming.multiplier / 2 : gaming.multiplier,
    source: "host-site-telemetry.solar",
    updated_at: updatedAt,
    detail: gaming.online ? detail : gaming.detail || detail,
  };
}

async function ensureTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS rootmc_host_site_telemetry (
         host_key TEXT PRIMARY KEY,
         payload_json TEXT NOT NULL,
         updated_at TEXT NOT NULL
       )`,
    )
    .run();
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS rootmc_ecoflow_samples (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         sn TEXT NOT NULL,
         label TEXT,
         live INTEGER NOT NULL DEFAULT 0,
         device_online INTEGER,
         soc REAL,
         solar_w REAL,
         in_w REAL,
         out_w REAL,
         sampled_at INTEGER NOT NULL,
         payload_json TEXT,
         created_at TEXT NOT NULL
       )`,
    )
    .run();
  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_ecoflow_samples_sn_at
       ON rootmc_ecoflow_samples (sn, sampled_at DESC)`,
    )
    .run();
}

export async function readHostSiteTelemetry(
  db: D1Database,
  hostKey = "primary",
): Promise<Record<string, unknown> | null> {
  try {
    await ensureTable(db);
    const row = await db
      .prepare(
        `SELECT payload_json, updated_at FROM rootmc_host_site_telemetry WHERE host_key = ? LIMIT 1`,
      )
      .bind(hostKey)
      .first<{ payload_json: string; updated_at: string }>();
    if (!row?.payload_json) return null;
    const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
    return { ...payload, _updated_at: row.updated_at };
  } catch {
    return null;
  }
}

async function nwsJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { Accept: "application/geo+json,application/json", "User-Agent": NWS_UA },
  });
  if (!res.ok) throw new Error(`nws ${res.status}`);
  return res.json();
}

/** Live NWS forecast + alerts for host-site coords (city/state never published). */
export async function fetchNwsHostWeather(lat = DEFAULT_LAT, lon = DEFAULT_LON) {
  const points = await nwsJson(
    `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
  );
  const forecastUrl = points?.properties?.forecast as string | undefined;
  const city = null;
  const state = null;
  let period: any = null;
  if (forecastUrl) {
    const forecast = await nwsJson(forecastUrl);
    period = forecast?.properties?.periods?.[0] || null;
  }
  let alerts: Array<{ event: string; severity: string; headline: string }> = [];
  try {
    const alertData = await nwsJson(
      `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`,
    );
    alerts = (alertData?.features || [])
      .map((f: any) => ({
        event: String(f?.properties?.event || "Alert"),
        severity: String(f?.properties?.severity || ""),
        headline: String(f?.properties?.headline || "").slice(0, 140),
      }))
      .slice(0, 5);
  } catch {
    alerts = [];
  }
  return {
    ok: true,
    source: "NWS",
    city,
    state,
    period: period
      ? {
          name: String(period.name || ""),
          temp: period.temperature,
          unit: String(period.temperatureUnit || "F"),
          wind: String(period.windSpeed || ""),
          short: String(period.shortForecast || ""),
        }
      : null,
    alerts,
  };
}

export async function buildHostSiteHourlySection(
  env: HostSiteEnv,
): Promise<{ content: string; detail: string }> {
  const telem = await readHostSiteTelemetry(env.DB, "primary");
  const site = (telem?.site as Record<string, unknown>) || {};
  const lat = Number(site.lat ?? DEFAULT_LAT);
  const lon = Number(site.lon ?? DEFAULT_LON);

  let weather: any = telem?.weather;
  try {
    // Prefer fresh NWS each hour (storm/hazard rail)
    weather = await fetchNwsHostWeather(lat, lon);
  } catch (e) {
    if (!weather?.ok) {
      weather = { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  const solar = (telem?.solar as Record<string, unknown>) || {};
  const perSn = (solar.perSn as Record<string, any>) || {};
  const solarLines: string[] = [];
  if (solar.batteryPct != null) {
    solarLines.push(`\u2022 **Bank:** ${solar.batteryPct}%`);
  }
  let solarTotal = 0;
  for (const [sn, v] of Object.entries(perSn)) {
    if (!v || typeof v !== "object" || !v.ok) continue;
    if (v.solarW != null) solarTotal += Number(v.solarW) || 0;
    const label = sn.slice(-6);
    const bits = [
      v.soc != null ? `SOC ${v.soc}%` : null,
      v.solarW != null ? `solar ${Math.round(Number(v.solarW))}W` : null,
    ].filter(Boolean);
    solarLines.push(`\u2022 **${label}:** ${bits.join(" / ")}`);
  }
  if (solarTotal > 0) {
    solarLines.push(`\u2022 **Site solar in:** ~${Math.round(solarTotal)}W`);
  }
  if (solar.morningAvgW != null) {
    solarLines.push(`\u2022 **Morning avg:** ~${Math.round(Number(solar.morningAvgW))}W`);
  }
  if (!solarLines.length) {
    solarLines.push(`\u2022 _Solar telemetry pending (Ava sync)_`);
  }

  const wxLines: string[] = [];
  if (weather?.period) {
    const p = weather.period;
    wxLines.push(
      `\u2022 **${p.name}:** ${p.temp}${p.unit} - ${p.short}` +
        (p.wind ? ` - wind ${p.wind}` : ""),
    );
  }
  wxLines.push(`\u2022 **Source:** ${weather?.source || "NWS"} (local point)`);
  if (Array.isArray(weather?.alerts) && weather.alerts.length) {
    for (const a of weather.alerts.slice(0, 4)) {
      wxLines.push(
        `\u2022 **HAZARD:** ${a.event}${a.severity ? ` (${a.severity})` : ""}`,
      );
    }
  } else {
    wxLines.push(`\u2022 **Hazards:** none active (NWS)`);
  }

  const siteLabel =
    str((site as Record<string, unknown>).label) ||
    "HI Pacific Solar Root Server";
  const content = [
    `**Host site** - ${siteLabel}`,
    `**Solar / EcoFlow**`,
    ...solarLines,
    `**Local weather**`,
    ...wxLines,
  ].join("\n");

  return {
    content,
    detail: `host-site solar=${solarLines.length} wx=${weather?.ok ? "ok" : "fail"} alerts=${weather?.alerts?.length || 0}`,
  };
}

export async function handleHostSiteRoutes(
  req: Request,
  env: HostSiteEnv,
  subpath: string,
): Promise<Response | null> {
  // Public live mining multiplier (Gold G) from aggregate bank SOC.
  if (
    req.method === "GET" &&
    (subpath === "/rootmc/solar-mining-multiplier" ||
      subpath === "/rootmc/solar-mining-multiplier/")
  ) {
    const telem = await readHostSiteTelemetry(env.DB);
    return json(resolveSolarMiningMultiplier(telem));
  }

  if (!subpath.startsWith("/rootmc/host-site")) return null;
  const rest = subpath.slice("/rootmc/host-site".length) || "/";

  if (req.method === "GET" && (rest === "/telemetry" || rest === "/")) {
    const telem = await readHostSiteTelemetry(env.DB);
    const mining = resolveSolarMiningMultiplier(telem);
    return json({ ok: true, telemetry: telem, mining });
  }

  if (req.method === "GET" && (rest === "/ecoflow/samples" || rest === "/ecoflow/samples/")) {
    await ensureTable(env.DB);
    const url = new URL(req.url);
    const sn = str(url.searchParams.get("sn"));
    const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get("limit") || 60)));
    const since = Number(url.searchParams.get("since") || 0);
    const sinceMs = Number.isFinite(since) && since > 0 ? since : 0;
    const rows = sn
      ? sinceMs
        ? await env.DB.prepare(
            `SELECT sn, label, live, device_online, soc, solar_w, in_w, out_w, sampled_at, created_at
             FROM rootmc_ecoflow_samples
             WHERE sn = ? AND sampled_at >= ?
             ORDER BY sampled_at DESC LIMIT ?`,
          )
            .bind(sn, sinceMs, limit)
            .all()
        : await env.DB.prepare(
            `SELECT sn, label, live, device_online, soc, solar_w, in_w, out_w, sampled_at, created_at
             FROM rootmc_ecoflow_samples WHERE sn = ? ORDER BY sampled_at DESC LIMIT ?`,
          )
            .bind(sn, limit)
            .all()
      : sinceMs
        ? await env.DB.prepare(
            `SELECT sn, label, live, device_online, soc, solar_w, in_w, out_w, sampled_at, created_at
             FROM rootmc_ecoflow_samples
             WHERE sampled_at >= ?
             ORDER BY sampled_at DESC LIMIT ?`,
          )
            .bind(sinceMs, limit)
            .all()
        : await env.DB.prepare(
            `SELECT sn, label, live, device_online, soc, solar_w, in_w, out_w, sampled_at, created_at
             FROM rootmc_ecoflow_samples ORDER BY sampled_at DESC LIMIT ?`,
          )
            .bind(limit)
            .all();
    return json({ ok: true, samples: rows?.results || [], since: sinceMs || null });
  }

  if (req.method === "POST" && rest === "/telemetry") {
    if (!validateDevWorkstationAuth(req, env)) {
      return json({ ok: false, detail: "unauthorized" }, 401);
    }
    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, detail: "invalid_json" }, 400);
    }
    await ensureTable(env.DB);
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO rootmc_host_site_telemetry (host_key, payload_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(host_key) DO UPDATE SET
         payload_json = excluded.payload_json,
         updated_at = excluded.updated_at`,
    )
      .bind("primary", JSON.stringify(body), now)
      .run();

    // Persist per-SN EcoFlow samples for fresh history (Alex 2026-08-03)
    const inserted = await insertEcoflowSamplesFromTelemetry(env.DB, body, now);
    return json({ ok: true, updated_at: now, eco_samples_inserted: inserted });
  }

  if (req.method === "POST" && (rest === "/ecoflow/samples" || rest === "/ecoflow/samples/")) {
    if (!validateDevWorkstationAuth(req, env)) {
      return json({ ok: false, detail: "unauthorized" }, 401);
    }
    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ ok: false, detail: "invalid_json" }, 400);
    }
    await ensureTable(env.DB);
    const now = new Date().toISOString();
    const samples = Array.isArray(body?.samples) ? body.samples : [body];
    let n = 0;
    for (const s of samples) {
      if (!s?.sn) continue;
      await env.DB.prepare(
        `INSERT INTO rootmc_ecoflow_samples
         (sn, label, live, device_online, soc, solar_w, in_w, out_w, sampled_at, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          str(s.sn),
          str(s.label) || null,
          s.live === true || s.live === 1 ? 1 : 0,
          s.deviceOnline === false || s.device_online === 0
            ? 0
            : s.deviceOnline === true || s.device_online === 1
              ? 1
              : null,
          s.soc != null ? Number(s.soc) : null,
          s.solarW != null ? Number(s.solarW) : s.solar_w != null ? Number(s.solar_w) : null,
          s.inW != null ? Number(s.inW) : s.in_w != null ? Number(s.in_w) : null,
          s.outW != null ? Number(s.outW) : s.out_w != null ? Number(s.out_w) : null,
          Number(s.sampledAt || s.sampled_at || Date.now()),
          JSON.stringify(s),
          now,
        )
        .run();
      n += 1;
    }
    return json({ ok: true, inserted: n, created_at: now });
  }

  return null;
}

async function insertEcoflowSamplesFromTelemetry(
  db: D1Database,
  body: any,
  createdAt: string,
): Promise<number> {
  const solar = body?.solar || {};
  const perSn = (solar.perSn || body?.perSn || {}) as Record<string, any>;
  const labels: Record<string, string> = {
    R331ZAB5SG6S2858: "Delta 2",
    R621ZA16XH6K1155: "River 2 Pro",
  };
  let n = 0;
  for (const [sn, v] of Object.entries(perSn)) {
    if (!sn || !v) continue;
    const live = v.ok === true && v.live !== false && v.deviceOnline !== false;
    const known = live
      ? v
      : v.lastKnown && typeof v.lastKnown === "object"
        ? v.lastKnown
        : v;
    await db
      .prepare(
        `INSERT INTO rootmc_ecoflow_samples
         (sn, label, live, device_online, soc, solar_w, in_w, out_w, sampled_at, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        sn,
        labels[sn] || sn.slice(-6),
        live ? 1 : 0,
        v.deviceOnline === false ? 0 : v.deviceOnline === true ? 1 : null,
        known?.soc != null ? Number(known.soc) : null,
        known?.solarW != null ? Number(known.solarW) : null,
        known?.inW != null ? Number(known.inW) : null,
        known?.outW != null ? Number(known.outW) : null,
        Number(v.sampledAt || Date.now()),
        JSON.stringify({ sn, ...v }),
        createdAt,
      )
      .run();
    n += 1;
  }
  return n;
}
