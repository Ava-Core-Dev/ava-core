const WINDOWS = [
  ["1m","1 Minute"],["15m","15m"],["1h","1h"],["8h","8h"],["12h","12h"],["24h","24h"],
  ["48h","48h"],["3d","3 Day"],["7d","7 Day"],["month","Month"],["year","Year"],["all","All time"]
];
const WINDOW_SEC = {
  "1m":60,"15m":900,"1h":3600,"8h":28800,"12h":43200,"24h":86400,"48h":172800,
  "3d":259200,"7d":604800,"month":30*86400,"year":365*86400,"all":null
};
let win = "12h";

const fmt = (n,d=1) => n==null||Number.isNaN(+n) ? "—" : (+n).toFixed(d);
const num = n => n==null ? "—" : Number(n).toLocaleString(undefined,{maximumFractionDigits:1});
const pct = s => s?.percent?.mean;
const duration = s => {
  s = +s || 0;
  return `${Math.floor(s/86400)}d ${Math.floor(s%86400/3600)}h ${Math.floor(s%3600/60)}m`;
};
const ch = n => n==null ? "—" : `${n>0?"+":""}${fmt(n,2)}%`;
const label = k => (WINDOWS.find(x => x[0]===k) || ["",k])[1];

function timeLabel(ts, spanSec) {
  if (ts == null || ts === "") return "";
  const d = new Date(Number(ts) * 1000);
  if (Number.isNaN(d.getTime())) return "";
  // Short windows: time only; longer: date + time
  if (spanSec != null && spanSec <= 3600 * 6) {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(d);
  }
  if (spanSec != null && spanSec <= 86400 * 2) {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric" }).format(d);
  }
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(d);
}

/** Keep only samples inside the selected window (client-side guard). */
function filterRows(rows, windowKey) {
  if (!rows?.length) return [];
  const sec = WINDOW_SEC[windowKey];
  if (sec == null) return rows.slice();
  const latest = Math.max(...rows.map(r => +r.minute_ts).filter(Number.isFinite));
  if (!Number.isFinite(latest)) return rows.slice();
  const cutoff = latest - sec;
  return rows.filter(r => +r.minute_ts >= cutoff);
}

/**
 * Time-scaled SVG chart.
 * X positions from real minute_ts, not array index — so shorter windows zoom in.
 */
function chart(id, series, rows) {
  const svg = document.getElementById(id);
  if (!svg) return;
  const W = 1000, H = 300, pL = 62, pR = 24, pT = 22, pB = 48;

  const points = [];
  for (const row of rows || []) {
    const ts = +row.minute_ts;
    if (!Number.isFinite(ts)) continue;
    points.push(row);
  }

  const values = series.flatMap(s => s.values).filter(Number.isFinite);
  if (!points.length || !values.length) {
    svg.innerHTML = `<text x="500" y="150" text-anchor="middle" fill="#93a0b5">No data in selected window</text>`;
    return;
  }

  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo >= 0) lo = 0;
  if (hi === lo) hi = lo + 1;

  const t0 = +points[0].minute_ts;
  const t1 = +points[points.length - 1].minute_ts;
  const span = Math.max(1, t1 - t0);

  const xAt = ts => pL + ((ts - t0) / span) * (W - pL - pR);
  const yAt = v => H - pB - ((v - lo) / (hi - lo)) * (H - pT - pB);

  let html = "";

  // Horizontal grid + Y labels
  for (let j = 0; j <= 4; j++) {
    const yy = pT + j * (H - pT - pB) / 4;
    const v = hi - j * (hi - lo) / 4;
    html += `<line x1="${pL}" y1="${yy}" x2="${W - pR}" y2="${yy}" stroke="#1c2736" stroke-width="1"/>`;
    html += `<text x="${pL - 8}" y="${yy + 4}" text-anchor="end" fill="#93a0b5" font-size="12">${num(v)}</text>`;
  }

  // Time scale ticks (5 evenly spaced in time)
  const tickCount = 5;
  for (let j = 0; j <= tickCount; j++) {
    const ts = t0 + (span * j) / tickCount;
    const xx = xAt(ts);
    html += `<line x1="${xx}" y1="${H - pB}" x2="${xx}" y2="${H - pB + 5}" stroke="#93a0b5" stroke-width="1"/>`;
    html += `<text x="${xx}" y="${H - 14}" text-anchor="middle" fill="#93a0b5" font-size="11">${timeLabel(ts, span)}</text>`;
  }

  // Axis baseline
  html += `<line x1="${pL}" y1="${H - pB}" x2="${W - pR}" y2="${H - pB}" stroke="#2a3a4f" stroke-width="1.5"/>`;
  html += `<text x="${pL}" y="${pT - 4}" fill="#93a0b5" font-size="11">TIME SCALE · ${label(win)}</text>`;

  // Series paths — align values to rows by index
  series.forEach((s, si) => {
    let d = "";
    points.forEach((row, i) => {
      const v = s.values[i];
      if (!Number.isFinite(v)) return;
      const xx = xAt(+row.minute_ts);
      const yy = yAt(v);
      d += (d ? " L" : "M") + `${xx.toFixed(1)} ${yy.toFixed(1)}`;
    });
    if (d) {
      html += `<path d="${d}" stroke="${s.color}" fill="none" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>`;
    }
  });

  svg.innerHTML = html;
}

function bar() {
  const el = document.getElementById("timebar");
  if (!el) return;
  el.innerHTML = WINDOWS.map(([k, l]) =>
    `<button type="button" class="timebtn ${k === win ? "active" : ""}" data-w="${k}">${l}</button>`
  ).join("");
  el.querySelectorAll("[data-w]").forEach(b => {
    b.onclick = () => {
      win = b.dataset.w;
      bar();
      load();
    };
  });
}

async function load() {
  try {
    const [now, hist] = await Promise.all([
      fetch(`/api/system/now?window=${encodeURIComponent(win)}`, { cache: "no-store" }).then(r => r.json()),
      fetch(`/api/system/history?window=${encodeURIComponent(win)}`, { cache: "no-store" }).then(r => r.json()),
    ]);

    const rawRows = hist.rows || [];
    const rows = filterRows(rawRows, win);

    const cpu = pct(now.cpu);
    const memory = pct(now.memory);
    const net = now.network || {};
    const up = now.uptime || {};
    const agg = hist.aggregate || {};

    const stamp = document.getElementById("stamp");
    if (stamp) {
      stamp.textContent = `Updated ${new Date(now.ts).toLocaleString()} · ${label(win)} selected · ${rows.length} samples`;
    }

    const stats = document.getElementById("stats");
    if (stats) {
      stats.innerHTML = `
        <div class="card stat"><div class="label">CPU current</div><div class="value">${fmt(cpu)}<span class="unit">%</span></div></div>
        <div class="card stat"><div class="label">Memory current</div><div class="value">${fmt(memory)}<span class="unit">%</span></div></div>
        <div class="card stat"><div class="label">Receive current</div><div class="value">${fmt((net.recv_bps || 0) / 1024, 1)}<span class="unit"> KB/s</span></div></div>
        <div class="card stat"><div class="label">Current uptime</div><div class="value">${duration(up.current_uptime_seconds)}</div></div>`;
    }

    const row = (name, key, unit = "") => {
      const a = agg[key] || {};
      return `<tr><td>${name}</td><td>${num(a.current)}${unit}</td><td>${num(a.average)}${unit}</td><td>${num(a.total)}${unit}</td><td>${num(a.min)}${unit} / ${num(a.max)}${unit}</td><td class="change ${a.percent_change >= 0 ? "up" : "down"}">${ch(a.percent_change)}</td></tr>`;
    };
    const suite = document.getElementById("suite");
    if (suite) {
      suite.innerHTML =
        row("CPU", "cpu", "%") +
        row("Memory", "memory", "%") +
        row("Receive", "recv_bps", " B/s") +
        row("Send", "sent_bps", " B/s");
    }

    const collection = document.getElementById("collection");
    if (collection) {
      collection.innerHTML = `
        <div class="row"><span>Samples</span><b>${rows.length}</b></div>
        <div class="row"><span>Cadence</span><b>60 sec</b></div>
        <div class="row"><span>Selected range</span><b>${label(win)}</b></div>
        <div class="row"><span>Source</span><b>system-1min.db</b></div>`;
    }

    const ur = now.uptime_periods?.[win] || {};
    const uptime = document.getElementById("uptime");
    if (uptime) {
      uptime.innerHTML = `
        <div class="big ok">${duration(up.current_uptime_seconds)}</div>
        <div class="row"><span>Availability</span><b>${fmt(ur.availability_percent, 2)}%</b></div>
        <div class="row"><span>Observed</span><b>${duration(ur.observed_seconds)}</b></div>
        <div class="row"><span>Change</span><b>${ch(ur.percent_change)}</b></div>`;
    }

    chart("resourceChart", [
      { color: "#6aa3ff", values: rows.map(r => pct(r.cpu)) },
      { color: "#53d8ff", values: rows.map(r => pct(r.memory)) },
    ], rows);

    chart("networkChart", [
      { color: "#51d89a", values: rows.map(r => (r.recv_bps || 0) / 1024) },
      { color: "#b597ff", values: rows.map(r => (r.sent_bps || 0) / 1024) },
    ], rows);
  } catch (e) {
    const stamp = document.getElementById("stamp");
    if (stamp) stamp.textContent = "System API unavailable";
  }
}

bar();
load();
setInterval(load, 10000);
