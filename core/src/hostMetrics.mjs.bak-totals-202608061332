import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { storePaths } from "./store.mjs";
import { setCursorConcurrencyOverride, CURSOR_CONCURRENCY } from "./cursorBrain.mjs";

const execFileAsync = promisify(execFile);
const SAMPLES_PER_MINUTE = 60;

/** @type {Array<{ cpu: number; ram: number; disk: number }>} */
let bucket = [];
let currentMinute = minuteFloor(new Date());
let samplerTimer = null;
let samplerRunning = false;

function metricsDir() {
  const dir = path.join(storePaths().dir, "host-metrics");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function snapshotPath() {
  return path.join(metricsDir(), "snapshot.json");
}

function minutesLogPath() {
  return path.join(metricsDir(), "minutes.jsonl");
}

function daysPath() {
  return path.join(metricsDir(), "days.json");
}

function lifetimePath() {
  return path.join(metricsDir(), "lifetime.json");
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function appendJsonl(file, row) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`, "utf8");
}

function minuteFloor(d) {
  const x = new Date(d);
  x.setSeconds(0, 0);
  return x;
}

function minuteIso(d) {
  return minuteFloor(d).toISOString();
}

function dayKey(d) {
  return minuteFloor(d).toISOString().slice(0, 10);
}

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function clampPct(n) {
  return Math.max(0, Math.min(100, Number(n) || 0));
}

function workstationId() {
  return String(process.env.AVA_WORKSTATION_ID || process.env.WORKSTATION_ID || "laptop").trim() || "laptop";
}

function apiBase() {
  return String(process.env.AVA_HOST_METRICS_API_BASE || process.env.ROOTMC_API_BASE || "https://api.rootmc.net").trim();
}

function devKey() {
  return String(process.env.ROOTMC_DEV_WORKSTATION_KEY || process.env.AVA_DEV_WORKSTATION_KEY || "").trim();
}

function driveLetter() {
  return String(process.env.AVA_WORKSTATION_DRIVE || process.env.WORKSTATION_DRIVE || "D")
    .trim()
    .replace(/:$/, "")
    .toUpperCase() || "D";
}

async function sampleWindows() {
  const ps = `
$cpu = 0.0; $ram = 0.0; $disk = 0.0
try {
  $c = Get-CimInstance Win32_Processor | Select-Object -First 1
  if ($c -and $null -ne $c.LoadPercentage) { $cpu = [double]$c.LoadPercentage }
} catch {}
try {
  $os = Get-CimInstance Win32_OperatingSystem
  if ($os -and $os.TotalVisibleMemorySize -gt 0) {
    $used = [double]($os.TotalVisibleMemorySize - $os.FreePhysicalMemory)
    $ram = ($used / [double]$os.TotalVisibleMemorySize) * 100.0
  }
} catch {}
try {
  $dl = '${driveLetter()}'
  $root = $dl + ':\\'
  if (Test-Path $root) {
    $di = Get-CimInstance Win32_LogicalDisk -Filter ("DeviceID='" + $dl + ":'")
    if ($di -and $di.Size -gt 0) {
      $disk = (([double]$di.Size - [double]$di.FreeSpace) / [double]$di.Size) * 100.0
    }
  } else {
    $sys = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
    if ($sys -and $sys.Size -gt 0) {
      $disk = (([double]$sys.Size - [double]$sys.FreeSpace) / [double]$sys.Size) * 100.0
    }
  }
} catch {}
@{ Cpu = [Math]::Max(0,[Math]::Min(100,$cpu)); Ram = [Math]::Max(0,[Math]::Min(100,$ram)); Disk = [Math]::Max(0,[Math]::Min(100,$disk)) } | ConvertTo-Json -Compress
`.trim();
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", ps],
    { timeout: 8000, windowsHide: true },
  );
  const data = JSON.parse(String(stdout || "").trim());
  return {
    cpu: clampPct(data.Cpu),
    ram: clampPct(data.Ram),
    disk: clampPct(data.Disk),
  };
}

function sampleFallback() {
  const total = os.totalmem();
  const free = os.freemem();
  const ram = total > 0 ? ((total - free) / total) * 100 : 0;
  const load = os.loadavg?.()[0] || 0;
  const cpus = Math.max(1, os.cpus()?.length || 1);
  const cpu = load > 0 ? Math.min(100, (load / cpus) * 100) : 0;
  return { cpu: clampPct(cpu), ram: clampPct(ram), disk: 0 };
}

export async function captureHostMetricsSample() {
  try {
    if (process.platform === "win32") return await sampleWindows();
  } catch {
    /* fallback */
  }
  return sampleFallback();
}

function averageSamples(samples) {
  if (!samples?.length) return null;
  let cpu = 0;
  let ram = 0;
  let disk = 0;
  for (const s of samples) {
    cpu += s.cpu;
    ram += s.ram;
    disk += s.disk;
  }
  const n = samples.length;
  return {
    cpu_avg_pct: round2(cpu / n),
    ram_avg_pct: round2(ram / n),
    disk_used_pct: round2(disk / n),
    sample_count: n,
  };
}

function upsertLocalDay(minuteRow) {
  const key = dayKey(minuteRow.minute_ts);
  const days = readJson(daysPath(), { days: {} });
  const prev = days.days[key] || {
    host_key: minuteRow.host_key,
    metric_date: key,
    cpu_sum: 0,
    ram_sum: 0,
    disk_sum: 0,
    sample_total: 0,
    minute_count: 0,
  };
  const samples = Math.max(1, minuteRow.sample_count || 1);
  prev.cpu_sum += minuteRow.cpu_avg_pct * samples;
  prev.ram_sum += minuteRow.ram_avg_pct * samples;
  prev.disk_sum += minuteRow.disk_used_pct * samples;
  prev.sample_total += samples;
  prev.minute_count += 1;
  prev.updated_at = new Date().toISOString();
  days.days[key] = prev;
  days.updatedAt = Date.now();
  writeJson(daysPath(), days);
  return prev;
}

function upsertLocalLifetime(minuteRow) {
  const prev = readJson(lifetimePath(), null) || {
    host_key: minuteRow.host_key,
    cpu_sum: 0,
    ram_sum: 0,
    disk_sum: 0,
    sample_total: 0,
    minute_count: 0,
    first_minute_ts: null,
    last_minute_ts: null,
  };
  const samples = Math.max(1, minuteRow.sample_count || 1);
  prev.cpu_sum += minuteRow.cpu_avg_pct * samples;
  prev.ram_sum += minuteRow.ram_avg_pct * samples;
  prev.disk_sum += minuteRow.disk_used_pct * samples;
  prev.sample_total += samples;
  prev.minute_count += 1;
  prev.first_minute_ts = prev.first_minute_ts || minuteRow.minute_ts;
  prev.last_minute_ts = minuteRow.minute_ts;
  prev.updated_at = new Date().toISOString();
  writeJson(lifetimePath(), prev);
  return prev;
}

async function postMinuteToApi(minuteRow) {
  const key = devKey();
  if (!key) {
    return { ok: false, reason: "no_dev_key" };
  }
  const uri = `${apiBase().replace(/\/$/, "")}/api/rootmc/host-metrics/minute`;
  try {
    const res = await fetch(uri, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workstation_id: minuteRow.host_key,
        minute_ts: minuteRow.minute_ts,
        cpu_avg_pct: minuteRow.cpu_avg_pct,
        ram_avg_pct: minuteRow.ram_avg_pct,
        disk_used_pct: minuteRow.disk_used_pct,
        sample_count: minuteRow.sample_count,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, reason: `HTTP ${res.status}`, detail: text.slice(0, 120) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

async function flushBucket(samples, minuteStart) {
  const avg = averageSamples(samples);
  if (!avg) return null;
  const hostKey = workstationId();
  const minuteRow = {
    host_key: hostKey,
    host_kind: "workstation",
    minute_ts: minuteIso(minuteStart),
    ...avg,
    posted_at: new Date().toISOString(),
  };
  appendJsonl(minutesLogPath(), minuteRow);
  upsertLocalDay(minuteRow);
  const lifetime = upsertLocalLifetime(minuteRow);
  const post = await postMinuteToApi(minuteRow);
  const snap = saveHostSnapshot({
    status: "live",
    host_key: hostKey,
    current: avg,
    last_minute: minuteRow,
    lifetime,
    last_post: post,
    note: post.ok ? "minute stored + posted" : `stored locally; API ${post.reason}`,
  });
  return snap;
}

export function saveHostSnapshot(partial) {
  const prev = readJson(snapshotPath(), {});
  const next = {
    ...prev,
    ...partial,
    updatedAt: Date.now(),
    hostname: os.hostname(),
    platform: process.platform,
    cpus: os.cpus()?.length || 0,
    totalMemGb: round2(os.totalmem() / 1024 ** 3),
  };
  writeJson(snapshotPath(), next);
  try {
    applyHostPressureThrottle(next.current || next.last_minute || null);
  } catch {
    /* ignore */
  }
  return next;
}

/** High load → fewer parallel digs. Never process.exit. */
function applyHostPressureThrottle(sample) {
  if (!sample) return;
  const cpu = Number(sample.cpu_avg_pct ?? sample.cpu ?? 0);
  const ram = Number(sample.ram_avg_pct ?? sample.ram ?? 0);
  if (cpu >= 92 || ram >= 92) {
    setCursorConcurrencyOverride(1);
  } else if (cpu >= 80 || ram >= 85) {
    setCursorConcurrencyOverride(Math.max(1, Math.min(2, CURSOR_CONCURRENCY)));
  } else {
    setCursorConcurrencyOverride(null);
  }
}

export function loadHostSnapshot() {
  return readJson(snapshotPath(), null);
}

export async function refreshHostMetricsSummary() {
  const snap = loadHostSnapshot() || {};
  try {
    const res = await fetch(`${apiBase().replace(/\/$/, "")}/api/rootmc/host-metrics/summary`, {
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const data = await res.json();
      return saveHostSnapshot({
        ...snap,
        status: snap.status || "live",
        remote_summary: data,
        note: "local sampler + remote summary",
      });
    }
    return saveHostSnapshot({
      ...snap,
      status: snap.status || "local_only",
      note: `summary HTTP ${res.status}`,
    });
  } catch (err) {
    return saveHostSnapshot({
      ...snap,
      status: snap.status || "local_only",
      note: err.message,
    });
  }
}

async function sampleTick() {
  if (samplerRunning) return;
  samplerRunning = true;
  try {
    const sample = await captureHostMetricsSample();
    const nowMinute = minuteFloor(new Date());
    let flushSamples = null;
    let flushMinute = null;

    if (+nowMinute !== +currentMinute && bucket.length > 0) {
      flushSamples = [...bucket];
      flushMinute = currentMinute;
      bucket = [];
      currentMinute = nowMinute;
    }
    bucket.push(sample);
    if (bucket.length >= SAMPLES_PER_MINUTE) {
      flushSamples = [...bucket];
      flushMinute = currentMinute;
      bucket = [];
      currentMinute = nowMinute;
    }
    if (flushSamples?.length && flushMinute) {
      await flushBucket(flushSamples, flushMinute);
    } else {
      saveHostSnapshot({
        status: devKey() ? "sampling" : "sampling_local",
        host_key: workstationId(),
        current: sample,
        bucket_size: bucket.length,
        note: devKey()
          ? "sampling — posts to D1 when minute closes"
          : "sampling locally — set ROOTMC_DEV_WORKSTATION_KEY to sync",
      });
    }
  } catch (err) {
    saveHostSnapshot({ status: "error", note: err.message });
  } finally {
    samplerRunning = false;
  }
}

let summaryTimer = null;

export function startHostMetricsSampler() {
  if (samplerTimer) return;
  saveHostSnapshot({
    status: "starting",
    host_key: workstationId(),
    note: "host-metrics sampler online",
  });
  samplerTimer = setInterval(() => {
    sampleTick().catch(() => {});
  }, 1000);
  sampleTick().catch(() => {});
  if (!summaryTimer) {
    summaryTimer = setInterval(() => {
      refreshHostMetricsSummary().catch(() => {});
    }, 5 * 60_000);
    refreshHostMetricsSummary().catch(() => {});
  }
}

export function stopHostMetricsSampler() {
  if (samplerTimer) clearInterval(samplerTimer);
  if (summaryTimer) clearInterval(summaryTimer);
  samplerTimer = null;
  summaryTimer = null;
}

/** Alias for poller parity with ecoflow naming. */
export async function refreshHostMetrics() {
  return refreshHostMetricsSummary();
}

function avgFromLifetime(life) {
  if (!life?.sample_total) return null;
  const n = Math.max(1, life.sample_total);
  return {
    cpu_avg_pct: round2(life.cpu_sum / n),
    ram_avg_pct: round2(life.ram_sum / n),
    disk_used_pct: round2(life.disk_sum / n),
    minute_count: life.minute_count || 0,
    sample_total: life.sample_total,
    first_minute_ts: life.first_minute_ts,
    last_minute_ts: life.last_minute_ts,
  };
}

function readRecentMinutes(maxAgeMs = 60 * 60 * 1000) {
  const file = minutesLogPath();
  if (!fs.existsSync(file)) return [];
  const since = Date.now() - maxAgeMs;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  const rows = [];
  for (const line of lines.slice(-5000)) {
    try {
      const row = JSON.parse(line);
      const ts = Date.parse(row.minute_ts);
      if (Number.isFinite(ts) && ts >= since) rows.push(row);
    } catch {
      /* skip */
    }
  }
  return rows;
}

/**
 * Minute CPU/RAM/disk series for solar/status graphs — live sampler only.
 * @param {{ maxAgeMs?: number, limit?: number }} [opts]
 */
export function loadHostMetricsMinuteSeries(opts = {}) {
  const maxAgeMs = Number(opts.maxAgeMs ?? 8 * 3600_000);
  const limit = Math.max(12, Math.min(720, Number(opts.limit ?? 240)));
  const rows = readRecentMinutes(maxAgeMs)
    .map((row) => {
      const t = Date.parse(row.minute_ts);
      if (!Number.isFinite(t)) return null;
      return {
        t,
        minute_ts: row.minute_ts,
        cpu: round2(row.cpu_avg_pct),
        ram: round2(row.ram_avg_pct),
        disk: round2(row.disk_used_pct),
        samples: row.sample_count || 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.t - b.t)
    .slice(-limit);
  return { series: rows, sampleCount: rows.length };
}

function aggregateMinuteRows(rows) {
  if (!rows.length) return null;
  let cpu = 0;
  let ram = 0;
  let disk = 0;
  let samples = 0;
  for (const row of rows) {
    const n = Math.max(1, row.sample_count || 1);
    cpu += row.cpu_avg_pct * n;
    ram += row.ram_avg_pct * n;
    disk += row.disk_used_pct * n;
    samples += n;
  }
  return {
    cpu_avg_pct: round2(cpu / samples),
    ram_avg_pct: round2(ram / samples),
    disk_used_pct: round2(disk / samples),
    minute_count: rows.length,
    sample_total: samples,
    from: rows[0]?.minute_ts,
    to: rows[rows.length - 1]?.minute_ts,
  };
}

/** Itemized rollups for upkeep / transfer reporting. */
export function itemizeHostMetricsTimeframes() {
  const snap = loadHostSnapshot();
  const life = readJson(lifetimePath(), null);
  const days = readJson(daysPath(), { days: {} });
  const hour = aggregateMinuteRows(readRecentMinutes(60 * 60 * 1000));
  const dayKeyToday = dayKey(new Date());
  const todayRow = days.days?.[dayKeyToday] || null;
  const today = todayRow
    ? {
        cpu_avg_pct: round2(todayRow.cpu_sum / Math.max(1, todayRow.sample_total)),
        ram_avg_pct: round2(todayRow.ram_sum / Math.max(1, todayRow.sample_total)),
        disk_used_pct: round2(todayRow.disk_sum / Math.max(1, todayRow.sample_total)),
        minute_count: todayRow.minute_count,
        sample_total: todayRow.sample_total,
        metric_date: todayRow.metric_date,
      }
    : aggregateMinuteRows(readRecentMinutes(24 * 60 * 60 * 1000));

  const weekDays = Object.entries(days.days || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-7)
    .map(([date, row]) => ({
      metric_date: date,
      cpu_avg_pct: round2(row.cpu_sum / Math.max(1, row.sample_total)),
      ram_avg_pct: round2(row.ram_sum / Math.max(1, row.sample_total)),
      disk_used_pct: round2(row.disk_sum / Math.max(1, row.sample_total)),
      minute_count: row.minute_count,
    }));

  let week = null;
  if (weekDays.length) {
    let cpu = 0;
    let ram = 0;
    let disk = 0;
    let samples = 0;
    let minutes = 0;
    for (const d of weekDays) {
      const row = days.days[d.metric_date];
      samples += row.sample_total;
      minutes += row.minute_count;
      cpu += row.cpu_sum;
      ram += row.ram_sum;
      disk += row.disk_sum;
    }
    week = {
      cpu_avg_pct: round2(cpu / Math.max(1, samples)),
      ram_avg_pct: round2(ram / Math.max(1, samples)),
      disk_used_pct: round2(disk / Math.max(1, samples)),
      minute_count: minutes,
      days: weekDays,
    };
  }

  return {
    host_key: snap?.host_key || workstationId(),
    current: snap?.current || null,
    last_minute: snap?.last_minute || null,
    last_hour: hour,
    today,
    last_7_days: week,
    all_time: avgFromLifetime(life),
    day_rows: weekDays,
    synced_remote: Boolean(snap?.remote_summary?.ok),
    updatedAt: snap?.updatedAt || null,
  };
}

export function gatherHostMetricsBrief() {
  const snap = loadHostSnapshot();
  const frames = itemizeHostMetricsTimeframes();
  if (!snap && !frames.last_hour) {
    return {
      brief: `### Host metrics (Root Server)
status: starting · sampler not warmed yet
Uses automated minute buckets (same pipeline as dev-workstation host-metrics.ps1).`,
    };
  }
  const cur = frames.current;
  const hour = frames.last_hour;
  const today = frames.today;
  const all = frames.all_time;
  const lines = [
    "### Host metrics (Root Server)",
    `host: ${frames.host_key} · status: ${snap?.status || "?"} · cpus: ${snap?.cpus ?? "?"} · ram: ${snap?.totalMemGb ?? "?"} GB`,
    cur
      ? `now: CPU ${cur.cpu_avg_pct ?? cur.cpu ?? "?"}% · RAM ${cur.ram_avg_pct ?? cur.ram ?? "?"}% · disk ${cur.disk_used_pct ?? cur.disk ?? "?"}%`
      : "now: sampling…",
    hour
      ? `last hour: CPU ${hour.cpu_avg_pct}% · RAM ${hour.ram_avg_pct}% · disk ${hour.disk_used_pct}% (${hour.minute_count} min)`
      : "last hour: warming buckets",
    today
      ? `today: CPU ${today.cpu_avg_pct}% · RAM ${today.ram_avg_pct}% · disk ${today.disk_used_pct}% (${today.minute_count || "?"} min)`
      : "",
    all
      ? `all-time local: CPU ${all.cpu_avg_pct}% · RAM ${all.ram_avg_pct}% · disk ${all.disk_used_pct}% (${all.minute_count} min since ${all.first_minute_ts || "?"})`
      : "",
    frames.synced_remote ? "remote summary: synced from api.rootmc.net" : "remote summary: local-only until API key/minutes post",
    snap?.note || "",
  ].filter(Boolean);
  return { brief: lines.join("\n"), snapshot: snap, timeframes: frames };
}
