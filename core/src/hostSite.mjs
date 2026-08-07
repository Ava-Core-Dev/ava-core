/**
 * Root Server host site — solar + localized NWS weather/hazards.
 * Used in hourly snapshot enrichment and ops power talk.
 * Public copy never names the host city/state — coords stay private for NWS only.
 * Weather: api.weather.gov (NWS) — same storm/hazard rail RootRecord Weather Manager uses.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths } from "./store.mjs";
import {
  refreshEcoFlow,
  loadEcoSnapshot,
  summarizeMorningSolar,
  snDisplayLabel} from "./ecoflow.mjs";
import { loadSolarProfile } from "./solarProfile.mjs";

const NWS_UA = "RootMC Ava (rootmc.net; host-site hourly)";
const DEFAULT_SITE = {
  id: "host-site-primary-v1",
  label: "HI Pacific Solar Root Server",
  locale: "HI Pacific",
  lat: 19.5558,
  lon: -155.1069,
  tz_offset_hours: -10,
};

function sitePath() {
  return path.join(storePaths().dir, "host-site.json");
}

function telemetryPath() {
  return path.join(storePaths().dir, "host-site-telemetry.json");
}

export function loadHostSite() {
  try {
    if (!fs.existsSync(sitePath())) return { ...DEFAULT_SITE };
    return { ...DEFAULT_SITE, ...JSON.parse(fs.readFileSync(sitePath(), "utf8")) };
  } catch {
    return { ...DEFAULT_SITE };
  }
}

/** Public node / server display name (Control Panel + Discord-registered nodes). */
export function hostPublicName() {
  const label = String(loadHostSite().label || "").trim();
  return label || DEFAULT_SITE.label;
}

/**
 * Persist public node name into host-site.json (label). Coords/locale unchanged.
 * @param {string} nodeName
 */
export function saveHostSiteLabel(nodeName) {
  const name = String(nodeName || "").trim();
  if (!name) throw new Error("node name required");
  const prev = loadHostSite();
  const next = {
    ...prev,
    label: name,
    updated_at: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(sitePath()), { recursive: true });
  fs.writeFileSync(sitePath(), JSON.stringify(next, null, 2) + "\n", "utf8");
  return next;
}

async function nwsJson(url) {
  const res = await fetch(url, {
    headers: { Accept: "application/geo+json,application/json", "User-Agent": NWS_UA },
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new Error(`nws ${res.status}: ${text.slice(0, 120)}`);
  }
  return data;
}

/**
 * Localized forecast + active alerts for host site (NWS).
 */

/**
 * Civil sun times for the private host-site point (ISO UTC).
 * Uses sunrise-sunset.org; fails soft so weather still returns.
 */
export async function fetchSunTimes(lat, lon, date = new Date()) {
  const la = Number(lat);
  const lo = Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  const url =
    `https://api.sunrise-sunset.org/json?lat=${la.toFixed(4)}&lng=${lo.toFixed(4)}` +
    `&date=${y}-${m}-${d}&formatted=0`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12_000);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { Accept: "application/json", "User-Agent": "AvaCoreSolar/1.0" },
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json?.status !== "OK" || !json?.results) return null;
    const r = json.results;
    return {
      sunrise: r.sunrise || null,
      sunset: r.sunset || null,
      transit: r.solar_noon || null,
      civilTwilightBegin: r.civil_twilight_begin || null,
      civilTwilightEnd: r.civil_twilight_end || null,
      dayLengthSec: r.day_length ?? null,
      source: "sunrise-sunset.org",
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchHostSiteWeather(site = loadHostSite()) {
  const lat = Number(site.lat);
  const lon = Number(site.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { ok: false, detail: "bad_coords" };
  }
  const points = await nwsJson(
    `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
  );
  const forecastUrl = points?.properties?.forecast;
  // Keep city/state off public payloads — NWS needs coords only.
  const city = null;
  const state = null;

  let period = null;
  if (forecastUrl) {
    const forecast = await nwsJson(forecastUrl);
    period = forecast?.properties?.periods?.[0] || null;
  }

  let alerts = [];
  try {
    const alertData = await nwsJson(
      `https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`,
    );
    alerts = (alertData?.features || [])
      .map((f) => ({
        event: f?.properties?.event || "Alert",
        severity: f?.properties?.severity || "",
        headline: String(f?.properties?.headline || "").slice(0, 160),
      }))
      .slice(0, 5);
  } catch {
    alerts = [];
  }

  let sun = null;
  try {
    sun = await fetchSunTimes(lat, lon);
  } catch {
    sun = null;
  }

  return {
    ok: true,
    source: "NWS",
    city,
    state,
    period: period
      ? {
          name: period.name,
          temp: period.temperature,
          unit: period.temperatureUnit || "F",
          wind: period.windSpeed,
          short: period.shortForecast,
        }
      : null,
    alerts,
    sun,
    fetchedAt: new Date().toISOString(),
  };
}

function snLabel(sn) {
  return snDisplayLabel(sn);
}

export function formatSolarLines(snap, morning = null) {
  const lines = [];
  const per = snap?.perSn || {};
  let solarTotal = 0;
  for (const [sn, v] of Object.entries(per)) {
    if (!v?.ok) continue;
    if (v.solarW != null) solarTotal += Number(v.solarW) || 0;
    const bits = [
      v.soc != null ? `SOC ${v.soc}%` : null,
      v.solarW != null ? `solar ${Math.round(v.solarW)}W` : null,
      v.outW != null ? `out ${Math.round(v.outW)}W` : null,
    ].filter(Boolean);
    lines.push(`- **${snLabel(sn)}**: ${bits.join(" / ") || "ok"}`);
  }
  if (snap?.batteryPct != null) {
    lines.unshift(`- **Bank:** ${snap.batteryPct}% overall`);
  }
  if (solarTotal > 0) {
    lines.push(`- **Site solar in now:** ~${Math.round(solarTotal)}W`);
  }
  if (morning?.siteAvgW != null) {
    lines.push(
      `- **Morning solar avg (sampled):** ~${Math.round(morning.siteAvgW)}W` +
        (morning.note && morning.note !== "ok" ? ` (${morning.note})` : ""),
    );
  }
  const solar = loadSolarProfile();
  lines.push(
    `- **Array:** ${solar?.panels?.count ?? 10} panels / ${solar?.panels?.circuits ?? 2} circuits / ${solar?.batteries?.count ?? 3} batteries`,
  );
  return lines;
}

export function formatWeatherLines(weather) {
  if (!weather?.ok) {
    return ["- Weather unavailable right now"];
  }
  const lines = [];
  const p = weather.period;
  if (p) {
    lines.push(
      `- **Now (${p.name}):** ${p.temp}${p.unit} - ${p.short}` +
        (p.wind ? ` - wind ${p.wind}` : ""),
    );
  }
  lines.push(`- **Source:** ${weather.source || "NWS"} (local point)`);
  if (weather.alerts?.length) {
    for (const a of weather.alerts) {
      lines.push(
        `- **HAZARD:** ${a.event}${a.severity ? ` (${a.severity})` : ""}${a.headline ? ` - ${a.headline}` : ""}`,
      );
    }
  } else {
    lines.push("- **Hazards:** none active (NWS)");
  }
  return lines;
}

/**
 * Full host-site block for Discord (ASCII-safe punctuation).
 */
export async function buildHostSiteHourlyBlock({ refreshPower = true } = {}) {
  const site = loadHostSite();
  let snap = loadEcoSnapshot();
  if (refreshPower) {
    try {
      snap = await refreshEcoFlow();
    } catch {
      snap = loadEcoSnapshot();
    }
  }
  const morning = summarizeMorningSolar({
    tzOffsetHours: site.tz_offset_hours ?? -10,
  });
  let weather;
  try {
    weather = await fetchHostSiteWeather(site);
  } catch (err) {
    weather = { ok: false, detail: err.message };
  }

  const publicSite = {
    ...site,
    id: site.id || DEFAULT_SITE.id,
    label: site.label || DEFAULT_SITE.label,
    locale: "HI Pacific",
  };
  const publicWeather =
    weather && typeof weather === "object"
      ? { ...weather, city: null, state: null }
      : weather;

  const payload = {
    site: publicSite,
    solar: {
      batteryPct: snap?.batteryPct ?? null,
      perSn: snap?.perSn || {},
      morningAvgW: morning.siteAvgW ?? null,
      morningNote: morning.note || null,
    },
    weather: publicWeather,
    updatedAt: new Date().toISOString(),
  };
  try {
    fs.mkdirSync(storePaths().dir, { recursive: true });
    fs.writeFileSync(telemetryPath(), JSON.stringify(payload, null, 2), "utf8");
  } catch {
    /* ignore */
  }

  const lines = [
    `**Host site** - ${publicSite.label}`,
    "",
    "**Solar / EcoFlow**",
    ...formatSolarLines(snap, morning),
    "",
    "**Local weather (NWS)**",
    ...formatWeatherLines(publicWeather),
  ];
  return {
    content: lines.join("\n"),
    payload,
  };
}

export function loadHostSiteTelemetry() {
  try {
    if (!fs.existsSync(telemetryPath())) return null;
    return JSON.parse(fs.readFileSync(telemetryPath(), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Push telemetry to api.rootmc.net when workstation key present (Worker hourly reads it).
 */
export async function pushHostSiteTelemetry(env = {}, payload = null) {
  const key = String(
    env.ROOTMC_DEV_WORKSTATION_KEY ||
      process.env.ROOTMC_DEV_WORKSTATION_KEY ||
      process.env.ROOTMC_INTERNAL_API_KEY ||
      "",
  ).trim();
  if (!key) return { ok: false, detail: "no_workstation_key" };
  const body = payload || loadHostSiteTelemetry();
  if (!body) return { ok: false, detail: "no_payload" };
  const base = String(
    process.env.AVA_API_BASE || process.env.ROOTMC_API_BASE || "https://api.rootmc.net",
  ).replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/api/rootmc/host-site/telemetry`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "AvaIvyRootMC/0.5",
        "X-RootMC-Dev-Key": key,
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text.slice(0, 200) };
    }
    if (!res.ok) {
      return { ok: false, status: res.status, detail: data?.detail || text.slice(0, 160) };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, detail: err.message };
  }
}
