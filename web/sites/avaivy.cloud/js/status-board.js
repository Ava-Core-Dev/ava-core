
const WINDOWS=[
 ['1m','1 Minute'],['15m','15m'],['1h','1h'],['8h','8h'],
 ['12h','12h'],['24h','24h'],['48h','48h'],['3d','3 Day'],
 ['7d','7 Day'],['month','Month'],['year','Year'],['all','All time']
];

let win='1h';

const esc=s=>String(s??'').replace(
 /[&<>"']/g,
 c=>({
  '&':'&amp;',
  '<':'&lt;',
  '>':'&gt;',
  '"':'&quot;',
  "'":'&#39;'
 }[c])
);

const label=k=>
 (WINDOWS.find(x=>x[0]===k)||['',k])[1];

const num=n=>
 n==null?'—':
 Number(n).toLocaleString(undefined,{maximumFractionDigits:2});

function bar(){

 document.getElementById('timebar').innerHTML=
  WINDOWS.map(([k,l])=>
   `<button class="timebtn ${k===win?'active':''}" data-w="${k}">${l}</button>`
  ).join('');

 document.querySelectorAll('[data-w]').forEach(b=>{
  b.onclick=()=>{
   win=b.dataset.w;
   bar();
   load();
  };
 });
}

async function load(){

 try{

  const s=await fetch(
   `/api/status?window=${encodeURIComponent(win)}`,
   {cache:'no-store'}
  ).then(r=>r.json());

  const o=s.operations||{};
  const cr=o.pending_crons||[];
  const ps=o.processes||[];
  const r=o.rates||{};

  document.getElementById('stamp').textContent=
   `Updated ${new Date(s.ts).toLocaleString()} · ${label(win)} selected`;

  document.getElementById('metrics').innerHTML=`

   <article class="card stat">
    <div class="label">Total Pending Operations Next Hour</div>
    <div class="value">${num(r.next_hour)}</div>
   </article>

   <article class="card stat">
    <div class="label">Average Processes / Hour</div>
    <div class="value">${num(r.avg_per_hour)}</div>
   </article>

   <article class="card stat">
    <div class="label">Average Processes / Minute</div>
    <div class="value">${num(r.avg_per_minute)}</div>
   </article>

   <article class="card stat">
    <div class="label">Current Processes</div>
    <div class="value">${num(ps.length)}</div>
   </article>
  `;

  document.getElementById('cronSummary').textContent=
   `${cr.filter(x=>x.enabled).length} enabled · `+
   `${cr.filter(x=>!x.enabled).length} disabled · `+
   `${num(r.next_hour)} due in next hour`;

  document.getElementById('crons').innerHTML=
   cr.map(x=>`
    <div class="row">
     <span class="${x.enabled?'ok':'warn'}">
      ${x.enabled?'● pending':'○ disabled'}
     </span>
     <code>${esc(x.path)}</code>
     <span class="muted">${esc(x.next_due_label||'')}</span>
    </div>
   `).join('') ||
   '<div class="empty">No scheduled jobs found.</div>';

  document.getElementById('processSummary').textContent=
   `${ps.length} current processes`;

  document.getElementById('processes').innerHTML=
   ps.map(x=>`
    <div class="row">
     <span>
      <b>${esc(x.pid)}</b> ·
      ${esc(x.elapsed)} ·
      ${esc(x.name)}
     </span>

     <code class="muted"
       style="max-width:68%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
       title="${esc(x.command)}">
       ${esc(x.command)}
     </code>
    </div>
   `).join('') ||
   '<div class="empty">No process data.</div>';

  document.getElementById('rates').innerHTML=
   WINDOWS.map(([k,l])=>{
    const x=o.windows?.[k]||{};

    return `
     <tr>
      <td>${l}</td>
      <td>${num(x.avg_per_minute)}</td>
      <td>${num(x.avg_per_hour)}</td>
      <td>${num(x.next_hour)}</td>
     </tr>
    `;
   }).join('');

 }catch(e){

  document.getElementById('stamp').textContent=
   'Status API unavailable — check broadcast /api/status';
 }
}

bar();
load();
setInterval(load,10000);
