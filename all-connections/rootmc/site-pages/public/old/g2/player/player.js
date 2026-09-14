(function () {
  /** McMMO, playtime, votes, and player search are shared — Gen1 API. */
  var SHARED_API = "";
  /** Gen2-only economy overlays (net worth). */
  var G2_API = "/api/g2/rootmc";
  var PATH_PREFIX = "/g2";
  var searchTimer = null;

  function el(id) {
    return document.getElementById(id);
  }

  function params() {
    return new URLSearchParams(window.location.search);
  }

  function uuidFromLocation() {
    var fromQuery = (params().get("uuid") || params().get("minecraft_uuid") || "").trim();
    if (/^[0-9a-f-]{36}$/i.test(fromQuery)) return fromQuery.toLowerCase();

    var pathMatch = window.location.pathname.match(/\/player\/([0-9a-f-]{36})\/?$/i);
    if (pathMatch) return pathMatch[1].toLowerCase();

    var parts = window.location.pathname.split("/").filter(Boolean);
    var idx = parts.indexOf("player");
    if (idx >= 0 && parts[idx + 1] && /^[0-9a-f-]{36}$/i.test(parts[idx + 1])) {
      return parts[idx + 1].toLowerCase();
    }
    return "";
  }

  function setPageStatus(msg, kind) {
    var s = el("page-status");
    if (!s) return;
    s.textContent = msg || "";
    s.className = "player-page-status" + (kind ? " player-page-status-" + kind : "");
    s.hidden = !msg;
  }

  function formatDate(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString();
    } catch (e) {
      return iso;
    }
  }

  function titleCaseSkill(key) {
    if (!key) return "";
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  function formatPlaytime(totalSeconds) {
    var seconds = Number(totalSeconds) || 0;
    if (seconds <= 0) return "0m";
    var hours = Math.floor(seconds / 3600);
    var minutes = Math.floor((seconds % 3600) / 60);
    return hours > 0 ? hours + "h " + minutes + "m" : minutes + "m";
  }

  function formatCurrency(value) {
    var n = Number(value) || 0;
    if (n <= 0) return "0.000";
    if (n >= 1000000) return (n / 1000000).toFixed(3) + "M";
    if (n >= 1000) return (n / 1000).toFixed(3) + "K";
    return n.toFixed(3);
  }

  function avatarUrl(uuid) {
    return "https://crafatar.com/avatars/" + uuid.replace(/-/g, "") + "?overlay&size=128";
  }

  function navigateToPlayer(uuid, q) {
    var next = new URLSearchParams();
    if (uuid) next.set("uuid", uuid);
    if (q) next.set("q", q);
    var qs = next.toString();
    history.pushState(null, "", PATH_PREFIX + "/player/" + (qs ? "?" + qs : ""));
  }

  function renderMcmmo(mcmmo) {
    var empty = el("mcmmo-empty");
    var panel = el("mcmmo-panel");
    var skillsEl = el("mcmmo-skills");
    if (!empty || !panel || !skillsEl) return;

    if (!mcmmo || !mcmmo.skills || !Object.keys(mcmmo.skills).length) {
      empty.hidden = false;
      panel.hidden = true;
      return;
    }

    empty.hidden = true;
    panel.hidden = false;
    el("mcmmo-power").textContent = mcmmo.power_level != null ? String(mcmmo.power_level) : "—";
    el("mcmmo-synced").textContent = formatDate(mcmmo.synced_at);

    var entries = Object.keys(mcmmo.skills)
      .map(function (key) {
        return { key: key, level: mcmmo.skills[key] };
      })
      .sort(function (a, b) {
        return b.level - a.level;
      });

    skillsEl.innerHTML = entries
      .map(function (row) {
        return (
          '<div class="player-mcmmo-skill"><span>' +
          titleCaseSkill(row.key) +
          '</span><strong>' +
          row.level +
          "</strong></div>"
        );
      })
      .join("");
  }

  function renderPlaytime(playtime) {
    var empty = el("playtime-empty");
    var panel = el("playtime-panel");
    if (!empty || !panel) return;
    if (!playtime || !playtime.total_playtime_seconds) {
      empty.hidden = false;
      panel.hidden = true;
      return;
    }
    empty.hidden = true;
    panel.hidden = false;
    el("playtime-total").textContent = formatPlaytime(playtime.total_playtime_seconds);
    el("playtime-first").textContent = formatDate(playtime.first_join_at);
    el("playtime-last").textContent = formatDate(playtime.last_login_at);
  }

  function renderNetWorth(netWorth) {
    var empty = el("networth-empty");
    var panel = el("networth-panel");
    if (!empty || !panel) return;
    if (!netWorth || !netWorth.total_value) {
      empty.hidden = false;
      panel.hidden = true;
      return;
    }
    empty.hidden = true;
    panel.hidden = false;
    var netTotal = (Number(netWorth.balance_value) || 0)
      + (Number(netWorth.inventory_value) || 0)
      + (Number(netWorth.chest_value) || 0)
      + (Number(netWorth.shop_stock_value) || 0);
    var storedTotal = Number(netWorth.total_value);
    if (!Number.isFinite(storedTotal) || Math.abs(netTotal - storedTotal) > 0.01) {
      el("networth-total").textContent = formatCurrency(netTotal);
    } else {
      el("networth-total").textContent = formatCurrency(storedTotal);
    }
    el("networth-balance").textContent = formatCurrency(netWorth.balance_value);
    el("networth-inventory").textContent = formatCurrency(netWorth.inventory_value);
    el("networth-shop-stock").textContent = formatCurrency(netWorth.shop_stock_value || 0);
    el("networth-synced").textContent = formatDate(netWorth.synced_at);
  }

  /** Gen2 wallet/net-worth overlay; McMMO/playtime stay on shared Gen1 stats. */
  async function overlayG2NetWorth(uuid) {
    try {
      var cfgRes = await fetch(G2_API + "/server/config", { cache: "no-store" });
      var cfg = await cfgRes.json().catch(function () { return {}; });
      var sid = String((cfg.featured_server && cfg.featured_server.server_id) || "g2").trim();
      var res = await fetch(
        G2_API + "/server/" + encodeURIComponent(sid) + "/economy/net-worth?limit=500",
        { cache: "no-store" },
      );
      if (!res.ok) return;
      var data = await res.json().catch(function () { return {}; });
      var rows = (data && data.leaderboard) || [];
      var hit = null;
      var needle = String(uuid || "").toLowerCase();
      for (var i = 0; i < rows.length; i++) {
        if (String(rows[i].minecraft_uuid || "").toLowerCase() === needle) {
          hit = rows[i];
          break;
        }
      }
      if (!hit) return;
      renderNetWorth({
        balance_value: hit.balance_value,
        inventory_value: hit.inventory_value,
        chest_value: hit.chest_value || 0,
        shop_stock_value: hit.shop_stock_value || 0,
        total_value: hit.total_value,
        synced_at: data.synced_at,
      });
    } catch (e) {
      /* keep shared Gen1 net-worth fallback */
    }
  }

  function formatObtainedVia(code) {
    if (!code) return "—";
    var labels = {
      MINED_ORE: "Mined gold ore",
      MINED_BLOCK: "Mined gold block",
      LOOT_CHEST: "Chest / container loot",
      LOOT_MOB: "Mob drop",
      PICKUP: "Ground pickup",
      MINT_HAND: "Minted (/mint hand)",
      MINT_ALL: "Minted (/mint all)",
      MINT_GOLD: "Redeemed (/mint gold)"
    };
    return labels[code] || code.replace(/_/g, " ").toLowerCase();
  }

  function formatMaterialName(material) {
    if (!material) return "—";
    return String(material).replace(/_/g, " ").toLowerCase().replace(/\b\w/g, function (c) {
      return c.toUpperCase();
    });
  }

  function renderGoldItemEvents(events) {
    var block = el("gold-items-block");
    var empty = el("gold-items-empty");
    var wrap = el("gold-items-table-wrap");
    var body = el("gold-items-body");
    if (!block || !empty || !wrap || !body) return;
    var rows = Array.isArray(events) ? events : [];
    if (!rows.length) {
      block.hidden = false;
      empty.hidden = false;
      wrap.hidden = true;
      body.innerHTML = "";
      return;
    }
    block.hidden = false;
    empty.hidden = true;
    wrap.hidden = false;
    body.innerHTML = rows.map(function (row) {
      var when = formatDate(row.occurred_at);
      var item = formatMaterialName(row.material);
      var qty = row.stack_amount != null ? row.stack_amount : "—";
      var goldG = row.gold_g != null ? Number(row.gold_g).toFixed(3) : "—";
      var how = formatObtainedVia(row.obtained_via);
      if (row.event_type === "MINT_TO_WALLET") {
        how = formatObtainedVia(row.obtained_via);
      } else if (row.event_type === "MINT_TO_ITEMS") {
        how = formatObtainedVia(row.obtained_via);
      }
      return "<tr><td>" + when + "</td><td>" + item + "</td><td>" + qty + "</td><td>" + goldG + "</td><td>" + how + "</td></tr>";
    }).join("");
  }

  function renderTreasury() {
    // Monthly dividend metrics removed from public player profiles.
  }

  async function loadStats(uuid) {
    setPageStatus("", "");
    el("panel-loading").hidden = false;
    el("panel-profile").hidden = true;

    try {
      var res = await fetch(SHARED_API + "/api/realm/minecraft/stats/" + encodeURIComponent(uuid), { cache: "no-store" });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) throw new Error(data.detail || "Could not load stats.");

      var stats = data.stats || {};
      el("panel-loading").hidden = true;
      el("panel-profile").hidden = false;

      var name = stats.minecraft_username || stats.realm_username || "Player";
      el("player-name").textContent = name;
      el("player-uuid").textContent = stats.minecraft_uuid || uuid;

      var badge = el("verified-badge");
      badge.textContent = stats.verified ? "Linked account" : "Not linked";
      badge.className = stats.verified ? "player-badge player-badge-ok" : "player-badge";

      var avatar = el("avatar");
      if (avatar) {
        avatar.src = stats.avatar_url || avatarUrl(uuid);
        avatar.alt = name;
      }

      var bio = el("player-bio");
      if (stats.bio) {
        bio.textContent = stats.bio;
        bio.hidden = false;
      } else if (bio) {
        bio.hidden = true;
      }

      renderMcmmo(stats.mcmmo);
      renderPlaytime(stats.playtime);
      renderNetWorth(stats.net_worth);
      renderTreasury(stats.treasury);
      renderGoldItemEvents(stats.gold_item_events);
      overlayG2NetWorth(uuid);

      var worlds = Array.isArray(stats.shared_worlds) ? stats.shared_worlds : [];
      var worldsBlock = el("worlds-block");
      var list = el("world-list");
      if (worldsBlock && list) {
        if (!worlds.length) {
          worldsBlock.hidden = true;
        } else {
          worldsBlock.hidden = false;
          list.innerHTML = worlds
            .map(function (w) {
              var notes = w.note_count != null ? w.note_count + " notes" : "";
              var ver = w.game_version ? " · " + w.game_version : "";
              return (
                "<li><strong>" +
                (w.world_name || "World") +
                "</strong>" +
                (w.seed ? " · seed " + w.seed : "") +
                ver +
                (notes ? " · " + notes : "") +
                "</li>"
              );
            })
            .join("");
        }
      }

      navigateToPlayer(uuid, params().get("q") || "");
    } catch (e) {
      el("panel-loading").hidden = true;
      setPageStatus(String(e.message || e), "err");
    }
  }

  function renderSearchResults(players) {
    var list = el("search-results");
    var hint = el("search-status");
    if (!list || !hint) return;

    if (!players.length) {
      list.hidden = true;
      hint.hidden = false;
      hint.textContent = "No players found. Try another name.";
      return;
    }

    hint.hidden = false;
    hint.textContent = players.length + " player" + (players.length === 1 ? "" : "s") + " found";
    list.hidden = false;
    list.innerHTML = players
      .map(function (p) {
        var name = p.minecraft_username || "Unknown";
        var verified = p.verified ? '<span class="player-result-verified">linked</span>' : "";
        return (
          '<li><button type="button" class="player-result" data-uuid="' +
          p.minecraft_uuid +
          '">' +
          '<img src="' +
          avatarUrl(p.minecraft_uuid) +
          '" alt="" width="40" height="40">' +
          "<span><strong>" +
          name +
          "</strong>" +
          verified +
          "</span></button></li>"
        );
      })
      .join("");

    list.querySelectorAll(".player-result").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var uuid = btn.getAttribute("data-uuid");
        if (uuid) void loadStats(uuid);
      });
    });
  }

  async function runSearch(q) {
    var query = String(q || "").trim();
    var hint = el("search-status");
    var list = el("search-results");
    if (query.length < 2) {
      if (hint) {
        hint.hidden = false;
        hint.textContent = "Type at least 2 characters to search.";
      }
      if (list) list.hidden = true;
      return;
    }

    if (hint) {
      hint.hidden = false;
      hint.textContent = "Searching…";
    }
    if (list) list.hidden = true;

    try {
      var res = await fetch(
        SHARED_API + "/api/realm/minecraft/players/search?q=" + encodeURIComponent(query) + "&limit=20",
        { cache: "no-store" },
      );
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok) throw new Error(data.detail || "Search failed.");
      renderSearchResults(Array.isArray(data.players) ? data.players : []);

      var next = new URLSearchParams(window.location.search);
      next.set("q", query);
      next.delete("uuid");
      history.replaceState(null, "", PATH_PREFIX + "/player/?" + next.toString());
      el("panel-profile").hidden = true;
    } catch (e) {
      if (hint) {
        hint.hidden = false;
        hint.textContent = String(e.message || e);
      }
    }
  }

  el("search-form")?.addEventListener("submit", function (ev) {
    ev.preventDefault();
    void runSearch(el("search-q")?.value || "");
  });

  el("search-q")?.addEventListener("input", function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      void runSearch(el("search-q")?.value || "");
    }, 320);
  });

  window.addEventListener("popstate", function () {
    var uuid = uuidFromLocation();
    if (uuid) void loadStats(uuid);
    else {
      el("panel-profile").hidden = true;
      el("panel-loading").hidden = true;
      var q = params().get("q");
      if (q) {
        if (el("search-q")) el("search-q").value = q;
        void runSearch(q);
      }
    }
  });

  (function init() {
    var q = params().get("q") || "";
    if (el("search-q") && q) el("search-q").value = q;

    var uuid = uuidFromLocation();
    if (uuid) {
      void loadStats(uuid);
      if (q) void runSearch(q);
      return;
    }
    if (q) {
      void runSearch(q);
      return;
    }
  })();
})();
