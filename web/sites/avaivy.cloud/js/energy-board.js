const WINDOWS=[['1m','1 Minute'],['15m','15m'],['1h','1h'],['8h','8h'],['12h','12h'],['24h','24h'],['48h','48h'],['3d','3 Day'],['7d','7 Day'],['month','Month'],['year','Year'],['all','All time']];
const order=['Primary','Backup'];
const colors={Primary:'#6aa3ff',Backup:'#51d89a'};
let win='12h';

const fmt=(n,d=1)=>n==null||Number.isNaN(+n)?'—':(+n).toFixed(d);
const watts=n=>n==null?'—':`${fmt(n,0)} W`;
const ch=n=>n==null?'—':`${n>0?'+':''}${fmt(n,2)}%`;

function timeLabel(v){
  if(v==null||v==='')return '';
  const n=Number(v);
  const d=new Date(Number.isFinite(n)?(n>1e12?n:n*1000):v);
  if(Number.isNaN(d.getTime()))return String(v);
  return new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(d);
}

function chart(id,sets,labels,unit=''){
  const svg=document.getElementById(id);
  if(!svg)return;

  const w=1000,h=300;
  const pL=58,pR=18,pT=18,pB=55;
  const values=sets.flatMap(s=>s.values).filter(Number.isFinite);

  if(!values.length){
    svg.innerHTML='<text x="500" y="150" text-anchor="middle" fill="#93a0b5">No data in selected window</text>';
    return;
  }

  let lo=Math.min(...values);
  let hi=Math.max(...values);
  if(lo>=0)lo=0;
  if(hi===lo)hi++;

  const n=Math.max(...sets.map(s=>s.values.length));
  const x=i=>pL+(n<2?(w-pL-pR)/2:i*(w-pL-pR)/(n-1));
  const y=v=>h-pB-(v-lo)/(hi-lo)*(h-pT-pB);

  let html='';

  for(let j=0;j<=4;j++){
    const yy=pT+j*(h-pT-pB)/4;
    const v=hi-j*(hi-lo)/4;
    html+=`<line x1="${pL}" y1="${yy}" x2="${w-pR}" y2="${yy}"/>`+
      `<text x="${pL-7}" y="${yy+4}" text-anchor="end" fill="#93a0b5" font-size="11">${fmt(v,0)}${unit}</text>`;
  }

  for(let j=0;j<=4;j++){
    const i=Math.round((n-1)*j/4);
    const xx=x(i);
    html+=`<line x1="${xx}" y1="${h-pB}" x2="${xx}" y2="${h-pB+5}"/>`+
      `<text x="${xx}" y="${h-15}" text-anchor="middle" fill="#93a0b5" font-size="11">${labels[i]||''}</text>`;
  }

  sets.forEach(s=>{
    let d='';
    s.values.forEach((v,i)=>{
      if(!Number.isFinite(v))return;
      d+=(d?' L':'M')+`${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
    });
    if(d)html+=`<path d="${d}" stroke="${s.color}" fill="none" stroke-width="2.5"/>`;
  });

  svg.innerHTML=html;
}

function bar(){
  document.getElementById('timebar').innerHTML=WINDOWS.map(([k,l])=>
    `<button class="timebtn ${k===win?'active':''}" data-w="${k}">${l}</button>`
  ).join('');

  document.querySelectorAll('#timebar [data-w]').forEach(b=>{
    b.onclick=()=>{
      win=b.dataset.w;
      bar();
      load();
    };
  });
}

function aggregateRow(name,key,unit=''){
  return (x,totalOverride)=>{
    const total=totalOverride!==undefined?totalOverride:x.total;
    const totalText=total==null?'—':`${fmt(total)}${unit}`;
    return `<tr><td>${name}</td><td>${fmt(x.current)}${unit}</td><td>${fmt(x.average)}${unit}</td><td>${totalText}</td><td class="change ${x.percent_change>=0?'up':'down'}">${ch(x.percent_change)}</td></tr>`;
  };
}

async function load(){
  try{
    const [now,hist]=await Promise.all([
      fetch('/api/energy/now',{cache:'no-store'}).then(r=>r.json()),
      fetch(`/api/energy/history?window=${encodeURIComponent(win)}`,{cache:'no-store'}).then(r=>r.json())
    ]);

    const by=Object.fromEntries(
      (now.enhanced||[])
        .filter(x=>order.includes(x.name))
        .map(x=>[x.name,x])
    );

    let soc=0,n=0,input=0,out=0,solar=0,net=0;
    for(const name of order){
      const r=by[name];
      if(!r)continue;
      if(r.soc_avg!=null){soc+=+r.soc_avg;n++;}
      input+=+r.in_w_avg||0;
      out+=+r.out_w_avg||0;
      solar+=+r.solar_w_avg||0;
      net+=+r.net_w_avg||0;
    }

    const bank=n?soc/n:null;

    document.getElementById('stamp').textContent=
      `Updated ${new Date(now.ts).toLocaleString()} · ${WINDOWS.find(x=>x[0]===win)?.[1]||win} selected`;

    document.getElementById('rings').innerHTML=order.map(name=>{
      const r=by[name]||{};
      const v=Math.max(0,Math.min(100,+r.soc_avg||0));
      return `<div class="ring"><div class="gauge" style="--value:${v}"><span>${fmt(r.soc_avg,0)}%</span></div><b>${name}</b><div class="muted">${r.online_pct==null?'—':fmt(r.online_pct,0)+'% online'}</div></div>`;
    }).join('');

    document.getElementById('totals').innerHTML=
      `<div class="card stat"><div class="label">Bank average</div><div class="value">${fmt(bank)}<span class="unit">%</span></div></div>`+
      `<div class="card stat"><div class="label">Solar</div><div class="value">${watts(solar)}</div></div>`+
      `<div class="card stat"><div class="label">Input / output</div><div class="value">${fmt(input,0)}<span class="unit"> / ${fmt(out,0)} W</span></div></div>`+
      `<div class="card stat"><div class="label">Net power</div><div class="value">${watts(net)}</div></div>`;

    document.getElementById('packs').innerHTML=order.map(name=>{
      const r=by[name]||{};
      return `<article class="pack"><h2>${name}</h2><div class="big">${fmt(r.soc_avg)}<span class="unit">%</span></div><div class="row"><span>Solar</span><b>${watts(r.solar_w_avg)}</b></div><div class="row"><span>In / Out</span><b>${fmt(r.in_w_avg,0)} / ${fmt(r.out_w_avg,0)} W</b></div><div class="row"><span>Net</span><b>${watts(r.net_w_avg)}</b></div></article>`;
    }).join('');

    const a=hist.aggregate||{};
    const powerRow=(name,key)=>{
      const x=a[key]||{};
      return `<tr><td>${name}</td><td>${fmt(x.current)} W</td><td>${fmt(x.average)} W</td><td>—</td><td class="change ${x.percent_change>=0?'up':'down'}">${ch(x.percent_change)}</td></tr>`;
    };
    const energyRow=(name,key)=>{
      const x=a[key]||{};
      return `<tr><td>${name}</td><td>${fmt(x.current)} Wh</td><td>${fmt(x.average)} Wh</td><td>${fmt(x.total)} Wh</td><td class="change ${x.percent_change>=0?'up':'down'}">${ch(x.percent_change)}</td></tr>`;
    };
    const socRow=()=>{
      const x=a.soc_avg||{};
      return `<tr><td>State of charge</td><td>${fmt(x.current)}%</td><td>${fmt(x.average)}%</td><td>—</td><td class="change ${x.percent_change>=0?'up':'down'}">${ch(x.percent_change)}</td></tr>`;
    };

    document.getElementById('suite').innerHTML=
      socRow()+
      powerRow('Solar','solar_w_avg')+
      powerRow('Input','in_w_avg')+
      powerRow('Output','out_w_avg')+
      powerRow('Net','net_w_avg')+
      energyRow('Energy in','energy_in_wh')+
      energyRow('Energy out','energy_out_wh');

    const rows=hist.rows||[];
    const labels=[...new Set(rows.map(r=>r.minute_key))].sort();
    const timeLabels=labels.map(timeLabel);

    const value=(name,key)=>{
      const m=new Map(
        rows.filter(r=>r.name===name).map(r=>[r.minute_key,Number(r[key])])
      );
      return labels.map(l=>m.get(l));
    };

    chart(
      'socChart',
      order.map(name=>({color:colors[name],values:value(name,'soc_avg')})),
      timeLabels,
      '%'
    );

    const solarByMinute=new Map();
    const netByMinute=new Map();
    for(const r of rows){
      solarByMinute.set(r.minute_key,(solarByMinute.get(r.minute_key)||0)+(+r.solar_w_avg||0));
      netByMinute.set(r.minute_key,(netByMinute.get(r.minute_key)||0)+(+r.net_w_avg||0));
    }

    chart(
      'powerChart',
      [
        {color:'#53d8ff',values:labels.map(l=>solarByMinute.get(l))},
        {color:'#51d89a',values:labels.map(l=>netByMinute.get(l))}
      ],
      timeLabels,
      ' W'
    );
  }catch(e){
    console.error('Energy dashboard error:',e);
    document.getElementById('stamp').textContent='Energy API unavailable';
  }
}

bar();
load();
setInterval(load,10000);
