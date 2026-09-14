(function () {
  var API = "https://api.rootmc.net";
  /** Claims host (g2 surface). */
  var FEATURED_FALLBACK_ID = "4963895e-0964-48b8-81b7-1f40a966e8be";
  var PLAY_LIMIT = 25;

  var PIE_COLORS = [
    "#c9a0dc",
    "#f5b942",
    "#7eb8da",
    "#5dd39e",
    "#e8c27a",
    "#e07a5f",
    "#81b29a",
    "#a8dadc",
    "#f2cc8f",
    "#b8b8ff",
    "#90be6d",
    "#f4a261",
  ];

  var charts = { activity: null, online: null };
  var viewerIana = "";
  var onlineRange = "24h";
  var onlineServerId = "";
  var onlineRangeBound = false;

  var ONLINE_RANGE_LABELS = {
    "8h": "8h",
    "12h": "12h",
    "24h": "24h",
    "48h": "48h",
    "7d": "7d",
    m: "30d",
    y: "1y",
  };

  function el(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function detectViewerIana() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch (e) {
      return "";
    }
  }

  function fmtPlaySeconds(sec) {
    var s = Math.max(0, Math.floor(Number(sec) || 0));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    if (h > 0) return h.toLocaleString("en-US") + "h " + m + "m";
    return m + "m";
  }

  function withTz(url) {
    if (!viewerIana) return url;
    return url + (url.indexOf("?") >= 0 ? "&" : "?") + "tz=" + encodeURIComponent(viewerIana);
  }

  function fillTbody(tableId, html) {
    var t = el(tableId);
    if (!t) return;
    var body = t.querySelector("tbody");
    if (body) body.innerHTML = html;
  }

  async function resolveServerId() {
    return { serverId: FEATURED_FALLBACK_ID, serverName: "RootMC Claims" };
  }

  function destroyChart(key) {
    if (charts[key]) {
      charts[key].destroy();
      charts[key] = null;
    }
  }

  function chartReady() {
    return typeof Chart !== "undefined";
  }

  function pieColors(n) {
    var out = [];
    for (var i = 0; i < n; i++) out.push(PIE_COLORS[i % PIE_COLORS.length]);
    return out;
  }

  function renderCharts(data) {
    if (!chartReady() || !data) return;
    var section = el("time-charts");
    if (section) section.hidden = false;

    var note = el("time-charts-note");
    if (note) {
      note.textContent = "All-time play share · peaks in " + (data.time_zone || viewerIana || "your timezone");
    }

    var mostActive = data.most_active_timezones || [];
    var totalPlay = mostActive.reduce(function (sum, z) {
      return sum + (Number(z.play_seconds) || 0);
    }, 0);
    var activityNote = el("time-activity-note");
    if (activityNote) {
      activityNote.textContent = mostActive.length
        ? "Share of play time by timezone · peak in your clock in tooltips"
        : "No timezone activity data yet.";
    }
    destroyChart("activity");
    if (mostActive.length) {
      charts.activity = new Chart(document.getElementById("time-activity-chart"), {
        type: "pie",
        data: {
          labels: mostActive.map(function (z) {
            return z.label || z.key;
          }),
          datasets: [
            {
              label: "Play time",
              data: mostActive.map(function (z) {
                return Number(z.play_seconds) || 0;
              }),
              backgroundColor: pieColors(mostActive.length),
              borderColor: "#0a0f10",
              borderWidth: 2,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              position: "right",
              labels: { color: "#a1afa8", boxWidth: 12, padding: 10 },
            },
            tooltip: {
              callbacks: {
                label: function (ctx) {
                  var sec = Number(ctx.parsed) || 0;
                  var pct = totalPlay > 0 ? ((sec / totalPlay) * 100).toFixed(1) : "0";
                  return (ctx.label || "") + ": " + fmtPlaySeconds(sec) + " (" + pct + "%)";
                },
                afterLabel: function (ctx) {
                  var row = mostActive[ctx.dataIndex] || {};
                  var parts = [];
                  if (row.players != null) parts.push(row.players + " players");
                  if (row.peak_viewer) parts.push("peak (yours) " + row.peak_viewer);
                  else if (row.peak_local) parts.push("peak " + row.peak_local);
                  return parts.join(" · ");
                },
              },
            },
          },
        },
      });
    }
  }

  async function loadCharts() {
    try {
      var res = await fetch(withTz(API + "/api/rootmc/time/charts"), { credentials: "omit" });
      if (!res.ok) throw new Error("charts HTTP " + res.status);
      var data = await res.json();
      renderCharts(data);
    } catch (e) {
      var section = el("time-charts");
      if (section) section.hidden = false;
      var note = el("time-charts-note");
      if (note) note.textContent = "Charts unavailable: " + (e && e.message ? e.message : e);
    }
  }

  function formatSampleLabel(ts, rangeKey) {
    try {
      var d = new Date(ts);
      var longRange = rangeKey === "7d" || rangeKey === "m" || rangeKey === "y";
      return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: longRange ? undefined : "2-digit",
      }).format(d);
    } catch (e) {
      return String(ts || "");
    }
  }

  function bindOnlineRangeControls() {
    if (onlineRangeBound) return;
    var wrap = el("time-online-range");
    if (!wrap) return;
    onlineRangeBound = true;
    wrap.querySelectorAll("[data-online-range]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var next = String(btn.getAttribute("data-online-range") || "24h");
        if (next === onlineRange) return;
        onlineRange = next;
        wrap.querySelectorAll("[data-online-range]").forEach(function (x) {
          x.classList.toggle("is-active", x.getAttribute("data-online-range") === onlineRange);
        });
        if (onlineServerId) loadOnlineChart(onlineServerId);
      });
    });
  }

  function renderOnlineChart(timesPayload) {
    var section = el("time-online-charts");
    var note = el("time-online-note");
    var peakEl = el("time-online-peak");
    if (!section) return;
    section.hidden = false;
    bindOnlineRangeControls();
    var samples = (timesPayload && timesPayload.samples) || [];
    var rangeKey = (timesPayload && timesPayload.range) || onlineRange;
    var sampleCount = (timesPayload && timesPayload.sample_count) || samples.length;
    var peak = (timesPayload && (timesPayload.peak_online || timesPayload.peak_online_48h)) || 0;
    var name = (timesPayload && timesPayload.server_name) || "Towny";
    var rangeLabel = ONLINE_RANGE_LABELS[rangeKey] || rangeKey;
    if (note) {
      note.textContent = samples.length
        ? name + " · " + rangeLabel + " · " + sampleCount + " samples in range"
        : "Waiting for Root-Times cloud samples…";
    }
    if (peakEl) peakEl.textContent = samples.length ? "Peak " + peak + " online" : "";
    destroyChart("online");
    if (!chartReady() || samples.length < 2) return;
    var labels = samples.map(function (s) {
      return formatSampleLabel(s.ts, rangeKey);
    });
    charts.online = new Chart(document.getElementById("time-online-chart"), {
      type: "line",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Online",
            data: samples.map(function (s) {
              return Number(s.online) || 0;
            }),
            borderColor: "#3d9b8f",
            backgroundColor: "rgba(61,155,143,0.15)",
            fill: true,
            tension: 0.25,
            pointRadius: 0,
            borderWidth: 2,
          },
          {
            label: "AFK",
            data: samples.map(function (s) {
              return Number(s.afk) || 0;
            }),
            borderColor: "#f5b942",
            backgroundColor: "transparent",
            fill: false,
            tension: 0.25,
            pointRadius: 0,
            borderWidth: 1.5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        scales: {
          x: {
            ticks: {
              color: "#8aa0a8",
              maxTicksLimit: 8,
              maxRotation: 0,
            },
            grid: { color: "rgba(255,255,255,0.04)" },
          },
          y: {
            beginAtZero: true,
            ticks: { color: "#8aa0a8", precision: 0 },
            grid: { color: "rgba(255,255,255,0.06)" },
          },
        },
        plugins: {
          legend: {
            labels: { color: "#a1afa8", boxWidth: 12 },
          },
        },
      },
    });
  }

  async function loadOnlineChart(serverId) {
    onlineServerId = serverId;
    bindOnlineRangeControls();
    try {
      var res = await fetch(
        API +
          "/api/rootmc/server/" +
          encodeURIComponent(serverId) +
          "/times?range=" +
          encodeURIComponent(onlineRange),
        { credentials: "omit", cache: "no-store" },
      );
      if (!res.ok) throw new Error("times HTTP " + res.status);
      renderOnlineChart(await res.json());
    } catch (e) {
      var section = el("time-online-charts");
      if (section) section.hidden = false;
      var note = el("time-online-note");
      if (note) note.textContent = "Online chart unavailable: " + (e && e.message ? e.message : e);
    }
  }

  function renderMcDays(data) {
    var wrap = el("time-mc-days");
    var note = el("time-mc-days-note");
    var md = data && data.minecraft_day;
    if (!wrap || !md || !md.gen1 || !md.gen2) {
      if (wrap) wrap.hidden = true;
      if (note) note.hidden = true;
      return;
    }
    function fill(prefix, card) {
      var dayEl = el(prefix + "-day");
      var phaseEl = el(prefix + "-phase");
      var metaEl = el(prefix + "-meta");
      if (dayEl) dayEl.textContent = "Day #" + (Number(card.day_id) || 0).toLocaleString("en-US");
      if (phaseEl) phaseEl.textContent = card.phase || "—";
      if (metaEl) {
        metaEl.textContent = card.next_midnight_label || "—";
      }
    }
    fill("time-mc-gen1", md.gen1);
    fill("time-mc-gen2", md.gen2);
    wrap.hidden = false;
    if (note) {
      note.textContent =
        md.note ||
        (md.length_minutes || 30) + " real minutes per MC day · " + (md.timezone || "Pacific/Honolulu");
      note.hidden = false;
    }
  }

  function renderYou(data) {
    var box = el("time-you");
    var tzLine = el("time-you-tz");
    var peakLine = el("time-you-peak");
    var maintLine = el("time-you-maint");
    var maintNote = el("time-you-maint-note");
    if (!box || !tzLine || !peakLine || !data || !data.ok) return;

    var clock = data.local_time || "—";
    var label = data.timezone_label || data.timezone_key || "Unknown";
    var town = data.nearest_town ? String(data.nearest_town) : "";
    tzLine.textContent =
      "Your Timezone: " + clock + " · " + label + (town ? " · " + town : "");

    var peak =
      data.best_join_window || data.peak_in_your_clock || data.peak_activity;
    peakLine.textContent = peak
      ? "Best time to join (worldwide, your clock): " + peak
      : "Best time to join: not enough play data yet";

    var maint = data.quiet_window || data.maintenance_window;
    if (maintLine && maintNote) {
      if (maint) {
        maintLine.textContent = "Quietest / maintenance (your clock): " + maint;
        maintLine.hidden = false;
        maintNote.hidden = false;
        maintNote.textContent =
          "Least busy worldwide window — preferred for restarts and maintenance.";
      } else {
        maintLine.hidden = true;
        maintNote.hidden = true;
      }
    }
    renderMcDays(data);
    box.hidden = false;
  }

  async function loadYou() {
    var iana = viewerIana || detectViewerIana();
    viewerIana = iana;
    var url = withTz(API + "/api/rootmc/time/local");
    try {
      var res = await fetch(url, { credentials: "omit" });
      if (!res.ok) throw new Error("local HTTP " + res.status);
      var data = await res.json();
      renderYou(data);
      if (!window.__timeYouTimer) {
        window.__timeYouTimer = setInterval(function () {
          loadYou();
        }, 30_000);
      }
    } catch (e) {
      var box = el("time-you");
      var tzLine = el("time-you-tz");
      var peakLine = el("time-you-peak");
      var maintLine = el("time-you-maint");
      var maintNote = el("time-you-maint-note");
      if (box && tzLine && peakLine) {
        var clock = "—";
        try {
          clock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date());
        } catch (e4) {
          /* ignore */
        }
        tzLine.textContent = "Your Timezone: " + clock + " · " + (iana || "local clock");
        peakLine.textContent = "Peak activity in your timezone: unavailable";
        if (maintLine) maintLine.hidden = true;
        if (maintNote) maintNote.hidden = true;
        box.hidden = false;
      }
    }
  }

  function renderTimezones(data) {
    var rows = (data.timezones || []).filter(function (z) {
      return (Number(z.players) || 0) > 0 || (Number(z.play_seconds) || 0) > 0;
    });
    if (!rows.length) {
      fillTbody("time-tz-table", '<tr><td colspan="4" class="rmc-muted">No timezone activity yet.</td></tr>');
      return;
    }
    fillTbody(
      "time-tz-table",
      rows
        .map(function (z) {
          return (
            "<tr><td>" +
            esc(z.label) +
            "</td><td>" +
            (Number(z.players) || 0) +
            "</td><td>" +
            esc(z.peak_local || "—") +
            "</td><td>" +
            esc(z.peak_viewer || z.peak_hst || "—") +
            "</td></tr>"
          );
        })
        .join(""),
    );
  }

  function renderPlaytime(rows) {
    var filtered = (rows || []).filter(function (r) {
      return (Number(r.total_playtime_seconds) || 0) >= 3600;
    });
    if (!filtered.length) {
      fillTbody("time-play-table", '<tr><td colspan="3" class="rmc-muted">No activity rows (1h+).</td></tr>');
      return;
    }
    fillTbody(
      "time-play-table",
      filtered
        .map(function (r, i) {
          return (
            "<tr><td>" +
            (i + 1) +
            "</td><td>" +
            esc(r.minecraft_username || r.username || "—") +
            "</td><td>" +
            esc(fmtPlaySeconds(r.total_playtime_seconds)) +
            "</td></tr>"
          );
        })
        .join(""),
    );
  }

  function renderWeekly(data) {
    var note = el("time-week-note");
    if (!data || !data.posted) {
      if (note) note.textContent = "Weekly awards not posted yet this cycle.";
      fillTbody("time-week-table", '<tr><td colspan="3" class="rmc-muted">Waiting for Sunday awards.</td></tr>');
      return;
    }
    if (note) note.textContent = (data.weekLabel || data.week_key || "Posted week") + " · top activity";
    var players = data.topActivePlayers || [];
    if (!players.length && data.topActivePlayer) players = [data.topActivePlayer];
    if (!players.length) {
      fillTbody("time-week-table", '<tr><td colspan="3" class="rmc-muted">No weekly activity winners.</td></tr>');
      return;
    }
    fillTbody(
      "time-week-table",
      players
        .map(function (p) {
          return (
            "<tr><td>" +
            (p.rank || "") +
            "</td><td>" +
            esc(p.displayName || p.minecraftUsername || "—") +
            "</td><td>" +
            esc(p.weeklyPlaytimeLabel || fmtPlaySeconds(p.weeklyPlaytimeSeconds)) +
            "</td></tr>"
          );
        })
        .join(""),
    );
  }

  async function load() {
    var err = el("time-error");
    var sub = el("time-subtitle");
    if (err) err.hidden = true;

    try {
      viewerIana = detectViewerIana();
      var server = await resolveServerId();
      loadYou();
      var results = await Promise.all([
        fetch(withTz(API + "/api/rootmc/activity/timezones"), { credentials: "omit" }).then(function (r) {
          if (!r.ok) throw new Error("timezones HTTP " + r.status);
          return r.json();
        }),
        fetch(
          API + "/api/rootmc/server/" + encodeURIComponent(server.serverId) + "/playtime/leaderboard?limit=" + PLAY_LIMIT,
          { credentials: "omit" },
        ).then(function (r) {
          if (!r.ok) throw new Error("playtime HTTP " + r.status);
          return r.json();
        }),
        fetch(API + "/api/rootmc/weekly-activity/highlights", { credentials: "omit" }).then(function (r) {
          if (!r.ok) throw new Error("weekly HTTP " + r.status);
          return r.json();
        }),
        loadOnlineChart(server.serverId),
      ]);

      var tz = results[0];
      var play = results[1];
      var weekly = results[2];

      renderTimezones(tz);
      renderPlaytime((play && (play.leaderboard || play.players || play.rows)) || []);
      renderWeekly(weekly);

      var bits = [];
      if (viewerIana) bits.push(viewerIana);
      if (tz && tz.mysql === false) bits.push("timezone peaks unavailable (MySQL)");
      else if (tz) bits.push((tz.total_players || 0) + " players with a timezone");
      if (sub) sub.textContent = bits.join(" · ") || "Loaded";

      function waitCharts() {
        if (chartReady()) return loadCharts();
        return new Promise(function (resolve) {
          var n = 0;
          var t = setInterval(function () {
            n++;
            if (chartReady() || n > 40) {
              clearInterval(t);
              resolve(loadCharts());
            }
          }, 50);
        });
      }
      await waitCharts();
    } catch (e) {
      if (err) {
        err.hidden = false;
        err.textContent = "Could not load time page: " + (e && e.message ? e.message : e);
      }
      if (sub) sub.textContent = "";
    }
  }

  load();
})();
