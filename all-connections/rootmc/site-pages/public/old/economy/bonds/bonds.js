(function () {
  var API = "/api/rootmc/server/";
  var FEATURED = "rootmc";
  var poolChart = null;
  var state = { serverId: "", players: [], governments: [] };

  function el(id) { return document.getElementById(id); }

  function setText(id, text) {
    var node = el(id);
    if (node) node.textContent = text;
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtGold(n) {
    if (!Number.isFinite(n)) return "\u2014";
    return n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + " G";
  }

  function fmtPct(n) {
    if (!Number.isFinite(n)) return "\u2014";
    return n.toFixed(2) + "%";
  }

  function fmtWhen(iso) {
    if (!iso) return "\u2014";
    try {
      return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    } catch (_e) {
      return String(iso);
    }
  }

  async function fetchJson(url) {
    var res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  async function resolveServerId() {
    try {
      var q = new URLSearchParams(location.search || "").get("server");
      if (q && String(q).trim()) return String(q).trim();
    } catch (_e) { /* fall through */ }
    try {
      var cfg = await fetchJson("/api/rootmc/server/config");
      var sid = String((cfg.featured_server || {}).server_id || "").trim();
      if (sid) return sid;
    } catch (_e) { /* fall through */ }
    return FEATURED;
  }

  function playerLink(name) {
    if (!name) return "?";
    return "<a href=\"/player/?player=" + encodeURIComponent(name) + "\">" + esc(name) + "</a>";
  }

  function fmtYieldPct(n) {
    if (!Number.isFinite(n)) return "\u2014";
    return n.toFixed(4) + "%";
  }

  function avgYieldFromDaily(rows) {
    var list = Array.isArray(rows) ? rows : [];
    var sumPct = 0;
    var n = 0;
    for (var i = 0; i < list.length && n < 48; i++) {
      var principal = Number(list[i].total_principal_g);
      if (!Number.isFinite(principal) || principal < 0.001) continue;
      var pool = Number(list[i].bond_pool_g);
      if (!Number.isFinite(pool)) pool = 0;
      sumPct += (pool / principal) * 100;
      n += 1;
    }
    if (n <= 0) {
      return { pct: NaN, gPerG: NaN, days: 0 };
    }
    var pct = sumPct / n;
    return { pct: pct, gPerG: pct / 100, days: n };
  }

  function renderGovernments() {
    var tbody = el("bonds-governments-body");
    if (!tbody) return;
    var rows = state.governments || [];
    if (!rows.length) {
      tbody.innerHTML = "<tr><td colspan=\"5\" class=\"rmc-muted\">No active town/nation bank participants.</td></tr>";
      return;
    }
    tbody.innerHTML = rows.map(function (g) {
      return "<tr>"
        + "<td>" + esc(String(g.kind || "town")) + "</td>"
        + "<td>" + esc(g.display_name || g.account_name || "?") + "</td>"
        + "<td class=\"gold\">" + fmtGold(Number(g.principal_g)) + "</td>"
        + "<td>" + fmtPct(Number(g.weight_pct)) + "</td>"
        + "<td>" + fmtGold(Number(g.lifetime_earned_g)) + "</td>"
        + "</tr>";
    }).join("");
  }

  function renderPlayers(filter) {
    var tbody = el("bonds-players-body");
    if (!tbody) return;
    var q = String(filter || "").trim().toLowerCase();
    var rows = state.players.filter(function (p) {
      if (!q) return true;
      return String(p.owner_name || "").toLowerCase().indexOf(q) >= 0;
    });
    if (!rows.length) {
      tbody.innerHTML = "<tr><td colspan=\"7\" class=\"rmc-muted\">No Gold Backed Bond holders yet.</td></tr>";
      return;
    }
    tbody.innerHTML = rows.map(function (p) {
      var uuid = String(p.owner_uuid || "");
      return "<tr class=\"bonds-player-row\" data-uuid=\"" + esc(uuid) + "\" data-name=\"" + esc(p.owner_name || "") + "\">"
        + "<td>" + playerLink(p.owner_name) + "</td>"
        + "<td>" + esc(p.active_bonds) + "</td>"
        + "<td class=\"gold\">" + fmtGold(Number(p.principal_g)) + "</td>"
        + "<td>" + fmtPct(Number(p.weight_pct)) + "</td>"
        + "<td>" + fmtGold(Number(p.uncollected_g)) + "</td>"
        + "<td class=\"gold\">" + fmtGold(Number(p.avg_24h_g)) + "</td>"
        + "<td>" + fmtGold(Number(p.lifetime_earned_g)) + "</td>"
        + "</tr>";
    }).join("");

    tbody.querySelectorAll(".bonds-player-row").forEach(function (row) {
      row.addEventListener("click", function () {
        loadPlayerDetail(row.getAttribute("data-uuid"), row.getAttribute("data-name"));
      });
    });
  }

  function renderDaily(rows) {
    var tbody = el("bonds-daily-body");
    if (!tbody) return;
    if (!rows || !rows.length) {
      tbody.innerHTML = "<tr><td colspan=\"6\" class=\"rmc-muted\">No settlements synced yet.</td></tr>";
      return;
    }
    tbody.innerHTML = rows.map(function (d) {
      return "<tr>"
        + "<td>#" + esc(d.mc_day_id) + "</td>"
        + "<td>" + fmtGold(Number(d.gross_inflow_g)) + "</td>"
        + "<td class=\"gold\">" + fmtGold(Number(d.bond_pool_g)) + "</td>"
        + "<td>" + fmtGold(Number(d.total_principal_g)) + "</td>"
        + "<td>" + esc(d.active_bonds) + "</td>"
        + "<td>" + fmtWhen(d.settled_at) + "</td>"
        + "</tr>";
    }).join("");
  }

  function renderChart(daily, pending) {
    var canvas = el("bonds-pool-chart");
    if (!canvas || !window.Chart) return;
    var rows = (daily || [])
      .filter(function (d) { return Number(d.bond_pool_g) > 0; })
      .slice()
      .reverse();
    var labels = rows.map(function (d) { return "#" + d.mc_day_id; });
    var values = rows.map(function (d) { return Number(d.bond_pool_g) || 0; });
    var pendingValues = new Array(values.length).fill(null);
    if (pending && Number(pending.estimated_pool_g) > 0) {
      labels.push("#" + pending.mc_day_id + " (pending)");
      values.push(null);
      pendingValues.push(Number(pending.estimated_pool_g));
    }
    if (!labels.length) {
      if (poolChart) {
        poolChart.destroy();
        poolChart = null;
      }
      return;
    }
    if (poolChart) poolChart.destroy();
    poolChart = new Chart(canvas, {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Settled Gold Backed Bond pool (G)",
            data: values,
            borderColor: "#f5b942",
            backgroundColor: "rgba(245, 185, 66, 0.08)",
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: "#f5b942",
            pointBorderColor: "#1a1f1e",
            pointBorderWidth: 1,
            spanGaps: false,
          },
          {
            label: "Pending pool (G)",
            data: pendingValues,
            borderColor: "rgba(245, 185, 66, 0.55)",
            backgroundColor: "transparent",
            borderWidth: 2,
            borderDash: [6, 4],
            fill: false,
            tension: 0,
            pointRadius: 5,
            pointStyle: "rectRot",
            pointBackgroundColor: "rgba(245, 185, 66, 0.55)",
            showLine: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        interaction: { mode: "index", intersect: false },
        plugins: { legend: { display: true, labels: { color: "#a1afa8" } } },
        scales: {
          x: {
            type: "category",
            ticks: { color: "#a1afa8", maxRotation: 0, autoSkip: false },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: { color: "#a1afa8" },
            grid: { color: "rgba(255,255,255,0.06)" },
          },
        },
        elements: {
          line: { borderJoinStyle: "round" },
          point: { hitRadius: 8 },
        },
      },
    });
  }

  async function loadPlayerDetail(uuid, name) {
    if (!uuid) return;
    var panel = el("bonds-detail-panel");
    if (panel) panel.hidden = false;
    setText("bonds-detail-title", (name || "Account") + " \u2014 bond detail");
    el("bonds-detail-bonds").innerHTML = "<tr><td colspan=\"3\" class=\"rmc-muted\">Loading…</td></tr>";
    el("bonds-detail-payouts").innerHTML = "<tr><td colspan=\"4\" class=\"rmc-muted\">Loading…</td></tr>";
    try {
      var data = await fetchJson(API + encodeURIComponent(state.serverId) + "/bonds/player/" + encodeURIComponent(uuid));
      var stats = data.stats || {};
      setText("bonds-detail-principal", fmtGold(Number(stats.principal_g)));
      setText("bonds-detail-weight", fmtPct(Number(stats.weight_pct)));
      setText("bonds-detail-avg24", fmtGold(Number(data.earned_24h_g != null ? data.earned_24h_g : stats.avg_24h_g)));
      setText("bonds-detail-uncollected", fmtGold(Number(stats.uncollected_g)));

      var bonds = data.bonds || [];
      el("bonds-detail-bonds").innerHTML = bonds.length
        ? bonds.map(function (b) {
          return "<tr><td>" + esc(b.display_name) + "</td><td class=\"gold\">" + fmtGold(Number(b.principal_g)) + "</td><td>" + fmtWhen(b.issued_at) + "</td></tr>";
        }).join("")
        : "<tr><td colspan=\"3\" class=\"rmc-muted\">No active certificates.</td></tr>";

      var payouts = data.payouts || [];
      el("bonds-detail-payouts").innerHTML = payouts.length
        ? payouts.map(function (p) {
          return "<tr><td>#" + esc(p.mc_day_id) + "</td><td class=\"gold\">" + fmtGold(Number(p.amount_g)) + "</td><td>" + fmtPct(Number(p.weight_pct)) + "</td><td>" + fmtWhen(p.settled_at) + "</td></tr>";
        }).join("")
        : "<tr><td colspan=\"4\" class=\"rmc-muted\">No payouts yet.</td></tr>";

      panel.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      el("bonds-detail-bonds").innerHTML = "<tr><td colspan=\"3\" class=\"market-error\">" + esc(e.message) + "</td></tr>";
    }
  }

  async function init() {
    var errEl = el("bonds-error");
    try {
      state.serverId = await resolveServerId();
      var data = await fetchJson(API + encodeURIComponent(state.serverId) + "/bonds?daily_limit=45");
      var s = data.summary || {};
      state.players = data.players || [];
      state.governments = data.governments || [];

      setText("bonds-subtitle", "Server " + state.serverId + " \u00B7 synced " + fmtWhen(data.synced_at));
      setText("bonds-income-pct-inline", (Number(s.income_share_pct) || 25) + "%");

      var daily = data.daily_settlements || [];
      var fromDaily = avgYieldFromDaily(daily);
      var yieldDays = Math.floor(Number(s.avg_daily_yield_sample_days) || 0);
      var yieldPct = Number(s.avg_daily_yield_pct);
      var yieldPerG = Number(s.avg_daily_yield_g_per_g);
      if (!(Number.isFinite(yieldPct) && yieldDays > 0) && fromDaily.days > 0) {
        yieldPct = fromDaily.pct;
        yieldPerG = fromDaily.gPerG;
        yieldDays = fromDaily.days;
      }
      if (Number.isFinite(yieldPct) && yieldDays > 0) {
        setText("bonds-avg-yield", fmtYieldPct(yieldPct));
        setText(
          "bonds-avg-yield-meta",
          (Number.isFinite(yieldPerG) ? yieldPerG.toFixed(6) + " G per 1 G \u00B7 " : "")
            + yieldDays + " settled MC days"
        );
      } else {
        setText("bonds-avg-yield", "\u2014");
        setText("bonds-avg-yield-meta", "Need settlement history");
      }

      setText("bonds-total-principal", fmtGold(Number(s.total_principal_g)));
      setText("bonds-active-count", (s.active_bonds || 0) + " active Gold Backed Bonds");
      setText("bonds-holders", String(s.holder_count || 0));
      setText("bonds-uncollected", fmtGold(Number(s.uncollected_g)));
      setText("bonds-lifetime", fmtGold(Number(s.lifetime_earned_g)));
      setText("bonds-pool-24h", fmtGold(Number(s.pool_24h_g)));
      if (s.last_settlement) {
        setText("bonds-last-pool", fmtGold(Number(s.last_settlement.bond_pool_g)));
        setText("bonds-last-day-meta", "MC day #" + s.last_settlement.mc_day_id + " \u00B7 settled " + fmtWhen(s.last_settlement.settled_at));
      } else {
        setText("bonds-last-pool", "\u2014");
        setText("bonds-last-day-meta", "No settlement yet");
      }
      if (s.pending_day && Number(s.pending_day.gross_inflow_g) > 0) {
        setText("bonds-pending-pool", fmtGold(Number(s.pending_day.estimated_pool_g)));
        setText("bonds-pending-meta", "MC day #" + s.pending_day.mc_day_id
          + " \u00B7 inflow " + fmtGold(Number(s.pending_day.gross_inflow_g))
          + " \u00B7 settles at next sunrise");
      } else if (s.pending_day) {
        setText("bonds-pending-pool", "\u2014");
        setText("bonds-pending-meta", "MC day #" + s.pending_day.mc_day_id + " \u00B7 no reserve inflow yet");
      } else {
        setText("bonds-pending-pool", "\u2014");
        setText("bonds-pending-meta", "Pending day not synced yet");
      }

      renderPlayers("");
      renderGovernments();
      renderDaily(daily);
      renderChart(daily, s.pending_day || null);

      var filter = el("bonds-player-filter");
      if (filter) {
        filter.addEventListener("input", function () { renderPlayers(filter.value); });
      }
    } catch (e) {
      if (errEl) {
        errEl.hidden = false;
        errEl.textContent = "Could not load bonds data: " + e.message;
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
