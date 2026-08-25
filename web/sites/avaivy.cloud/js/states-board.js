const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function load(){
  const el=document.getElementById('stateFeed');
  try{
    const [news,eq,weather]=await Promise.all([
      fetch('/api/news/global',{cache:'no-store'}).then(r=>r.json()),
      fetch('/api/earthquakes/global',{cache:'no-store'}).then(r=>r.json()),
      fetch('/api/weather/aggregate',{cache:'no-store'}).then(r=>r.json())
    ]);
    const stateNews=new Map(),stateQuakes=new Map();
    (news.items||[]).forEach(x=>{if(x.state_name)stateNews.set(x.state_name,(stateNews.get(x.state_name)||0)+1)});
    (eq.events||[]).forEach(x=>{if(x.admin1_code)stateQuakes.set(x.admin1_code,(stateQuakes.get(x.admin1_code)||0)+1)});
    const locs=(weather.locations||[]).reduce((m,x)=>{if(x.admin1_code)m.set(x.admin1_code,(m.get(x.admin1_code)||0)+1);return m},new Map());
    const codes={AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'}; const raw=[...new Set([...stateNews.keys(),...stateQuakes.keys(),...locs.keys()])]; const states=raw.map(s=>codes[s]||s).sort().slice(0,50);
    el.innerHTML=states.length?states.map(s=>`<article class="geo-card"><div class="eyebrow">${esc(s)}</div><h3>Live coverage</h3><p>${stateNews.get(s)||0} news items · ${stateQuakes.get(Object.keys(codes).find(k=>codes[k]===s)||s)||0} earthquakes · ${locs.get(Object.keys(codes).find(k=>codes[k]===s)||s)||0} weather locations</p><a class="source-link" href="/weather/united-states/${String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}/">Open state ↗</a></article>`).join(''):'<article class="geo-card wide"><div class="muted">State feeds are installed and will populate as collectors report data.</div></article>';
  }catch(e){el.innerHTML='<article class="geo-card wide"><div class="muted">Live state feed temporarily unavailable.</div></article>'}
}
load();setInterval(load,300000);
