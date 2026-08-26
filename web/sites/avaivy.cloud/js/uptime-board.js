const WINDOWS = [
  ["1m","1 Minute"],["15m","15m"],["1h","1h"],["8h","8h"],["12h","12h"],["24h","24h"],
  ["48h","48h"],["3d","3 Day"],["7d","7 Day"],["month","Month"],["year","Year"],["all","All time"]
];
const WINDOW_SEC = {
  "1m":60,"15m":900,"1h":3600,"8h":28800,"12h":43200,"24h":86400,"48h":172800,
  "3d":259200,"7d":604800,"month":30*86400,"year":365*86400,"all":null
};
let win = "12h";

const label = k => (WINDOWS.find(x => x[0] === k) || ["", k])[1];
const pct = n => n == null || Number.isNaN(+n) ? "—" : `${(+n).toFixed(2)}%`;
const change = n => n == null || Number.isNaN(+n) ? "—" : `${n > 0 ? "+" : ""}${(+n).toFixed(2)}%`;

function dur(s) {
  s = Math.max(0, Math.floor(+s || 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function timeLabel(ts, spanSec) {
  if (ts == null) return "";
  const d = new Date(Number(ts) * 1000);
  if (Number.isNaN(d.getTime())) return "";
  if (spanSec != null && spanSec <= 3600 * 6) {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(d);
  }
  if (spanSec != null && spanSec <= 86400 * 2) {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
  }
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(d);
}

function filterHistory(rows) {
  if (!rows?.length) return [];
  const sec = WINDOW_SEC[win];
  if (sec == null) return rows.slice();
  const latest = Math.max(...rows.map(r => +r.ts).filter(Number.isFinite));
  if (!Number.isFinite(latest)) return rows.slice();
  const cutoff = latest - sec;
  return rows.filter(r => +r.ts >= cutoff);
}

/**
 * Availability timeline:
 * - time-scaled X
 * - green bands where uptime advances ~1:1 with wall clock (online)
 * - gaps / resets drawn as offline
 * - cyan line = current uptime counter
 */
function chart(rows) {
  const s = document.getElementById("uptimeChart");
  if (!s) return;

  const clean = filterHistory(
    (Array.isArray(rows) ? rows : [])
      .map(x => ({ ts: Number(x?.ts), uptime_seconds: Number(x?.uptime_seconds) }))
      .filter(x => Number.isFinite(x.ts) && Number.isFinite(x.uptime_seconds))
  ).sort((a, b) => a.ts - b.ts);

  const W = 1000, H = 280, L = 70, R = 18, T = 22, B = 52;

  if (!clean.length) {
    s.innerHTML = `<text x="500" y="140" text-anchor="middle" fill="#93a0b5" font-size="13">No uptime history in selected window</text>`;
    return;
  }

  const t0 = clean[0].ts;
  const t1 = clean[clean.length - 1].ts;
  const span = Math.max(1, t1 - t0);
  const vals = clean.map(x => x.uptime_seconds);
  let lo = 0;
  let hi = Math.max(...vals, 1);

  const xAt = ts => L + ((ts - t0) / span) * (W - L - R);
  const yAt = v => H - B - ((v - lo) / (hi - lo)) * (H - T - B);

  let html = "";

  // Online segments (uptime advances with wall clock within 2x tolerance)
  for (let i = 1; i < clean.length; i++) {
    const a = clean[i - 1];
    const b = clean[i];
    const dt = b.ts - a.ts;
    if (dt <= 0) continue;
    const du = b.uptime_seconds - a.uptime_seconds;
    const online = du > 0 && du >= dt * 0.5 && du <= dt * 1.5 + 5;
    if (online) {
      const x1 = xAt(a.ts);
      const x2 = xAt(b.ts);
      html += `<rect x="${x1}" y="${T}" width="${Math.max(1, x2 - x1)}" height="${H - T - B}" fill="rgba(81,216,154,0.12)"/>`;
    } else if (du < -1) {
      // reboot / reset
      const x1 = xAt(a.ts);
      const x2 = xAt(b.ts);
      html += `<rect x="${x1}" y="${T}" width="${Math.max(1, x2 - x1)}" height="${H - T - B}" fill="rgba(255,107,107,0.15)"/>`;
    }
  }

  for (let j = 0; j <= 4; j++) {
    const yy = T + j * (H - T - B) / 4;
    const v = hi - j * (hi - lo) / 4;
    html += `<line x1="${L}" y1="${yy}" x2="${W - R}" y2="${yy}" stroke="#1c2736"/>`;
    html += `<text x="${L - 8}" y="${yy + 4}" text-anchor="end" font-size="12" fill="#93a0b5">${dur(v)}</text>`;
  }

  const tickCount = 5;
  for (let j = 0; j <= tickCount; j++) {
    const ts = t0 + (span * j) / tickCount;
    const xx = xAt(ts);
    html += `<line x1="${xx}" y1="${H - B}" x2="${xx}" y2="${H - B + 5}" stroke="#93a0b5"/>`;
    html += `<text x="${xx}" y="${H - 14}" text-anchor="middle" font-size="11" fill="#93a0b5">${timeLabel(ts, span)}</text>`;
  }
  html += `<line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="#2a3a4f" stroke-width="1.5"/>`;
  html += `<text x="${L}" y="${T - 6}" fill="#93a0b5" font-size="11">TIME SCALE · ${label(win)} · uptime (green = online)</text>`;

  let d = "";
  clean.forEach((p, i) => {
    d += (i ? " L" : "M") + `${xAt(p.ts).toFixed(1)} ${yAt(p.uptime_seconds).toFixed(1)}`;
  });
  html += `<path d="${d}" fill="none" stroke="#53d8ff" stroke-width="2.5" stroke-linejoin="round"/>`;

  s.innerHTML = html;
}

function bar() {
  const el = document.getElementById("timebar");
  if (!el) return;
  el.innerHTML = WINDOWS.map(([k, l]) =>
    `<button type="button" class="timebtn ${k === win ? "active" : ""}" data-w="${k}">${l}</button>`
  ).join("");
  el.querySelectorAll("[data-w]").forEach(b => {
    b.onclick = () => { win = b.dataset.w; bar(); load(); };
  });
}

async function load() {
  try {
    const response = await fetch(`/api/uptime?window=${encodeURIComponent(win)}`, {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const x = await response.json();

    const periods = x.periods && typeof x.periods === "object" ? x.periods : {};
    const period = x.period || periods[win] || {};
    const history = x.history || [];

    const stamp = document.getElementById("stamp");
    if (stamp) {
      stamp.textContent = `Updated ${new Date(x.ts || Date.now()).toLocaleString()} · ${label(win)} selected`;
    }

    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    set("availability", pct(period.availability_percent));
    set("online", dur(period.online_seconds));
    set("offline", dur(period.offline_seconds));
    set("current", dur(x.current_uptime_seconds ?? period.current_uptime_seconds));

    const suite = document.getElementById("suite");
    if (suite) {
      const p = period;
      suite.innerHTML = `
        <tr>
          <td>Selected window</td>
          <td>${dur(p.current_uptime_seconds)}</td>
          <td>${dur(p.average_uptime_seconds)}</td>
          <td>${dur(p.online_seconds)}</td>
          <td>${dur(p.offline_seconds)}</td>
          <td>${pct(p.availability_percent)}</td>
          <td class="change ${Number(p.percent_change) > 0 ? "up" : Number(p.percent_change) < 0 ? "down" : "flat"}">${change(p.percent_change)}</td>
        </tr>`;
    }

    const periodsBody = document.getElementById("periods");
    if (periodsBody) {
      periodsBody.innerHTML = WINDOWS.map(([k, l]) => {
        const a = periods[k] || {};
        const cls =
          Number(a.percent_change) > 0 ? "up" :
          Number(a.percent_change) < 0 ? "down" : "flat";
        return `<tr>
          <td>${l}</td>
          <td>${pct(a.availability_percent)}</td>
          <td>${dur(a.average_uptime_seconds)}</td>
          <td>${dur(a.online_seconds)}</td>
          <td>${dur(a.offline_seconds)}</td>
          <td>${a.samples ?? 0}</td>
          <td class="change ${cls}">${change(a.percent_change)}</td>
        </tr>`;
      }).join("");
    }

    chart(history);
  } catch (e) {
    console.error("Uptime board error:", e);
    const stamp = document.getElementById("stamp");
    if (stamp) stamp.textContent = "Uptime API unavailable";
  }
}

bar();
load();
setInterval(load, 10000);
