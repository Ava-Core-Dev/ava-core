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

/** Never poll or store. Not the public DELTA 2. */
const HIDDEN_SN = new Set(["R331ZAB5SG755642"]);

function normSn(sn: string): string {
  return String(sn || "").trim().toUpperCase();
}

function publicSn(sn: string): boolean {
  const key = normSn(sn);
  return Boolean(key) && Boolean(SN_LABELS[key]) && !HIDDEN_SN.has(key);
}

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

const APPLIANCE_AC_W = 1000;
const STARLINK_BAND_LO = 40;
const STARLINK_BAND_HI = 250;

function packPower(data: Record<string, unknown>) {
  const pv = wattsOf(data, "mppt.inWatts", "mppt.pv1InWatts", "mppt.pv2InWatts");
  const acIn = wattsOf(data, "inv.inputWatts", "inv.acInWatts");
  const acOut = wattsOf(data, "inv.outputWatts", "inv.outWatts");
  const pdIn = wattsOf(data, "pd.wattsInSum", "pd.inputWatts");
  const pdOut = wattsOf(data, "pd.wattsOutSum", "pd.outputWatts");
  const usb = ["pd.usb1Watts", "pd.usb2Watts", "pd.qcUsb1Watts", "pd.typec1Watts", "pd.typec2Watts"]
    .reduce((s, k) => s + wattsOf(data, k), 0);
  const car = ["pd.carWatts", "mppt.carOutWatts", "mppt.dcdc12vWatts"]
    .reduce((s, k) => s + wattsOf(data, k), 0);
  const leftover = Math.max(0, pdOut - acOut - car);
  const dcOut = Math.max(usb, leftover);
  const acCharge = Math.max(acIn, Math.max(0, pdIn - pv));
  const discharge = Math.max(acOut, pdOut);
  const dcIn = Math.max(0, pdIn - pv - acIn);
  return {
    pv_w: pv,
    ac_in_w: acIn,
    ac_out_w: acOut,
    ac_charge_w: Math.round(acCharge * 10) / 10,
    discharge_w: Math.round(discharge * 10) / 10,
    usb_w: Math.round(usb * 10) / 10,
    car_w: Math.round(car * 10) / 10,
    dc_out_w: Math.round(dcOut * 10) / 10,
    dc_in_w: Math.round(dcIn * 10) / 10,
    watts_in: pv,
    watts_out: Math.round(dcOut * 10) / 10,
  };
}

function isDelta(d: Record<string, unknown>): boolean {
  const sn = normSn(String(d.sn || ""));
  const lab = String(d.label || "").toUpperCase();
  return sn === "R331ZAB5SG6S2858" || lab === "DELTA 2";
}

function isRiver(d: Record<string, unknown>): boolean {
  const sn = normSn(String(d.sn || ""));
  const lab = String(d.label || "").toUpperCase();
  return sn === "R621ZA16XH6K1155" || lab.includes("RIVER");
}

function applyAcRoles(devices: Array<Record<string, unknown>>): void {
  for (const d of devices) {
    d.ac_role = null;
    d.transfer_sure = false;
    delete d.transfer_w;
    delete d.appliance_w;
    delete d.starlink_w;
    delete d.emergency_w;
  }
  const delta = devices.find(isDelta);
  const river = devices.find(isRiver);
  let src: Record<string, unknown> | undefined;
  let dst: Record<string, unknown> | undefined;
  let transfer = 0;
  if (delta && river) {
    const dOut = Number(delta.ac_out_w || 0);
    const rOut = Number(river.ac_out_w || 0);
    const dIn = Math.max(Number(delta.ac_in_w || 0), Number(delta.ac_charge_w || 0));
    const rIn = Math.max(Number(river.ac_in_w || 0), Number(river.ac_charge_w || 0));
    if (dOut >= 20 && rIn >= 20) {
      src = delta;
      dst = river;
      transfer = Math.min(dOut, rIn);
    } else if (rOut >= 20 && dIn >= 20) {
      src = river;
      dst = delta;
      transfer = Math.min(rOut, dIn);
    }
    if (src && dst) {
      src.ac_role = "transfer_out";
      dst.ac_role = "transfer_in";
      src.transfer_sure = true;
      dst.transfer_sure = true;
      src.transfer_w = Math.round(transfer * 10) / 10;
      dst.transfer_w = Math.round(transfer * 10) / 10;
    }
  }
  const leftover: Array<{ d: Record<string, unknown>; w: number }> = [];
  for (const d of devices) {
    const aco = Number(d.ac_out_w || 0);
    const house = d === src ? Math.max(0, aco - transfer) : aco;
    if (house < 20) continue;
    leftover.push({ d, w: house });
  }
  const kettle = leftover.filter((x) => x.w >= APPLIANCE_AC_W);
  const house = leftover.filter((x) => x.w < APPLIANCE_AC_W);
  for (const x of kettle) {
    x.d.ac_role = "appliances";
    x.d.appliance_w = Math.round(x.w * 10) / 10;
  }
  const inBand = house.filter((x) => x.w >= STARLINK_BAND_LO && x.w <= STARLINK_BAND_HI);
  let starlinkPick: Record<string, unknown> | undefined;
  if (inBand.length === 1) starlinkPick = inBand[0].d;
  else if (house.length) starlinkPick = house.reduce((a, b) => (a.w >= b.w ? a : b)).d;
  for (const x of house) {
    if (x.d === starlinkPick) {
      x.d.starlink_w = Math.round(x.w * 10) / 10;
      if (x.d.ac_role !== "transfer_out" && x.d.ac_role !== "transfer_in") {
        x.d.ac_role = "starlink_lights";
      }
    } else {
      x.d.emergency_w = Math.round(x.w * 10) / 10;
      if (x.d.ac_role !== "transfer_out" && x.d.ac_role !== "transfer_in") {
        x.d.ac_role = "emergency";
      }
    }
  }
}

function sameWatts(a: number, b: number): boolean {
  if (a < 20 || b < 20) return false;
  const slack = Math.max(40, 0.12 * Math.max(a, b));
  return Math.abs(a - b) <= slack;
}

function isNightHst(): boolean {
  const h = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Pacific/Honolulu",
      hour: "numeric",
      hourCycle: "h23",
    }).format(new Date()),
  );
  return h >= 19 || h < 6;
}

const EBATT_MIN_W = 20;
const EBATT_MAX_W = 225;
const EBATT_WH = 220;

function applyEbatt(devices: Array<Record<string, unknown>>): void {
  for (const d of devices) {
    delete d.ebatt_w;
    d.input_kind = null;
  }
  if (!devices.length || !isNightHst()) return;
  const incoming = devices.reduce((s, d) => s + Number(d.pv_w || 0), 0);
  if (incoming < EBATT_MIN_W || incoming > EBATT_MAX_W) return;
  const delta = devices.find(isDelta);
  const deltaOut = delta
    ? Math.max(Number(delta.discharge_w || 0), Number(delta.ac_out_w || 0), Number(delta.out_w || 0))
    : 0;
  if (sameWatts(incoming, deltaOut)) return;
  for (const d of devices) {
    const w = Number(d.pv_w || 0);
    if (w >= EBATT_MIN_W) {
      d.input_kind = "ebatt";
      d.ebatt_w = Math.round(w * 10) / 10;
    }
  }
}

function solarInW(devices: Array<Record<string, unknown>>): number {
  return Math.round(
    devices.reduce((s, d) => s + (d.input_kind === "ebatt" ? 0 : Number(d.pv_w || 0)), 0) * 10,
  ) / 10;
}

function ebattInW(devices: Array<Record<string, unknown>>): number {
  return Math.round(
    devices.reduce(
      (s, d) => s + (d.input_kind === "ebatt" ? Number(d.ebatt_w || d.pv_w || 0) : 0),
      0,
    ) * 10,
  ) / 10;
}

function loadCategories(devices: Array<Record<string, unknown>>) {
  let transfer = 0, appliances = 0, starlink = 0, emergency = 0, server = 0, drives = 0;
  for (const d of devices) {
    if (d.ac_role === "transfer_out") transfer += Number(d.transfer_w || 0);
    appliances += Number(d.appliance_w || 0);
    starlink += Number(d.starlink_w || 0);
    emergency += Number(d.emergency_w || 0);
    const car = Number(d.car_w || 0);
    if (car >= 5) drives += car;
    server += Math.max(0, Number(d.dc_out_w || 0));
  }
  return {
    server_mobile_w: Math.round(server * 10) / 10,
    starlink_lights_w: Math.round(starlink * 10) / 10,
    appliances_w: Math.round(appliances * 10) / 10,
    emergency_pack_w: Math.round(emergency * 10) / 10,
    hard_drives_12v_w: Math.round(drives * 10) / 10,
    transfer_w: Math.round(transfer * 10) / 10,
  };
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
    if (Array.isArray(parsed.devices)) {
      parsed.devices = parsed.devices.filter((d: { sn?: string }) => publicSn(String(d?.sn || "")));
    }
    return { ...parsed, source: parsed.source || "ecoflow_cf", stored_at: row.ts };
  } catch {
    return null;
  }
}

export async function pollAndStoreEcoflow(env: EcoflowEnv): Promise<Record<string, unknown> | null> {
  const sns = String(env.AVA_ECOFLOW_SN || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(publicSn);
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
  applyEbatt(devices);
  const cats = loadCategories(devices);
  const battery = banks.length ? Math.round((banks.reduce((a, b) => a + b, 0) / banks.length) * 10) / 10 : null;
  const solarW = solarInW(devices);
  const ebattW = ebattInW(devices);
  const inW = Math.round((solarW + ebattW) * 10) / 10;
  const dc = devices.reduce((s, d) => s + Number(d.dc_out_w || 0), 0);
  const acInSum = devices.reduce((s, d) => s + Number(d.ac_in_w || 0), 0);
  const acOutSum = devices.reduce((s, d) => s + Number(d.ac_out_w || 0), 0);
  const srcLab = devices.find((d) => d.ac_role === "transfer_out")?.label;
  const dstLab = devices.find((d) => d.ac_role === "transfer_in")?.label;
  const bits: string[] = [];
  if (cats.appliances_w >= 20) bits.push("appliances");
  if (srcLab && dstLab) bits.push(`transfer ${srcLab} → ${dstLab}`);
  else if (cats.transfer_w >= 20) bits.push("AC transfer");
  if (cats.starlink_lights_w >= 20) bits.push("Starlink + lights");
  if (cats.emergency_pack_w >= 20) bits.push("emergency pack");
  if (cats.hard_drives_12v_w >= 5) bits.push("hard drives 12V");
  if (ebattW >= 20) bits.push("E-Batt input");
  else if (solarW > 20) bits.push("PV charging");
  if (cats.server_mobile_w > 20) bits.push("server + mobile");
  const snap = {
    battery_pct: battery,
    bank_pct: battery,
    solar_in_w: solarW,
    ebatt_in_w: ebattW,
    load_w: Math.round(dc * 10) / 10,
    power_w: solarW,
    state: bits.join(" · ") || "idle",
    devices,
    totals: {
      solar_in_w: solarW,
      ebatt_in_w: ebattW,
      load_w: Math.round(dc * 10) / 10,
      dc_load_w: Math.round(dc * 10) / 10,
      ac_in_w: Math.round(acInSum * 10) / 10,
      ac_out_w: Math.round(acOutSum * 10) / 10,
      generator_w: 0,
      transfer_w: cats.transfer_w,
      appliance_w: cats.appliances_w,
      starlink_lights_w: cats.starlink_lights_w,
      emergency_pack_w: cats.emergency_pack_w,
      server_mobile_w: cats.server_mobile_w,
      hard_drives_12v_w: cats.hard_drives_12v_w,
      net_w: Math.round((inW - dc) * 10) / 10,
      bank_avg_pct: battery,
      packs: devices.length,
      categories: cats,
    },
    source: "ecoflow_cf",
    updated_at: new Date().toISOString(),
  };
  if (ebattW >= 20) {
    (snap as Record<string, unknown>).ebatt = {
      in_w: ebattW,
      nameplate_wh: EBATT_WH,
      label: "E-Batt input",
    };
    (snap as Record<string, unknown>).night_charge = {
      show: true,
      kind: "ebatt",
      title: "E-Batt input",
      detail: "Recycled Ninebot 220 Wh on the MPPT. EcoFlow calls this PV. Not solar. Nameplate only — no SOC.",
      in_w: ebattW,
      nameplate_wh: EBATT_WH,
    };
  }
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
