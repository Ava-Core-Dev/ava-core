(function () {
  const TOKEN_KEY = "rootrecord_portal_token";
  const OWNER_EMAIL = "root@rootrecord.info";

  let apiBase = "";

  function el(id) {
    return document.getElementById(id);
  }

  function setStatus(msg, kind) {
    const s = el("dev-status");
    if (!s) return;
    s.textContent = msg || "";
    s.className = "status" + (kind ? " status-" + kind : "");
  }

  function showPanel(name) {
    ["dev-loading", "dev-denied", "dev-main"].forEach((id) => {
      const n = el(id);
      if (n) n.hidden = id !== name;
    });
  }

  async function loadConfig() {
    const res = await fetch("/api/site-config", { cache: "no-store" });
    if (!res.ok) throw new Error("config");
    const j = await res.json();
    apiBase = typeof j.apiBase === "string" ? j.apiBase.replace(/\/+$/, "") : "";
    if (!apiBase) throw new Error("api_base_missing");
  }

  async function apiFetch(path, opts) {
    const headers = new Headers((opts && opts.headers) || {});
    const token = localStorage.getItem(TOKEN_KEY) || "";
    if (token && !headers.has("Authorization")) {
      headers.set("Authorization", "Bearer " + token);
    }
    return fetch(apiBase + path, { ...(opts || {}), headers, credentials: "include" });
  }

  async function requireOwner() {
    const me = await apiFetch("/v1/me", { method: "GET" });
    if (!me.ok) return false;
    const j = await me.json();
    const email = String(j.email || "").trim().toLowerCase();
    return email === OWNER_EMAIL;
  }

  async function loadUsage(days) {
    const r = await apiFetch(`/api/internal/usage/accuweather?days=${encodeURIComponent(String(days))}`, {
      method: "GET",
    });
    const txt = await r.text();
    let data;
    try {
      data = JSON.parse(txt);
    } catch {
      data = { raw: txt };
    }
    if (!r.ok) throw new Error(data?.detail || `Usage request failed (${r.status})`);
    renderUsage(data);
    el("usage-json").textContent = JSON.stringify(data, null, 2);
  }

  function fmtNum(n) {
    return Number(n || 0).toLocaleString();
  }

  function renderUsage(data) {
    const summary = el("usage-summary");
    const cards = [
      ["Total Accu calls", fmtNum(data.total_accu_calls)],
      ["Avg calls/day", fmtNum(data.avg_accu_calls_per_day)],
      ["Projected 30d", fmtNum(data.projected_30_day_calls)],
      ["Allowance", fmtNum(data.allowance_monthly_calls)],
      ["Projected overage", fmtNum(data.projected_overage_calls)],
      ["Cache hit rate", `${Number(data?.cache_stats?.cache_hit_rate || 0).toFixed(2)}%`],
    ];
    summary.innerHTML = cards
      .map(
        ([k, v]) =>
          `<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:.7rem .8rem">
            <div style="font-size:.75rem;color:var(--ink-muted);text-transform:uppercase;letter-spacing:.08em">${k}</div>
            <div style="font-size:1.2rem;font-weight:600;margin-top:.2rem">${v}</div>
          </div>`
      )
      .join("");

    const metricRows = Object.entries(data.totals_by_metric || {}).sort((a, b) => Number(b[1]) - Number(a[1]));
    const metricBody = el("usage-metrics-table").querySelector("tbody");
    metricBody.innerHTML = metricRows
      .map(
        ([metric, count]) =>
          `<tr><td style="padding:.45rem .5rem;border-bottom:1px solid rgba(255,255,255,.1);font-family:'JetBrains Mono',monospace">${metric}</td><td style="padding:.45rem .5rem;border-bottom:1px solid rgba(255,255,255,.1);text-align:right">${fmtNum(count)}</td></tr>`
      )
      .join("");

    const daily = Array.isArray(data.daily) ? data.daily : [];
    const dailyBody = el("usage-daily-table").querySelector("tbody");
    dailyBody.innerHTML = daily
      .map(
        (d) =>
          `<tr>
            <td style="padding:.45rem .5rem;border-bottom:1px solid rgba(255,255,255,.1);font-family:'JetBrains Mono',monospace">${d.day_utc}</td>
            <td style="padding:.45rem .5rem;border-bottom:1px solid rgba(255,255,255,.1);text-align:right">${fmtNum(d.accu_calls)}</td>
            <td style="padding:.45rem .5rem;border-bottom:1px solid rgba(255,255,255,.1);text-align:right">${fmtNum(d.cache_hits)}</td>
            <td style="padding:.45rem .5rem;border-bottom:1px solid rgba(255,255,255,.1);text-align:right">${fmtNum(d.cache_misses)}</td>
          </tr>`
      )
      .join("");
  }

  async function probe(endpoint, lat, lon) {
    const r = await apiFetch(
      `${endpoint}?lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}`,
      { method: "GET" }
    );
    const txt = await r.text();
    let data;
    try {
      data = JSON.parse(txt);
    } catch {
      data = { raw: txt };
    }
    el("probe-json").textContent = JSON.stringify(
      {
        status: r.status,
        endpoint,
        lat,
        lon,
        data,
      },
      null,
      2
    );
  }

  async function init() {
    showPanel("dev-loading");
    setStatus("Checking access…", "");
    try {
      await loadConfig();
      const ok = await requireOwner();
      if (!ok) {
        showPanel("dev-denied");
        setStatus("Only root@rootrecord.info can open this page.", "warn");
        return;
      }

      showPanel("dev-main");
      setStatus("Authorized.", "ok");

      const usageForm = el("usage-form");
      usageForm?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const days = Math.max(1, Math.min(90, Number(el("usage-days").value || 30)));
        setStatus("Loading usage data…", "");
        try {
          await loadUsage(days);
          setStatus("Usage loaded.", "ok");
        } catch (e) {
          setStatus(String(e?.message || e), "err");
        }
      });

      const probeForm = el("probe-form");
      probeForm?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const endpoint = el("probe-endpoint").value;
        const lat = Number(el("probe-lat").value);
        const lon = Number(el("probe-lon").value);
        setStatus("Probing endpoint…", "");
        try {
          await probe(endpoint, lat, lon);
          setStatus("Probe complete.", "ok");
        } catch (e) {
          setStatus(String(e?.message || e), "err");
        }
      });

      await loadUsage(30);
    } catch (e) {
      showPanel("dev-denied");
      setStatus(String(e?.message || e), "err");
    }
  }

  window.addEventListener("DOMContentLoaded", init);
})();
