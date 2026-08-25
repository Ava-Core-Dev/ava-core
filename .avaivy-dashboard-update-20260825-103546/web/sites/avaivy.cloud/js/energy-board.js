const WINDOWS=[['1m','1 Minute'],['15m','15m'],['1h','1h'],['8h','8h'],['12h','12h'],['24h','24h'],['48h','48h'],['3d','3 Day'],['7d','7 Day'],['month','Month'],['year','Year'],['all','All time']];const order=['Primary','Backup'],colors={Primary:'#6aa3ff',Backup:'#51d89a'};let win='12h';const fmt=(n,d=1)=>n==null||Number.isNaN(+n)?'—':(+n).toFixed(d);const watts=n=>n==null?'—':`${fmt(n,0)} W`;const ch=n=>n==null?'—':`${n>0?'+':''}${fmt(n,2)}%`;function timeLabel(v){
  if(v==null||v==='')return '';
  const n=Number(v); const d=new Date(Number.isFinite(n)?(n>1e12?n:n*1000):v);
  return new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(d);
}
function chart(id,sets,rows,unit){
  const svg=document.getElementById(id),w=1000,h=300,pL=62,pR=18,pT=18,pB=54;
  const values=sets.flatMap(s=>s.values).filter(Number.isFinite);
  if(!values.length){svg.innerHTML='<text x="500" y="150" text-anchor="middle" fill="#93a0b5">No data in selected window</text>';return}
  let lo=Math.min(...values),hi=Math.max(...values);
  if(id==='socChart'){lo=0;hi=100}
  else if(lo>=0)lo=0;
  if(hi===lo)hi++;
  const n=Math.max(...sets.map(s=>s.values.length),1);
  const x=i=>pL+(n<2?(w-pL-pR)/2:i*(w-pL-pR)/(n-1));
  const y=v=>h-pB-(v-lo)/(hi-lo)*(h-pT-pB);
  const getTs=r=>r?.minute_ts??r?.ts??r?.bucket_key;
  let html=`<text x="${pL-46}" y="${pT+10}" fill="#93a0b5" font-size="11">${unit}</text>`;
  for(let j=0;j<=4;j++){
    const yy=pT+j*(h-pT-pB)/4,v=hi-j*(hi-lo)/4;
    html+=`<line x1="${pL}" y1="${yy}" x2="${w-pR}" y2="${yy}"/><text x="${pL-8}" y="${yy+4}" text-anchor="end" fill="#93a0b5" font-size="11">${fmt(v,unit==='%'?0:0)}</text>`;
  }
  for(let j=0;j<=4;j++){
    const i=Math.round((n-1)*j/4),xx=x(i),ts=getTs(rows?.[i]);
    html+=`<line x1="${xx}" y1="${h-pB}" x2="${xx}" y2="${h-pB+5}"/><text x="${xx}" y="${h-14}" text-anchor="middle" fill="#93a0b5" font-size="10">${timeLabel(ts)}</text>`;
  }
  for(const s of sets){
    let path='';
    s.values.forEach((v,i)=>{if(!Number.isFinite(v))return;path+=(path?' L':'M')+`${x(i).toFixed(1)} ${y(v).toFixed(1)}`});
    html+=`<path d="${path}" stroke="${s.color}" fill="none" stroke-width="2.5"/>`;
  }
  svg.innerHTML=html;
}
function bar(){document.getElementById('timebar').innerHTML=WINDOWS.map(([k,l])=>`<button class="timebtn ${k===win?'active':''}" data-w="${k}">${l}</button>`).join('');document.querySelectorAll('[data-w]').forEach(b=>b.onclick=()=>{win=b.dataset.w;bar();load()})}async function load(){try{const [now,hist]=await Promise.all([fetch('/api/energy/now',{cache:'no-store'}).then(r=>r.json()),fetch(`/api/energy/history?window=${win}`,{cache:'no-store'}).then(r=>r.json())]);const by=Object.fromEntries((now.enhanced||[]).filter(x=>order.includes(x.name)).map(x=>[x.name,x]));let soc=0,n=0,input=0,out=0,solar=0,net=0;for(const name of order){const r=by[name];if(!r)continue;if(r.soc_avg!=null){soc+=+r.soc_avg;n++}input+=+r.in_w_avg||0;out+=+r.out_w_avg||0;solar+=+r.solar_w_avg||0;net+=+r.net_w_avg||0}const bank=n?soc/n:null;document.getElementById('stamp').textContent=`Updated ${new Date(now.ts).toLocaleString()} · ${win}`;document.getElementById('rings').innerHTML=order.map(name=>{const r=by[name]||{},v=Math.max(0,Math.min(100,+r.soc_avg||0));return `<div class="ring"><div class="gauge" style="--value:${v}"><span>${fmt(r.soc_avg,0)}%</span></div><b>${name}</b><div class="muted">${r.online_pct==null?'—':fmt(r.online_pct,0)+'% online'}</div></div>`}).join('');document.getElementById('totals').innerHTML=`<div class="card stat"><div class="label">Bank average</div><div class="value">${fmt(bank)}<span class="unit">%</span></div></div><div class="card stat"><div class="label">Solar</div><div class="value">${watts(solar)}</div></div><div class="card stat"><div class="label">Input / output</div><div class="value">${fmt(input,0)}<span class="unit"> / ${fmt(out,0)} W</span></div></div><div class="card stat"><div class="label">Net power</div><div class="value">${watts(net)}</div></div>`;document.getElementById('packs').innerHTML=order.map(name=>{const r=by[name]||{};return `<article class="pack"><h2>${name}</h2><div class="big">${fmt(r.soc_avg)}<span class="unit">%</span></div><div class="row"><span>Solar</span><b>${watts(r.solar_w_avg)}</b></div><div class="row"><span>In / Out</span><b>${fmt(r.in_w_avg,0)} / ${fmt(r.out_w_avg,0)} W</b></div><div class="row"><span>Net</span><b>${watts(r.net_w_avg)}</b></div></article>`}).join('');const a=hist.aggregate||{},row=(name,key,unit='')=>{const x=a[key]||{};return `<tr><td>${name}</td><td>${fmt(x.current)}${unit}</td><td>${fmt(x.average)}${unit}</td><td>${fmt(x.total)}${unit}</td><td class="change ${x.percent_change>=0?'up':'down'}">${ch(x.percent_change)}</td></tr>`};document.getElementById('suite').innerHTML=row('State of charge','soc_avg','%')+row('Solar','solar_w_avg',' W')+row('Input','in_w_avg',' W')+row('Output','out_w_avg',' W')+row('Net','net_w_avg',' W')+row('Energy in','energy_in_wh',' Wh')+row('Energy out','energy_out_wh',' Wh');const rows=hist.rows||[],labels=[...new Set(rows.map(r=>r.minute_key))].sort(),value=(name,key)=>{const m=new Map(rows.filter(r=>r.name===name).map(r=>[r.minute_key,+r[key]]));return labels.map(l=>m.get(l))};chart('socChart',order.map(name=>({color:colors[name],values:value(name,'soc_avg')})),labels.map(minute_ts=>({minute_ts})), '%');chart('powerChart',[{color:'#53d8ff',values:labels.map(l=>rows.filter(r=>r.minute_key===l).reduce((z,r)=>z+(+r.solar_w_avg||0),0))},{color:'#51d89a',values:labels.map(l=>rows.filter(r=>r.minute_key===l).reduce((z,r)=>z+(+r.net_w_avg||0),0))}],labels.map(minute_ts=>({minute_ts})), 'W');}catch(e){document.getElementById('stamp').textContent='Energy API unavailable'}}bar();load();setInterval(load,10000);