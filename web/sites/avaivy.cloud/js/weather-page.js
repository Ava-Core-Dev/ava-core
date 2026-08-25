const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=v=>v==null?'—':Number(v).toLocaleString(undefined,{maximumFractionDigits:2});
const temp=v=>v==null?'—':`${n(v)}°C / ${n(Number(v)*9/5+32)}°F`;
const wind=v=>v==null?'—':`${n(v)} km/h / ${n(Number(v)*.621371)} mph`;
function stat(label,value,sub=''){return `<article class="weather-card stat-card"><div class="kicker">${esc(label)}</div><strong>${esc(value)}</strong><span>${esc(sub)}</span></article>`}
let locationRows=[]; function render(d){
  if(!d.ok) throw Error(d.error||'Weather database unavailable');
  const s=d.summary||{}, r=d.recent_24h||{};
  document.querySelector('.status span').textContent='DATABASE ONLINE';
  document.getElementById('stats').innerHTML=[
    stat('OBSERVATIONS',n(s.observations),'stored weather data points'),
    stat('LOCATIONS',n(s.locations),'distinct collected locations'),
    stat('PROVIDERS',n(s.providers),'distinct data providers'),
    stat('AVERAGE TEMPERATURE',temp(s.avg_temp_c),'all stored temperature points'),
    stat('AVERAGE HUMIDITY',s.avg_humidity_pct==null?'—':`${n(s.avg_humidity_pct)}%`,'all stored humidity points'),
    stat('AVERAGE WIND',wind(s.avg_wind_kph),'all stored wind points'),
    stat('AVERAGE PRECIPITATION',s.avg_precipitation_mm==null?'—':`${n(s.avg_precipitation_mm)} mm`,'points with precipitation data'),
    stat('TEMPERATURE RANGE',`${temp(s.min_temp_c)} → ${temp(s.max_temp_c)}`,'lowest to highest stored point')
  ].join('');
  document.getElementById('coverage').textContent=`${n(s.observations)} observations across ${n(s.locations)} locations and ${n(s.providers)} providers · first ${s.first_observation||'—'} · latest ${s.last_observation||'—'}`;
  document.getElementById('recent').innerHTML=`<article class="weather-card"><div class="kicker">24-HOUR SAMPLE</div><div class="big-number">${n(r.observations)}</div><p class="muted">observations across ${n(r.locations)} locations</p></article><article class="weather-card"><div class="kicker">AVERAGES</div><div class="mini-grid"><div><span>Temperature</span><b>${temp(r.avg_temp_c)}</b></div><div><span>Humidity</span><b>${r.avg_humidity_pct==null?'—':n(r.avg_humidity_pct)+'%'}</b></div><div><span>Wind</span><b>${wind(r.avg_wind_kph)}</b></div><div><span>Precipitation</span><b>${r.avg_precipitation_mm==null?'—':n(r.avg_precipitation_mm)+' mm'}</b></div></div></article>`;
  document.getElementById('regions').innerHTML=(d.regions||[]).map(x=>`<article class="weather-card region-card"><div class="kicker">${esc(x.country_code)} · ${esc(x.admin1_code)}</div><h3>${esc(x.region)}</h3><p>${n(x.observations)} observations · ${n(x.locations)} locations</p><div class="region-stats"><span><b>${temp(x.avg_temp_c)}</b> avg temp</span><span><b>${x.avg_humidity_pct==null?'—':n(x.avg_humidity_pct)+'%'}</b> avg humidity</span><span><b>${wind(x.avg_wind_kph)}</b> avg wind</span></div></article>`).join('')||'<div class="weather-card"><p class="muted">No regional data has been collected yet.</p></div>';
  locationRows=d.locations||[]; document.getElementById('locations').innerHTML=locationRows.map(x=>`<article class="location-node"><div class="island">${esc(x.country_code)} · ${esc(x.admin1_code)} · ${esc(x.island||'Region')}</div><h3>${esc(x.name)}</h3><p>${n(x.observations)} observations · ${n(x.providers)} providers</p><div class="location-avg">${temp(x.avg_temp_c)}</div><small>Avg temperature · latest ${esc(x.last_observation||'—')}</small></article>`).join('')||'<div class="weather-card"><p class="muted">No locations have been collected yet.</p></div>';
}
async function load(){try{const r=await fetch('/api/weather/aggregate',{cache:'no-store'});if(!r.ok)throw Error(`HTTP ${r.status}`);render(await r.json())}catch(e){document.querySelector('.status span').textContent='DATABASE UNAVAILABLE';document.getElementById('stats').innerHTML=`<article class="weather-card"><h2>Weather database unavailable</h2><p class="muted">${esc(e.message)}</p></article>`}}
load();setInterval(load,300000);
const search=document.getElementById('locationSearch'); if(search) search.addEventListener('input',()=>{const q=search.value.trim().toLowerCase();document.querySelectorAll('#locations .location-node').forEach((el,i)=>{const x=locationRows[i]||{};el.style.display=!q||`${x.name||''} ${x.country_code||''} ${x.admin1_code||''} ${x.island||''}`.toLowerCase().includes(q)?'':'none'})});
