const COLORS = { Primary: '#5b9cff', security: '#a78bfa', Backup: '#3dd68c' };
const ORDER = ['Primary', 'security', 'Backup'];

function fmt(n, d = 1) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toFixed(d);
}

let socChart, pwrChart, netChart;

async function load() {
  let now, hist;
  try {
    now = await fetch('/api/now').then(r => r.json());
    hist = await fetch('/api/history?hours=12').then(r => r.json());
  } catch (e) {
    document.getElementById('clock').textContent = 'API offline — is broadcast running?';
    return;
  }

  document.getElementById('clock').textContent =
    new Date(now.ts).toLocaleString() + ' UTC';

  const by = {};
  (now.enhanced || []).forEach(r => by[r.name] = r);

  // bank rollup
  let socSum = 0, socN = 0, inSum = 0, outSum = 0, solarSum = 0;
  for (const name of ORDER) {
    const r = by[name];
    if (!r) continue;
    if (r.soc_avg != null) { socSum += r.soc_avg; socN++; }
    inSum += r.in_w_avg || 0;
    outSum += r.out_w_avg || 0;
    solarSum += r.solar_w_avg || 0;
  }
  const bankSoc = socN ? (socSum / socN) : null;
  document.getElementById('bank').innerHTML = `
    <div class="card"><h2>Bank SOC</h2><div class="big">${fmt(bankSoc,1)}<span class="unit">%</span></div></div>
    <div class="card"><h2>Total in</h2><div class="big">${fmt(inSum,0)}<span class="unit"> W</span></div></div>
    <div class="card"><h2>Total out</h2><div class="big">${fmt(outSum,0)}<span class="unit"> W</span></div></div>
    <div class="card"><h2>Net</h2><div class="big">${fmt(inSum - outSum,0)}<span class="unit"> W</span></div></div>
    <div class="card"><h2>Solar</h2><div class="big">${fmt(solarSum,0)}<span class="unit"> W</span></div></div>
  `;

  // live strip
  let liveHtml = '';
  (now.live || []).forEach(r => {
    liveHtml += `<div class="live-pill"><strong>${r.name || r.sn}</strong>
      SOC ${fmt(r.soc,1)}% · in ${fmt(r.in_w,0)}W · out ${fmt(r.out_w,0)}W
      ${r.online ? '· online' : '· offline'}</div>`;
  });
  document.getElementById('live').innerHTML =
    liveHtml || '<div class="sub">no live 10s samples yet</div>';

  // device cards
  let cards = '';
  for (const name of ORDER) {
    const r = by[name];
    if (!r) continue;
    const t = r.trend || 'stable';
    cards += `
      <div class="card">
        <h2>${name}</h2>
        <div class="big">${fmt(r.soc_avg,1)}<span class="unit"> %</span></div>
        <div style="margin:.35rem 0 .65rem">
          <span class="tag ${t}">${t}</span>
          <span class="tag">${r.samples || 0} samples</span>
          <span class="tag">Δ ${fmt(r.soc_delta,2)}</span>
        </div>
        <div class="row"><span>In / Out</span><span class="vals">${fmt(r.in_w_avg,0)} / ${fmt(r.out_w_avg,0)} W</span></div>
        <div class="row"><span>Net</span><span class="vals">${fmt(r.net_w_avg,0)} W</span></div>
        <div class="row"><span>Solar</span><span class="vals">${fmt(r.solar_w_avg,0)} W</span></div>
        <div class="row"><span>Energy in / out</span><span class="vals">${fmt(r.energy_in_wh,2)} / ${fmt(r.energy_out_wh,2)} Wh</span></div>
        <div class="row"><span>Load ratio</span><span class="vals">${fmt(r.load_ratio,2)}</span></div>
        <div class="row"><span>Online</span><span class="vals">${fmt(r.online_pct,0)}%</span></div>
      </div>`;
  }
  document.getElementById('cards').innerHTML =
    cards || '<div class="sub">waiting for enhanced minute data…</div>';

  // table
  let th = `<div class="row" style="font-size:.75rem;color:var(--muted)">
    <span>name</span>
    <span class="vals">soc · in · out · net · solar · Δsoc · trend</span>
  </div>`;
  for (const name of ORDER) {
    const r = by[name];
    if (!r) continue;
    th += `<div class="row">
      <span>${name}</span>
      <span class="vals">${fmt(r.soc_avg,1)}% · ${fmt(r.in_w_avg,0)} · ${fmt(r.out_w_avg,0)} · ${fmt(r.net_w_avg,0)} · ${fmt(r.solar_w_avg,0)} · ${fmt(r.soc_delta,2)} · ${r.trend}</span>
    </div>`;
  }
  document.getElementById('table').innerHTML = th;

  buildCharts(hist.rows || []);
}

function buildCharts(rows) {
  const series = {};
  const labelsSet = new Set();
  rows.forEach(r => {
    labelsSet.add(r.minute_key);
    if (!series[r.name]) series[r.name] = { soc: {}, in: {}, out: {}, net: {} };
    series[r.name].soc[r.minute_key] = r.soc_avg;
    series[r.name].in[r.minute_key] = r.in_w_avg;
    series[r.name].out[r.minute_key] = r.out_w_avg;
    series[r.name].net[r.minute_key] = r.net_w_avg;
  });
  const labels = [...labelsSet].sort();

  const mk = (name, key, dash = false) => ({
    label: name + (key === 'out' ? ' out' : key === 'in' ? ' in' : key === 'net' ? ' net' : ''),
    data: labels.map(l => series[name]?.[key]?.[l] ?? null),
    borderColor: COLORS[name] || '#888',
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderDash: dash ? [5, 4] : [],
    pointRadius: 0,
    tension: 0.25,
  });

  const opts = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { labels: { color: '#8b95a8', boxWidth: 12 } } },
    scales: {
      x: { ticks: { color: '#8b95a8', maxTicksLimit: 10 }, grid: { color: '#1e2530' } },
      y: { ticks: { color: '#8b95a8' }, grid: { color: '#1e2530' } },
    },
  };

  if (socChart) socChart.destroy();
  if (pwrChart) pwrChart.destroy();
  if (netChart) netChart.destroy();

  socChart = new Chart(document.getElementById('socChart'), {
    type: 'line',
    data: { labels, datasets: Object.keys(series).map(n => mk(n, 'soc')) },
    options: opts,
  });
  pwrChart = new Chart(document.getElementById('pwrChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        ...Object.keys(series).map(n => mk(n, 'in')),
        ...Object.keys(series).map(n => mk(n, 'out', true)),
      ],
    },
    options: opts,
  });
  netChart = new Chart(document.getElementById('netChart'), {
    type: 'line',
    data: { labels, datasets: Object.keys(series).map(n => mk(n, 'net')) },
    options: opts,
  });
}

load();
setInterval(load, 15000);
