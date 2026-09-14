import { json } from "./cors";

/** Narrow env slice — avoids circular import with `router.ts`. */
export interface AqsEpaEnv {
  AQS_API_EMAIL?: string;
  AQS_API_KEY?: string;
}

/**
 * Proxies the US EPA Air Quality System (AQS) Data API for Hawaiʻi County (Big Island).
 *
 * @see https://aqs.epa.gov/aqsweb/documents/data_api.html
 *
 * Credentials are **Worker secrets** (`AQS_API_EMAIL`, `AQS_API_KEY`) from EPA signup — never
 * ship them in the mobile app. AQS is regulatory archive data (often months behind real time);
 * the response wrapper includes an AirNow pointer for current conditions.
 */

const EPA_BASE = "https://aqs.epa.gov/data/api";
/** PM2.5 (FRM/FEM), O₃, SO₂ — criteria pollutants relevant to vog / volcanic air. */
const PARAM_CODES = "88101,44201,42401";
const HI_STATE_FIPS = "15";
const HAWAII_COUNTY_FIPS = "001";

function yyyymmddUtc(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** AQS requires bdate/edate in the same calendar year. */
function rollingWindowSameYear(days: number): { bdate: string; edate: string } {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  if (start.getUTCFullYear() !== end.getUTCFullYear()) {
    start.setTime(Date.UTC(end.getUTCFullYear(), 0, 1));
  }
  return { bdate: yyyymmddUtc(start), edate: yyyymmddUtc(end) };
}

function extractRows(epa: Record<string, unknown>): unknown[] {
  const body = epa.Body;
  if (Array.isArray(body)) return body;
  const data = epa.Data;
  if (Array.isArray(data)) return data;
  return [];
}

export async function handleAqsHawaiiCountyDaily(_request: Request, env: AqsEpaEnv): Promise<Response> {
  const email = String(env.AQS_API_EMAIL || "").trim();
  const key = String(env.AQS_API_KEY || "").trim();
  if (!email || !key) {
    return json(
      {
        detail: "aqs_credentials_not_configured",
        hint: "EPA signup → set Worker secrets AQS_API_EMAIL + AQS_API_KEY (see aqs.epa.gov/data_api.html).",
      },
      503,
    );
  }

  const { bdate, edate } = rollingWindowSameYear(7);
  const u = new URL(`${EPA_BASE}/dailyData/byCounty`);
  u.searchParams.set("email", email);
  u.searchParams.set("key", key);
  u.searchParams.set("param", PARAM_CODES);
  u.searchParams.set("bdate", bdate);
  u.searchParams.set("edate", edate);
  u.searchParams.set("state", HI_STATE_FIPS);
  u.searchParams.set("county", HAWAII_COUNTY_FIPS);

  let epaRes: Response;
  try {
    epaRes = await fetch(u.toString(), {
      headers: { Accept: "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return json({ detail: "aqs_upstream_fetch_failed", message: msg.slice(0, 200) }, 502);
  }

  const text = await epaRes.text();
  let epaParsed: unknown;
  try {
    epaParsed = JSON.parse(text) as unknown;
  } catch {
    return json(
      { detail: "aqs_upstream_invalid_json", upstream_status: epaRes.status, snippet: text.slice(0, 120) },
      502,
    );
  }

  const epaObj = epaParsed && typeof epaParsed === "object" ? (epaParsed as Record<string, unknown>) : {};
  const rows = extractRows(epaObj);
  const trimmed = rows.length > 80 ? rows.slice(rows.length - 80) : rows;

  const payload = {
    schema: "rootrecord.kilauea.aqs_hawaii_daily.v1",
    epa_documentation: "https://aqs.epa.gov/aqsweb/documents/data_api.html",
    lag_notice:
      "EPA AQS holds validated regulatory data; publication often lags real-world conditions by months. This is not a live smoke or vog index.",
    current_air_hint:
      "Hourly current AQI for the Kīlauea app is served from the same Worker at GET /api/airnow/current (AirNow API proxy).",
    geography: "Hawaiʻi County (Big Island), FIPS state 15 / county 001",
    query_window: { bdate, edate, parameters: PARAM_CODES.split(",") },
    epa: epaParsed,
    rows_trimmed: trimmed,
    rows_total: rows.length,
  };

  return json(payload, 200, {
    "Cache-Control": "public, max-age=21600",
  });
}
