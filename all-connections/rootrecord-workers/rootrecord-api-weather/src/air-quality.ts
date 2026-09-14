/**
 * Air quality for Weather Manager — Open-Meteo CAMS model (no API key).
 * Pro/Lifetime gate is enforced in router.ts.
 */

const AIR_QUALITY_BASE = "https://air-quality-api.open-meteo.com/v1/air-quality";

const HOURLY_VARS = [
  "us_aqi",
  "pm2_5",
  "pm10",
  "ozone",
  "nitrogen_dioxide",
  "sulphur_dioxide",
].join(",");

const CURRENT_VARS = HOURLY_VARS;

type OpenMeteoHourly = {
  time?: string[];
  us_aqi?: (number | null)[];
  pm2_5?: (number | null)[];
  pm10?: (number | null)[];
  ozone?: (number | null)[];
  nitrogen_dioxide?: (number | null)[];
  sulphur_dioxide?: (number | null)[];
};

type OpenMeteoCurrent = {
  time?: string;
  us_aqi?: number | null;
  pm2_5?: number | null;
  pm10?: number | null;
  ozone?: number | null;
  nitrogen_dioxide?: number | null;
  sulphur_dioxide?: number | null;
};

type OpenMeteoBody = {
  hourly?: OpenMeteoHourly;
  current?: OpenMeteoCurrent;
};

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function usAqiCategory(aqi: number): { category: string; categoryColor: string } {
  if (aqi <= 50) return { category: "Good", categoryColor: "#00e400" };
  if (aqi <= 100) return { category: "Moderate", categoryColor: "#ffff00" };
  if (aqi <= 150) return { category: "Unhealthy for sensitive groups", categoryColor: "#ff7e00" };
  if (aqi <= 200) return { category: "Unhealthy", categoryColor: "#ff0000" };
  if (aqi <= 300) return { category: "Very unhealthy", categoryColor: "#8f3f97" };
  return { category: "Hazardous", categoryColor: "#7e0023" };
}

function dominantFromValues(row: {
  pm2_5?: number | null;
  pm10?: number | null;
  ozone?: number | null;
  nitrogen_dioxide?: number | null;
  sulphur_dioxide?: number | null;
}): string {
  const ranked: Array<[string, number]> = [];
  if (row.pm2_5 != null) ranked.push(["PM2.5", row.pm2_5]);
  if (row.pm10 != null) ranked.push(["PM10", row.pm10]);
  if (row.ozone != null) ranked.push(["Ozone", row.ozone]);
  if (row.nitrogen_dioxide != null) ranked.push(["NO₂", row.nitrogen_dioxide]);
  if (row.sulphur_dioxide != null) ranked.push(["SO₂", row.sulphur_dioxide]);
  ranked.sort((a, b) => b[1] - a[1]);
  return ranked[0]?.[0] || "";
}

function buildPollutants(row: {
  pm2_5?: number | null;
  pm10?: number | null;
  ozone?: number | null;
  nitrogen_dioxide?: number | null;
  sulphur_dioxide?: number | null;
}): Array<Record<string, unknown>> {
  const items: Array<{ name: string; value: number | null; unit: string }> = [
    { name: "PM2.5", value: row.pm2_5 ?? null, unit: "μg/m³" },
    { name: "PM10", value: row.pm10 ?? null, unit: "μg/m³" },
    { name: "Ozone", value: row.ozone ?? null, unit: "μg/m³" },
    { name: "NO₂", value: row.nitrogen_dioxide ?? null, unit: "μg/m³" },
    { name: "SO₂", value: row.sulphur_dioxide ?? null, unit: "μg/m³" },
  ];
  return items
    .filter((p) => p.value != null)
    .map((p) => ({
      name: p.name,
      type: p.name,
      value: p.value,
      unit: p.unit,
      index: null,
      category: "",
      categoryColor: "",
    }));
}

function snapshotFromRow(
  timeIso: string,
  aqi: number | null,
  row: {
    pm2_5?: number | null;
    pm10?: number | null;
    ozone?: number | null;
    nitrogen_dioxide?: number | null;
    sulphur_dioxide?: number | null;
  }
): Record<string, unknown> | null {
  if (aqi == null) return null;
  const { category, categoryColor } = usAqiCategory(aqi);
  const epoch = Math.floor(new Date(timeIso).getTime() / 1000);
  const dominant = dominantFromValues(row);
  return {
    date: timeIso,
    epochDate: Number.isFinite(epoch) ? epoch : null,
    overallIndex: Math.round(aqi),
    category,
    categoryColor,
    dominantPollutant: dominant,
    hazardStatement: "",
    link: "",
    pollutants: buildPollutants(row),
  };
}

async function fetchOpenMeteoAir(lat: number, lon: number): Promise<OpenMeteoBody> {
  const u = new URL(AIR_QUALITY_BASE);
  u.searchParams.set("latitude", lat.toFixed(4));
  u.searchParams.set("longitude", lon.toFixed(4));
  u.searchParams.set("current", CURRENT_VARS);
  u.searchParams.set("hourly", HOURLY_VARS);
  u.searchParams.set("timezone", "auto");
  u.searchParams.set("forecast_days", "5");

  const ttlSec = 30 * 60;
  const cacheKey = new Request(u.toString());
  const cache = (caches as unknown as { default?: Cache }).default || null;
  let body: string | null = null;

  if (cache) {
    try {
      const hit = await cache.match(cacheKey);
      if (hit?.ok) body = await hit.text();
    } catch {
      /* miss */
    }
  }

  if (!body) {
    const r = await fetch(u.toString(), {
      headers: { Accept: "application/json", "User-Agent": "RootRecord-Weather-Manager/1.0" },
    });
    if (!r.ok) throw new Error(`open_meteo_air_${r.status}`);
    body = await r.text();
    if (cache && ttlSec > 0) {
      try {
        await cache.put(
          cacheKey,
          new Response(body, {
            status: 200,
            headers: { "content-type": "application/json", "cache-control": `public, max-age=${ttlSec}` },
          })
        );
      } catch {
        /* ignore */
      }
    }
  }

  return JSON.parse(body) as OpenMeteoBody;
}

function hourlySnapshots(data: OpenMeteoBody, limit = 12): Array<Record<string, unknown>> {
  const h = data.hourly;
  if (!h?.time?.length) return [];
  const out: Array<Record<string, unknown>> = [];
  const now = Date.now();
  for (let i = 0; i < h.time.length && out.length < limit; i++) {
    const t = h.time[i];
    if (!t) continue;
    const ts = new Date(t).getTime();
    if (ts < now - 15 * 60 * 1000) continue;
    const snap = snapshotFromRow(t, num(h.us_aqi?.[i]), {
      pm2_5: num(h.pm2_5?.[i]),
      pm10: num(h.pm10?.[i]),
      ozone: num(h.ozone?.[i]),
      nitrogen_dioxide: num(h.nitrogen_dioxide?.[i]),
      sulphur_dioxide: num(h.sulphur_dioxide?.[i]),
    });
    if (snap) out.push(snap);
  }
  return out;
}

function dailySnapshots(data: OpenMeteoBody, days = 5): Array<Record<string, unknown>> {
  const h = data.hourly;
  if (!h?.time?.length) return [];
  const byDay = new Map<
    string,
    { aqi: number; row: Parameters<typeof snapshotFromRow>[2]; time: string }
  >();
  for (let i = 0; i < h.time.length; i++) {
    const t = h.time[i];
    const aqi = num(h.us_aqi?.[i]);
    if (!t || aqi == null) continue;
    const dayKey = t.slice(0, 10);
    const row = {
      pm2_5: num(h.pm2_5?.[i]),
      pm10: num(h.pm10?.[i]),
      ozone: num(h.ozone?.[i]),
      nitrogen_dioxide: num(h.nitrogen_dioxide?.[i]),
      sulphur_dioxide: num(h.sulphur_dioxide?.[i]),
    };
    const prev = byDay.get(dayKey);
    if (!prev || aqi > prev.aqi) byDay.set(dayKey, { aqi, row, time: t });
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, days)
    .map(([, v]) => snapshotFromRow(v.time, v.aqi, v.row))
    .filter((s): s is Record<string, unknown> => Boolean(s));
}

export async function weatherAirQuality(
  lat: number,
  lon: number,
  _env?: unknown,
  _db?: unknown
): Promise<Record<string, unknown>> {
  try {
    const data = await fetchOpenMeteoAir(lat, lon);
    const cur = data.current || {};
    const currentAqi = num(cur.us_aqi);
    const current =
      currentAqi != null
        ? snapshotFromRow(cur.time || new Date().toISOString(), currentAqi, {
            pm2_5: num(cur.pm2_5),
            pm10: num(cur.pm10),
            ozone: num(cur.ozone),
            nitrogen_dioxide: num(cur.nitrogen_dioxide),
            sulphur_dioxide: num(cur.sulphur_dioxide),
          })
        : hourlySnapshots(data, 1)[0] || null;

    const hourly = hourlySnapshots(data, 12);
    const daily = dailySnapshots(data, 5);

    if (!current && !hourly.length && !daily.length) {
      return {
        available: false,
        reason: "no_data",
        current: null,
        hourly: [],
        daily: [],
      };
    }

    return {
      available: true,
      source: "model",
      attribution: "Air quality forecast model",
      location: { lat, lon },
      current,
      hourly,
      daily,
      fetched_at: new Date().toISOString(),
      model_note: "US AQI from regional air-quality model; not a ground monitor.",
    };
  } catch {
    return {
      available: false,
      reason: "fetch_failed",
      current: null,
      hourly: [],
      daily: [],
    };
  }
}
