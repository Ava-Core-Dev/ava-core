(function () {
  var SERVER_ID = "g2";
  var PER_PAGE = 25;
  var CHART_LINE = "line";
  var CHART_CANDLE = "candle";
  var CHART_PERIOD_HOUR = "hour";
  var CHART_PERIOD_DAY = "day";
  var CHART_PERIOD_WEEK = "week";
  var HISTORY_LIMIT = 500;

  var state = {
    page: 1,
    total: 0,
    totalPages: 1,
    selected: "",
    items: [],
    debounce: null,
    q: "",
    historyPoints: [],
    chartMode: CHART_LINE,
    chartPeriod: CHART_PERIOD_HOUR,
    priceChart: null,
    modalChart: null,
    chartModalOpen: false,
    modalEscHandler: null,
  };

  var SIDEBAR_CHART = { hostId: "market-chart-host", canvasId: "market-price-chart", chartKey: "priceChart" };
  var MODAL_CHART = { hostId: "modal-market-chart-host", canvasId: "modal-market-price-chart", chartKey: "modalChart" };

  var CHART_GREEN = "#f5b942";
  var CHART_GREEN_FILL = "rgba(245, 185, 66, 0.16)";
  var CHART_GRID = "rgba(255, 255, 255, 0.05)";
  var CHART_TICK = "#a1afa8";
  var CHART_UP = "#5dd39e";
  var CHART_DOWN = "#ef5b5b";

  var PERIOD_LABELS = {
    hour: "Hourly",
    day: "Daily",
    week: "Weekly",
  };

  function el(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function marketItemUrl(key) {
    return "/market/?item=" + encodeURIComponent(String(key || "").toUpperCase());
  }

  function itemKeyFromPath() {
    var path = window.location.pathname.replace(/\/+$/, "");
    var match = path.match(/^\/market\/([^/]+)$/i);
    if (!match) return "";
    try {
      return decodeURIComponent(match[1]).trim().toUpperCase().replace(/\s+/g, "_");
    } catch (_e) {
      return String(match[1]).trim().toUpperCase().replace(/\s+/g, "_");
    }
  }

  function itemKeyFromLocation() {
    var fromQuery = new URLSearchParams(window.location.search).get("item");
    if (fromQuery && String(fromQuery).trim()) {
      var key = String(fromQuery).trim().toUpperCase().replace(/\s+/g, "_");
      if (key && !key.startsWith(":")) return key;
    }
    return itemKeyFromPath();
  }

  function syncItemUrl(key) {
    if (!key) return;
    var p = new URLSearchParams(window.location.search);
    p.set("item", String(key).toUpperCase());
    var next = "/market/?" + p.toString();
    if (window.location.pathname + window.location.search !== next) {
      history.replaceState(null, "", next);
    }
  }

  function selectItem(key) {
    state.selected = key;
    syncItemUrl(key);
    renderTable();
    loadHistory();
  }

  function params() {
    var p = new URLSearchParams(window.location.search);
    var sid = (p.get("server") || p.get("server_id") || "").trim();
    if (sid) SERVER_ID = sid;
    var pathKey = itemKeyFromLocation();
    if (pathKey) {
      state.selected = pathKey;
      state.q = pathKey.replace(/_/g, " ");
    } else {
      var q = (p.get("q") || "").trim();
      if (q) state.q = q;
    }
  }

  function fmtGold(n) {
    if (!Number.isFinite(n)) return "-";
    return n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }

  function fmtPct24h(n) {
    if (!Number.isFinite(n)) return "-";
    var sign = n > 0 ? "+" : "";
    return sign + n.toFixed(1) + "%";
  }

  function changeCellHtml(row) {
    var pct = Number(row.change_24h_pct);
    if (!Number.isFinite(pct)) {
      return "<td class=\"market-change flat\">-</td>";
    }
    if (Math.abs(pct) < 0.05) {
      return "<td class=\"market-change flat\">flat</td>";
    }
    var cls = pct > 0 ? "up" : "down";
    return "<td class=\"market-change " + cls + "\">" + fmtPct24h(pct) + "</td>";
  }

  function itemLabel(key, row) {
    if (row && row.display_name) return row.display_name;
    if (window.RootMcItemKeys && window.RootMcItemKeys.displayName) {
      return window.RootMcItemKeys.displayName(key);
    }
    return String(key || "").replace(/_/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function filterValues() {
    return {
      q: el("f-q").value.trim(),
      sort: el("f-sort").value,
      minPrice: el("f-min-price").value,
      maxPrice: el("f-max-price").value,
      minQty: el("f-min-qty").value,
      maxQty: el("f-max-qty").value,
      minShops: el("f-min-shops").value,
      inStock: el("f-in-stock").checked,
    };
  }

  function buildItemsUrl() {
    var f = filterValues();
    var p = new URLSearchParams();
    p.set("server_id", SERVER_ID);
    p.set("page", String(state.page));
    p.set("per_page", String(PER_PAGE));
    p.set("sort", f.sort);
    if (f.q) p.set("q", f.q);
    if (f.minPrice) p.set("min_price", f.minPrice);
    if (f.maxPrice) p.set("max_price", f.maxPrice);
    if (f.minQty) p.set("min_qty", f.minQty);
    if (f.maxQty) p.set("max_qty", f.maxQty);
    if (f.minShops) p.set("min_shops", f.minShops);
    if (f.inStock) p.set("in_stock", "1");
    return "/api/g2/rootmc/stock-market/items?" + p.toString();
  }

  function setError(msg) {
    var e = el("market-error");
    if (msg) { e.textContent = msg; e.hidden = false; }
    else { e.hidden = true; e.textContent = ""; }
  }

  function parseIso(iso) {
    var d = new Date(String(iso || ""));
    return isNaN(d.getTime()) ? null : d;
  }

  function weekStartKey(iso) {
    var d = parseIso(iso);
    if (!d) return String(iso || "").slice(0, 10);
    var day = d.getUTCDay();
    var diff = day === 0 ? -6 : 1 - day;
    d.setUTCDate(d.getUTCDate() + diff);
    return d.toISOString().slice(0, 10);
  }

  function bucketKey(iso, period) {
    var s = String(iso || "");
    if (period === CHART_PERIOD_HOUR) return s.slice(0, 13);
    if (period === CHART_PERIOD_WEEK) return weekStartKey(s);
    return s.slice(0, 10);
  }

  function formatBucketLabel(key, period) {
    if (period === CHART_PERIOD_HOUR) {
      return key.length >= 13 ? key.slice(5, 13).replace("T", " ") : key;
    }
    if (period === CHART_PERIOD_WEEK) {
      return key.length >= 10 ? "Wk " + key.slice(5) : key;
    }
    return key.length >= 10 ? key.slice(5) : key;
  }

  function buildPeriodBuckets(points, period) {
    var byKey = {};
    points.forEach(function (p) {
      var k = bucketKey(p.recorded_at, period);
      if (!k) return;
      var price = Number(p.avg_price) || 0;
      if (!byKey[k]) {
        byKey[k] = { key: k, open: price, high: price, low: price, close: price };
      } else {
        byKey[k].high = Math.max(byKey[k].high, price);
        byKey[k].low = Math.min(byKey[k].low, price);
        byKey[k].close = price;
      }
    });
    return Object.keys(byKey).sort().map(function (k) { return byKey[k]; });
  }

  function destroyChart(chartKey) {
    chartKey = chartKey || "priceChart";
    if (state[chartKey]) {
      state[chartKey].destroy();
      state[chartKey] = null;
    }
  }

  function destroyAllCharts() {
    destroyChart("priceChart");
    destroyChart("modalChart");
  }

  var REFERENCE_PRICE_NOTE =
    "Valuation (not what shops charge): 60% live shop average + 40% 28-day history. " +
    "Used for /value and net worth. Buy/sell still use Low/High sign prices.";

  function selectedItemRow() {
    return state.items.find(function (r) { return r.item_key === state.selected; }) || null;
  }

  function referenceDivergesFromShop(row) {
    if (!row) return false;
    var list = Number(row.avg_listing_price) || Number(row.min_price) || 0;
    var ref = Number(row.market_avg) || 0;
    return list > 0 && ref > 0 && Math.abs(list - ref) > 0.005;
  }

  function selectedItemSummaryHtml() {
    var row = selectedItemRow();
    if (!row) return "";
    var low = row.min_price > 0 ? fmtGold(row.min_price) + " G" : "-";
    var high = row.max_price > 0 ? fmtGold(row.max_price) + " G" : "-";
    var shopRange = low + (row.max_price > row.min_price ? " - " + high : "");
    var val = row.market_avg > 0 ? fmtGold(row.market_avg) + " G" : "-";
    var hint = referenceDivergesFromShop(row)
      ? "<p class=\"market-reference-note\">Checkout price is " + shopRange + ". Valuation lags at " + val + " (28-day memory).</p>"
      : "";
    return (
      "<div class=\"market-selected-summary\">" +
      "<strong>" + esc(itemLabel(row.item_key, row)) + "</strong>" +
      "<span class=\"market-selected-stat\"><em>Shop</em> " + shopRange + "</span>" +
      "<span class=\"market-selected-stat market-selected-stat--muted\"><em>Valuation</em> " + val + "</span>" +
      hint +
      "</div>"
    );
  }

  function chartTitleText() {
    if (!state.selected) return "Valuation history";
    return "Valuation history  -  " + itemLabel(state.selected);
  }

  function chartTooltip() {
    return {
      backgroundColor: "#162816",
      titleColor: "#e8f0e4",
      bodyColor: "#9bb396",
      borderColor: "rgba(120, 180, 100, 0.22)",
      borderWidth: 1,
      callbacks: {
        label: function (ctx) {
          if (ctx.chart.config.type === "candlestick") {
            var raw = ctx.raw || {};
            return [
              "O " + fmtGold(raw.o) + " G",
              "H " + fmtGold(raw.h) + " G",
              "L " + fmtGold(raw.l) + " G",
              "C " + fmtGold(raw.c) + " G",
            ];
          }
          return fmtGold(ctx.parsed.y) + " G";
        },
      },
    };
  }

  function chartScales(yLabel) {
    return {
      x: {
        grid: { color: CHART_GRID },
        ticks: { color: CHART_TICK, maxRotation: 45, font: { size: 10 } },
      },
      y: {
        grid: { color: CHART_GRID },
        ticks: {
          color: CHART_TICK,
          font: { size: 10 },
          callback: function (v) { return fmtGold(v); },
        },
        title: {
          display: true,
          text: yLabel,
          color: CHART_GREEN,
          font: { size: 11, weight: "500" },
        },
      },
    };
  }

  function renderLineChart(canvas, buckets, chartKey) {
    chartKey = chartKey || "priceChart";
    if (typeof Chart === "undefined") {
      return "<p class=\"rmc-muted\">Chart library failed to load.</p>";
    }
    var labels = buckets.map(function (b) { return formatBucketLabel(b.key, state.chartPeriod); });
    var data = buckets.map(function (b) { return b.close; });
    state[chartKey] = new Chart(canvas, {
      type: "line",
      data: {
        labels: labels,
        datasets: [{
          label: "Valuation (G)",
          data: data,
          borderColor: CHART_GREEN,
          backgroundColor: CHART_GREEN_FILL,
          tension: 0.25,
          fill: true,
          pointRadius: buckets.length > 40 ? 0 : 2,
          pointHoverRadius: 4,
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: chartTooltip(),
        },
        scales: chartScales("Gold (G)"),
      },
    });
    return "";
  }

  function renderCandleChart(canvas, buckets, chartKey) {
    chartKey = chartKey || "priceChart";
    if (typeof Chart === "undefined") {
      return "<p class=\"rmc-muted\">Chart library failed to load.</p>";
    }
    if (buckets.length < 2) {
      return "<p class=\"rmc-muted\">Need at least 2 " + (PERIOD_LABELS[state.chartPeriod] || "period").toLowerCase() + " buckets for candles.</p>";
    }
    state[chartKey] = new Chart(canvas, {
      type: "candlestick",
      data: {
        labels: buckets.map(function (b) { return formatBucketLabel(b.key, state.chartPeriod); }),
        datasets: [{
          label: PERIOD_LABELS[state.chartPeriod] + " OHLC (G)",
          data: buckets.map(function (b, i) {
            return { x: i, o: b.open, h: b.high, l: b.low, c: b.close };
          }),
          color: { up: CHART_UP, down: CHART_DOWN, unchanged: CHART_TICK },
          borderColor: { up: CHART_UP, down: CHART_DOWN, unchanged: CHART_TICK },
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: chartTooltip(),
        },
        scales: chartScales("Gold (G)"),
      },
    });
    return "";
  }

  function chartMetaText(points, buckets) {
    if (!buckets.length) return "";
    var period = PERIOD_LABELS[state.chartPeriod] || state.chartPeriod;
    var mode = state.chartMode === CHART_CANDLE ? "candles" : "line";
    var first = formatBucketLabel(buckets[0].key, state.chartPeriod);
    var last = formatBucketLabel(buckets[buckets.length - 1].key, state.chartPeriod);
    return points.length + " snapshots  -  " + buckets.length + " " + period.toLowerCase() + "  -  " + mode + "  -  " + first + " -> " + last;
  }

  function bindChartControls(scope) {
    var root = scope || el("market-chart");
    if (!root) return;
    var periodWrap = root.querySelector("[data-chart-period-wrap]");
    if (periodWrap) {
      periodWrap.querySelectorAll("button[data-chart-period]").forEach(function (btn) {
        btn.classList.toggle("is-on", btn.getAttribute("data-chart-period") === state.chartPeriod);
        btn.onclick = function () {
          var period = btn.getAttribute("data-chart-period");
          if (period === state.chartPeriod) return;
          state.chartPeriod = period;
          remountAllCharts();
        };
      });
    }
    var modeWrap = root.querySelector("[data-chart-mode-wrap]");
    if (modeWrap) {
      modeWrap.querySelectorAll("button[data-chart-mode]").forEach(function (btn) {
        btn.classList.toggle("is-on", btn.getAttribute("data-chart-mode") === state.chartMode);
        btn.onclick = function () {
          var mode = btn.getAttribute("data-chart-mode");
          if (mode === state.chartMode) return;
          state.chartMode = mode;
          remountAllCharts();
        };
      });
    }
  }

  function chartBlockHtml(opts) {
    opts = opts || {};
    var hostId = opts.hostId || "market-chart-host";
    var periodId = opts.periodId || "market-chart-period";
    var modeId = opts.modeId || "market-chart-toggle";
    var showExpand = opts.showExpand !== false;
    var expandBtn = showExpand
      ? "<button type=\"button\" class=\"market-chart-expand\" data-chart-expand aria-label=\"Expand chart\" title=\"Enlarge chart\">" +
        "<svg width=\"16\" height=\"16\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\">" +
        "<polyline points=\"15 3 21 3 21 9\"/><polyline points=\"9 21 3 21 3 15\"/><line x1=\"21\" y1=\"3\" x2=\"14\" y2=\"10\"/><line x1=\"3\" y1=\"21\" x2=\"10\" y2=\"14\"/></svg></button>"
      : "";
    return (
      "<div class=\"market-chart-panel" + (opts.large ? " market-chart-panel--large" : "") + "\">" +
      "<div class=\"market-chart-head\">" +
      "<span class=\"market-chart-title\">" + chartTitleText() + "</span>" +
      "<div class=\"market-chart-controls\">" +
      expandBtn +
      "<div class=\"market-chart-toggle\" id=\"" + periodId + "\" data-chart-period-wrap>" +
      "<button type=\"button\" data-chart-period=\"hour\">Hourly</button>" +
      "<button type=\"button\" data-chart-period=\"day\">Daily</button>" +
      "<button type=\"button\" data-chart-period=\"week\">Weekly</button>" +
      "</div>" +
      "<div class=\"market-chart-toggle\" id=\"" + modeId + "\" data-chart-mode-wrap>" +
      "<button type=\"button\" data-chart-mode=\"line\">Line</button>" +
      "<button type=\"button\" data-chart-mode=\"candle\">Candles</button>" +
      "</div></div></div>" +
      selectedItemSummaryHtml() +
      "<div id=\"" + hostId + "\"></div>" +
      "<p class=\"market-reference-note\">" + REFERENCE_PRICE_NOTE + "</p>" +
      "</div>"
    );
  }

  function mountChart(points, target) {
    target = target || SIDEBAR_CHART;
    destroyChart(target.chartKey);
    var host = el(target.hostId);
    if (!host) return;
    if (target === SIDEBAR_CHART) {
      var card = el("market-chart");
      if (card) card.hidden = false;
    }
    if (!points || points.length < 1) {
      host.innerHTML = "<p class=\"rmc-muted\">No price history recorded yet.</p>";
      return;
    }
    var buckets = buildPeriodBuckets(points, state.chartPeriod);
    if (buckets.length < 1) {
      host.innerHTML = "<p class=\"rmc-muted\">No price history for this period yet.</p>";
      return;
    }
    if (state.chartMode === CHART_CANDLE && buckets.length < 2) {
      host.innerHTML = "<p class=\"rmc-muted\">Need at least 2 " + (PERIOD_LABELS[state.chartPeriod] || "period").toLowerCase() + " buckets for candles - try Line or a longer period.</p>";
      return;
    }
    var clickable = target === SIDEBAR_CHART ? " market-chart-canvas-wrap--clickable" : "";
    host.innerHTML =
      "<div class=\"market-chart-canvas-wrap" + (target.large ? " market-chart-canvas-wrap--large" : "") + clickable + "\" data-chart-expand>" +
      "<canvas id=\"" + target.canvasId + "\" aria-label=\"" + chartTitleText() + "\"></canvas></div>" +
      "<p class=\"market-chart-meta\">" + chartMetaText(points, buckets) + "</p>";
    var canvas = el(target.canvasId);
    var err = state.chartMode === CHART_CANDLE
      ? renderCandleChart(canvas, buckets, target.chartKey)
      : renderLineChart(canvas, buckets, target.chartKey);
    if (err) host.innerHTML = err;
    if (target === SIDEBAR_CHART) bindChartExpand();
  }

  function bindChartExpand() {
    var scope = el("market-chart");
    if (!scope || state.chartModalOpen) return;
    scope.querySelectorAll("[data-chart-expand]").forEach(function (node) {
      node.onclick = function (e) {
        if (e.target.closest(".market-chart-toggle")) return;
        e.stopPropagation();
        openChartModal();
      };
    });
  }

  function remountAllCharts() {
    if (!state.historyPoints.length) return;
    mountChart(state.historyPoints, SIDEBAR_CHART);
    bindChartControls(el("market-chart"));
    if (state.chartModalOpen) {
      mountChart(state.historyPoints, Object.assign({}, MODAL_CHART, { large: true }));
      bindChartControls(el("market-chart-modal-inner"));
    }
  }

  function closeChartModal() {
    if (!state.chartModalOpen) return;
    destroyChart("modalChart");
    var overlay = el("market-chart-modal");
    if (overlay) overlay.remove();
    document.body.classList.remove("market-chart-modal-open");
    state.chartModalOpen = false;
    if (state.modalEscHandler) {
      document.removeEventListener("keydown", state.modalEscHandler);
      state.modalEscHandler = null;
    }
    if (state.historyPoints.length) {
      mountChart(state.historyPoints, SIDEBAR_CHART);
      bindChartControls(el("market-chart"));
    }
  }

  function openChartModal() {
    if (state.chartModalOpen || !state.historyPoints.length) return;
    state.chartModalOpen = true;
    document.body.classList.add("market-chart-modal-open");
    var overlay = document.createElement("div");
    overlay.className = "market-chart-modal";
    overlay.id = "market-chart-modal";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", chartTitleText());
    overlay.innerHTML =
      "<div class=\"market-chart-modal-backdrop\" data-chart-modal-close></div>" +
      "<div class=\"market-chart-modal-inner rmc-card market-chart-card\" id=\"market-chart-modal-inner\">" +
      "<button type=\"button\" class=\"market-chart-modal-close\" data-chart-modal-close aria-label=\"Close chart\">" +
      "<svg width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.5\" stroke-linecap=\"round\" aria-hidden=\"true\">" +
      "<line x1=\"18\" y1=\"6\" x2=\"6\" y2=\"18\"/><line x1=\"6\" y1=\"6\" x2=\"18\" y2=\"18\"/></svg></button>" +
      chartBlockHtml({
        hostId: MODAL_CHART.hostId,
        periodId: "modal-market-chart-period",
        modeId: "modal-market-chart-toggle",
        showExpand: false,
        large: true,
      }) +
      "</div>";
    overlay.addEventListener("click", function (e) {
      if (e.target.closest("[data-chart-modal-close]")) closeChartModal();
    });
    document.body.appendChild(overlay);
    mountChart(state.historyPoints, Object.assign({}, MODAL_CHART, { large: true }));
    bindChartControls(el("market-chart-modal-inner"));
    state.modalEscHandler = function (e) {
      if (e.key === "Escape") closeChartModal();
    };
    document.addEventListener("keydown", state.modalEscHandler);
    var closeBtn = overlay.querySelector(".market-chart-modal-close");
    if (closeBtn) closeBtn.focus();
  }

  function renderChartBlock() {
    return chartBlockHtml();
  }

  function showChartCard(html) {
    var card = el("market-chart");
    if (!card) return;
    card.hidden = false;
    card.innerHTML = html;
  }

  function hideChartCard() {
    var card = el("market-chart");
    if (!card) return;
    card.hidden = true;
    card.innerHTML = "<p class=\"rmc-muted\">Select an item to view its price chart.</p>";
  }

  function renderTable() {
    var tbody = el("market-tbody");
    tbody.innerHTML = "";
    state.items.forEach(function (row) {
      var tr = document.createElement("tr");
      if (row.item_key === state.selected) tr.className = "active";
      tr.dataset.key = row.item_key;
      tr.innerHTML =
        "<td><a class=\"market-item-link\" href=\"" + esc(marketItemUrl(row.item_key)) + "\"><strong>" + esc(itemLabel(row.item_key, row)) + "</strong></a><span class=\"market-item-id\">" + esc(row.item_key) + "</span></td>" +
        "<td>" + (row.total_quantity || 0).toLocaleString() + "</td>" +
        "<td>" + (row.shop_count || 0) + "</td>" +
        "<td class=\"market-price\">" + (row.min_price > 0 ? fmtGold(row.min_price) + " G" : "-") + "</td>" +
        "<td class=\"market-price market-col-optional\">" + (row.max_price > 0 ? fmtGold(row.max_price) + " G" : "-") + "</td>" +
        "<td>" + (row.buy_capacity || 0).toLocaleString() + "</td>" +
        "<td class=\"market-col-optional\">" + (row.buy_shop_count || 0) + "</td>" +
        "<td class=\"market-price\">" + (row.max_buy_price > 0 ? fmtGold(row.max_buy_price) + " G" : "-") + "</td>" +
        "<td class=\"market-col-optional\"><span class=\"market-price market-price--muted\" title=\"Valuation only - not checkout\">" +
        (row.market_avg > 0 ? fmtGold(row.market_avg) + " G" : "-") + "</span></td>" +
        changeCellHtml(row);
      tr.addEventListener("click", function (e) {
        if (e.target.closest("a.market-item-link")) e.preventDefault();
        selectItem(row.item_key);
      });
      tbody.appendChild(tr);
    });
    el("market-table-wrap").hidden = state.items.length === 0;
    el("market-empty").hidden = state.items.length > 0;
    el("market-loading").hidden = true;
  }

  function renderPagination() {
    var wrap = el("market-pagination");
    wrap.hidden = state.total === 0;
    var start = state.total === 0 ? 0 : (state.page - 1) * PER_PAGE + 1;
    var end = Math.min(state.page * PER_PAGE, state.total);
    el("page-label").textContent = start + "-" + end + " of " + state.total + "  -  page " + state.page + " / " + state.totalPages;
    el("page-prev").disabled = state.page <= 1;
    el("page-next").disabled = state.page >= state.totalPages;
  }

  function loadItems() {
    el("market-loading").hidden = false;
    setError(null);
    fetch(buildItemsUrl(), { cache: "no-store" })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.d.detail || "Could not load prices right now. Try again in a minute.");
        var rows = (res.d.items || []).filter(function (r) { return r.item_key; });
        state.items = rows;
        state.total = Number(res.d.total) || 0;
        state.totalPages = Math.max(1, Number(res.d.total_pages) || 1);
        state.page = Number(res.d.page) || state.page;
        el("market-total").textContent = state.total + " item" + (state.total === 1 ? "" : "s");
        if (rows.length && !rows.some(function (r) { return r.item_key === state.selected; })) {
          if (!itemKeyFromLocation()) state.selected = rows[0].item_key;
        }
        if (!rows.length) state.selected = itemKeyFromLocation() || "";
        renderTable();
        renderPagination();
        if (state.selected) loadHistory();
        else renderDetailEmpty();
      })
      .catch(function (e) {
        el("market-loading").hidden = true;
        setError(e.message || String(e));
      });
  }

  function renderDetailEmpty() {
    closeChartModal();
    destroyAllCharts();
    state.historyPoints = [];
    hideChartCard();
  }

  function loadHistory() {
    if (!state.selected) { renderDetailEmpty(); return; }
    closeChartModal();
    var url = "/api/g2/rootmc/stock-market/history?server_id=" + encodeURIComponent(SERVER_ID) +
      "&item=" + encodeURIComponent(state.selected) + "&limit=" + HISTORY_LIMIT;
    fetch(url, { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (h) {
        var points = h.points || [];
        state.historyPoints = points;
        showChartCard(renderChartBlock());
        bindChartControls();
        mountChart(points);
      })
      .catch(function () {
        closeChartModal();
        destroyAllCharts();
        hideChartCard();
      });
  }

  function bindFilters() {
    var inputs = ["f-q", "f-sort", "f-min-price", "f-max-price", "f-min-qty", "f-max-qty", "f-min-shops", "f-in-stock"];
    inputs.forEach(function (id) {
      el(id).addEventListener(id === "f-q" ? "input" : "change", function () {
        if (id === "f-q") {
          clearTimeout(state.debounce);
          state.debounce = setTimeout(function () { state.page = 1; loadItems(); }, 300);
        } else {
          state.page = 1;
          loadItems();
        }
      });
    });
    el("f-clear").addEventListener("click", function () {
      el("f-q").value = "";
      el("f-sort").value = "quantity_desc";
      ["f-min-price", "f-max-price", "f-min-qty", "f-max-qty", "f-min-shops"].forEach(function (id) { el(id).value = ""; });
      el("f-in-stock").checked = false;
      state.page = 1;
      loadItems();
    });
    el("page-prev").addEventListener("click", function () {
      if (state.page > 1) { state.page--; loadItems(); }
    });
    el("page-next").addEventListener("click", function () {
      if (state.page < state.totalPages) { state.page++; loadItems(); }
    });
  }

  window.addEventListener("popstate", function () {
    var key = itemKeyFromLocation();
    if (key === state.selected) return;
    state.selected = key;
    if (key) state.q = key.replace(/_/g, " ");
    var search = el("f-q");
    if (search && key) search.value = state.q;
    renderTable();
    if (key) loadHistory();
    else renderDetailEmpty();
  });

  params();
  if (state.q) {
    var search = el("f-q");
    if (search) search.value = state.q;
  }
  bindFilters();
  loadItems();
})();
