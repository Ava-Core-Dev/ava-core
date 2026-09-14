(function () {
  var API = "/api/rootmc/treasury/";
  var TREASURY_ID = "rootmc";
  var FEATURED_FALLBACK_ID = "rootmc";
  var LEDGER_PAGE = 25;

  var CHART_GOLD = "#f5b942";
  var CHART_GOLD_FILL = "rgba(245, 185, 66, 0.16)";
  var CHART_HOLDER = "#7eb8da";
  var CHART_HOLDER_FILL = "rgba(126, 184, 218, 0.08)";
  var CHART_IN = "#5dd39e";
  var CHART_OUT = "#ef5b5b";
  var CHART_GRID = "rgba(255, 255, 255, 0.05)";
  var CHART_TICK = "#a1afa8";

  var TYPE_COLORS = {
    OPENING: "#d4a853",
    TAX: "#f5b942",
    NOTE_BURN: "#e06c6c",
    DONATION: "#6ec9a8",
    DEATH: "#c97b4a",
    TOWNY_SINK: "#7eb8da",
    LOAN_PRINCIPAL: "#9b8cff",
    LOAN_INTEREST: "#b8a8ff",
    VOTE: "#5dd39e",
    GRANT: "#ef5b5b",
    DIVIDEND: "#ff8f6b",
    LOAN_DISBURSE: "#e06c9f",
    OTHER: "#a1afa8",
  };

  var TYPE_LABELS = {
    TOWNY_SINK: "Server fees (Towny)",
    VOTE: "Vote Rewards",
    GRANT: "Grants",
    DIVIDEND: "Treasury payouts",
    MINT_GROSS: "/mint conversion",
    MINT_REDEEM: "/mint gold redemption",
  };

  function typeDisplayLabel(type, glossary) {
    var t = String(type || "").trim();
    if (!t) return "—";
    if (TYPE_LABELS[t]) return TYPE_LABELS[t];
    var row = (glossary || []).find(function (g) { return g.type === t; });
    if (row && row.label) {
      var short = String(row.label).split(" — ")[0].split(" (")[0].trim();
      if (short) return short;
    }
    return t;
  }

  var state = {
    serverId: "",
    summary: null,
    ledgerPage: 1,
    ledgerTotal: 0,
    balanceChart: null,
    flowChart: null,
    chartRange: "days",
    viewMonth: "",
  };

  function el(id) { return document.getElementById(id); }

  function params() { return new URLSearchParams(window.location.search); }

  async function fetchJsonWithTimeout(url, timeoutMs) {
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, Math.max(1000, timeoutMs || 8000));
    try {
      var res = await fetch(url, { cache: "no-store", signal: controller.signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function serverIdFromQuery() {
    return (params().get("server") || params().get("server_id") || "").trim();
  }

  function monthFromQuery() {
    return (params().get("month") || "").trim();
  }

  function monthPeriodLabel(data) {
    data = data || {};
    if (data.viewing_historical_month && data.view_hst_month) {
      return String(data.view_hst_month);
    }
    return "MTD";
  }

  function renderMonthSelector(data) {
    var bar = el("reserve-month-bar");
    var sel = el("f-month");
    var note = el("reserve-month-note");
    var prevBtn = el("f-month-prev");
    var nextBtn = el("f-month-next");
    if (!bar || !sel) return;
    var months = (data && data.available_months) || [];
    var viewMonth = String((data && (data.view_hst_month || data.current_hst_month)) || "");
    var liveMonth = String((data && data.current_hst_month) || "");
    state.viewMonth = viewMonth;
    if (!months.length && viewMonth) months = [viewMonth];
    if (!months.length) {
      sel.innerHTML = '<option value="">No ledger months yet</option>';
      if (prevBtn) prevBtn.disabled = true;
      if (nextBtn) nextBtn.disabled = true;
      return;
    }
    var current = sel.value;
    sel.innerHTML = months.map(function (m) {
      var label = m === liveMonth ? m + " (current)" : m;
      return '<option value="' + escapeHtml(m) + '">' + escapeHtml(label) + "</option>";
    }).join("");
    sel.value = viewMonth;
    if (!sel.value && months[0]) sel.value = months[0];

    var idx = months.indexOf(sel.value);
    if (prevBtn) prevBtn.disabled = idx < 0 || idx >= months.length - 1;
    if (nextBtn) nextBtn.disabled = idx <= 0;

    if (note) {
      var period = monthPeriodLabel(data);
      if (data && data.locked_hst_baseline) {
        note.textContent =
          "Locked audit baseline for " + data.locked_hst_baseline + " (old map). Post-reset /mint and grant metrics count from "
          + (data.post_reset_metrics_from_hst_month || "2026-07") + " onward.";
      } else if (data && data.viewing_historical_month) {
        note.textContent =
          "Showing " + period + " only — balance and cumulative totals exclude later months.";
      } else if (liveMonth && sel.value === liveMonth && Number((data.month || {}).net) === 0 && months.length > 1) {
        note.textContent =
          "No treasury activity yet in " + liveMonth + ". Select " + months[1] + " to view last month\u2019s transactions.";
      } else {
        note.textContent = "Ledger and charts below match the selected HST month (" + period + ").";
      }
    }
    if (current !== sel.value) {
      var next = new URLSearchParams(window.location.search);
      if (sel.value && sel.value !== liveMonth) next.set("month", sel.value);
      else next.delete("month");
      var qs = next.toString();
      history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : ""));
    }
  }

  function navigateMonth(delta) {
    var data = state.summary || {};
    var months = data.available_months || [];
    var viewMonth = String(selMonthValue() || data.view_hst_month || "");
    var idx = months.indexOf(viewMonth);
    if (idx < 0) return;
    var nextIdx = idx - delta;
    if (nextIdx < 0 || nextIdx >= months.length) return;
    applyMonthSelection(months[nextIdx]);
  }

  function selMonthValue() {
    var sel = el("f-month");
    return sel ? String(sel.value || "").trim() : "";
  }

  function applyMonthSelection(monthKey) {
    var next = new URLSearchParams(window.location.search);
    var live = state.summary && state.summary.current_hst_month;
    if (monthKey && monthKey !== live) next.set("month", monthKey);
    else next.delete("month");
    var qs = next.toString();
    history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : ""));
    load().catch(function (e) { setError(e.message); });
  }

  function updateMonthLabels(data) {
    var period = monthPeriodLabel(data);
    var inLabel = el("rs-in-label");
    var outLabel = el("rs-out-label");
    var netLabel = el("rs-net-label");
    var balLabel = document.querySelector("#reserve-summary .market-summary-cell .market-summary-label");
    var allLabel = document.querySelector("#reserve-summary .market-summary-cell--meta .market-summary-label");
    if (inLabel) inLabel.textContent = period + " inflows";
    if (outLabel) outLabel.textContent = period + " outflows";
    if (netLabel) netLabel.textContent = period + " net";
    if (balLabel) {
      balLabel.textContent = data && data.viewing_historical_month
        ? "End-of-month balance"
        : "Reserve balance";
    }
    if (allLabel) {
      allLabel.textContent = data && data.viewing_historical_month
        ? "Cumulative net (through " + String(data.view_hst_month || period) + ")"
        : "Post-reset ledger net";
    }
  }

  async function resolveServerId() {
    var sid = serverIdFromQuery();
    if (sid) return { serverId: sid, serverName: null };
    try {
      var data = await fetchJsonWithTimeout("/api/rootmc/server/config", 8000).catch(function () { return {}; });
      var featured = data.featured_server || {};
      sid = String(featured.server_id || "").trim();
      if (sid) return { serverId: sid, serverName: featured.name || null };
    } catch (e) { /* fall through */ }
    return { serverId: FEATURED_FALLBACK_ID, serverName: "RootMC" };
  }

  function fmtGold(n) {
    if (!Number.isFinite(n)) return "—";
    var sign = n < 0 ? "−" : "";
    return sign + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + " G";
  }

  function fmtWhen(iso) {
    if (!iso) return "—";
    var s = String(iso).trim();
    if (!s) return "—";
    if (!/Z$/i.test(s) && !/[+-]\d{2}:?\d{2}$/.test(s)) {
      s = s.replace(" ", "T") + "Z";
    }
    var d = new Date(s);
    if (isNaN(d.getTime())) return String(iso).slice(0, 16).replace("T", " ");
    return d.toLocaleString(undefined, {
      timeZone: "Pacific/Honolulu",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    }) + " HST";
  }

  function setError(msg) {
    var e = el("reserve-error") || el("eco-error");
    if (!e) return;
    if (msg) { e.textContent = msg; e.hidden = false; }
    else { e.hidden = true; e.textContent = ""; }
  }

  function fmtPct(n) {
    if (!Number.isFinite(n)) return "—";
    var sign = n > 0 ? "+" : "";
    return sign + n.toFixed(1) + "%";
  }

  /** @param {"good-up"|"bad-up"|"neutral"} tone */
  function renderChange(nodeId, pct, tone) {
    var node = el(nodeId);
    if (!node) return;
    if (!Number.isFinite(pct)) {
      node.textContent = "";
      node.hidden = true;
      node.className = "reserve-change";
      return;
    }
    node.hidden = false;
    if (Math.abs(pct) < 0.05) {
      node.textContent = "flat";
      node.className = "reserve-change flat";
      return;
    }
    var up = pct > 0;
    var good = tone === "neutral" ? up : tone === "bad-up" ? !up : up;
    node.textContent = fmtPct(pct);
    node.className = "reserve-change " + (good ? "reserve-in" : "reserve-out");
  }

  function changes(data) {
    return (data && data.changes_vs_prior_month) || {};
  }

  function monthBounds() {
    var mb = (state.summary && state.summary.month_bounds) || {};
    return { start: String(mb.start || ""), end: String(mb.end || "") };
  }

  function flowDailyForView(summary) {
    summary = summary || {};
    var flow = summary.flow_daily || [];
    var mb = summary.month_bounds || {};
    var start = String(mb.start || "").slice(0, 10);
    var end = String(mb.end || "").slice(0, 10);
    if (!start || !end) return flow;
    return flow.filter(function (d) {
      var day = String(d.day || "");
      return day >= start && day < end;
    });
  }

  function updateFlowChartNote(data) {
    var node = el("rs-flow-chart-note");
    if (!node) return;
    var period = monthPeriodLabel(data || {});
    node.textContent = period + " — reserve inflows/outflows (server fees, tax, grants, votes).";
  }

  function destroyChart(key) {
    if (state[key]) {
      state[key].destroy();
      state[key] = null;
    }
  }

  function renderTownyIntake(mtd, allTime, townyChanges, data) {
    var panel = el("reserve-towny-panel");
    var mtdHost = el("reserve-towny-mtd");
    var allEl = el("reserve-towny-all");
    if (!panel || !mtdHost) return;
    var period = monthPeriodLabel(data);
    var rows = [
      { key: "new_town", label: "New towns" },
      { key: "new_nation", label: "New nations" },
      { key: "claims", label: "Claims" },
      { key: "service_fees", label: "Service fees" },
    ];
    var ch = townyChanges || {};
    var hasAny = rows.some(function (r) {
      return (Number((mtd || {})[r.key]) || 0) > 0 || (Number((allTime || {})[r.key]) || 0) > 0;
    });
    panel.hidden = false;
    if (!hasAny && !(Number((mtd || {}).other) || Number((allTime || {}).other))) {
      mtdHost.innerHTML =
        '<p class="rmc-muted">No tagged Towny founding rows synced yet. New /town new, nation create, and claim fees are logged after <code>root-essentials 1.4.24+</code> is on the server.</p>';
      if (allEl) allEl.textContent = "";
      return;
    }
    mtdHost.innerHTML = rows.map(function (r) {
      var pct = Number(ch[r.key]);
      var pctHtml = Number.isFinite(pct)
        ? '<div class="reserve-change' + (Math.abs(pct) < 0.05 ? " flat" : (pct > 0 ? " reserve-in" : " reserve-out")) + '">' + (Math.abs(pct) < 0.05 ? "flat" : fmtPct(pct)) + "</div>"
        : "";
      return (
        '<div class="reserve-towny-cell">' +
        '<div class="reserve-towny-label">' + r.label + "</div>" +
        '<div class="reserve-towny-value">' + fmtGold(Number((mtd || {})[r.key])) + "</div>" +
        pctHtml +
        '<div class="reserve-towny-sub">' + period + "</div>" +
        "</div>"
      );
    }).join("");
    var otherMtd = Number((mtd || {}).other) || 0;
    var otherAll = Number((allTime || {}).other) || 0;
    if (otherMtd > 0 || otherAll > 0) {
      var otherPct = Number(ch.other);
      var otherPctHtml = Number.isFinite(otherPct)
        ? '<div class="reserve-change' + (Math.abs(otherPct) < 0.05 ? " flat" : (otherPct > 0 ? " reserve-in" : " reserve-out")) + '">' + (Math.abs(otherPct) < 0.05 ? "flat" : fmtPct(otherPct)) + "</div>"
        : "";
      mtdHost.innerHTML +=
        '<div class="reserve-towny-cell reserve-towny-cell--other">' +
        '<div class="reserve-towny-label">Other Towny</div>' +
        '<div class="reserve-towny-value">' + fmtGold(otherMtd) + "</div>" +
        otherPctHtml +
        '<div class="reserve-towny-sub">' + period + " · legacy/un tagged</div>" +
        "</div>";
    }
    if (allEl) {
      var totalPct = Number(ch.total);
      var totalPctTxt = Number.isFinite(totalPct)
        ? " · " + period + " " + fmtPct(totalPct) + " vs prior month"
        : "";
      allEl.textContent =
        "All-time Towny intake: " +
        fmtGold(Number((allTime || {}).total)) +
        " (towns " +
        fmtGold(Number(allTime.new_town)) +
        " · nations " +
        fmtGold(Number(allTime.new_nation)) +
        " · claims " +
        fmtGold(Number(allTime.claims)) +
        ")" +
        totalPctTxt;
    }
  }

  function renderNoteSupply(data) {
    var ns = data.note_supply;
    var payable = data.payable_supply || null;
    var overEl = el("rs-over-issue");
    var cell = el("rs-note-supply-cell");
    if (!overEl || !cell) return;
    if (!ns && !payable) {
      cell.hidden = true;
      return;
    }
    cell.hidden = false;
    var label = cell.querySelector(".market-summary-label");
    var meta = cell.querySelector(".market-summary-meta");
    if (payable) {
      var managed = Number(payable.reserve_managed_g != null ? payable.reserve_managed_g : payable.reserve_position_g);
      var shortfall = managed < -0.01 ? -managed : 0;
      if (label) label.textContent = "Private-claim shortfall";
      if (shortfall > 0.01) {
        overEl.textContent = fmtGold(shortfall);
        overEl.className = "market-summary-value reserve-out";
      } else {
        overEl.textContent = "None";
        overEl.className = "market-summary-value reserve-in";
      }
      if (meta) {
        meta.textContent = "Mint backing minus player/town/nation/bond claims";
      }
      return;
    }
    var over = Number(ns.over_issue_g) || 0;
    if (ns.status === "over_issued" && over > 0.01) {
      if (label) label.textContent = "Shortfall vs /mint";
      overEl.textContent = fmtGold(over);
      overEl.className = "market-summary-value reserve-out";
    } else {
      if (label) label.textContent = "Shortfall vs /mint";
      overEl.textContent = "None";
      overEl.className = "market-summary-value reserve-in";
    }
    if (meta) meta.innerHTML = '<a href="#eco-note-panel">Gold backing</a> details above';
  }

  function renderSupplyIntegrity(data) {
    var panel = el("reserve-integrity-panel");
    var integrity = data && data.supply_integrity;
    if (!panel || !integrity) {
      if (panel) panel.hidden = true;
      return;
    }
    panel.hidden = false;
    var openingEl = el("rs-integrity-opening");
    if (openingEl) openingEl.textContent = fmtGold(Number(integrity.july_reserve_opening_g));
    var balEl = el("rs-integrity-balance");
    if (balEl) {
      var intBal = Number(integrity.current_reserve_balance_g);
      balEl.textContent = fmtGold(intBal);
      balEl.classList.toggle("reserve-neg", Number.isFinite(intBal) && intBal < 0);
    }
    var delta = Number(integrity.reserve_delta_from_july_opening_g);
    var deltaEl = el("rs-integrity-delta");
    if (deltaEl) {
      deltaEl.textContent = (delta >= 0 ? "+" : "") + fmtGold(delta);
      deltaEl.classList.toggle("reserve-in", delta > 0.01);
      deltaEl.classList.toggle("reserve-out", delta < -0.01);
    }
    var mintEl = el("rs-integrity-mint");
    if (mintEl) mintEl.textContent = fmtGold(Number(integrity.gold_mined_mint_since_july_g));
    var donationsEl = el("rs-integrity-donations");
    if (donationsEl) {
      var donationG = Number(integrity.reserve_donations_since_july_g) || 0;
      donationsEl.textContent = donationG > 0.01 ? fmtGold(donationG) : "None";
    }
    var foundEl = el("rs-integrity-found");
    if (foundEl) foundEl.textContent = fmtGold(Number(integrity.gold_found_physical_since_july_g));
    var storageEl = el("rs-integrity-storage");
    if (storageEl) storageEl.textContent = fmtGold(Number(integrity.physical_gold_in_storage_g));
    var storageMeta = el("rs-integrity-storage-meta");
    if (storageMeta) {
      var pg = data.physical_gold_storage_summary || {};
      var scanned = pg.scanned_at ? "scanned " + String(pg.scanned_at) : "";
      var unattributed = Number(pg.unattributed_g) || 0;
      storageMeta.textContent = scanned
        ? scanned + (unattributed > 0.01 ? " · " + fmtGold(unattributed) + " G in world chests (unattributed)" : "")
        : "Periodic scan of inventory, ender chest, shop stock, and loaded containers.";
    }
    var summaryEl = el("rs-integrity-summary");
    if (summaryEl && integrity.summary) summaryEl.textContent = integrity.summary;
    var alertEl = el("rs-integrity-alert");
    if (alertEl) {
      var warn = integrity.status && integrity.status !== "ok";
      alertEl.hidden = !warn;
      if (warn) {
        alertEl.textContent = integrity.summary || "Supply integrity check flagged a mismatch.";
      }
    }
  }

  function renderGoldFoundLeaderboard(data) {
    var panel = el("reserve-gold-found-panel");
    var rows = (data && data.gold_found_leaderboard_since_july) || [];
    if (!panel) return;
    if (!rows.length) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    var tbody = document.querySelector("#rs-gold-found-table tbody");
    if (!tbody) return;
    tbody.innerHTML = rows.map(function (row) {
      var physical = (Number(row.mined_ore_since_july_g) || 0) + (Number(row.mined_block_since_july_g) || 0);
      var name = row.minecraft_username || row.minecraft_uuid || "—";
      return "<tr><td>" + row.rank + "</td><td>" + playerLink(name)
        + "</td><td class=\"lb-gold\">" + fmtGold(row.mined_since_july_g)
        + "</td><td class=\"lb-gold\">" + fmtGold(physical)
        + "</td><td class=\"lb-gold\">" + fmtGold(row.total_gold_g)
        + "</td><td class=\"lb-gold\">" + fmtGold(row.baseline_total_gold_g) + "</td></tr>";
    }).join("");
    var meta = el("rs-gold-found-meta");
    if (meta) {
      var synced = data.gold_found_synced_at ? " · synced " + String(data.gold_found_synced_at) : "";
      meta.textContent = rows.length + " players with gold found since opening" + synced;
    }
  }

  function renderExecutiveTransactions(data) {
    var panel = el("reserve-executive-panel");
    var table = el("rs-executive");
    var empty = el("rs-executive-empty");
    var meta = el("rs-executive-meta");
    if (!panel || !table) return;
    var block = data.executive_transactions_24h || {};
    var entries = (block.entries || []).slice();
    if (data.locked_hst_baseline || data.viewing_historical_month) {
      panel.hidden = true;
      return;
    }
    panel.hidden = false;
    var count = Number(block.count) || entries.length;
    var net = Number(block.net);
    var metaParts = [];
    if (Number.isFinite(count)) metaParts.push(count + " row" + (count === 1 ? "" : "s"));
    if (Number.isFinite(net)) metaParts.push("net " + fmtGold(net));
    if (block.since_iso) metaParts.push("since " + fmtWhen(block.since_iso));
    if (meta) meta.textContent = metaParts.join(" · ");

    var tbody = table.querySelector("tbody");
    if (!tbody) return;
    if (!entries.length) {
      tbody.innerHTML = "";
      table.hidden = true;
      if (empty) empty.hidden = false;
      return;
    }
    table.hidden = false;
    if (empty) empty.hidden = true;
    var glossary = (data.type_glossary || []);
    tbody.innerHTML = entries.map(function (row) {
      var dirClass = row.direction === "inflow" ? "reserve-in" : row.direction === "outflow" ? "reserve-out" : "";
      var typeName = typeDisplayLabel(row.entry_type, glossary);
      var kind = escapeHtml(row.executive_label || "Executive");
      var details = escapeHtml(row.public_details || formatLedgerDetails(row.details));
      var operator = row.operator_display && row.operator_display !== "—"
        ? " · " + escapeHtml(row.operator_display)
        : "";
      return "<tr>"
        + "<td>" + escapeHtml(fmtWhen(row.created_at)) + "</td>"
        + "<td>" + kind + operator + "</td>"
        + "<td>" + escapeHtml(typeName) + "</td>"
        + "<td>" + playerLink(row.from_display) + "</td>"
        + "<td>" + playerLink(ledgerDestination(row)) + "</td>"
        + "<td class=\"" + dirClass + "\">" + fmtGold(Number(row.amount)) + "</td>"
        + "<td class=\"reserve-details\">" + details + "</td>"
        + "</tr>";
    }).join("");
  }

  function reserveGrossLedger(data) {
    var gross = Number(data.map_262_gross_reserve_balance);
    if (Number.isFinite(gross)) return gross;
    var allNet = Number((data.all_time || {}).net);
    if (Number.isFinite(allNet)) return allNet;
    return Number(data.balance);
  }

  function reserveManagedBalance(data) {
    var payable = data && data.payable_supply;
    if (payable && Number.isFinite(Number(payable.reserve_managed_g))) {
      return Number(payable.reserve_managed_g);
    }
    if (Number.isFinite(Number(data.balance))) return Number(data.balance);
    return reserveGrossLedger(data);
  }

  function reserveVaultBalance(data) {
    var vault = Number(data.vault_balance);
    if (Number.isFinite(vault)) return vault;
    vault = Number((data.payable_supply || {}).reserve_vault_g);
    if (Number.isFinite(vault)) return vault;
    return Number((data.note_supply || {}).reserve_notes_g);
  }

  function renderSummary(data) {
    el("reserve-summary").hidden = false;
    renderMonthSelector(data);
    updateMonthLabels(data);
    var ch = changes(data);
    var grossBal = reserveGrossLedger(data);
    // Headline = July 1+ ledger net (same as in-game /tax), not mint−claims.
    var bal = Number.isFinite(grossBal) ? grossBal : Number(data.balance);
    var balEl = el("rs-balance");
    balEl.textContent = fmtGold(bal);
    balEl.classList.toggle("reserve-out", bal < -0.01);
    balEl.classList.toggle("reserve-in", bal >= -0.01);
    balEl.classList.toggle("reserve-neg", Number.isFinite(bal) && bal < 0);
    var balWrap = balEl && balEl.closest(".market-summary-cell");
    var balMeta = balWrap && balWrap.querySelector(".market-summary-meta");
    if (balMeta) {
      balMeta.textContent = "July 1+ treasury ledger · matches /tax";
    }

    var month = data.month || {};
    el("rs-mtd-in").textContent = fmtGold(Number(month.inflow));
    el("rs-mtd-out").textContent = fmtGold(Number(month.outflow));
    var net = Number(month.net);
    var netEl = el("rs-mtd-net");
    netEl.textContent = fmtGold(net);
    netEl.classList.toggle("reserve-neg", Number.isFinite(net) && net < 0);

    var allNet = Number((data.all_time || {}).net);
    var allEl = el("rs-all-net");
    allEl.textContent = fmtGold(allNet);
    allEl.classList.toggle("reserve-neg", Number.isFinite(allNet) && allNet < 0);

    var minedEl = el("rs-gold-mined");
    if (minedEl) minedEl.textContent = fmtGold(Number(data.gold_mined_post_reset || data.total_gold_mined || data.total_gold_minted));
    var foundJulyEl = el("rs-gold-found-july");
    var gfSummary = data.gold_found_summary || {};
    if (foundJulyEl) foundJulyEl.textContent = fmtGold(Number(gfSummary.mined_since_july_g));
    var minedMeta = document.querySelector("#gold-mined .market-summary-meta");
    if (minedMeta) {
      minedMeta.textContent = data.locked_hst_baseline
        ? "Post-reset /mint tracked from " + (data.post_reset_metrics_from_hst_month || "2026-07") + " HST onward"
        : "Physical /mint since July 1";
    }

    renderSupplyIntegrity(data);
    renderNoteSupply(data);
    renderGoldFoundLeaderboard(data);
    renderExecutiveTransactions(data);

    var preJulyCell = el("rs-pre-july-baseline");
    if (preJulyCell && preJulyCell.closest(".market-summary-cell")) {
      preJulyCell.closest(".market-summary-cell").hidden = true;
    }
    var openingCell = el("rs-true-opening");
    if (openingCell && openingCell.closest(".market-summary-cell")) {
      openingCell.closest(".market-summary-cell").hidden = true;
    }

    renderChange("rs-balance-change", Number(ch.balance_pct), "good-up");
    renderChange("rs-mtd-in-change", Number(ch.mtd_inflow_pct), "good-up");
    renderChange("rs-mtd-out-change", Number(ch.mtd_outflow_pct), "bad-up");
    renderChange("rs-mtd-net-change", Number(ch.mtd_net_pct), "good-up");
    renderChange("rs-all-net-change", Number(ch.all_time_month_contribution_pct), "good-up");

    var changeLabel = el("rs-change-label");
    if (changeLabel) {
      var label = String(ch.label || "");
      var priorMonth = String(data.prior_hst_month || "");
      changeLabel.textContent = label
        ? label + (priorMonth ? " · balance vs end of " + priorMonth : "")
        : "";
    }

    var synced = data.synced_at ? "Last sync " + fmtWhen(data.synced_at) : "";
    var hst = data.view_hst_month
      ? " · Viewing " + data.view_hst_month + (data.viewing_historical_month ? " (historical)" : " (current)")
      : (data.current_hst_month ? " · HST month " + data.current_hst_month : "");
    var avg = Number(data.average_monthly_net);
    var avgTxt = Number.isFinite(avg) ? " · avg monthly net " + fmtGold(avg) : "";
    var avgPct = Number(ch.average_monthly_net_pct);
    if (Number.isFinite(avgPct)) avgTxt += " (" + fmtPct(avgPct) + " vs avg)";
    var recon = "";
    el("rs-meta").textContent = (synced + hst + avgTxt + recon).trim();

    if (data.scope_note) {
      var scopeEl = el("reserve-scope");
      if (scopeEl) {
        scopeEl.textContent = data.scope_note;
        scopeEl.hidden = false;
      }
    }

    fillTypeFilter(data.type_glossary || []);
    updateFlowChartNote(data);
    renderGlossary((data.type_glossary || []).concat(
      (data.towny_intake_glossary || []).map(function (row) {
        return { type: row.key, direction: "inflow", label: row.label };
      }),
    ), month.by_type || {}, ch.by_type || {});
    renderTownyIntake(data.towny_intake_mtd, data.towny_intake_all_time, ch.towny || {}, data);
  }

  var HST_OFFSET_MS = 10 * 60 * 60 * 1000;

  function hstDayKey(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    var hst = new Date(d.getTime() - HST_OFFSET_MS);
    return hst.getUTCFullYear() + "-"
      + String(hst.getUTCMonth() + 1).padStart(2, "0") + "-"
      + String(hst.getUTCDate()).padStart(2, "0");
  }

  function hstDayStartIso(dayKey) {
    var ms = Date.parse(dayKey + "T00:00:00-10:00");
    if (isNaN(ms)) return "";
    return new Date(ms).toISOString();
  }

  function rangeKey(iso, range) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    if (range === "days") return hstDayKey(iso);
    var hst = new Date(d.getTime() - HST_OFFSET_MS);
    var year = hst.getUTCFullYear();
    var month = String(hst.getUTCMonth() + 1).padStart(2, "0");
    var day = String(hst.getUTCDate()).padStart(2, "0");
    var hour = String(hst.getUTCHours()).padStart(2, "0");
    if (range === "hours") return year + "-" + month + "-" + day + " " + hour + ":00";
    if (range === "months") return year + "-" + month;
    if (range === "years") return String(year);
    var wd = hst.getUTCDay();
    var diff = wd === 0 ? -6 : 1 - wd;
    hst.setUTCDate(hst.getUTCDate() + diff);
    return hst.getUTCFullYear() + "-"
      + String(hst.getUTCMonth() + 1).padStart(2, "0") + "-"
      + String(hst.getUTCDate()).padStart(2, "0");
  }

  function bucketBalance(history, range) {
    if (range === "hours") {
      return (history || []).map(function (p) {
        var key = rangeKey(p.recorded_at, "hours");
        return { label: hourChartLabel(key), value: Number(p.balance) || 0 };
      });
    }
    // balance_history is one point per HST day — week buckets mislabel the series.
    var effectiveRange = range === "weeks" ? "days" : range;
    var map = {};
    (history || []).forEach(function (p) {
      var key = rangeKey(p.recorded_at, effectiveRange);
      if (!key) return;
      map[key] = Number(p.balance) || 0;
    });
    return Object.keys(map).sort().map(function (k) {
      return { label: k, value: map[k] };
    });
  }

  function bucketFlow(flowDaily, range) {
    var map = {};
    (flowDaily || []).forEach(function (d) {
      var day = String(d.day || "");
      var key = range === "days" ? day : rangeKey(day ? day + "T12:00:00-10:00" : "", range);
      if (!key) return;
      if (!map[key]) map[key] = { inflow: 0, outflow: 0, by_type: {} };
      map[key].inflow += Number(d.inflow) || 0;
      map[key].outflow += Number(d.outflow) || 0;
      Object.keys(d.by_type || {}).forEach(function (t) {
        map[key].by_type[t] = (map[key].by_type[t] || 0) + (Number((d.by_type || {})[t]) || 0);
      });
    });
    return Object.keys(map).sort().map(function (k) {
      return { day: k, inflow: map[k].inflow, outflow: map[k].outflow, by_type: map[k].by_type };
    });
  }

  function fillTypeFilter(glossary) {
    var sel = el("f-type");
    if (!sel) return;
    while (sel.options.length > 1) sel.remove(1);
    glossary.forEach(function (row) {
      var opt = document.createElement("option");
      opt.value = row.type;
      opt.textContent = typeDisplayLabel(row.type, glossary) + " (" + row.type + ")";
      sel.appendChild(opt);
    });
  }

  function renderGlossary(glossary, monthByType, typeChanges) {
    var host = el("rs-glossary");
    if (!host) return;
    monthByType = monthByType || {};
    typeChanges = typeChanges || {};
    host.innerHTML = glossary.map(function (row) {
      var dir = row.direction === "inflow" ? "reserve-in" : row.direction === "outflow" ? "reserve-out" : "";
      var mtdAmt = Number(monthByType[row.type]);
      var amtHtml = "";
      if (Number.isFinite(mtdAmt) && mtdAmt > 0) {
        var pct = Number(typeChanges[row.type]);
        var pctPart = Number.isFinite(pct)
          ? " <span class=\"" + (Math.abs(pct) < 0.05 ? "reserve-change flat" : (pct > 0 ? "reserve-in" : "reserve-out")) + "\">" + (Math.abs(pct) < 0.05 ? "flat" : fmtPct(pct)) + "</span>"
          : "";
        amtHtml = "<span class=\"reserve-glossary-amt\">" + fmtGold(mtdAmt) + pctPart + "</span>";
      } else {
        amtHtml = "<span class=\"reserve-glossary-amt rmc-muted\">—</span>";
      }
      var name = typeDisplayLabel(row.type, glossary);
      return "<div class=\"reserve-glossary-row\"><span class=\"reserve-type-name\">" + escapeHtml(name) + "</span>"
        + "<code class=\"reserve-type-code\">" + escapeHtml(row.type) + "</code>"
        + "<span class=\"reserve-glossary-dir " + dir + "\">" + row.direction + "</span>"
        + "<span>" + escapeHtml(row.label || "") + "</span>"
        + amtHtml + "</div>";
    }).join("");
  }

  function holderChartPoints(summary) {
    return (summary.holder_supply_daily || []).map(function (row) {
      var day = String(row.day || "");
      if (!day) return null;
      return {
        recorded_at: day + "T12:00:00-10:00",
        balance: Number(row.holder_combined_g) || 0,
      };
    }).filter(Boolean);
  }

  /** Drop July opening carryover when API still returns opening + net (pre-deploy). */
  function reserveChartCarryOffset(summary, lastChartBalance) {
    if (!summary || summary.locked_hst_baseline) return 0;
    var headline = Number(summary.balance);
    var last = Number(lastChartBalance);
    if (!Number.isFinite(headline) || !Number.isFinite(last)) return 0;
    if (Math.abs(last - headline) < 2) return 0;
    var carry = Number((summary.note_supply || {}).opening_unbacked_carryover_g);
    if (!Number.isFinite(carry) || carry < 0.01) return 0;
    return Math.abs(last - headline - carry) < 2 ? carry : 0;
  }

  function hourChartLabel(hourKey) {
    var parts = String(hourKey || "").split(" ");
    if (parts.length < 2) return hourKey;
    var hm = parts[1].split(":");
    var h = parseInt(hm[0], 10);
    if (!Number.isFinite(h)) return hourKey;
    if (h === 0) return "12 AM";
    if (h < 12) return h + " AM";
    if (h === 12) return "12 PM";
    return (h - 12) + " PM";
  }

  function balanceChartPoints(summary, range) {
    if (range === "hours") {
      return (summary.balance_hourly || []).map(function (row) {
        var hour = String(row.hour || "");
        return {
          recorded_at: hour ? hour.replace(" ", "T") + ":00-10:00" : "",
          balance: Number(row.balance) || 0,
        };
      }).filter(function (p) { return p.recorded_at; });
    }
    var history = (summary.balance_history || []).slice();
    history.sort(function (a, b) {
      return String(a.recorded_at || "").localeCompare(String(b.recorded_at || ""));
    });
    var lastBal = history.length ? Number(history[history.length - 1].balance) : NaN;
    var offset = reserveChartCarryOffset(summary, lastBal);
    if (offset > 0.01) {
      history = history.map(function (p) {
        return {
          recorded_at: p.recorded_at,
          balance: Math.max(0, (Number(p.balance) || 0) - offset),
        };
      });
    }
    return history;
  }

  function flowChartTypes(typeSet) {
    var types = Object.keys(typeSet).sort();
    if (!types.length) return [];
    var priority = ["TAX", "TOWNY_SINK", "VOTE", "GRANT", "DIVIDEND", "NOTE_BURN"];
    var picked = priority.filter(function (t) { return typeSet[t]; });
    types.forEach(function (t) {
      if (picked.indexOf(t) >= 0) return;
      picked.push(t);
    });
    if (picked.length <= 12) return picked;
    return picked.slice(0, 11).concat(["__OTHER__"]);
  }

  function flowAmountForType(d, type, glossary, pickedTypes) {
    if (type === "__OTHER__") {
      var sum = 0;
      Object.keys(d.by_type || {}).forEach(function (t) {
        if (pickedTypes.indexOf(t) >= 0 || t === "__OTHER__") return;
        sum += flowAmountForType(d, t, glossary, pickedTypes);
      });
      return sum;
    }
    var amt = Number((d.by_type || {})[type]) || 0;
    if (amt <= 0) return 0;
    var row = (glossary || []).find(function (g) { return g.type === type; });
    if (row && row.direction === "outflow") return -amt;
    if (type === "NOTE_BURN") return -amt;
    return amt;
  }

  function balanceChartBuckets(history, range) {
    if (!history || !history.length) return [];
    // One point per bucket (last balance wins) — skips no-op NOTE_BURN rows server-side.
    return bucketBalance(history, range);
  }

  function renderBalanceChart(summary) {
    var history = balanceChartPoints(summary || {}, state.chartRange);
    destroyChart("balanceChart");
    var host = el("reserve-balance-chart-host");
    var empty = el("reserve-balance-empty");
    if (!history || !history.length) {
      if (host) host.hidden = true;
      if (empty) empty.hidden = false;
      return;
    }
    if (host) host.hidden = false;
    if (empty) empty.hidden = true;
    if (typeof Chart === "undefined") return;
    var canvas = el("reserve-balance-chart");
    if (!canvas) return;

    var buckets = balanceChartBuckets(history, state.chartRange);
    var labels = buckets.map(function (b) { return b.label; });
    var values = buckets.map(function (b) { return b.value; });
    var holderHistory = state.chartRange === "hours" ? [] : holderChartPoints(summary || {});
    var holderBuckets = balanceChartBuckets(holderHistory, state.chartRange);
    var holderByLabel = {};
    holderBuckets.forEach(function (b) { holderByLabel[b.label] = b.value; });
    var holderValues = labels.map(function (label) {
      return holderByLabel[label] != null ? holderByLabel[label] : null;
    });
    var hasHolder = holderValues.some(function (v) { return v != null && v > 0.01; });
    var maxReserve = values.length ? Math.max.apply(null, values) : 0;
    var maxHolder = hasHolder
      ? Math.max.apply(null, holderValues.filter(function (v) { return v != null; }))
      : 0;
    if (maxHolder > maxReserve * 1.15) {
      hasHolder = false;
    }

    state.balanceChart = new Chart(canvas, {
      type: "line",
      data: {
        labels: labels,
        datasets: [{
          label: "Reserve balance (G)",
          data: values,
          borderColor: CHART_GOLD,
          backgroundColor: CHART_GOLD_FILL,
          fill: true,
          tension: 0.2,
          pointRadius: values.length > 80 ? 0 : (state.chartRange === "hours" ? 3 : 2),
          borderWidth: 2,
        }].concat(hasHolder ? [{
          label: "Player wallet Notes (G)",
          data: holderValues,
          borderColor: CHART_HOLDER,
          backgroundColor: CHART_HOLDER_FILL,
          fill: false,
          tension: 0.2,
          pointRadius: holderValues.length > 80 ? 0 : 2,
          borderWidth: 2,
          borderDash: [6, 4],
        }] : []),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: hasHolder,
            labels: { color: CHART_TICK, boxWidth: 12 },
          },
        },
        scales: {
          x: { ticks: { color: CHART_TICK, maxTicksLimit: 8 }, grid: { color: CHART_GRID } },
          y: { ticks: { color: CHART_TICK }, grid: { color: CHART_GRID } },
        },
      },
    });
  }

  function renderFlowChart(flowDaily, glossary) {
    destroyChart("flowChart");
    var host = el("reserve-flow-chart-host");
    var empty = el("reserve-flow-empty");
    if (!flowDaily || !flowDaily.length) {
      if (host) host.hidden = true;
      if (empty) empty.hidden = false;
      return;
    }
    if (host) host.hidden = false;
    if (empty) empty.hidden = true;
    if (typeof Chart === "undefined") return;
    var flowCanvas = el("reserve-flow-chart");
    if (!flowCanvas) return;

    var bucketed = bucketFlow(flowDaily, state.chartRange);
    var labels = bucketed.map(function (d) { return String(d.day || ""); });
    var inData = bucketed.map(function (d) { return Number(d.inflow) || 0; });
    var outData = bucketed.map(function (d) { return Number(d.outflow) || 0; });

    var typeSet = {};
    bucketed.forEach(function (d) {
      var bt = d.by_type || {};
      Object.keys(bt).forEach(function (t) { typeSet[t] = true; });
    });
    var types = flowChartTypes(typeSet);

    var datasets = [];
    if (types.length) {
      datasets = types.map(function (type) {
        return {
          label: type === "__OTHER__" ? "Other" : typeDisplayLabel(type, glossary),
          data: bucketed.map(function (d) {
            return flowAmountForType(d, type, glossary, types);
          }),
          backgroundColor: type === "__OTHER__"
            ? TYPE_COLORS.OTHER
            : (TYPE_COLORS[type] || "#a1afa8"),
          stack: "types",
        };
      });
    } else {
      datasets = [
        {
          label: "Inflows",
          data: inData,
          backgroundColor: CHART_IN,
          stack: "flow",
        },
        {
          label: "Outflows",
          data: outData.map(function (v) { return -v; }),
          backgroundColor: CHART_OUT,
          stack: "flow",
        },
      ];
    }

    state.flowChart = new Chart(flowCanvas, {
      type: "bar",
      data: { labels: labels, datasets: datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: CHART_TICK, boxWidth: 12 } },
        },
        scales: {
          x: { stacked: true, ticks: { color: CHART_TICK, maxTicksLimit: 12 }, grid: { color: CHART_GRID } },
          y: { stacked: true, ticks: { color: CHART_TICK }, grid: { color: CHART_GRID } },
        },
      },
    });
  }

  function playerLink(name) {
    var mapped = displayName(name);
    if (!mapped || mapped === "—" || mapped.indexOf("…") > 0) return mapped || "—";
    var n = String(mapped).toLowerCase();
    if (n === "reserve" || n === "towny-server" || n === "server" || n === "system") {
      return escapeHtml(mapped);
    }
    if (/^(town|nation) of /i.test(mapped) || /\((town|nation) bank\)$/i.test(mapped)) {
      return escapeHtml(mapped);
    }
    return "<a href=\"/player/?player=" + encodeURIComponent(mapped) + "\">" + escapeHtml(mapped) + "</a>";
  }

  function displayName(name) {
    var s = String(name || "").trim();
    if (!s) return "—";
    if (s.toLowerCase() === "towny-server") return "Reserve";
    if (/^town-/i.test(s) && s.length > 5) return "Town of " + s.slice(5);
    if (/^nation-/i.test(s) && s.length > 7) return "Nation of " + s.slice(7);
    return s;
  }

  function govDisplayFromDetails(details) {
    var m = /(?:^|;)(town|nation):([^;]+)/i.exec(String(details || ""));
    if (!m) return "";
    var name = String(m[2] || "").trim();
    if (!name) return "";
    return (String(m[1]).toLowerCase() === "nation" ? "Nation of " : "Town of ") + name;
  }

  function ledgerDestination(row) {
    var shown = displayName(row && row.to_display);
    var looksLikeHash = !shown || shown === "—" || /\.\.\.|…$/.test(shown) || /^[0-9a-f]{8}\.\.\.?$/i.test(shown);
    if (looksLikeHash) {
      var gov = govDisplayFromDetails(row && row.details);
      if (gov) return gov;
    }
    return shown;
  }

  function stripOperator(details) {
    var text = String(details || "").trim();
    if (!text) return "—";
    var parts = text.split(";");
    var kept = parts.filter(function (p) { return !/^operator=/i.test(String(p).trim()); });
    var out = kept.join(";");
    return out || "—";
  }

  function formatLedgerDetails(details) {
    var text = stripOperator(details);
    if (!text || text === "—") return "—";
    return text.split(";").map(function (part) {
      var p = String(part || "").trim();
      var m = /^(town|nation):(.+)$/i.exec(p);
      if (m) {
        return (String(m[1]).toLowerCase() === "nation" ? "Nation of " : "Town of ") + String(m[2]).trim();
      }
      return p;
    }).filter(Boolean).join("; ") || "—";
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function appendLedgerRows(entries, replace) {
    var table = el("rs-ledger");
    if (!table) return;
    var tbody = table.querySelector("tbody");
    if (!tbody) return;
    var glossary = (state.summary && state.summary.type_glossary) || [];
    var html = (entries || []).map(function (row) {
      var dirClass = row.direction === "inflow" ? "reserve-in" : row.direction === "outflow" ? "reserve-out" : "";
      var entryType = String(row.entry_type || "").toUpperCase();
      var isMintRedeem = entryType === "MINT_REDEEM";
      var isMintGross = entryType === "MINT_GROSS";
      var isBondPhysical = row.fee_kind === "bond_physical"
        || entryType === "BOND_REDEEM"
        || (entryType === "BOND_COUPON" && /^(coupon|bond:|bonded)/i.test(String(row.details || "").trim()));
      var genericName = typeDisplayLabel(row.entry_type, glossary);
      var typeName = genericName;
      var detailLabel = "";
      if (row.type_label && String(row.type_label).trim() && row.type_label !== genericName) {
        if (String(row.entry_type || "").toUpperCase() === "VOTE") {
          typeName = row.type_label;
        } else {
          detailLabel = row.type_label;
        }
      }
      var fromCell = row.fee_kind === "towny_closed_loop"
        ? escapeHtml(row.from_display || "—")
        : String(row.entry_type || "").toUpperCase() === "VOTE"
          ? "Reserve <span class=\"reserve-type-label\">vote payout</span>"
          : playerLink(row.from_display);
      var destShown = ledgerDestination(row);
      var toCell = row.fee_kind === "towny_closed_loop" || destShown === "—"
        ? escapeHtml(destShown || "—")
        : isMintRedeem || isMintGross || isBondPhysical
          ? escapeHtml(destShown || "—")
          : playerLink(destShown);
      var amtCell;
      if (isMintRedeem) {
        amtCell = "<span class=\"reserve-convert\">" + fmtGold(row.amount).replace(" G", "") + " G · wallet → physical</span>";
      } else if (isMintGross) {
        amtCell = "<span class=\"reserve-convert\">" + fmtGold(row.amount).replace(" G", "") + " G · physical → wallet</span>";
      } else if (isBondPhysical) {
        amtCell = "<span class=\"reserve-convert\">" + fmtGold(row.amount).replace(" G", "") + " G · reserve → physical</span>";
      } else {
        amtCell = "<span class=\"lb-gold " + dirClass + "\">"
          + (row.direction === "outflow" ? "−" : "+") + fmtGold(row.amount).replace(" G", "") + " G</span>";
      }
      return "<tr>"
        + "<td>" + fmtWhen(row.created_at) + "</td>"
        + "<td><span class=\"reserve-type-name\">" + escapeHtml(typeName) + "</span>"
        + (detailLabel ? "<span class=\"reserve-type-label\">" + escapeHtml(detailLabel) + "</span>" : "")
        + "<code class=\"reserve-type-code\">" + escapeHtml(row.entry_type) + "</code></td>"
        + "<td>" + fromCell + "</td>"
        + "<td>" + toCell + "</td>"
        + "<td>" + amtCell + "</td>"
        + "<td class=\"reserve-details\">" + escapeHtml(formatLedgerDetails(row.details || "—")) + "</td>"
        + "</tr>";
    }).join("");
    if (replace) tbody.innerHTML = html;
    else tbody.insertAdjacentHTML("beforeend", html);
    if (replace && !entries.length) {
      var hint = "";
      var data = state.summary || {};
      var months = data.available_months || [];
      if (!data.viewing_historical_month && months.length > 1) {
        hint = " Try selecting " + months[1] + " above to view last month\u2019s transactions.";
      }
      tbody.innerHTML = "<tr><td colspan=\"6\" class=\"rmc-muted\">No ledger rows for this month." + hint + "</td></tr>";
    }
  }

  function ledgerQuery(page) {
    var p = new URLSearchParams();
    p.set("limit", String(LEDGER_PAGE));
    p.set("offset", String(Math.max(0, (page - 1) * LEDGER_PAGE)));
    var mb = monthBounds();
    if (mb.start) p.set("start", mb.start);
    if (mb.end) p.set("end", mb.end);
    var type = el("f-type").value;
    var dir = el("f-direction").value;
    if (type) p.set("type", type);
    if (dir) p.set("direction", dir);
    return API + TREASURY_ID + "/ledger?" + p.toString();
  }

  async function loadLedger(page) {
    state.ledgerPage = Math.max(1, page || 1);
    var data = await fetchJsonWithTimeout(ledgerQuery(state.ledgerPage), 10000);
    state.ledgerTotal = Number(data.total) || 0;
    var entries = data.entries || [];
    appendLedgerRows(entries, true);
    var totalPages = Math.max(1, Math.ceil(state.ledgerTotal / LEDGER_PAGE));
    var period = monthPeriodLabel(state.summary);
    var countEl = el("rs-ledger-count");
    if (countEl) {
      countEl.textContent = "Page " + state.ledgerPage + " of " + totalPages
        + " · " + state.ledgerTotal + " rows (" + period + ")";
    }
    var prevBtn = el("rs-prev-page");
    var nextBtn = el("rs-next-page");
    if (prevBtn) prevBtn.disabled = state.ledgerPage <= 1;
    if (nextBtn) nextBtn.disabled = state.ledgerPage >= totalPages;
  }

  function bindRangeControls() {
    var wrap = el("reserve-range-controls");
    if (!wrap) return;
    wrap.querySelectorAll("[data-range]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var next = String(btn.getAttribute("data-range") || "hours");
        state.chartRange = next;
        wrap.querySelectorAll("[data-range]").forEach(function (x) { x.classList.remove("is-active"); });
        btn.classList.add("is-active");
        renderBalanceChart(state.summary);
        renderFlowChart(flowDailyForView(state.summary), (state.summary || {}).type_glossary || []);
      });
    });
  }

  function reserveUrl() {
    var url = API + TREASURY_ID + "/reserve";
    var month = monthFromQuery();
    if (month) return url + "?month=" + encodeURIComponent(month);
    return url;
  }

  async function load() {
    var resolved = await resolveServerId();
    state.serverId = TREASURY_ID;
    if (!state.serverId) {
      var sub = el("reserve-subtitle");
      if (sub) sub.textContent = "No featured server configured yet.";
      return;
    }

    if (!serverIdFromQuery() && !/\/economy\/?$/i.test(window.location.pathname)) {
      var next = new URLSearchParams(window.location.search);
      next.set("server", resolved.serverId || TREASURY_ID);
      var qs = next.toString();
      history.replaceState(null, "", window.location.pathname + (qs ? "?" + qs : ""));
    }

    var sub = el("reserve-subtitle");
    if (sub) {
      sub.textContent = (resolved.serverName || resolved.serverId || TREASURY_ID)
        + " · Reserve treasury · same data as in-game /reserve";
    }

    try {
      state.summary = await fetchJsonWithTimeout(reserveUrl(), 10000);
      renderSummary(state.summary);
      renderBalanceChart(state.summary);
      renderFlowChart(flowDailyForView(state.summary), state.summary.type_glossary || []);
      await loadLedger(1);
      bindRangeControls();
      setError("");
      var ecoSub = el("eco-subtitle");
      if (ecoSub && state.summary) {
        var synced = state.summary.synced_at;
        var monthKey = state.summary.view_hst_month || state.summary.current_hst_month || "";
        if (synced) {
          ecoSub.textContent = "Last synced " + fmtWhen(synced)
            + (monthKey ? " · viewing " + monthKey + " (HST)" : "");
        }
      }
    } catch (err) {
      setError(err && err.message ? err.message : "Failed to load reserve data.");
    }
  }

  function bindReserveUi() {
    var apply = el("f-apply");
    if (apply) {
      apply.addEventListener("click", function () {
        loadLedger(1).catch(function (e) { setError(e.message); });
      });
    }
    var monthSel = el("f-month");
    if (monthSel) {
      monthSel.addEventListener("change", function () {
        applyMonthSelection(selMonthValue());
      });
    }
    var monthPrev = el("f-month-prev");
    if (monthPrev) {
      monthPrev.addEventListener("click", function () { navigateMonth(1); });
    }
    var monthNext = el("f-month-next");
    if (monthNext) {
      monthNext.addEventListener("click", function () { navigateMonth(-1); });
    }
    var prevPage = el("rs-prev-page");
    if (prevPage) {
      prevPage.addEventListener("click", function () {
        loadLedger(state.ledgerPage - 1).catch(function (e) { setError(e.message); });
      });
    }
    var nextPage = el("rs-next-page");
    if (nextPage) {
      nextPage.addEventListener("click", function () {
        loadLedger(state.ledgerPage + 1).catch(function (e) { setError(e.message); });
      });
    }
  }

  function shouldInitReserve() {
    return !!(el("reserve-month-bar") || el("reserve-ledger-panel"));
  }

  if (shouldInitReserve()) {
    bindReserveUi();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", load);
    } else {
      load();
    }
  }
})();
