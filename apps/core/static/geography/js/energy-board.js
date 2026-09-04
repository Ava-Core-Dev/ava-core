const WINDOWS = [
  ["1m","1 Minute"],["15m","15m"],["1h","1h"],["8h","8h"],["12h","12h"],["24h","24h"],
  ["48h","48h"],["3d","3 Day"],["7d","7 Day"],["month","Month"],["year","Year"],["all","All time"]
];
const WINDOW_SEC = {
  "1m":60,"15m":900,"1h":3600,"8h":28800,"12h":43200,"24h":86400,"48h":172800,
  "3d":259200,"7d":604800,"month":30*86400,"year":365*86400,"all":null
};
const order = ["Primary","Backup"];
const colors = { Primary: "#6aa3ff", Backup: "#51d89a" };
let win = "12h";

const fmt = (n, d=1) => n==null||Number.isNaN(+n) ? "—" : (+n).toFixed(d);
const watts = n => n==null ? "—" : `${fmt(n,0)} W`;
const ch = n => n==null ? "—" : `${n>0?"+":""}${fmt(n,2)}%`;
const label = k => (WINDOWS.find(x => x[0]===k)||["",k])[1];

function parseTs(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) return v > 1e12 ? v / 1000 : v;
  const s = String(v).trim();
  // "2026-08-25 19:13" or ISO
  const iso = s.includes("T") ? s : s.replace(" ", "T") + (s.includes("+") || s.endsWith("Z") ? "" : "Z");
  const t = Date.parse(iso);
  if (Number.isFinite(t)) return t / 1000;
  const n = Number(s);
  return Number.isFinite(n) ? (n > 1e12 ? n / 1000 : n) : null;
}

function timeLabel(ts, spanSec) {
  if (ts == null) return "";
  const d = new Date(Number(ts) * 1000);
  if (Number.isNaN(d.getTime())) return "";
  if (spanSec != null && spanSec <= 3600 * 6) {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(d);
  }
  if (spanSec != null && spanSec <= 86400 * 2) {
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric" }).format(d);
  }
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(d);
}

/** series: [{ color, values: number[] }] aligned to times[] (unix seconds) */
function chart(id, series, times, unitHint) {
  const svg = document.getElementById(id);
  if (!svg) return;
  const W = 1000, H = 300, pL = 58, pR = 22, pT = 24, pB = 48;

  const pts = [];
  for (let i = 0; i < times.length; i++) {
    const ts = times[i];
    if (!Number.isFinite(ts)) continue;
    pts.push(i);
  }

  const values = series.flatMap(s => s.values).filter(Number.isFinite);
  if (!pts.length || !values.length) {
    svg.innerHTML = `<text x="500" y="150" text-anchor="middle" fill="#93a0b5">No data in selected window</text>`;
    return;
  }

  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (unitHint === "%" && lo >= 0) lo = 0;
  if (unitHint === "%" && hi <= 100) hi = Math.max(hi, 1);
  if (lo >= 0 && unitHint !== "W") lo = Math.min(lo, 0);
  if (unitHint === "W") {
    // allow negative net
  } else if (lo > 0 && unitHint === "%") {
    lo = 0;
  }
  if (hi === lo) hi = lo + 1;

  const t0 = times[pts[0]];
  const t1 = times[pts[pts.length - 1]];
  const span = Math.max(1, t1 - t0);
  const xAt = ts => pL + ((ts - t0) / span) * (W - pL - pR);
  const yAt = v => H - pB - ((v - lo) / (hi - lo)) * (H - pT - pB);

  let html = "";
  for (let j = 0; j <= 4; j++) {
    const yy = pT + j * (H - pT - pB) / 4;
    const v = hi - j * (hi - lo) / 4;
    html += `<line x1="${pL}" y1="${yy}" x2="${W - pR}" y2="${yy}" stroke="#1c2736" stroke-width="1"/>`;
    html += `<text x="${pL - 8}" y="${yy + 4}" text-anchor="end" fill="#93a0b5" font-size="11">${fmt(v, unitHint === "%" ? 0 : 0)}</text>`;
  }

  const tickCount = 5;
  for (let j = 0; j <= tickCount; j++) {
    const ts = t0 + (span * j) / tickCount;
    const xx = xAt(ts);
    html += `<line x1="${xx}" y1="${H - pB}" x2="${xx}" y2="${H - pB + 5}" stroke="#93a0b5"/>`;
    html += `<text x="${xx}" y="${H - 14}" text-anchor="middle" fill="#93a0b5" font-size="11">${timeLabel(ts, span)}</text>`;
  }
  html += `<line x1="${pL}" y1="${H - pB}" x2="${W - pR}" y2="${H - pB}" stroke="#2a3a4f" stroke-width="1.5"/>`;
  html += `<text x="${pL}" y="${pT - 6}" fill="#93a0b5" font-size="11">TIME SCALE · ${label(win)}${unitHint ? " · " + unitHint : ""}</text>`;

  series.forEach(s => {
    let d = "";
    pts.forEach(i => {
      const v = s.values[i];
      if (!Number.isFinite(v)) return;
      const xx = xAt(times[i]);
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
    b.onclick = () => { win = b.dataset.w; bar(); load(); };
  });
}

function filterByWindow(keys, keyToTs) {
  const sec = WINDOW_SEC[win];
  if (sec == null || !keys.length) return keys;
  const times = keys.map(k => keyToTs.get(k)).filter(Number.isFinite);
  if (!times.length) return keys;
  const latest = Math.max(...times);
  const cutoff = latest - sec;
  return keys.filter(k => {
    const t = keyToTs.get(k);
    return Number.isFinite(t) && t >= cutoff;
  });
}

async function load() {
  try {
    const [now, hist] = await Promise.all([
      fetch("/api/energy/now", { cache: "no-store" }).then(r => r.json()),
      fetch(`/api/energy/history?window=${encodeURIComponent(win)}`, { cache: "no-store" }).then(r => r.json()),
    ]);

    const by = Object.fromEntries(
      (now.enhanced || []).filter(x => order.includes(x.name)).map(x => [x.name, x])
    );
    let soc = 0, n = 0, input = 0, out = 0, solar = 0, net = 0;
    for (const name of order) {
      const r = by[name];
      if (!r) continue;
      if (r.soc_avg != null) { soc += +r.soc_avg; n++; }
      input += +r.in_w_avg || 0;
      out += +r.out_w_avg || 0;
      solar += +r.solar_w_avg || 0;
      net += +r.net_w_avg || 0;
    }
    const bank = n ? soc / n : null;

    const stamp = document.getElementById("stamp");
    if (stamp) stamp.textContent = `Updated ${new Date(now.ts).toLocaleString()} · ${label(win)}`;

    const rings = document.getElementById("rings");
    if (rings) {
      rings.innerHTML = order.map(name => {
        const r = by[name] || {};
        const v = Math.max(0, Math.min(100, +r.soc_avg || 0));
        return `<div class="ring"><div class="gauge" style="--value:${v}"><span>${fmt(r.soc_avg, 0)}%</span></div><b>${name}</b><div class="muted">${r.online_pct == null ? "—" : fmt(r.online_pct, 0) + "% online"}</div></div>`;
      }).join("");
    }

    const totals = document.getElementById("totals");
    if (totals) {
      totals.innerHTML = `
        <div class="card stat"><div class="label">Bank average</div><div class="value">${fmt(bank)}<span class="unit">%</span></div></div>
        <div class="card stat"><div class="label">Solar</div><div class="value">${watts(solar)}</div></div>
        <div class="card stat"><div class="label">Input / output</div><div class="value">${fmt(input, 0)}<span class="unit"> / ${fmt(out, 0)} W</span></div></div>
        <div class="card stat"><div class="label">Net power</div><div class="value">${watts(net)}</div></div>`;
    }

    const packs = document.getElementById("packs");
    if (packs) {
      packs.innerHTML = order.map(name => {
        const r = by[name] || {};
        return `<article class="pack"><h2>${name}</h2><div class="big">${fmt(r.soc_avg)}<span class="unit">%</span></div>
          <div class="row"><span>Solar</span><b>${watts(r.solar_w_avg)}</b></div>
          <div class="row"><span>In / Out</span><b>${fmt(r.in_w_avg, 0)} / ${fmt(r.out_w_avg, 0)} W</b></div>
          <div class="row"><span>Net</span><b>${watts(r.net_w_avg)}</b></div></article>`;
      }).join("");
    }

    const a = hist.aggregate || {};
    const row = (name, key, unit = "") => {
      const x = a[key] || {};
      return `<tr><td>${name}</td><td>${fmt(x.current)}${unit}</td><td>${fmt(x.average)}${unit}</td><td>${fmt(x.total)}${unit}</td><td class="change ${x.percent_change >= 0 ? "up" : "down"}">${ch(x.percent_change)}</td></tr>`;
    };
    const suite = document.getElementById("suite");
    if (suite) {
      suite.innerHTML =
        row("State of charge", "soc_avg", "%") +
        row("Solar", "solar_w_avg", " W") +
        row("Input", "in_w_avg", " W") +
        row("Output", "out_w_avg", " W") +
        row("Net", "net_w_avg", " W") +
        row("Energy in", "energy_in_wh", " Wh") +
        row("Energy out", "energy_out_wh", " Wh");
    }

    const rows = hist.rows || [];
    const keyToTs = new Map();
    for (const r of rows) {
      const k = r.minute_key || r.bucket_key;
      if (!k || keyToTs.has(k)) continue;
      const ts = parseTs(r.ts) ?? parseTs(k);
      if (ts != null) keyToTs.set(k, ts);
    }
    let labels = [...new Set(rows.map(r => r.minute_key || r.bucket_key).filter(Boolean))].sort();
    labels = filterByWindow(labels, keyToTs);
    const times = labels.map(k => keyToTs.get(k));

    const value = (name, key) => {
      const m = new Map(
        rows.filter(r => r.name === name).map(r => [r.minute_key || r.bucket_key, +r[key]])
      );
      return labels.map(l => m.get(l));
    };

    chart(
      "socChart",
      order.map(name => ({ color: colors[name], values: value(name, "soc_avg") })),
      times,
      "%"
    );
    chart(
      "powerChart",
      [
        {
          color: "#53d8ff",
          values: labels.map(l =>
            rows.filter(r => (r.minute_key || r.bucket_key) === l).reduce((z, r) => z + (+r.solar_w_avg || 0), 0)
          ),
        },
        {
          color: "#51d89a",
          values: labels.map(l =>
            rows.filter(r => (r.minute_key || r.bucket_key) === l).reduce((z, r) => z + (+r.net_w_avg || 0), 0)
          ),
        },
      ],
      times,
      "W"
    );
  } catch (e) {
    const stamp = document.getElementById("stamp");
    if (stamp) stamp.textContent = "Energy API unavailable";
  }
}

bar();
load();
setInterval(load, 10000);
