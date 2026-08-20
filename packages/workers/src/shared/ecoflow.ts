/**
 * EcoFlow Open API from Cloudflare when Ava origin is offline.
 * Same HMAC as origin / Node: query params then accessKey, nonce, timestamp.
 * GET must not send Content-Type: application/json (EcoFlow 8521).
 */

const DEFAULT_BASE = "https://api-a.ecoflow.com";

export interface EcoflowEnv {
  AVA_HEARTBEAT_DB: D1Database;
  AVA_ECOFLOW_ACCESS_KEY?: string;
  AVA_ECOFLOW_SECRET_KEY?: string;
  AVA_ECOFLOW_SN?: string;
  AVA_ECOFLOW_BASE_URL?: string;
}

const SN_LABELS: Record<string, string> = {
  R331ZAB5SG6S2858: "DELTA 2",
  R621ZA16XH6K1155: "RIVER 2 Pro",
};

async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function qstring(obj: Record<string, string>): string {
  return Object.keys(obj)
    .sort()
    .map((k) => `${k}=${obj[k]}`)
    .join("&");
}

async function ecoflowGet(
  env: EcoflowEnv,
  apiPath: string,
  params: Record<string, string> = {},
): Promise<{ ok: boolean; json: any }> {
  const key = String(env.AVA_ECOFLOW_ACCESS_KEY || "").trim();
  const secret = String(env.AVA_ECOFLOW_SECRET_KEY || "").trim();
  const base = String(env.AVA_ECOFLOW_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
  if (!key || !secret) return { ok: false, json: null };

  const nonce = String(Math.floor(100000 + Math.random() * 900000));
  const timestamp = String(Date.now());
  const signHeaders = { accessKey: key, nonce, timestamp };
  const paramQs = qstring(params);
  const signStr = (paramQs ? `${paramQs}&` : "") + qstring(signHeaders);
  const sign = await hmacSha256Hex(secret, signStr);
  const url = paramQs ? `${base}${apiPath}?${paramQs}` : `${base}${apiPath}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      accessKey: key,
      nonce,
      timestamp,
      sign,
      Accept: "application/json",
      "User-Agent": "AvaIvy/2.0 (CF EcoFlow)",
    },
  });
  const json = await res.json().catch(() => null);
  const code = json?.code != null ? String(json.code) : "0";
  return { ok: res.ok && code === "0", json };
}

function num(data: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = data[k];
    if (v != null && v !== "") {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function pickSoc(data: Record<string, unknown>): number | null {
  for (const k of ["bms_bmsStatus.soc", "bmsMaster.soc", "pd.soc", "soc"]) {
    const v = num(data, k);
    if (v != null && v >= 0 && v <= 100) return Math.round(v * 10) / 10;
  }
  return null;
}

export async function ensureEcoflowTable(env: EcoflowEnv): Promise<void> {
  await env.AVA_HEARTBEAT_DB.exec(
    `CREATE TABLE IF NOT EXISTS ava_ecoflow (
      host TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      json TEXT NOT NULL
    )`,
  );
}

export async function readStoredEcoflow(env: EcoflowEnv): Promise<Record<string, unknown> | null> {
  try {
    const row = await env.AVA_HEARTBEAT_DB
      .prepare("SELECT ts, json FROM ava_ecoflow WHERE host = 'ava-core' LIMIT 1")
      .first<{ ts: string; json: string }>();
    if (!row?.json) return null;
    const parsed = JSON.parse(row.json);
    return { ...parsed, source: parsed.source || "ecoflow_cf", stored_at: row.ts };
  } catch {
    return null;
  }
}

export async function pollAndStoreEcoflow(env: EcoflowEnv): Promise<Record<string, unknown> | null> {
  const sns = String(env.AVA_ECOFLOW_SN || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!sns.length || !env.AVA_ECOFLOW_ACCESS_KEY) return null;

  await ensureEcoflowTable(env);
  const devices: Array<Record<string, unknown>> = [];
  const banks: number[] = [];
  let wattsIn = 0;
  let wattsOut = 0;
  for (const sn of sns) {
    const q = await ecoflowGet(env, "/iot-open/sign/device/quota/all", { sn });
    const data = (q.json?.data && typeof q.json.data === "object") ? q.json.data : {};
    const soc = pickSoc(data);
    const inn = num(data, "mppt.inWatts", "pd.wattsInSum", "pd.inputWatts") || 0;
    const out = num(data, "pd.outputWatts", "inv.outputWatts", "pd.wattsOutSum") || 0;
    const live = q.ok && Object.keys(data).length > 0;
    if (live && soc != null) {
      banks.push(soc);
      wattsIn += inn;
      wattsOut += out;
    }
    devices.push({
      label: SN_LABELS[sn] || sn.slice(-6),
      sn,
      soc,
      watts_in: inn,
      watts_out: out,
      online: live,
    });
  }
  const battery = banks.length ? Math.round((banks.reduce((a, b) => a + b, 0) / banks.length) * 10) / 10 : null;
  const snap = {
    battery_pct: battery,
    bank_pct: battery,
    solar_in_w: Math.round(wattsIn * 10) / 10,
    load_w: Math.round(wattsOut * 10) / 10,
    power_w: Math.round(wattsIn * 10) / 10,
    state: wattsIn > 20 ? "charging" : wattsOut > 20 ? "discharging" : "idle",
    devices,
    totals: {
      solar_in_w: Math.round(wattsIn * 10) / 10,
      load_w: Math.round(wattsOut * 10) / 10,
      net_w: Math.round((wattsIn - wattsOut) * 10) / 10,
      bank_avg_pct: battery,
      packs: devices.length,
    },
    source: "ecoflow_cf",
    updated_at: new Date().toISOString(),
  };
  await env.AVA_HEARTBEAT_DB.prepare(
    "INSERT INTO ava_ecoflow (host, ts, json) VALUES (?1, ?2, ?3) ON CONFLICT(host) DO UPDATE SET ts = excluded.ts, json = excluded.json",
  )
    .bind("ava-core", snap.updated_at, JSON.stringify(snap))
    .run();
  return snap;
}

export function solarDeskFromStored(stored: Record<string, unknown> | null): Response {
  const solar = stored || { source: "ecoflow_cf", detail: "no_snapshot" };
  return new Response(
    JSON.stringify({
      ok: true,
      solar,
      host: { host: "cloudflare-fallback" },
      weather: {},
      kilauea: {},
      shutdown: {},
    }),
    { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
  );
}
