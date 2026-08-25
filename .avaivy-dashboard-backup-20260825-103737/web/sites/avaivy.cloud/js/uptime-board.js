
const WINDOWS=[
 ['1m','1 Minute'],['15m','15m'],['1h','1h'],['8h','8h'],
 ['12h','12h'],['24h','24h'],['48h','48h'],['3d','3 Day'],
 ['7d','7 Day'],['month','Month'],['year','Year'],['all','All time']
];

let win='12h';

const dur=s=>{
 s=+s||0;
 const d=Math.floor(s/86400);
 const h=Math.floor(s%86400/3600);
 const m=Math.floor(s%3600/60);
 return d ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`;
};

const pct=n=>n==null?'—':`${(+n).toFixed(2)}%`;

const change=n=>n==null?'—':
 `${n>0?'+':''}${(+n).toFixed(2)}%`;

const label=k=>
 (WINDOWS.find(x=>x[0]===k)||['',k])[1];

const tl=ts=>{
 try{
  return new Intl.DateTimeFormat(undefined,{
   month:'short',
   day:'numeric',
   hour:'numeric',
   minute:'2-digit'
  }).format(new Date(ts*1000));
 }catch{
  return '—';
 }
};

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

function chart(rows,online){

 const svg=document.getElementById('uptimeChart');

 const w=1000,h=300;
 const l=70,r=18,t=22,b=58;

 if(!rows.length){
  svg.innerHTML=
   '<text x="500" y="150" text-anchor="middle" fill="#93a0b5">No uptime history</text>';
  return;
 }

 const n=rows.length;

 const x=i=>
  l+(n<2?(w-l-r)/2:i*(w-l-r)/(n-1));

 const y=v=>h-b-v*(h-t-b);

 let html='';

 [0,1].forEach(v=>{
  const yy=y(v);

  html+=
   `<line x1="${l}" y1="${yy}" x2="${w-r}" y2="${yy}"/>`+
   `<text x="${l-8}" y="${yy+4}" text-anchor="end"
      fill="#93a0b5" font-size="12">${v?'Online':'Offline'}</text>`;
 });

 for(let j=0;j<=4;j++){

  const i=Math.round((n-1)*j/4);
  const xx=x(i);

  html+=
   `<line x1="${xx}" y1="${h-b}" x2="${xx}" y2="${h-b+5}"/>`+
   `<text x="${xx}" y="${h-14}" text-anchor="middle"
      fill="#93a0b5" font-size="11">${tl(rows[i].ts)}</text>`;
 }

 let d='';

 online.forEach((v,i)=>{
  d+=(i?' L':'M')+
     `${x(i).toFixed(1)} ${y(v?1:0).toFixed(1)}`;
 });

 html+=
  `<path d="${d}" stroke="#53d8ff" fill="none"
     stroke-width="3" vector-effect="non-scaling-stroke"/>`;

 svg.innerHTML=html;
}

async function load(){

 try{

  const x=await fetch(
   `/api/uptime?window=${encodeURIComponent(win)}`,
   {cache:'no-store'}
  ).then(r=>r.json());

  const a=x.period||x.periods?.[win]||{};
  const rows=x.history||[];

  document.getElementById('stamp').textContent=
   `Updated ${new Date(x.ts).toLocaleString()} · ${label(win)} selected`;

  document.getElementById('chartWindow').textContent=label(win);

  document.getElementById('stats').innerHTML=`

   <article class="card stat">
    <div class="label">Availability</div>
    <div class="value ${(a.availability_percent??0)>=99?'ok':'warn'}">
     ${pct(a.availability_percent)}
    </div>
   </article>

   <article class="card stat">
    <div class="label">Online time</div>
    <div class="value ok">${dur(a.online_seconds)}</div>
   </article>

   <article class="card stat">
    <div class="label">Offline time</div>
    <div class="value ${a.offline_seconds?'warn':''}">
     ${dur(a.offline_seconds)}
    </div>
   </article>

   <article class="card stat">
    <div class="label">Current uptime</div>
    <div class="value">${dur(a.current_uptime_seconds)}</div>
   </article>
  `;

  document.getElementById('suite').innerHTML=`
   <tr>
    <td>${label(win)}</td>
    <td>${dur(a.current_uptime_seconds)}</td>
    <td>${dur(a.average_uptime_seconds)}</td>
    <td>${dur(a.online_seconds)}</td>
    <td>${dur(a.offline_seconds)}</td>
    <td>${pct(a.availability_percent)}</td>
    <td class="change ${
      a.percent_change>=0?'up':
      a.percent_change<0?'down':'flat'
    }">${change(a.percent_change)}</td>
   </tr>
  `;

  document.getElementById('periods').innerHTML=
   WINDOWS.map(([k,l])=>{
    const p=x.periods?.[k]||{};

    return `
     <tr>
      <td>${l}</td>
      <td>${pct(p.availability_percent)}</td>
      <td>${dur(p.average_uptime_seconds)}</td>
      <td>${dur(p.online_seconds)}</td>
      <td>${dur(p.offline_seconds)}</td>
      <td>${p.samples??0}</td>
      <td class="change ${
       p.percent_change>=0?'up':
       p.percent_change<0?'down':'flat'
      }">${change(p.percent_change)}</td>
     </tr>
    `;
   }).join('');

  chart(rows,x.online||[]);

 }catch(e){
  document.getElementById('stamp').textContent=
   'Uptime API unavailable';
 }
}

bar();
load();
setInterval(load,10000);
