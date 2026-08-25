const WINDOWS=[['1m','1 Minute'],['15m','15m'],['1h','1h'],['8h','8h'],['12h','12h'],['24h','24h'],['48h','48h'],['3d','3 Day'],['7d','7 Day'],['month','Month'],['year','Year'],['all','All time']];
let win='1h';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const label=k=>(WINDOWS.find(x=>x[0]===k)||['',k])[1];
function bar(){document.getElementById('timebar').innerHTML=WINDOWS.map(([k,l])=>`<button class="timebtn ${k===win?'active':''}" data-w="${k}">${l}</button>`).join('');document.querySelectorAll('[data-w]').forEach(b=>b.onclick=()=>{win=b.dataset.w;bar();load()})}
function forecastCard(title,value,sub=''){return `<article class="card stat"><div class="label">${title}</div><div class="value">${value}</div><div class="muted">${sub}</div></article>`}
async function load(){
  try{
    const s=await fetch(`/api/status?window=${win}`,{cache:'no-store'}).then(r=>r.json()),o=s.operations||{},cr=o.pending_crons||[],ps=o.processes||[],f=o.forecast||{},a=(o.averages||{})[win]||{};
    document.getElementById('stamp').textContent=`Updated ${new Date(s.ts).toLocaleString()} · ${label(win)} selected`;
    document.getElementById('operationAverages').innerHTML=WINDOWS.map(([k,l])=>{const z=(o.averages||{})[k]||{};return `<tr><td>${l}</td><td>${Math.round(z.expected_operations??0).toLocaleString()}</td><td>${(z.average_per_hour??0).toFixed(2)}</td><td>${(z.average_per_minute??0).toFixed(3)}</td></tr>`}).join('');document.getElementById('forecast').innerHTML=forecastCard('Total Pending Operations Next Hour',f.total_pending??0,'scheduled/recurring work due in the next 60 minutes')+forecastCard('Average Processes / Hour',Math.round(a.average_per_hour??0),`expected scheduled operations · ${label(win)}`)+forecastCard('Average Processes / Minute',(a.average_per_minute??0).toFixed(2),`expected scheduled operations · ${label(win)}`)+forecastCard('Schedule Entries',f.schedule_entries??cr.length,'public scheduler inventory');
    document.getElementById('cronSummary').textContent=`${cr.filter(x=>x.enabled).length} enabled · ${cr.filter(x=>!x.enabled).length} disabled`;
    document.getElementById('crons').innerHTML=cr.map(x=>`<div class="row"><span class="${x.enabled?'ok':'warn'}">${x.enabled?'● pending':'○ disabled'}</span><code>${esc(x.path)}</code></div>`).join('')||'<div class="empty">No scheduled jobs found.</div>';
    document.getElementById('processSummary').textContent=`${ps.length} current processes`;
    document.getElementById('processes').innerHTML=ps.map(x=>`<div class="row"><span><b>${esc(x.pid)}</b> · ${esc(x.elapsed)} · ${esc(x.name)}</span><code class="muted" style="max-width:68%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(x.command)}">${esc(x.command)}</code></div>`).join('')||'<div class="empty">No process data.</div>';
    document.getElementById('directory').textContent=s.directory?.enabled?'ON':'OFF';
    document.getElementById('energy').textContent=s.energy?.error?'ERROR':`${(s.energy?.units||[]).length} PACKS`;
  }catch(e){document.getElementById('stamp').textContent='Status API unavailable'}
}
bar();load();setInterval(load,10000);
