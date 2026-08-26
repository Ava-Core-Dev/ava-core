const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));
const n = v => v == null ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
const temp = v => v == null ? "—" : `${n(v)}°C / ${n(Number(v) * 9 / 5 + 32)}°F`;
const wind = v => v == null ? "—" : `${n(v)} km/h / ${n(Number(v) * 0.621371)} mph`;

function stat(label, value, sub = "") {
  return `<article class="weather-card stat-card"><div class="kicker">${esc(label)}</div><strong>${esc(value)}</strong><span>${esc(sub)}</span></article>`;
}

function render(d) {
  if (!d.ok) throw Error(d.error || "Weather database unavailable");
  const s = d.summary || {};
  const r = d.recent_24h || {};
  const status = document.querySelector(".status span");
  if (status) status.textContent = "DATABASE ONLINE";

  document.getElementById("stats").innerHTML = [
    stat("OBSERVATIONS", n(s.observations), "stored weather data points"),
    stat("LOCATIONS", n(s.locations), "distinct collected locations"),
    stat("PROVIDERS", n(s.providers), "distinct data providers"),
    stat("AVERAGE TEMPERATURE", temp(s.avg_temp_c), "all stored temperature points"),
    stat("AVERAGE HUMIDITY", s.avg_humidity_pct == null ? "—" : `${n(s.avg_humidity_pct)}%`, "all stored humidity points"),
    stat("AVERAGE WIND", wind(s.avg_wind_kph), "all stored wind points"),
    stat("AVERAGE PRECIPITATION", s.avg_precipitation_mm == null ? "—" : `${n(s.avg_precipitation_mm)} mm`, "points with precipitation data"),
    stat("TEMPERATURE RANGE", `${temp(s.min_temp_c)} → ${temp(s.max_temp_c)}`, "lowest to highest stored point"),
  ].join("");

  document.getElementById("coverage").textContent =
    `${n(s.observations)} observations across ${n(s.locations)} locations and ${n(s.providers)} providers · first ${s.first_observation || "—"} · latest ${s.last_observation || "—"}`;

  document.getElementById("recent").innerHTML = `
    <article class="weather-card">
      <div class="kicker">24-HOUR SAMPLE</div>
      <div class="big-number">${n(r.observations)}</div>
      <p class="muted">observations across ${n(r.locations)} locations</p>
    </article>
    <article class="weather-card">
      <div class="kicker">AVERAGES</div>
      <div class="mini-grid">
        <div><span>Temperature</span><b>${temp(r.avg_temp_c)}</b></div>
        <div><span>Humidity</span><b>${r.avg_humidity_pct == null ? "—" : n(r.avg_humidity_pct) + "%"}</b></div>
        <div><span>Wind</span><b>${wind(r.avg_wind_kph)}</b></div>
        <div><span>Precipitation</span><b>${r.avg_precipitation_mm == null ? "—" : n(r.avg_precipitation_mm) + " mm"}</b></div>
      </div>
    </article>`;

  const providers = d.providers || [];
  document.getElementById("providers").innerHTML = providers.length
    ? providers.map(p => {
        const name = p.provider || p.name || "Provider";
        const obs = p.observations ?? p.count ?? "—";
        return `<article class="weather-card region-card"><div class="kicker">PROVIDER</div><h3>${esc(name)}</h3><p>${esc(n(obs))} observations</p></article>`;
      }).join("")
    : `<article class="weather-card region-card"><p class="muted">No provider breakdown yet.</p></article>`;
}

fetch("/api/weather/aggregate", { cache: "no-store" })
  .then(r => r.json())
  .then(render)
  .catch(err => {
    const status = document.querySelector(".status span");
    if (status) status.textContent = "DATABASE OFFLINE";
    const stats = document.getElementById("stats");
    if (stats) stats.innerHTML = `<article class="weather-card"><p class="muted">${esc(err.message || "Weather API unavailable")}</p></article>`;
  });
