(function () {
  var TREASURY = "/api/rootmc/treasury/";
  var SERVER_API = "/api/rootmc/server/";
  var FEATURED_FALLBACK = "rootmc";
  var LEDGER_PAGE_SIZE = 100;

  var state = {
    serverId: "",
    eraStartDate: "2026-07-03",
    ledgerTotal: 0,
    ledgerLoaded: 0,
    ledgerOffset: 0,
    ledgerLoading: false,
    ledgerDone: false,
    provenance: null,
    selectedGoldFoundUuid: "",
  };

  function el(id) { return document.getElementById(id); }

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

  function fmtPct(n) {
    if (n == null || !Number.isFinite(n)) return "\u2014";
    return n.toFixed(1) + "%";
  }

  function fmtWhen(iso) {
    if (!iso) return "\u2014";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return esc(iso);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function playerLink(name) {
    if (!name) return "\u2014";
    return "<a href=\"/player/?player=" + encodeURIComponent(name) + "\">" + esc(name) + "</a>";
  }

  async function resolveServerId() {
    try {
      var res = await fetch("/api/rootmc/server/config", { cache: "no-store" });
      var data = await res.json().catch(function () { return {}; });
      var sid = String((data.featured_server || {}).server_id || "").trim();
      if (sid) return sid;
    } catch (e) { /* fall through */ }
    return FEATURED_FALLBACK;
  }

  function showError(msg) {
    var node = el("mint-error");
    if (!node) return;
    node.textContent = msg;
    node.hidden = !msg;
  }

  function eraLabelShort(dateHst) {
    if (!dateHst) return "3 Jul";
    var parts = String(dateHst).split("-");
    if (parts.length !== 3) return dateHst;
    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    var m = parseInt(parts[1], 10);
    var d = parseInt(parts[2], 10);
    if (!m || !d) return dateHst;
    return d + " " + (months[m - 1] || parts[1]);
  }

  function eraLabelLong(dateHst) {
    if (!dateHst) return "3 July 2026";
    var parts = String(dateHst).split("-");
    if (parts.length !== 3) return dateHst;
    var months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    var m = parseInt(parts[1], 10);
    var d = parseInt(parts[2], 10);
    if (!m || !d) return dateHst;
    return d + " " + (months[m - 1] || parts[1]) + " " + parts[0];
  }

  function applyEraLabels(data) {
    var short = eraLabelShort(data.era_start_date_hst);
    var long = eraLabelLong(data.era_start_date_hst);
    var lb = el("mint-lb-note");
    if (lb) lb.textContent = "Net /mint by player since " + short + " \u2014 positive = more gold converted to Notes than redeemed.";
    var ledgerNote = el("mint-ledger-note");
    if (ledgerNote) {
      ledgerNote.textContent = "Every audited /mint action since " + long + " \u2014 gold converted to wallet Notes and Notes redeemed for physical gold.";
    }
    var eraLbl = el("mt-ledger-era-label");
    if (eraLbl) eraLbl.textContent = "(since " + short + ")";
  }

  function renderTransparency(data) {
    var tr = data.transparency || {};
    var lead = el("mint-role-summary");
    if (lead) lead.textContent = tr.summary || "";

    function set(id, text) {
      var node = el(id);
      if (node) node.textContent = text;
    }

    set("mt-gross-in", fmtGold(tr.ledger_gross_in_g));
    set("mt-redeemed-out", fmtGold(tr.ledger_redeemed_out_g));
    set("mt-net-backing", fmtGold(tr.ledger_net_backing_g));
    set("mt-wallet-notes", fmtGold(tr.player_wallet_notes_g));
    set("mt-reserve-notes", fmtGold(tr.reserve_notes_g));
    set("mt-total-circ", fmtGold(tr.total_circulation_g));
    set("mt-wallet-backing-pct", fmtPct(tr.wallet_backing_pct));
    set("mt-circulation-backing-pct", fmtPct(tr.circulation_backing_pct));
    set("mt-over-issue", fmtGold(tr.wallet_over_issue_g));
    set("mt-surplus", fmtGold(tr.era_surplus_headroom_g));
    set("mt-unminted-items", fmtGold(tr.physical_items_unminted_g));
    set("mt-gold-physical", fmtGold(tr.gold_found_physical_since_era_g));
    set("mt-gold-loot", fmtGold(tr.gold_found_loot_since_era_g));
    set("mt-gold-found", fmtGold(tr.gold_found_since_era_g));
  }

  function renderProvenanceWarning(provenance, goldFoundSummary) {
    var node = el("mint-provenance-warning");
    var body = el("mint-provenance-warning-body");
    if (!node || !body) return;
    provenance = provenance || {};
    state.provenance = provenance;

    var needsScan = !provenance.physical_scan_available;
    var needsEvents = !provenance.item_events_available;
    if (!needsScan && !needsEvents) {
      node.hidden = true;
      return;
    }

    var parts = [];
    if (needsScan) {
      parts.push(
        "Physical gold storage scan has not run — \"Gold not yet minted\" shows 0 until Root-Essentials 1.4.65+ and RootMC 1.3.50+ jars are on the live server."
      );
    }
    if (needsEvents) {
      parts.push(
        "Per-item gold receipts are empty (" + (provenance.item_events_count || 0) + " rows). Large \"gold found\" totals are activity counters only until the plugin syncs item events from MySQL."
      );
    }
    if (goldFoundSummary && Number(goldFoundSummary.loot_since_july_g) > 0) {
      parts.push(
        "Example: a 1,610 G tracker total can be mostly loot chests (~1,422 G) with only ~184 G from ore and blocks — not 1,610 G of items sitting in inventory."
      );
    }
    body.textContent = parts.join(" ");
    node.hidden = false;
  }

  function renderSummary(data) {
    var t = data.totals || {};
    var physical = data.physical_gold || {};

    el("mint-player-balances").textContent = fmtGold(t.total_player_balances_g);
    el("mint-total-minted").textContent = fmtGold(t.total_minted_g);
    el("mint-total-minted-meta").textContent =
      (t.mint_events || 0) + " conversions since " + eraLabelShort(data.era_start_date_hst);
    el("mint-unminted").textContent = fmtGold(t.unminted_gold_items_g);
    el("mint-unminted-meta").textContent = physical.scanned_at
      ? "scanned " + fmtWhen(physical.scanned_at)
      : "physical items at peg";

    el("mint-redeem").textContent = fmtGold(t.mint_redeem_g);
    el("mint-redeem-events").textContent = (t.redeem_events || 0) + " redemptions";
    el("mint-net").textContent = fmtGold(t.mint_net_g);
    el("mint-backing").textContent = fmtPct(
      (data.transparency && data.transparency.wallet_backing_pct != null)
        ? data.transparency.wallet_backing_pct
        : t.backing_pct
    );
    el("mint-ledger-count").textContent = String(t.mint_ledger_rows ?? "\u2014");

    state.ledgerTotal = Number(t.mint_ledger_rows) || 0;

    var synced = data.synced_at ? "Synced " + fmtWhen(data.synced_at) : "";
    el("mint-subtitle").textContent =
      "Physical gold \u2194 wallet Notes \u00b7 tracked from " + (data.era_start_date_hst || "2026-07-03") +
      (synced ? " \u00b7 " + synced : "");

    applyEraLabels(data);
  }

  function renderLeaderboard(rows) {
    var tbody = el("mint-leaderboard").querySelector("tbody");
    if (!rows || !rows.length) {
      tbody.innerHTML = "<tr><td colspan=\"6\" class=\"rmc-muted\">No /mint activity recorded yet.</td></tr>";
      return;
    }
    tbody.innerHTML = rows.map(function (row) {
      var net = mintNet(row);
      var netClass = net >= 0 ? "gold" : "lb-mint-negative";
      return "<tr>" +
        "<td>" + esc(row.rank) + "</td>" +
        "<td>" + playerLink(row.minecraft_username) + "</td>" +
        "<td class=\"gold\">" + fmtGold(mintGrossIn(row)) + "</td>" +
        "<td>" + fmtGold(mintRedeemed(row)) + "</td>" +
        "<td class=\"" + netClass + "\">" + fmtGold(net) + "</td>" +
        "<td>" + esc(row.mint_events) + "</td>" +
        "</tr>";
    }).join("");
  }

  function ledgerRowHtml(row, rowNum) {
    var kind = row.kind === "mint_out" ? "Notes \u2192 gold" : "Gold \u2192 Notes";
    var kindClass = row.kind === "mint_out" ? "mint-kind-out" : "mint-kind-in";
    return "<tr>" +
      "<td class=\"mint-row-num\">" + rowNum + "</td>" +
      "<td class=\"mint-when\">" + fmtWhen(row.created_at) + "</td>" +
      "<td>" + playerLink(row.minecraft_username) + "</td>" +
      "<td class=\"" + kindClass + "\">" + esc(kind) + "</td>" +
      "<td class=\"gold\">" + fmtGold(row.amount_g) + "</td>" +
      "</tr>";
  }

  function updateLedgerStatus() {
    var status = el("mint-ledger-status");
    if (!status) return;
    if (state.ledgerTotal === 0 && state.ledgerLoaded === 0) {
      status.textContent = "No /mint actions recorded since " + eraLabelLong(state.eraStartDate) + ".";
      return;
    }
    var shown = state.ledgerLoaded;
    var total = state.ledgerTotal;
    status.textContent = "Showing " + shown.toLocaleString() + " of " + total.toLocaleString() + " ledger rows.";
  }

  function appendLedgerRows(rows) {
    var tbody = el("mint-ledger-table").querySelector("tbody");
    if (!rows || !rows.length) {
      if (state.ledgerLoaded === 0) {
        tbody.innerHTML = "<tr><td colspan=\"5\" class=\"rmc-muted\">No ledger rows yet.</td></tr>";
      }
      return;
    }
    if (state.ledgerLoaded === 0) tbody.innerHTML = "";
    var html = rows.map(function (row, i) {
      return ledgerRowHtml(row, state.ledgerTotal - state.ledgerLoaded - i);
    }).join("");
    tbody.insertAdjacentHTML("beforeend", html);
    state.ledgerLoaded += rows.length;
    updateLedgerStatus();
    var moreBtn = el("mint-ledger-more");
    if (moreBtn) {
      moreBtn.hidden = state.ledgerDone || state.ledgerLoaded >= state.ledgerTotal;
    }
  }

  async function loadLedgerPage(append) {
    if (state.ledgerLoading || state.ledgerDone) return;
    state.ledgerLoading = true;
    var moreBtn = el("mint-ledger-more");
    if (moreBtn) moreBtn.disabled = true;

    try {
      var url = TREASURY + encodeURIComponent(state.serverId) +
        "/mint/ledger?limit=" + LEDGER_PAGE_SIZE + "&offset=" + (append ? state.ledgerOffset : 0);
      var res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("Mint ledger API returned " + res.status);
      var data = await res.json();
      if (!append) {
        state.ledgerLoaded = 0;
        state.ledgerOffset = 0;
        state.ledgerDone = false;
        state.ledgerTotal = Number(data.total) || state.ledgerTotal;
      }
      var entries = data.entries || [];
      state.ledgerOffset = Number(data.next_offset) || state.ledgerOffset;
      if (!data.has_more) state.ledgerDone = true;
      appendLedgerRows(entries);
    } catch (err) {
      var status = el("mint-ledger-status");
      if (status) {
        status.textContent = err && err.message ? err.message : "Failed to load mint ledger.";
      }
    } finally {
      state.ledgerLoading = false;
      if (moreBtn) {
        moreBtn.disabled = false;
        moreBtn.hidden = state.ledgerDone || state.ledgerLoaded >= state.ledgerTotal;
      }
    }
  }

  function renderStorage(physical) {
    physical = physical || {};
    el("mint-storage-total").textContent = fmtGold(physical.total_storage_g);
    el("mint-storage-players").textContent = String(physical.player_count ?? "\u2014");
    el("mint-storage-scanned").textContent = physical.scanned_at ? fmtWhen(physical.scanned_at) : "Awaiting scan";
  }

  function renderGoldFound(rows) {
    var tbody = el("mint-gold-found").querySelector("tbody");
    if (!rows || !rows.length) {
      tbody.innerHTML = "<tr><td colspan=\"5\" class=\"rmc-muted\">No gold-found tracker data yet.</td></tr>";
      return;
    }
    tbody.innerHTML = rows.map(function (row) {
      var physical = Number(row.physical_mined_since_july_g);
      if (!Number.isFinite(physical)) {
        physical = (Number(row.mined_ore_since_july_g) || 0) + (Number(row.mined_block_since_july_g) || 0);
      }
      var loot = Number(row.loot_since_july_g);
      if (!Number.isFinite(loot)) {
        var since = Number(row.mined_since_july_g);
        if (!Number.isFinite(since)) {
          since = Number(row.total_gold_g) - Number(row.baseline_total_gold_g);
        }
        loot = Math.max(0, since - physical);
      }
      var selected = state.selectedGoldFoundUuid === row.minecraft_uuid ? " mint-gold-found-row--active" : "";
      return "<tr class=\"mint-gold-found-row" + selected + "\" data-uuid=\"" + esc(row.minecraft_uuid) + "\" data-player=\"" + esc(row.minecraft_username || "") + "\" tabindex=\"0\" role=\"button\">" +
        "<td>" + esc(row.rank || 0) + "</td>" +
        "<td>" + playerLink(row.minecraft_username) + "</td>" +
        "<td class=\"gold\">" + fmtGold(physical) + "</td>" +
        "<td>" + fmtGold(loot) + "</td>" +
        "<td>" + esc(row.find_events || 0) + "</td>" +
        "</tr>";
    }).join("");
  }

  function formatLocation(row) {
    if (!row.world) return "\u2014";
    var loc = esc(row.world);
    if (row.block_x != null && row.block_y != null && row.block_z != null) {
      loc += " " + row.block_x + ", " + row.block_y + ", " + row.block_z;
    }
    return loc;
  }

  function renderItemEvents(playerName, events, provenance) {
    var panel = el("mint-item-events");
    var title = el("mint-item-events-title");
    var status = el("mint-item-events-status");
    var tbody = el("mint-item-events-body");
    if (!panel || !tbody) return;

    panel.hidden = false;
    if (title) title.textContent = "Item receipts — " + (playerName || "player");

    if (!events || !events.length) {
      if (status) {
        status.textContent = provenance && provenance.item_events_available
          ? "No item receipts for this player yet."
          : "Item receipts not synced — live server needs Root-Essentials 1.4.65+ exporting gold_item_events.";
      }
      tbody.innerHTML = "<tr><td colspan=\"6\" class=\"rmc-muted\">No rows</td></tr>";
      return;
    }

    if (status) status.textContent = "Showing " + events.length + " most recent item events.";
    tbody.innerHTML = events.map(function (row) {
      return "<tr>" +
        "<td class=\"mint-when\">" + fmtWhen(row.occurred_at) + "</td>" +
        "<td>" + esc(row.obtained_via || row.event_type) + "</td>" +
        "<td>" + esc(row.material) + "</td>" +
        "<td>" + esc(row.stack_amount) + "</td>" +
        "<td class=\"gold\">" + fmtGold(row.gold_g) + "</td>" +
        "<td class=\"mint-loc\">" + formatLocation(row) + "</td>" +
        "</tr>";
    }).join("");
  }

  async function loadItemEventsForPlayer(uuid, playerName) {
    state.selectedGoldFoundUuid = uuid || "";
    var rows = el("mint-gold-found").querySelectorAll(".mint-gold-found-row");
    rows.forEach(function (tr) {
      tr.classList.toggle("mint-gold-found-row--active", tr.getAttribute("data-uuid") === uuid);
    });

    try {
      var url = SERVER_API + encodeURIComponent(state.serverId) +
        "/gold-items/events?uuid=" + encodeURIComponent(uuid) + "&limit=25";
      var res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("Item events API returned " + res.status);
      var data = await res.json();
      renderItemEvents(playerName || data.player, data.events || [], state.provenance);
    } catch (err) {
      renderItemEvents(playerName, [], state.provenance);
      var status = el("mint-item-events-status");
      if (status) status.textContent = err && err.message ? err.message : "Failed to load item receipts.";
    }
  }

  function bindGoldFoundClicks() {
    var table = el("mint-gold-found");
    if (!table) return;
    table.addEventListener("click", function (evt) {
      var tr = evt.target.closest(".mint-gold-found-row");
      if (!tr) return;
      loadItemEventsForPlayer(tr.getAttribute("data-uuid"), tr.getAttribute("data-player"));
    });
    table.addEventListener("keydown", function (evt) {
      if (evt.key !== "Enter" && evt.key !== " ") return;
      var tr = evt.target.closest(".mint-gold-found-row");
      if (!tr) return;
      evt.preventDefault();
      loadItemEventsForPlayer(tr.getAttribute("data-uuid"), tr.getAttribute("data-player"));
    });
  }

  async function load() {
    showError("");
    state.serverId = await resolveServerId();
    try {
      var res = await fetch(
        TREASURY + encodeURIComponent(state.serverId) + "/mint/department?limit=50",
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error("Mint department API returned " + res.status);
      var data = await res.json();
      state.eraStartDate = data.era_start_date_hst || "2026-07-03";
      renderSummary(data);
      renderTransparency(data);
      renderProvenanceWarning(data.provenance, data.gold_found_summary);
      renderLeaderboard(data.leaderboard);
      renderStorage(data.physical_gold);
      renderGoldFound(data.gold_found_since_era);
      await loadLedgerPage(false);
    } catch (err) {
      showError(err && err.message ? err.message : "Failed to load mint department data.");
      el("mint-subtitle").textContent = "Could not load department data.";
    }
  }

  function bindLedgerMore() {
    var moreBtn = el("mint-ledger-more");
    if (!moreBtn) return;
    moreBtn.addEventListener("click", function () {
      loadLedgerPage(true);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      bindLedgerMore();
      bindGoldFoundClicks();
      load();
    });
  } else {
    bindLedgerMore();
    bindGoldFoundClicks();
    load();
  }
})();
