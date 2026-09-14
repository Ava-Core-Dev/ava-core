(function () {
  var SERVER_ID = "rootmc";
  var TAPE_MIN = 12;
  /** Region breakdown lives on /time — keep home hero compact at 100% zoom. */
  var ACTIVITY_ZONES = 0;
  var API = "https://api.rootmc.net";
  var API_FALLBACK = "https://rootmc-api.root-337.workers.dev";
  var viewerIana = "";
  var activityTimer = null;

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function el(id) {
    return document.getElementById(id);
  }

  function fmtGold(n) {
    if (!Number.isFinite(n)) return "—";
    return n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + " G";
  }

  function fmtPct24h(n) {
    if (!Number.isFinite(n)) return "—";
    var sign = n > 0 ? "+" : "";
    return sign + n.toFixed(1) + "% 24h";
  }

  function itemSymbol(key) {
    return String(key || "").toUpperCase();
  }

  function marketItemUrl(key) {
    return "/market/?item=" + encodeURIComponent(String(key || "").toUpperCase());
  }

  function detectViewerIana() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch (_e) {
      return "";
    }
  }

  function withTz(url) {
    if (!viewerIana) return url;
    return url + (url.indexOf("?") >= 0 ? "&" : "?") + "tz=" + encodeURIComponent(viewerIana);
  }

  function formatLocalClock(iana) {
    try {
      return new Intl.DateTimeFormat("en-US", {
        timeZone: iana || undefined,
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date());
    } catch (_e) {
      return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date());
    }
  }

  async function resolveServerId() {
    try {
      var res = await fetch("/api/rootmc/server/config", { cache: "no-store" });
      var data = await res.json().catch(function () { return {}; });
      var sid = String((data.featured_server || {}).server_id || "").trim();
      if (sid) return sid;
    } catch (_e) { /* fall through */ }
    return SERVER_ID;
  }

  function displayPrice(row) {
    var avg = Number(row.market_avg) || 0;
    var min = Number(row.min_price) || 0;
    return avg > 0 ? avg : min;
  }

  function moversFromItems(items) {
    var map = {};
    (items || []).forEach(function (row) {
      var key = String(row.item_key || "").toUpperCase();
      if (!key) return;
      var pct = Number(row.change_24h_pct);
      map[key] = {
        current: displayPrice(row),
        pct: Number.isFinite(pct) ? pct : 0,
        hasChange: Number.isFinite(pct),
      };
    });
    return map;
  }

  function renderPriceTape(items, movers) {
    var wrap = el("home-price-tape-wrap");
    var host = el("home-price-tape");
    if (!wrap || !host) return;

    var tapeRows = Object.keys(movers)
      .map(function (key) {
        return {
          key: key,
          current: movers[key].current,
          pct: movers[key].pct,
          hasChange: movers[key].hasChange,
        };
      })
      .filter(function (row) {
        return row.hasChange && Math.abs(row.pct) >= 0.05;
      })
      .sort(function (a, b) {
        return Math.abs(b.pct) - Math.abs(a.pct);
      });

    if (tapeRows.length < TAPE_MIN) {
      (items || []).forEach(function (row) {
        var key = String(row.item_key || "").toUpperCase();
        if (!key || tapeRows.some(function (r) { return r.key === key; })) return;
        var mover = movers[key];
        tapeRows.push({
          key: key,
          current: mover ? mover.current : displayPrice(row),
          pct: mover && mover.hasChange ? mover.pct : 0,
          hasChange: mover ? mover.hasChange : false,
        });
      });
    }

    tapeRows = tapeRows.filter(function (row) { return row.current > 0; }).slice(0, 28);
    if (!tapeRows.length) {
      wrap.hidden = true;
      return;
    }

    var segment = tapeRows
      .map(function (row) {
        var dir = !row.hasChange || Math.abs(row.pct) < 0.05 ? "flat" : row.pct > 0 ? "up" : "down";
        return (
          '<a class="rmc-market-tape-item ' +
          dir +
          '" href="' +
          esc(marketItemUrl(row.key)) +
          '">' +
          '<span class="sym">' +
          esc(itemSymbol(row.key)) +
          "</span>" +
          '<span class="px">' +
          esc(fmtGold(row.current)) +
          "</span>" +
          '<span class="chg">' +
          esc(row.hasChange ? fmtPct24h(row.pct) : "—") +
          "</span>" +
          "</a>"
        );
      })
      .join("");

    host.innerHTML =
      '<div class="rmc-market-tape-track">' +
      segment +
      "</div>" +
      '<div class="rmc-market-tape-track" aria-hidden="true">' +
      segment +
      "</div>";
    wrap.hidden = false;
  }

  async function fetchJsonWithTimeout(url, timeoutMs) {
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = null;
    if (controller) {
      timer = setTimeout(function () { controller.abort(); }, timeoutMs);
    }
    try {
      var res = await fetch(url, { cache: "no-store", signal: controller ? controller.signal : undefined });
      return { ok: res.ok, status: res.status, json: await res.json().catch(function () { return {}; }) };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function loadMarketTape() {
    var serverId = await resolveServerId();
    try {
      var base =
        "/api/rootmc/stock-market/items?server_id=" + encodeURIComponent(serverId);
      var results = await Promise.all([
        fetchJsonWithTimeout(base + "&per_page=25&sort=shop_count_desc&page=1", 8000),
        fetchJsonWithTimeout(base + "&per_page=25&sort=shop_count_desc&page=2", 8000),
      ]);
      if (!results[0].ok) throw new Error("market HTTP " + results[0].status);

      var items = [];
      results.forEach(function (res) {
        if (res.ok) items = items.concat((res.json.items || []).filter(function (r) { return r.item_key; }));
      });

      renderPriceTape(items, moversFromItems(items));
    } catch (_e) {
      /* tape stays hidden */
    }
  }

  function formatPlayHours(seconds) {
    var s = Number(seconds) || 0;
    if (s <= 0) return "";
    var hours = s / 3600;
    if (hours >= 10) return Math.round(hours).toLocaleString() + "h play in band";
    if (hours >= 1) return hours.toFixed(1).replace(/\.0$/, "") + "h play in band";
    var mins = Math.max(1, Math.round(s / 60));
    return mins + "m play in band";
  }

  function renderActivityCard(local, zones) {
    var host = el("home-hero-activity");
    var meta = el("home-hero-activity-meta");
    if (!host) return;

    var clock = (local && local.local_time) || formatLocalClock(viewerIana);
    var label = (local && (local.timezone_label || local.timezone_key)) || viewerIana || "Local clock";
    var town = local && local.nearest_town ? String(local.nearest_town) : "";
    var peak =
      (local &&
        (local.best_join_window ||
          local.peak_in_your_clock ||
          local.peak_activity)) ||
      null;
    var quiet =
      (local && (local.quiet_window || local.maintenance_window)) || null;
    var bandPlay = local && Number(local.peak_band_play_seconds);
    var lastHourRaw = local && local.players_last_hour;
    var lastHour =
      lastHourRaw === null || lastHourRaw === undefined ? null : Number(lastHourRaw);
    var zoneRows = (zones || []).slice(0, ACTIVITY_ZONES);

    var html =
      '<div class="rmc-hero-activity-row rmc-hero-activity-row--feature">' +
      '<span class="label">Your timezone</span>' +
      '<span class="value" id="home-activity-clock">' +
      esc(clock) +
      "</span>" +
      '<span class="sub">' +
      esc(label) +
      (town ? " · " + esc(town) : "") +
      "</span>" +
      "</div>" +
      '<div class="rmc-hero-activity-row rmc-hero-activity-row--feature">' +
      '<span class="label">Players last hour</span>' +
      '<span class="value gold">' +
      (Number.isFinite(lastHour) ? esc(String(lastHour)) : "—") +
      "</span>" +
      "</div>" +
      '<div class="rmc-hero-activity-row rmc-hero-activity-row--feature">' +
      '<span class="label">Best time to join (your clock)</span>' +
      '<span class="value gold">' +
      esc(peak || "Not enough play data yet") +
      "</span>" +
      (Number.isFinite(bandPlay) && bandPlay > 0
        ? '<span class="sub">' + esc(formatPlayHours(bandPlay)) + " · worldwide</span>"
        : peak
          ? '<span class="sub">Worldwide peak · shown in your timezone</span>'
          : "") +
      "</div>" +
      '<div class="rmc-hero-activity-row rmc-hero-activity-row--feature">' +
      '<span class="label">Quietest / maintenance (your clock)</span>' +
      '<span class="value gold">' +
      esc(quiet || "Not enough play data yet") +
      "</span>" +
      '<span class="sub">Least busy worldwide · shown in your timezone</span>' +
      "</div>";

    if (zoneRows.length) {
      html +=
        '<div class="rmc-hero-activity-row rmc-hero-activity-row--feature">' +
        '<span class="label">Active regions (peaks on your clock)</span>' +
        "</div>";
      html += zoneRows
        .map(function (z) {
          var peakYours = z.peak_viewer || z.peakViewer || "—";
          var count = Number(z.players) || 0;
          return (
            '<div class="rmc-hero-activity-row">' +
            "<strong>" +
            esc(z.label || z.key || "Zone") +
            "</strong>" +
            '<span class="px">' +
            esc(peakYours) +
            "</span>" +
            '<span class="pill flat">' +
            esc(String(count)) +
            " p</span>" +
            "</div>"
          );
        })
        .join("");
    }

    host.innerHTML = html;
    if (meta) {
      meta.innerHTML =
        "Join at the worldwide peak · maintain in the quiet window · <a href=\"/time/old/\">Open live metrics</a> · <a href=\"/time/\">How time works</a>";
    }
  }

  function showActivityError() {
    var host = el("home-hero-activity");
    var meta = el("home-hero-activity-meta");
    if (host) {
      host.innerHTML =
        '<p class="rmc-muted rmc-hero-ticker-loading">Could not load activity. Try <a href="/time/old/">/time/old</a>.</p>';
    }
    if (meta) meta.innerHTML = '<a href="/time/old/">Live metrics</a> · <a href="/time/">How time works</a>';
  }

  async function fetchActivityPair(base) {
    var results = await Promise.all([
      fetchJsonWithTimeout(withTz(base + "/api/rootmc/time/local"), 8000),
      fetchJsonWithTimeout(withTz(base + "/api/rootmc/activity/timezones"), 8000),
    ]);
    var local = results[0].json && results[0].json.ok ? results[0].json : null;
    var tzPayload = results[1].json && results[1].ok !== false ? results[1].json : null;
    if (results[0].ok && local && local.ok) return { local: local, tzPayload: tzPayload };
    return null;
  }

  async function loadActivityCard() {
    viewerIana = detectViewerIana();
    try {
      var pair = await fetchActivityPair(API);
      if (!pair) pair = await fetchActivityPair(API_FALLBACK);
      if (!pair) throw new Error("local unavailable");
      var local = pair.local;
      var tzPayload = pair.tzPayload;

      if (local.iana) viewerIana = String(local.iana);

      var zones = [];
      if (tzPayload && Array.isArray(tzPayload.most_active)) {
        zones = tzPayload.most_active.map(function (z) {
          return {
            key: z.key,
            label: z.label,
            players: z.players,
            peak_viewer: z.peakViewer || z.peak_viewer,
            peak_local: z.peakLocal || z.peak_local,
          };
        });
      } else if (tzPayload && Array.isArray(tzPayload.timezones)) {
        zones = tzPayload.timezones;
      }

      renderActivityCard(local, zones);

      if (activityTimer) clearInterval(activityTimer);
      activityTimer = setInterval(function () {
        var clockEl = el("home-activity-clock");
        if (clockEl) clockEl.textContent = formatLocalClock(viewerIana || (local && local.iana));
      }, 30_000);
    } catch (_e) {
      showActivityError();
    }
  }

  function scoreLine(p) {
    var votePts = (Number(p.voteCount) || 0) * 5;
    return (
      esc(p.activityScore) +
      " pts (" +
      esc(p.messageCount) +
      " blocks · " +
      esc(p.voteCount) +
      " votes = " +
      esc(votePts) +
      " pts · " +
      esc(p.reactionCount) +
      " reactions)"
    );
  }

  async function loadWeeklyLeaders() {
    var section = document.getElementById("weekly-leaders");
    if (!section) return;

    try {
      var res = await fetch("/api/rootmc/weekly-activity/highlights", { credentials: "same-origin" });
      if (!res.ok) return;
      var data = await res.json();
      if (!data) return;
      var hasCurrentRoleData =
        (Array.isArray(data.currentTopParticipatorRole) && data.currentTopParticipatorRole.length) ||
        (Array.isArray(data.currentTopActivePlayerRole) && data.currentTopActivePlayerRole.length);
      if (!data.posted && !hasCurrentRoleData) return;

      section.hidden = false;

      var weekEl = document.getElementById("weekly-leaders-week");
      if (weekEl && data.weekLabel) {
        weekEl.textContent = "Week of " + data.weekLabel;
      } else if (weekEl && hasCurrentRoleData) {
        weekEl.textContent = "Current Discord role holders";
      }

      var partList = document.getElementById("weekly-participators");
      if (partList && Array.isArray(data.participators) && data.participators.length) {
        partList.innerHTML = data.participators
          .map(function (p) {
            return (
              '<li class="rmc-leader-row">' +
              '<span class="rmc-leader-rank">' +
              esc(p.rank) +
              "</span>" +
              '<span class="rmc-leader-name">' +
              esc(p.displayName) +
              "</span>" +
              '<span class="rmc-leader-meta">' +
              scoreLine(p) +
              "</span>" +
              "</li>"
            );
          })
          .join("");
      } else if (
        partList &&
        Array.isArray(data.currentTopParticipatorRole) &&
        data.currentTopParticipatorRole.length
      ) {
        partList.innerHTML = data.currentTopParticipatorRole
          .map(function (name, idx) {
            return (
              '<li class="rmc-leader-row">' +
              '<span class="rmc-leader-rank">' +
              esc(idx + 1) +
              "</span>" +
              '<span class="rmc-leader-name">' +
              esc(name) +
              "</span>" +
              '<span class="rmc-leader-meta">Current Top Participator role</span>' +
              "</li>"
            );
          })
          .join("");
      } else if (partList) {
        partList.innerHTML = '<li class="rmc-leader-empty">No Top Participator winners this week.</li>';
      }

      var playerBlock = document.getElementById("weekly-top-player");
      if (playerBlock) {
        var topPlayers =
          Array.isArray(data.topActivePlayers) && data.topActivePlayers.length
            ? data.topActivePlayers
            : data.topActivePlayer
              ? [data.topActivePlayer]
              : [];
        if (topPlayers.length) {
          playerBlock.hidden = false;
          playerBlock.innerHTML = topPlayers
            .map(function (tp) {
              var pro = tp.proGranted ? " · Pro member this week" : "";
              return (
                '<p class="rmc-leader-player-name">#' +
                esc(tp.rank || 1) +
                " " +
                esc(tp.minecraftUsername) +
                "</p>" +
                '<p class="rmc-muted">' +
                esc(tp.displayName) +
                " · " +
                esc(tp.weeklyPlaytimeLabel) +
                " in-game" +
                esc(pro) +
                "</p>"
              );
            })
            .join("");
        } else if (Array.isArray(data.currentTopActivePlayerRole) && data.currentTopActivePlayerRole.length) {
          playerBlock.hidden = false;
          playerBlock.innerHTML =
            '<p class="rmc-leader-player-name">' +
            esc(data.currentTopActivePlayerRole[0]) +
            "</p>" +
            '<p class="rmc-muted">Current Top Active Player role holder</p>';
        } else {
          playerBlock.hidden = true;
        }
      }
    } catch (_e) {
      /* keep section hidden until awards exist */
    }
  }

  function boot() {
    loadMarketTape();
    loadActivityCard();
    loadWeeklyLeaders();
    setTimeout(function () {
      var host = el("home-hero-activity");
      if (!host) return;
      if (host.textContent && host.textContent.toLowerCase().indexOf("loading local activity") >= 0) {
        showActivityError();
      }
    }, 10000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
