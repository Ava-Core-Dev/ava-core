const WINDOWS=[['1m','1 Minute'],['15m','15m'],['1h','1h'],['8h','8h'],['12h','12h'],['24h','24h'],['48h','48h'],['3d','3 Day'],['7d','7 Day'],['month','Month'],['year','Year'],['all','All time']];
let win='24h';
const dur=s=>{s=+s||0;return `${Math.floor(s/86400)}d ${Math.floor(s%86400/3600)}h ${Math.floor(s%3600/60)}m`};
const pct=n=>n==null?'—':`${(+n).toFixed(2)}%`;
const change=n=>n==null?'—':`${n>0?'+':''}${(+n).toFixed(2)}%`;
const label=k=>(WINDOWS.find(x=>x[0]===k)||['',k])[1];
const tl=ts=>new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(ts*1000));
function bar(){document.getElementById('timebar').innerHTML=WINDOWS.map(([k,l])=>`<button class="timebtn ${k===win?'active':''}" data-w="${k}">${l}</button>`).join('');document.querySelectorAll('[data-w]').forEach(b=>b.onclick=()=>{win=b.dataset.w;bar();load()})}
function chart(rows,period){
  const s=document.getElementById('uptimeChart'),w=1000,h=300,l=72,r=18,t=18,b=54;
  if(!rows.length){s.innerHTML='<text x="500" y="150" text-anchor="middle" fill="#93a0b5">No uptime history in selected window</text>';return}
  const vals=rows.map(x=>x.uptime_seconds).filter(Number.isFinite),hi=Math.max(...vals,1),lo=0,n=rows.length;
  const x=i=>l+(n<2?(w-l-r)/2:i*(w-l-r)/(n-1)),y=v=>h-b-(v-lo)/Math.max(1,hi-lo)*(h-t-b);
  let html=`<text x="${l-56}" y="${t+10}" fill="#93a0b5" font-size="11">UPTIME</text>`;
  for(let j=0;j<=4;j++){let yy=t+j*(h-t-b)/4,v=hi-j*hi/4;html+=`<line x1="${l}" y1="${yy}" x2="${w-r}" y2="${yy}"/><text x="${l-8}" y="${yy+4}" text-anchor="end" font-size="11" fill="#93a0b5">${dur(v)}</text>`}
  for(let j=0;j<=4;j++){let i=Math.round((n-1)*j/4),xx=x(i);html+=`<text x="${xx}" y="${h-14}" text-anchor="middle" font-size="10" fill="#93a0b5">${tl(rows[i].ts)}</text>`}
  // A zero-height red baseline segment marks an inferred offline/reset sample.
  let d='';
  rows.forEach((v,i)=>{d+=(i?' L':'M')+`${x(i)} ${v.online===false?y(0):y(v.uptime_seconds)}`});
  html+=`<path d="${d}" fill="none" stroke="#53d8ff" stroke-width="2.5"/>`;
  rows.forEach((v,i)=>{if(v.online===false)html+=`<circle cx="${x(i)}" cy="${y(0)}" r="4" fill="#ff7272"/>`});
  html+=`<text x="${w-r}" y="${t+10}" text-anchor="end" fill="#ff7272" font-size="10">● inferred offline / reset</text>`;
  s.innerHTML=html;
}
async function load(){
  try{
    const x=await fetch(`/api/uptime?window=${win}`,{cache:'no-store'}).then(r=>r.json()),u=x.history||[],p=x.periods||{},a=p[win]||{};
    const current=u.at(-1)?.uptime_seconds;
    document.getElementById('stamp').textContent=`Updated ${new Date(x.ts).toLocaleString()} · ${label(win)}`;
    document.getElementById('stats').innerHTML=`<article class="card stat"><div class="label">Current uptime</div><div class="value ok">${dur(current)}</div></article><article class="card stat"><div class="label">Availability</div><div class="value ${(a.availability_percent??0)>=99?'ok':'warn'}">${pct(a.availability_percent)}</div></article><article class="card stat"><div class="label">Offline time</div><div class="value ${(a.offline_seconds??0)>0?'warn':'ok'}">${dur(a.offline_seconds)}</div></article><article class="card stat"><div class="label">Observed online</div><div class="value">${dur(a.observed_seconds)}</div></article>`;
    document.getElementById('suite').innerHTML=`<tr><td>Online</td><td>${dur(a.observed_seconds)}</td><td>${pct(a.availability_percent)}</td><td>${dur(a.observed_seconds)}</td><td>${pct(a.availability_percent)}</td></tr><tr><td>Offline</td><td>${dur(a.offline_seconds)}</td><td>${pct(a.offline_percent)}</td><td>${dur(a.offline_seconds)}</td><td>—</td></tr>`;
    document.getElementById('periods').innerHTML=WINDOWS.map(([k,l])=>{const z=p[k]||{};return `<tr><td>${l}</td><td>${pct(z.availability_percent)}</td><td>${dur(z.average_uptime_seconds)}</td><td>${dur(z.observed_seconds)}</td><td>${dur(z.offline_seconds)}</td><td>${z.samples??0}</td><td class="change ${z.percent_change>=0?'up':z.percent_change<0?'down':'flat'}">${change(z.percent_change)}</td></tr>`}).join('');
    chart(u,a);
  }catch(e){document.getElementById('stamp').textContent='Uptime API unavailable'}
}
bar();load();setInterval(load,10000);
