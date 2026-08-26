const WINDOWS = [
  ["1m","1 Minute"],["15m","15m"],["1h","1h"],["8h","8h"],
  ["12h","12h"],["24h","24h"],["48h","48h"],["3d","3 Day"],
  ["7d","7 Day"],["month","Month"],["year","Year"],["all","All time"]
];
let win = "1h";
let allCrons = [];

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));
const label = k => (WINDOWS.find(x => x[0] === k) || ["", k])[1];
const num = n => n == null ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

function bar() {
  document.getElementById("timebar").innerHTML = WINDOWS.map(([k, l]) =>
    `<button type="button" class="timebtn ${k === win ? "active" : ""}" data-w="${k}">${l}</button>`
  ).join("");
  document.querySelectorAll("[data-w]").forEach(b => {
    b.onclick = () => { win = b.dataset.w; bar(); load(); };
  });
}

function renderCrons(list) {
  const root = document.getElementById("crons");
  if (!root) return;
  if (!list.length) {
    root.innerHTML = '<div class="empty">No scheduled jobs match.</div>';
    return;
  }
  root.innerHTML = list.map(x => `
    <div class="row">
      <span class="${x.enabled ? "ok" : "warn"}">${x.enabled ? "● pending" : "○ disabled"}</span>
      <code title="${esc(x.path)}">${esc(x.path)}</code>
      <span class="muted">${esc(x.lane || "")}</span>
      <span class="muted">${esc(x.next_due_label || x.schedule || "")}</span>
    </div>
  `).join("");
}

function bindSearch() {
  const input = document.getElementById("cronSearch");
  if (!input || input.dataset.bound) return;
  input.dataset.bound = "1";
  input.oninput = () => {
    const q = input.value.trim().toLowerCase();
    if (!q) {
      renderCrons(allCrons);
      return;
    }
    renderCrons(allCrons.filter(x =>
      [x.path, x.schedule, x.lane, x.next_due_label].some(v => String(v || "").toLowerCase().includes(q))
    ));
  };
}

async function load() {
  try {
    const s = await fetch(`/api/status?window=${encodeURIComponent(win)}`, { cache: "no-store" }).then(r => r.json());
    const o = s.operations || {};
    allCrons = o.pending_crons || [];
    const ps = o.processes || [];
    const r = o.rates || {};

    const stamp = document.getElementById("stamp");
    if (stamp) {
      stamp.textContent = `Updated ${new Date(s.ts).toLocaleString()} · ${label(win)} selected · ${allCrons.length} jobs`;
    }

    const metrics = document.getElementById("metrics");
    if (metrics) {
      metrics.innerHTML = `
        <article class="card stat">
          <div class="label">Scheduled jobs (all)</div>
          <div class="value">${num(r.total_jobs ?? allCrons.length)}</div>
        </article>
        <article class="card stat">
          <div class="label">Due next hour</div>
          <div class="value">${num(r.next_hour)}</div>
        </article>
        <article class="card stat">
          <div class="label">Avg jobs / hour</div>
          <div class="value">${num(r.avg_per_hour)}</div>
        </article>
        <article class="card stat">
          <div class="label">Current processes</div>
          <div class="value">${num(ps.length)}</div>
        </article>`;
    }

    const cronSummary = document.getElementById("cronSummary");
    if (cronSummary) {
      cronSummary.textContent =
        `${allCrons.filter(x => x.enabled).length} enabled · ` +
        `${allCrons.filter(x => !x.enabled).length} disabled · ` +
        `${num(r.next_hour)} due in next hour · showing all ${allCrons.length}`;
    }

    // Ensure search field exists above list
    let search = document.getElementById("cronSearch");
    if (!search) {
      const host = document.getElementById("crons")?.parentElement;
      if (host) {
        search = document.createElement("input");
        search.id = "cronSearch";
        search.type = "search";
        search.placeholder = "Filter chronologicals…";
        search.style.cssText = "margin:8px 0 12px;width:100%;max-width:480px;padding:10px 12px;border:1px solid #253246;border-radius:10px;background:#0d1420;color:#edf3ff";
        host.insertBefore(search, document.getElementById("crons"));
      }
    }
    bindSearch();
    const q = (document.getElementById("cronSearch")?.value || "").trim().toLowerCase();
    renderCrons(!q ? allCrons : allCrons.filter(x =>
      [x.path, x.schedule, x.lane, x.next_due_label].some(v => String(v || "").toLowerCase().includes(q))
    ));

    const processSummary = document.getElementById("processSummary");
    if (processSummary) processSummary.textContent = `${ps.length} current processes`;

    const processes = document.getElementById("processes");
    if (processes) {
      processes.innerHTML = ps.map(x => `
        <div class="row">
          <span><b>${esc(x.pid)}</b> · ${esc(x.elapsed)} · ${esc(x.name)}</span>
          <code class="muted" style="max-width:68%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(x.command)}">${esc(x.command)}</code>
        </div>
      `).join("") || '<div class="empty">No process data.</div>';
    }

    const rates = document.getElementById("rates");
    if (rates) {
      rates.innerHTML = WINDOWS.map(([k, l]) => {
        const x = o.windows?.[k] || {};
        return `<tr><td>${l}</td><td>${num(x.avg_per_minute)}</td><td>${num(x.avg_per_hour)}</td><td>${num(x.next_hour)}</td></tr>`;
      }).join("");
    }
  } catch (e) {
    const stamp = document.getElementById("stamp");
    if (stamp) stamp.textContent = "Status API unavailable";
  }
}

bar();
load();
setInterval(load, 10000);
