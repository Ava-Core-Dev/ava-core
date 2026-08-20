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

function wattsOf(data: Record<string, unknown>, ...keys: string[]): number {
  const v = num(data, ...keys);
  if (v == null) return 0;
  const n = Math.abs(v) >= 10000 ? v / 1000 : v;
  return Math.max(0, Math.round(n * 10) / 10);
}

function packPower(data: Record<string, unknown>) {
  const pv = wattsOf(data, "mppt.inWatts", "mppt.pv1InWatts", "mppt.pv2InWatts");
  const acIn = wattsOf(data, "inv.inputWatts", "inv.acInWatts");
  const acOut = wattsOf(data, "inv.outputWatts", "inv.outWatts");
  const pdIn = wattsOf(data, "pd.wattsInSum", "pd.inputWatts");
  const pdOut = wattsOf(data, "pd.wattsOutSum", "pd.outputWatts");
  const usb = ["pd.usb1Watts", "pd.usb2Watts", "pd.typec1Watts", "pd.typec2Watts", "pd.carWatts"]
    .reduce((s, k) => s + wattsOf(data, k), 0);
  const dcOut = Math.max(usb, Math.max(0, pdOut - acOut));
  const acCharge = Math.max(acIn, Math.max(0, pdIn - pv));
  const discharge = Math.max(acOut, pdOut);
  return {
    pv_w: pv,
    ac_in_w: acIn,
    ac_out_w: acOut,
    ac_charge_w: Math.round(acCharge * 10) / 10,
    discharge_w: Math.round(discharge * 10) / 10,
    dc_out_w: Math.round(dcOut * 10) / 10,
    watts_in: pv,
    watts_out: Math.round(dcOut * 10) / 10,
  };
}

function isDelta(d: Record<string, unknown>): boolean {
  const sn = String(d.sn || "");
  const lab = String(d.label || "").toUpperCase();
  return sn.startsWith("R331") || lab.includes("DELTA");
}

function isRiver(d: Record<string, unknown>): boolean {
  const sn = String(d.sn || "");
  const lab = String(d.label || "").toUpperCase();
  return sn.startsWith("R621") || lab.includes("RIVER");
}

function sameWatts(a: number, b: number): boolean {
  if (a < 20 || b < 20) return false;
  return Math.abs(a - b) <= Math.max(40, 0.12 * Math.max(a, b));
}

function applyAcRoles(devices: Array<Record<string, unknown>>): void {
  for (const d of devices) {
    d.ac_role = null;
    d.transfer_sure = false;
  }
  const delta = devices.find(isDelta);
  const river = devices.find(isRiver);
  const pair = (src: Record<string, unknown>, dst: Record<string, unknown>): boolean => {
    const srcOut = Math.max(Number(src.ac_out_w || 0), Number(src.discharge_w || 0));
    const dstIn = Math.max(Number(dst.ac_in_w || 0), Number(dst.ac_charge_w || 0));
    if (!sameWatts(srcOut, dstIn)) return false;
    src.ac_role = "transfer_out";
    dst.ac_role = "transfer_in";
    src.transfer_sure = true;
    dst.transfer_sure = true;
    src.transfer_w = Math.round(srcOut * 10) / 10;
    dst.transfer_w = Math.round(dstIn * 10) / 10;
    return true;
  };
  if (delta && river && (pair(delta, river) || pair(river, delta))) return;
  for (const d of devices) {
    const aco = Number(d.ac_out_w || 0);
    const aci = Number(d.ac_in_w || 0);
    if (aco >= 1100) d.ac_role = "appliances";
    else if (aci > 20) d.ac_role = "generator";
    else if (aco > 20) d.ac_role = "ac_out";
  }
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
  for (const sn of sns) {
    const q = await ecoflowGet(env, "/iot-open/sign/device/quota/all", { sn });
    const data = (q.json?.data && typeof q.json.data === "object") ? q.json.data : {};
    const soc = pickSoc(data);
    const pwr = packPower(data);
    const live = q.ok && Object.keys(data).length > 0;
    if (live && soc != null) banks.push(soc);
    devices.push({
      label: SN_LABELS[sn] || sn.slice(-6),
      sn,
      soc,
      online: live,
      ...pwr,
    });
  }
  applyAcRoles(devices);
  const battery = banks.length ? Math.round((banks.reduce((a, b) => a + b, 0) / banks.length) * 10) / 10 : null;
  const pv = devices.reduce((s, d) => s + Number(d.pv_w || 0), 0);
  const dc = devices.reduce((s, d) => s + Number(d.dc_out_w || 0), 0);
  const acInSum = devices.reduce((s, d) => s + Number(d.ac_in_w || 0), 0);
  const acOutSum = devices.reduce((s, d) => s + Number(d.ac_out_w || 0), 0);
  const appliance = devices.reduce((s, d) => s + (d.ac_role === "appliances" ? Number(d.ac_out_w) : 0), 0);
  const transfer = devices.reduce((s, d) => s + (d.ac_role === "transfer_out" ? Number(d.transfer_w || d.ac_out_w) : 0), 0);
  const srcLab = devices.find((d) => d.ac_role === "transfer_out")?.label;
  const dstLab = devices.find((d) => d.ac_role === "transfer_in")?.label;
  const generator = devices.reduce((s, d) => s + (d.ac_role === "generator" ? Number(d.ac_in_w) : 0), 0);
  const snap = {
    battery_pct: battery,
    bank_pct: battery,
    solar_in_w: Math.round(pv * 10) / 10,
    load_w: Math.round(dc * 10) / 10,
    power_w: Math.round(pv * 10) / 10,
    state: appliance ? "appliances" : srcLab && dstLab ? `transfer ${srcLab} → ${dstLab}` : transfer ? "AC transfer" : generator ? "generator" : pv > 20 ? "PV charging" : dc > 20 ? "DC load" : "idle",
    devices,
    totals: {
      solar_in_w: Math.round(pv * 10) / 10,
      load_w: Math.round(dc * 10) / 10,
      dc_load_w: Math.round(dc * 10) / 10,
      ac_in_w: Math.round(acInSum * 10) / 10,
      ac_out_w: Math.round(acOutSum * 10) / 10,
      generator_w: Math.round(generator * 10) / 10,
      transfer_w: Math.round(transfer * 10) / 10,
      appliance_w: Math.round(appliance * 10) / 10,
      net_w: Math.round((pv - dc) * 10) / 10,
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
