
async function loadReports(){
 const root=document.querySelector('[data-report-root]'); if(!root)return;
 const category=root.dataset.category||"";
 const search=document.querySelector('[data-report-search]');
 async function render(){
  const q=encodeURIComponent(search?.value||"");
  try{
   const r=await fetch(`/api/context/reports?category=${encodeURIComponent(category)}&q=${q}`,{cache:"no-store"});
   const d=await r.json(); const rows=d.reports||[];
   root.innerHTML=rows.length?rows.map(x=>`<article class="report-item"><div class="context-meta">${esc(x.category)}${x.location?" · "+esc(x.location):""}</div><h3>${esc(x.title)}</h3><p>${esc(x.summary||"")}</p><div class="context-meta">${fmt(x.published_at)}</div><div class="report-assets">${asset(x,"text","READ")} ${asset(x,"audio","LISTEN")} ${asset(x,"image","VIEW IMAGE")}</div></article>`).join(""):`<div class="empty">No reports published here yet. This archive is ready for new reports and associated assets.</div>`;
  }catch(e){root.innerHTML=`<div class="empty">Report index unavailable: ${esc(e.message)}</div>`}
 }
 function esc(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
 function asset(x,k,label){const u=x.assets&&x.assets[k];return u?`<a href="${esc(u)}" target="_blank" rel="noopener">${label}</a>`:""}
 function fmt(v){if(!v)return "";try{return new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(new Date(v))}catch{return v}}
 search?.addEventListener("input",render); render();
}loadReports();
