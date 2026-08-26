const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[c]));
const n = v => v == null || Number.isNaN(+v) ? "—" : Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
const temp = v => v == null || Number.isNaN(+v) ? "—" : `${n(v)}°C / ${n(Number(v) * 9 / 5 + 32)}°F`;
const wind = v => v == null || Number.isNaN(+v) ? "—" : `${n(v)} km/h / ${n(Number(v) * 0.621371)} mph`;

function isHawaiiLoc(loc) {
  const code = String(loc.admin1_code || loc.admin1 || "").toUpperCase();
  const region = String(loc.region || loc.island || "").toLowerCase();
  const name = String(loc.name || "").toLowerCase();
  if (code === "HI") return true;
  if (["oʻahu", "oahu", "hawaiʻi", "hawaii", "maui", "kauaʻi", "kauai", "molokaʻi", "molokai", "lānaʻi", "lanai"].some(x => region.includes(x))) return true;
  return false;
}

function stat(label, value, sub = "") {
  return `<article class="weather-card stat-card"><div class="kicker">${esc(label)}</div><strong>${esc(value)}</strong><span>${esc(sub)}</span></article>`;
}

function avg(nums) {
  const vals = nums.filter(v => v != null && !Number.isNaN(+v)).map(Number);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function sum(nums) {
  return nums.filter(v => v != null && !Number.isNaN(+v)).map(Number).reduce((a, b) => a + b, 0);
}

function renderLocations(list) {
  const root = document.getElementById("hiLocations");
  if (!list.length) {
    root.innerHTML = `<div class="hi-loc-empty muted">No Hawaiʻi locations with stored observations yet.</div>`;
    return;
  }
  // Sort: island then name
  const sorted = [...list].sort((a, b) => {
    const ia = String(a.island || a.region || "").localeCompare(String(b.island || b.region || ""));
    if (ia) return ia;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
  root.innerHTML = `<ul class="hi-loc-list">` + sorted.map(loc => {
    const island = loc.island || loc.region || "Hawaiʻi";
    const href = loc.slug
      ? `/weather/united-states/hawaii/${esc(loc.slug)}/`
      : `/states/hawaii/`;
    const hum = loc.avg_humidity_pct == null ? "—" : n(loc.avg_humidity_pct) + "%";
    const precip = loc.avg_precipitation_mm == null ? "—" : n(loc.avg_precipitation_mm) + " mm";
    return `<li class="hi-loc-row">
      <a class="hi-loc-name" href="${href}"><span class="hi-loc-island">${esc(island)}</span><strong>${esc(loc.name || "Location")}</strong></a>
      <span class="hi-loc-metric" title="Average temperature">${temp(loc.avg_temp_c)}</span>
      <span class="hi-loc-metric muted" title="Humidity">${hum}</span>
      <span class="hi-loc-metric muted" title="Wind">${wind(loc.avg_wind_kph)}</span>
      <span class="hi-loc-metric muted" title="Observations">${esc(n(loc.observations))} obs</span>
    </li>`;
  }).join("") + `</ul>`;
}

async function load() {
  const status = document.querySelector(".status span");
  try {
    const [agg, state] = await Promise.all([
      fetch("/api/weather/aggregate", { cache: "no-store" }).then(r => r.json()),
      fetch("/api/states/hawaii", { cache: "no-store" }).then(r => r.json()).catch(() => null),
    ]);

    if (!agg.ok) throw Error(agg.error || "Weather aggregate unavailable");
    if (status) status.textContent = "DATABASE ONLINE";

    const regions = (agg.regions || []).filter(r =>
      String(r.admin1_code || "").toUpperCase() === "HI" ||
      String(r.country_code || "").toUpperCase() === "US" && ["oʻahu","hawaii","maui","kauaʻi","molokaʻi","lānaʻi","oahu","kauai","molokai","lanai"].some(x => String(r.region || "").toLowerCase().includes(x))
    );
    const locations = (agg.locations || []).filter(isHawaiiLoc);
    allLocations = locations;

    const obs = sum(locations.map(l => l.observations));
    const locCount = locations.length;
    const avgTemp = avg(locations.map(l => l.avg_temp_c));
    const avgHum = avg(locations.map(l => l.avg_humidity_pct));
    const avgWind = avg(locations.map(l => l.avg_wind_kph));
    const avgPrecip = avg(locations.map(l => l.avg_precipitation_mm));

    document.getElementById("hiStats").innerHTML = [
      stat("OBSERVATIONS", n(obs || regions.reduce((z, r) => z + (r.observations || 0), 0)), "Hawaiʻi stored data points"),
      stat("LOCATIONS", n(locCount), "monitored Hawaiʻi places"),
      stat("ISLANDS / REGIONS", n(regions.length), "regional groups with data"),
      stat("AVERAGE TEMPERATURE", temp(avgTemp), "across Hawaiʻi locations"),
      stat("AVERAGE HUMIDITY", avgHum == null ? "—" : `${n(avgHum)}%`, "across Hawaiʻi locations"),
      stat("AVERAGE WIND", wind(avgWind), "across Hawaiʻi locations"),
      stat("AVERAGE PRECIPITATION", avgPrecip == null ? "—" : `${n(avgPrecip)} mm`, "points with precipitation"),
      stat("PROVIDERS", n(agg.summary?.providers), "global provider count in store"),
    ].join("");

    // Live reference from /api/states/hawaii
    const w = state?.weather || {};
    const cur = w.current || {};
    const daily = w.daily || {};
    const liveRoot = document.getElementById("hiLive");
    if (cur && (cur.temperature_2m != null || cur.temperature_c != null || cur.temp_c != null)) {
      const t = cur.temperature_2m ?? cur.temperature_c ?? cur.temp_c;
      const rh = cur.relative_humidity_2m ?? cur.humidity_pct ?? cur.humidity;
      const ws = cur.wind_speed_10m ?? cur.wind_kph ?? cur.wind;
      const rain = cur.rain ?? cur.precipitation ?? cur.precipitation_mm;
      liveRoot.innerHTML = `
        <article class="weather-card">
          <div class="kicker">NOW</div>
          <div class="weather-temp">${temp(t)}</div>
          <p class="weather-feels">Humidity ${rh == null ? "—" : n(rh) + "%"} · Wind ${wind(ws)}</p>
          <div class="mini-grid" style="margin-top:14px">
            <div><span>Rain / precip</span><b>${rain == null ? "—" : n(rain) + " mm"}</b></div>
            <div><span>Source</span><b>Hawaiʻi state feed</b></div>
          </div>
        </article>
        <article class="weather-card">
          <div class="kicker">TODAY</div>
          <div class="mini-grid">
            <div><span>High</span><b>${temp(daily.temperature_2m_max?.[0] ?? daily.high_c)}</b></div>
            <div><span>Low</span><b>${temp(daily.temperature_2m_min?.[0] ?? daily.low_c)}</b></div>
            <div><span>Sunrise</span><b>${esc(daily.sunrise?.[0] || daily.sunrise || "—")}</b></div>
            <div><span>Sunset</span><b>${esc(daily.sunset?.[0] || daily.sunset || "—")}</b></div>
          </div>
        </article>`;
    } else {
      liveRoot.innerHTML = `<article class="weather-card"><div class="kicker">LIVE REFERENCE</div><p class="muted">State live feed unavailable — island and location averages below still reflect the collected database.</p></article>`;
    }

    document.getElementById("hiRegions").innerHTML = regions.length
      ? regions.map(r => `
          <article class="weather-card region-card">
            <div class="kicker">REGION</div>
            <h3>${esc(r.region || "Region")}</h3>
            <p>${esc(n(r.observations))} obs · ${esc(n(r.locations))} locations</p>
            <div class="region-stats">
              <span>Temp <b>${temp(r.avg_temp_c)}</b></span>
              <span>Humidity <b>${r.avg_humidity_pct == null ? "—" : n(r.avg_humidity_pct) + "%"}</b></span>
              <span>Wind <b>${wind(r.avg_wind_kph)}</b></span>
              <span>Precip <b>${r.avg_precipitation_mm == null ? "—" : n(r.avg_precipitation_mm) + " mm"}</b></span>
            </div>
          </article>`).join("")
      : `<article class="weather-card region-card"><p class="muted">No island-level regions in the aggregate yet.</p></article>`;

    renderLocations(locations);

    const search = document.getElementById("hiSearch");
    if (search) {
      search.oninput = () => {
        const q = search.value.trim().toLowerCase();
        renderLocations(!q ? allLocations : allLocations.filter(l =>
          [l.name, l.island, l.region].some(x => String(x || "").toLowerCase().includes(q))
        ));
      };
    }
  } catch (err) {
    if (status) status.textContent = "DATA UNAVAILABLE";
    document.getElementById("hiStats").innerHTML =
      `<article class="weather-card"><p class="muted">${esc(err.message || "Failed to load Hawaiʻi weather")}</p></article>`;
  }
}

let allLocations = [];
load();
setInterval(load, 60000);
