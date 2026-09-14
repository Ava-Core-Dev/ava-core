(function () {
  var API = "/api/rootmc/server/";
  var TREASURY = "/api/rootmc/treasury/";
  var FEATURED_FALLBACK_ID = "rootmc";
  var LIMIT = 50;

  function el(id) { return document.getElementById(id); }

  function params() { return new URLSearchParams(window.location.search); }

  function serverIdFromQuery() {
    return (params().get("server") || params().get("server_id") || "").trim();
  }

  async function resolveServerId() {
    var sid = serverIdFromQuery();
    if (sid) return { serverId: sid, serverName: null };
    try {
      var res = await fetch("/api/rootmc/server/config", { cache: "no-store" });
      var data = await res.json().catch(function () { return {}; });
      var featured = data.featured_server || {};
      sid = String(featured.server_id || "").trim();
      if (sid) return { serverId: sid, serverName: featured.name || null };
    } catch (e) { /* fall through */ }
    return { serverId: FEATURED_FALLBACK_ID, serverName: "RootMC" };
  }

  function fmtGold(n) {
    if (!Number.isFinite(n)) return "\u2014";
    return n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + " G";
  }

  function mintNet(row) {
    if (row && row.net_minted_g != null) return Number(row.net_minted_g) || 0;
    return Number(row && row.gross_minted_g) || 0;
  }

  function mintGrossIn(row) {
    if (row && row.gross_in_g != null) return Number(row.gross_in_g) || 0;
    var net = mintNet(row);
    return net > 0 ? net : 0;
  }

  function mintRedeemed(row) {
    if (row && row.redeemed_g != null) return Number(row.redeemed_g) || 0;
    var net = mintNet(row);
    return net < 0 ? Math.abs(net) : 0;
  }

  function mintTotals(data) {
    data = data || {};
    var grossIn = data.total_gross_in_g != null ? Number(data.total_gross_in_g) : null;
    var redeemed = data.total_redeemed_g != null ? Number(data.total_redeemed_g) : null;
    var net = data.net_minted_g != null ? Number(data.net_minted_g) : Number(data.total_gross_minted_g);
    if (grossIn == null && Number.isFinite(net)) grossIn = net > 0 ? net : 0;
    if (redeemed == null && Number.isFinite(net)) redeemed = net < 0 ? Math.abs(net) : 0;
    if (!Number.isFinite(net) && grossIn != null && redeemed != null) net = grossIn - redeemed;
    return {
      grossIn: Number.isFinite(grossIn) ? grossIn : 0,
      redeemed: Number.isFinite(redeemed) ? redeemed : 0,
      net: Number.isFinite(net) ? net : 0,
    };
  }

  function fmtPlaytime(sec) {
    sec = Math.max(0, Math.floor(Number(sec) || 0));
    var d = Math.floor(sec / 86400);
    var h = Math.floor((sec % 86400) / 3600);
    var m = Math.floor((sec % 3600) / 60);
    if (d > 0) return d + "d " + h + "h";
    if (h > 0) return h + "h " + m + "m";
    return m + "m";
  }

  function playerName(row) {
    return String(row.minecraft_username || row.minecraft_uuid || "?").trim() || "?";
  }

  function playerLink(name) {
    if (!name || name === "?") return "?";
    return "<a href=\"/player/?player=" + encodeURIComponent(name) + "\">" + name + "</a>";
  }

  function netWorthTotal(row) {
    var balance = Number(row.balance_value) || 0;
    var inventory = Number(row.inventory_value) || 0;
    var chest = Number(row.chest_value) || 0;
    var shopStock = Number(row.shop_stock_value) || 0;
    var sum = balance + inventory + chest + shopStock;
    var stored = Number(row.total_value);
    if (!Number.isFinite(stored) || Math.abs(sum - stored) > 0.01) return sum;
    return stored;
  }

  function netWorthTitle(row) {
    var balance = Number(row.balance_value) || 0;
    var inventory = Number(row.inventory_value) || 0;
    var chest = Number(row.chest_value) || 0;
    var shopStock = Number(row.shop_stock_value) || 0;
    return "Wallet " + fmtGold(balance)
      + " + inventory " + fmtGold(inventory)
      + (chest > 0 ? " + chests " + fmtGold(chest) : "")
      + (shopStock > 0 ? " + shop stock " + fmtGold(shopStock) : "");
  }

  function fillTable(tableId, rowsHtml, colSpan) {
    colSpan = colSpan || 4;
    var table = el(tableId);
    if (!table) return;
    var tbody = table.querySelector("tbody");
    tbody.innerHTML = rowsHtml || "<tr><td colspan=\"" + colSpan + "\" class=\"rmc-muted\">No data yet.</td></tr>";
  }

  function renderNetWorth(rows) {
    if (!rows.length) {
      fillTable("lb-networth", "", 4);
      fillTable("lb-wallet", "", 3);
      return;
    }
    fillTable("lb-networth", rows.map(function (row, i) {
      return "<tr><td>" + (row.rank || i + 1) + "</td><td>" + playerLink(playerName(row))
        + "</td><td class=\"lb-gold\">" + fmtGold(row.balance_value)
        + "</td><td class=\"lb-gold\" title=\"" + netWorthTitle(row).replace(/"/g, "&quot;") + "\">"
        + fmtGold(netWorthTotal(row)) + "</td></tr>";
    }).join(""));
    var byWallet = rows.slice().sort(function (a, b) {
      return (Number(b.balance_value) || 0) - (Number(a.balance_value) || 0);
    });
    fillTable("lb-wallet", byWallet.map(function (row, i) {
      return "<tr><td>" + (i + 1) + "</td><td>" + playerLink(playerName(row))
        + "</td><td class=\"lb-gold\">" + fmtGold(row.balance_value) + "</td></tr>";
    }).join(""), 3);
  }

  function renderPlaytime(rows) {
    fillTable("lb-playtime", (rows || []).map(function (row) {
      return "<tr><td>" + row.rank + "</td><td>" + playerLink(playerName(row))
        + "</td><td>" + fmtPlaytime(row.total_playtime_seconds) + "</td></tr>";
    }).join(""), 3);
  }

  function renderMcmmo(rows) {
    fillTable("lb-mcmmo", (rows || []).map(function (row) {
      return "<tr><td>" + row.rank + "</td><td>" + playerLink(playerName(row))
        + "</td><td class=\"lb-gold\">" + (Number(row.power_level) || 0).toLocaleString() + "</td></tr>";
    }).join(""), 3);
  }

  function renderGoldMinted(data) {
    var rows = (data && data.leaderboard) || [];
    if (data) {
      var totals = mintTotals(data);
      el("lb-mint-summary").hidden = false;
      el("lb-mint-gross-in").textContent = fmtGold(totals.grossIn);
      el("lb-mint-redeemed").textContent = fmtGold(totals.redeemed);
      el("lb-mint-net").textContent = fmtGold(totals.net);
      el("lb-mint-players").textContent = String(rows.length);
    }
    fillTable("lb-gold-minted", rows.map(function (row) {
      var net = mintNet(row);
      var netClass = net < 0 ? "lb-mint-negative" : "lb-gold";
      return "<tr><td>" + row.rank + "</td><td>" + playerLink(playerName(row))
        + "</td><td class=\"lb-gold\">" + fmtGold(mintGrossIn(row))
        + "</td><td>" + fmtGold(mintRedeemed(row))
        + "</td><td class=\"" + netClass + "\">" + fmtGold(net)
        + "</td><td>" + (Number(row.mint_events) || 0) + "</td></tr>";
    }).join(""), 6);
  }

  function renderGoldFound(rows, summary) {
    if (summary) {
      el("lb-gold-summary").hidden = false;
      el("lb-gold-primary-label").textContent = "Since opening (all players)";
      el("lb-gold-primary").textContent = fmtGold(summary.mined_since_july_g);
      el("lb-gold-physical").textContent = fmtGold(summary.physical_mined_since_july_g);
      el("lb-gold-players").textContent = String(summary.player_count || 0);
      var lootSinceJuly = Math.max(0, (Number(summary.mined_since_july_g) || 0) - (Number(summary.physical_mined_since_july_g) || 0));
      el("lb-gold-chest").textContent = fmtGold(lootSinceJuly);
    }
    var emptyNote = (!rows || !rows.length)
      ? "<tr><td colspan=\"6\" class=\"rmc-muted\">No gold-found rows synced yet — requires Root-Essentials gold tracker on the live server. Wallet <code>/mint</code> totals are in the panel above.</td></tr>"
      : "";
    fillTable("lb-gold-found", emptyNote + (rows || []).map(function (row) {
      var physicalJuly = (Number(row.mined_ore_since_july_g) || 0) + (Number(row.mined_block_since_july_g) || 0);
      return "<tr><td>" + row.rank + "</td><td>" + playerLink(playerName(row))
        + "</td><td class=\"lb-gold\">" + fmtGold(row.mined_since_july_g)
        + "</td><td class=\"lb-gold\">" + fmtGold(physicalJuly)
        + "</td><td class=\"lb-gold\">" + fmtGold(row.total_gold_g)
        + "</td><td class=\"lb-gold\">" + fmtGold(row.baseline_total_gold_g) + "</td></tr>";
    }).join(""), 6);
  }

  async function fetchBoard(path) {
    var res = await fetch(path, { cache: "no-store" });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      throw new Error(data.detail || ("HTTP " + res.status + " loading " + path));
    }
    return data;
  }

  async function loadGoldFound(sid) {
    var base = API + encodeURIComponent(sid);
    var data = await fetchBoard(base + "/gold-found/leaderboard?limit=" + LIMIT + "&order=since_july");
    renderGoldFound(data.leaderboard || [], data.summary);
    return data;
  }

  async function load() {
    var resolved = await resolveServerId();
    var sid = resolved.serverId;
    if (!sid) {
      el("lb-subtitle").textContent = "No featured server configured yet.";
      return;
    }

    if (!serverIdFromQuery()) {
      var next = new URLSearchParams(window.location.search);
      next.set("server", sid);
      var qs = next.toString();
      history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : ""));
    }

    el("lb-subtitle").textContent = (resolved.serverName || sid) + " · top " + LIMIT + " per board";

    var base = API + encodeURIComponent(sid);
    var mintPath = TREASURY + encodeURIComponent(FEATURED_FALLBACK_ID) + "/mint/leaderboard?limit=" + LIMIT;
    var boards = [
      { key: "networth", path: base + "/economy/net-worth?limit=" + LIMIT, render: function (data) {
        renderNetWorth((data && data.leaderboard) || []);
        return data && data.synced_at;
      }},
      { key: "mint", path: mintPath, render: function (data) {
        renderGoldMinted(data || {});
        return data && data.synced_at;
      }},
      { key: "goldFound", path: null, render: function (data) {
        renderGoldFound((data && data.leaderboard) || [], data && data.summary);
        return data && data.synced_at;
      }},
      { key: "playtime", path: base + "/playtime/leaderboard?limit=" + LIMIT, render: function (data) {
        renderPlaytime((data && data.leaderboard) || []);
        return data && data.synced_at;
      }},
      { key: "mcmmo", path: base + "/mcmmo/leaderboard?limit=" + LIMIT, render: function (data) {
        renderMcmmo((data && data.leaderboard) || []);
        return data && data.synced_at;
      }},
    ];

    var errors = [];
    var syncedAt = null;

    await Promise.all(boards.map(async function (board) {
      try {
        var data;
        if (board.key === "goldFound") {
          data = await loadGoldFound(sid);
        } else {
          data = await fetchBoard(board.path);
        }
        var synced = board.render(data);
        if (synced && !syncedAt) syncedAt = synced;
      } catch (err) {
        errors.push((board.key || "board") + ": " + (err.message || String(err)));
      }
    }));

    if (syncedAt) {
      el("lb-subtitle").textContent += " · updated " + new Date(syncedAt).toLocaleString();
    }
    if (errors.length) {
      el("lb-error").hidden = false;
      el("lb-error").textContent = errors.join(" · ");
    }
  }

  load();
})();
