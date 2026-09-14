(function () {
  var METRICS_API = "https://api.rootmc.net/api/rootmc/host-metrics/summary";
  var PRESENCE_API = "https://api.rootmc.net/api/rootmc/host-presence/summary?days=14";

  var HOST_COLORS = {
    server: { line: "#5dd39e", fill: "rgba(93, 211, 158, 0.12)" },
    primary: { line: "#f5b942", fill: "rgba(245, 185, 66, 0.12)" },
    laptop: { line: "#7eb8da", fill: "rgba(126, 184, 218, 0.12)" },
  };

  var grid = document.getElementById("health-grid");
  var subtitle = document.getElementById("health-subtitle");
  var errEl = document.getElementById("health-error");
  var recentSection = document.getElementById("health-recent");
  var recentBody = document.getElementById("health-recent-body");
  var chartsSection = document.getElementById("health-charts");
  var uptimeSection = document.getElementById("health-uptime");
  var timelineEl = document.getElementById("health-timeline");

  var charts = { cpu: null, ram: null, devUptime: null, allUptime: null };

  function pct(v) {
    if (v === null || v === undefined || Number.isNaN(Number(v))) return "—";
    return Number(v).toFixed(1) + "%";
  }

  function tps(v) {
    if (v === null || v === undefined) return "—";
    return Number(v).toFixed(2);
  }

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtDuration(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return "0m";
    var totalMin = Math.floor(ms / 60000);
    var h = Math.floor(totalMin / 60);
    var m = totalMin % 60;
    if (h > 0 && m > 0) return h + "h " + m + "m";
    if (h > 0) return h + "h";
    return m + "m";
  }

  function hostColorKey(host) {
    if (host.host_kind === "server") return "server";
    if (host.host_key === "laptop") return "laptop";
    return "primary";
  }

  function colorForHost(host) {
    return HOST_COLORS[hostColorKey(host)] || HOST_COLORS.primary;
  }

  function labelForPresenceKey(key, presence) {
    if (key === "laptop") return presence.laptop.label;
    if (key === "primary") return presence.workstation.label;
    if (key === "server") return presence.server.label;
    return key;
  }

  function ramLabel(host) {
    return host.host_kind === "server" ? "RAM (JVM heap)" : "RAM";
  }

  function renderHostCard(host, presence) {
    var a = host.all_time || {};
    var pKey = host.host_kind === "server" ? presence.server : (host.host_key === "laptop" ? presence.laptop : presence.workstation);
    var online = pKey && pKey.online;
    var badge = online
      ? '<span class="health-badge health-badge--on">Online</span>'
      : '<span class="health-badge health-badge--off">Offline</span>';
    var today = pKey ? " · today " + fmtDuration(pKey.todayMs) : "";
    var cell = document.createElement("div");
    cell.className = "market-summary-cell";
    cell.innerHTML =
      '<div class="market-summary-label">' + esc(host.host_label) + " " + badge + "</div>" +
      '<div class="market-summary-value">CPU ' + pct(a.cpu_avg_pct) + "</div>" +
      '<p class="market-summary-meta">' + ramLabel(host) + " " + pct(a.ram_avg_pct) +
      " · Disk " + pct(a.disk_used_pct) +
      (a.tps_avg != null ? " · TPS " + tps(a.tps_avg) : "") +
      "<br>All-time over " + (a.minute_count || 0) + " minute buckets" +
      today + "</p>";
    return cell;
  }

  function renderRecent(hostLabel, rows) {
    if (!rows || !rows.length) return "";
    var lines = rows.slice(0, 12).map(function (r) {
      var tpsPart = r.tps_avg != null ? " · TPS " + tps(r.tps_avg) : "";
      return "<tr><td>" + esc(r.minute_ts) + "</td><td>" + pct(r.cpu_avg_pct) +
        "</td><td>" + pct(r.ram_avg_pct) + "</td><td>" + pct(r.disk_used_pct) +
        tpsPart + "</td><td>" + (r.sample_count || 0) + "</td></tr>";
    }).join("");
    return "<h3 style=\"margin-top:1.5rem\">" + esc(hostLabel) + "</h3>" +
      "<table class=\"rmc-table\"><thead><tr><th>Minute (UTC)</th><th>CPU</th><th>RAM</th><th>Disk</th><th>Samples</th></tr></thead><tbody>" +
      lines + "</tbody></table>";
  }

  function buildMinuteSeries(hosts, recentMinutes, field) {
    var labelSet = {};
    hosts.forEach(function (host) {
      var rows = (recentMinutes[host.host_key] || []).slice().reverse();
      rows.forEach(function (r) { labelSet[r.minute_ts] = true; });
    });
    var labels = Object.keys(labelSet).sort();
    if (!labels.length) return null;

    var datasets = hosts.map(function (host) {
      var byMinute = {};
      (recentMinutes[host.host_key] || []).forEach(function (r) {
        byMinute[r.minute_ts] = r[field];
      });
      var c = colorForHost(host);
      return {
        label: host.host_label,
        data: labels.map(function (ts) {
          var v = byMinute[ts];
          return v === undefined || v === null ? null : Number(v);
        }),
        borderColor: c.line,
        backgroundColor: c.fill,
        tension: 0.25,
        spanGaps: true,
        pointRadius: 0,
        borderWidth: 2,
      };
    });

    return {
      labels: labels.map(function (ts) {
        try {
          return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
        } catch (_e) {
          return ts;
        }
      }),
      datasets: datasets,
    };
  }

  function chartBaseOptions(yTitle) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { labels: { color: "#a1afa8", boxWidth: 12 } },
        tooltip: {
          callbacks: {
            label: function (ctx) {
              var v = ctx.parsed.y;
              if (v === null || v === undefined) return ctx.dataset.label + ": —";
              return ctx.dataset.label + ": " + Number(v).toFixed(1) + "%";
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: "#a1afa8", maxTicksLimit: 8 }, grid: { color: "rgba(255,255,255,0.05)" } },
        y: {
          min: 0,
          max: 100,
          title: { display: true, text: yTitle, color: "#a1afa8" },
          ticks: { color: "#a1afa8", callback: function (v) { return v + "%"; } },
          grid: { color: "rgba(255,255,255,0.05)" },
        },
      },
    };
  }

  function destroyChart(key) {
    if (charts[key]) {
      charts[key].destroy();
      charts[key] = null;
    }
  }

  function renderMetricCharts(hosts, recentMinutes) {
    var cpuData = buildMinuteSeries(hosts, recentMinutes, "cpu_avg_pct");
    var ramData = buildMinuteSeries(hosts, recentMinutes, "ram_avg_pct");
    if (!cpuData && !ramData) return;

    chartsSection.hidden = false;
    if (cpuData) {
      destroyChart("cpu");
      charts.cpu = new Chart(document.getElementById("health-cpu-chart"), {
        type: "line",
        data: cpuData,
        options: chartBaseOptions("CPU %"),
      });
    }
    if (ramData) {
      destroyChart("ram");
      charts.ram = new Chart(document.getElementById("health-ram-chart"), {
        type: "line",
        data: ramData,
        options: chartBaseOptions("RAM %"),
      });
    }
  }

  function uptimeBarChart(canvasId, chartKey, labels, datasets) {
    destroyChart(chartKey);
    charts[chartKey] = new Chart(document.getElementById(canvasId), {
      type: "bar",
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: "#a1afa8", boxWidth: 12 } },
          tooltip: {
            callbacks: {
              label: function (ctx) {
                return ctx.dataset.label + ": " + fmtDuration(ctx.parsed.y);
              },
            },
          },
        },
        scales: {
          x: { ticks: { color: "#a1afa8" }, grid: { display: false } },
          y: {
            ticks: {
              color: "#a1afa8",
              callback: function (v) { return fmtDuration(v); },
            },
            grid: { color: "rgba(255,255,255,0.05)" },
          },
        },
      },
    });
  }

  function msDataset(label, color, values) {
    return {
      label: label,
      data: values,
      backgroundColor: color,
      borderRadius: 4,
    };
  }

  function renderUptimeCharts(presence) {
    var byDay = presence.uptime_by_day || {};
    var merged = (byDay.merged_dev || presence.recent_days || []).slice().reverse();
    if (!merged.length) return;

    uptimeSection.hidden = false;
    var dayLabels = merged.map(function (d) { return d.day.slice(5); });

    uptimeBarChart(
      "health-dev-uptime-chart",
      "devUptime",
      dayLabels,
      [msDataset("Merged dev activity", HOST_COLORS.primary.line, merged.map(function (d) { return d.mergedDevMs || d.uptimeMs || 0; }))]
    );

    var laptop = (byDay.laptop || []).slice();
    var primary = (byDay.primary || []).slice();
    var server = (byDay.server || []).slice();
    if (laptop.length && primary.length && server.length) {
      uptimeBarChart(
        "health-all-uptime-chart",
        "allUptime",
        dayLabels,
        [
          msDataset(presence.laptop.label, HOST_COLORS.laptop.line, laptop.map(function (d) { return d.uptimeMs; })),
          msDataset(presence.workstation.label, HOST_COLORS.primary.line, primary.map(function (d) { return d.uptimeMs; })),
          msDataset(presence.server.label, HOST_COLORS.server.line, server.map(function (d) { return d.uptimeMs; })),
        ]
      );
    }

    renderTimeline(presence);
  }

  function renderTimeline(presence) {
    var day = presence.hstDayKey || "today";
    var mergedMs = presence.mergedDevTodayMs || 0;
    var intervals = presence.todayIntervalsByHost || {};
    var keys = ["laptop", "primary", "server"];

    var html = '<h3 style="margin-top:1.5rem">Today (' + esc(day) + ' HST) — ' + fmtDuration(mergedMs) + " merged dev</h3>";
    html += '<div class="health-timeline-grid">';

    keys.forEach(function (key) {
      var label = labelForPresenceKey(key, presence);
      var color = HOST_COLORS[key] || HOST_COLORS.primary;
      var rows = intervals[key] || [];
      html += '<div class="health-timeline-host"><div class="health-timeline-host-label">' + esc(label) + "</div>";
      html += '<div class="health-timeline-track">';
      if (!rows.length) {
        html += '<span class="rmc-muted">No sessions recorded</span>';
      } else {
        rows.forEach(function (iv) {
          var start = Date.parse(iv.start);
          var end = iv.end ? Date.parse(iv.end) : Date.now();
          if (!Number.isFinite(start) || !Number.isFinite(end)) return;
          var dayStart = Date.parse(day + "T00:00:00-10:00");
          var dayEnd = Date.parse(day + "T23:59:59.999-10:00");
          var clipStart = Math.max(start, dayStart);
          var clipEnd = Math.min(end, dayEnd);
          if (clipEnd <= clipStart) return;
          var left = ((clipStart - dayStart) / (dayEnd - dayStart)) * 100;
          var width = ((clipEnd - clipStart) / (dayEnd - dayStart)) * 100;
          html += '<span class="health-timeline-bar" style="left:' + left.toFixed(2) + "%;width:" + width.toFixed(2) +
            "%;background:" + color.line + '" title="' + esc(iv.start) + " → " + esc(iv.end || "now") + '"></span>';
        });
      }
      html += "</div></div>";
    });

    html += "</div>";
    timelineEl.innerHTML = html;
  }

  function fetchJson(url) {
    return fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" }).then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    });
  }

  Promise.all([fetchJson(METRICS_API), fetchJson(PRESENCE_API)])
    .then(function (results) {
      var data = results[0];
      var presence = results[1];
      var hosts = data.hosts || [];
      grid.innerHTML = "";
      if (!hosts.length) {
        subtitle.textContent = "No metrics yet — waiting for first minute rollups.";
        return;
      }
      hosts.forEach(function (host) {
        grid.appendChild(renderHostCard(host, presence));
      });
      subtitle.textContent =
        "Synced " + (data.synced_at || "").replace("T", " ").replace(/\.\d{3}Z$/, " UTC") +
        " · HST day " + (presence.hstDayKey || "—");

      renderMetricCharts(hosts, data.recent_minutes || {});
      renderUptimeCharts(presence);

      var recent = data.recent_minutes || {};
      var html = "";
      hosts.forEach(function (host) {
        html += renderRecent(host.host_label, recent[host.host_key]);
      });
      if (html) {
        recentBody.innerHTML = html;
        recentSection.hidden = false;
      }
    })
    .catch(function (e) {
      errEl.hidden = false;
      errEl.textContent = "Could not load host health: " + (e && e.message ? e.message : String(e));
      subtitle.textContent = "Unavailable";
    });
})();
