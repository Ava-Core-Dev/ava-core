const WINDOWS=[
  ["1m","1 Minute"],
  ["15m","15m"],
  ["1h","1h"],
  ["8h","8h"],
  ["12h","12h"],
  ["24h","24h"],
  ["48h","48h"],
  ["3d","3 Day"],
  ["7d","7 Day"],
  ["month","Month"],
  ["year","Year"],
  ["all","All time"]
];

let win="12h";

const label=k=>
  (WINDOWS.find(x=>x[0]===k)||["",k])[1];

const dur=s=>{
  if(s==null || !Number.isFinite(Number(s))) return "—";
  s=Number(s);
  return `${Math.floor(s/86400)}d ${Math.floor(s%86400/3600)}h ${Math.floor(s%3600/60)}m`;
};

const pct=n=>
  n==null || !Number.isFinite(Number(n))
    ? "—"
    : `${Number(n).toFixed(2)}%`;

const change=n=>
  n==null || !Number.isFinite(Number(n))
    ? "—"
    : `${Number(n)>0?"+":""}${Number(n).toFixed(2)}%`;

const tl=ts=>{
  const d=new Date(Number(ts)*1000);
  if(Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(undefined,{
    month:"short",
    day:"numeric",
    hour:"numeric",
    minute:"2-digit"
  }).format(d);
};

function bar(){
  const el=document.getElementById("timebar");
  if(!el) return;

  el.innerHTML=WINDOWS.map(([k,l])=>
    `<button class="timebtn ${k===win?"active":""}" data-w="${k}">${l}</button>`
  ).join("");

  el.querySelectorAll("[data-w]").forEach(b=>{
    b.onclick=()=>{
      win=b.dataset.w;
      bar();
      load();
    };
  });
}

function chart(rows){
  const s=document.getElementById("uptimeChart");
  if(!s) return;

  const clean=(Array.isArray(rows)?rows:[])
    .map(x=>({
      ts:Number(x?.ts),
      uptime_seconds:Number(x?.uptime_seconds)
    }))
    .filter(x=>
      Number.isFinite(x.ts) &&
      Number.isFinite(x.uptime_seconds)
    );

  const w=1000,h=280,l=70,r=18,t=18,b=52;

  if(!clean.length){
    s.innerHTML=
      `<text x="500" y="140" text-anchor="middle"
        fill="#93a0b5" font-size="13">
        No uptime history in selected window
       </text>`;
    return;
  }

  const vals=clean.map(x=>x.uptime_seconds);
  const lo=Math.min(...vals);
  const hi=Math.max(...vals);
  const span=Math.max(1,hi-lo);
  const n=clean.length;

  const x=i=>
    l+(n<2 ? (w-l-r)/2 : i*(w-l-r)/(n-1));

  const y=v=>
    h-b-((v-lo)/span)*(h-t-b);

  let html="";

  for(let j=0;j<=4;j++){
    const yy=t+j*(h-t-b)/4;
    const v=hi-j*(hi-lo)/4;

    html+=
      `<line x1="${l}" y1="${yy}" x2="${w-r}" y2="${yy}"/>`+
      `<text x="${l-8}" y="${yy+4}"
        text-anchor="end" font-size="12"
        fill="#93a0b5">${dur(v)}</text>`;
  }

  for(let j=0;j<=4;j++){
    const i=Math.round((n-1)*j/4);
    const xx=x(i);

    html+=
      `<text x="${xx}" y="${h-14}"
        text-anchor="middle" font-size="11"
        fill="#93a0b5">${tl(clean[i].ts)}</text>`;
  }

  let d="";

  clean.forEach((v,i)=>{
    d+=(i?" L":"M")+`${x(i)} ${y(v.uptime_seconds)}`;
  });

  s.innerHTML=
    html+
    `<path d="${d}"
      fill="none"
      stroke="#53d8ff"
      stroke-width="2.5"
      vector-effect="non-scaling-stroke"/>`;
}

async function load(){
  try{
    const response=await fetch(
      `/api/uptime?window=${encodeURIComponent(win)}`,
      {
        cache:"no-store",
        headers:{"Accept":"application/json"}
      }
    );

    if(!response.ok){
      throw new Error(`HTTP ${response.status}`);
    }

    const x=await response.json();

    const periods=
      x.periods && typeof x.periods==="object"
        ? x.periods
        : {};

    const p=
      x.period && typeof x.period==="object"
        ? x.period
        : (periods[win] || {});

    const history=
      Array.isArray(x.history)
        ? x.history
        : [];

    const stamp=document.getElementById("stamp");
    if(stamp){
      stamp.textContent=
        `Updated ${new Date(x.ts).toLocaleString()} · ${label(win)} selected`;
    }

    const chartWindow=document.getElementById("chartWindow");
    if(chartWindow){
      chartWindow.textContent=label(win);
    }

    const stats=document.getElementById("stats");
    if(stats){
      stats.innerHTML=`
        <article class="card stat">
          <div class="label">Availability</div>
          <div class="value ${(Number(p.availability_percent)||0)>=99?"ok":"warn"}">
            ${pct(p.availability_percent)}
          </div>
        </article>

        <article class="card stat">
          <div class="label">Online time</div>
          <div class="value ok">${dur(p.online_seconds)}</div>
        </article>

        <article class="card stat">
          <div class="label">Offline time</div>
          <div class="value ${Number(p.offline_seconds)>0?"warn":""}">
            ${dur(p.offline_seconds)}
          </div>
        </article>

        <article class="card stat">
          <div class="label">Current uptime</div>
          <div class="value">${dur(p.current_uptime_seconds)}</div>
        </article>
      `;
    }

    const suite=document.getElementById("suite");

    if(suite){
      suite.innerHTML=`
        <tr>
          <td>Selected window</td>
          <td>${dur(p.current_uptime_seconds)}</td>
          <td>${dur(p.average_uptime_seconds)}</td>
          <td>${dur(p.online_seconds)}</td>
          <td>${dur(p.offline_seconds)}</td>
          <td>${pct(p.availability_percent)}</td>
          <td class="change ${
            Number(p.percent_change)>0
              ? "up"
              : Number(p.percent_change)<0
                ? "down"
                : "flat"
          }">${change(p.percent_change)}</td>
        </tr>
      `;
    }

    const periodsBody=document.getElementById("periods");

    if(periodsBody){
      periodsBody.innerHTML=WINDOWS.map(([k,l])=>{
        const a=periods[k] || {};

        const cls=
          Number(a.percent_change)>0
            ? "up"
            : Number(a.percent_change)<0
              ? "down"
              : "flat";

        return `
          <tr>
            <td>${l}</td>
            <td>${pct(a.availability_percent)}</td>
            <td>${dur(a.average_uptime_seconds)}</td>
            <td>${dur(a.online_seconds)}</td>
            <td>${dur(a.offline_seconds)}</td>
            <td>${a.samples ?? 0}</td>
            <td class="change ${cls}">
              ${change(a.percent_change)}
            </td>
          </tr>
        `;
      }).join("");
    }

    chart(history);

  }catch(e){
    console.error("Uptime board error:",e);

    const stamp=document.getElementById("stamp");
    if(stamp){
      stamp.textContent="Uptime API unavailable";
    }
  }
}

bar();
load();
setInterval(load,10000);
