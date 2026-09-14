(function () {
  var API = "https://api.rootmc.net";
  var meta = document.getElementById("res-meta");
  var err = document.getElementById("res-error");
  var summary = document.getElementById("res-summary");
  var body = document.getElementById("res-body");
  var qInput = document.getElementById("res-q");
  var dateSelect = document.getElementById("res-date");
  var itemSelect = document.getElementById("res-history-item");
  var historyPanel = document.getElementById("res-history");
  var historyMeta = document.getElementById("res-history-meta");
  var timer = null;
  var historyChart = null;
  var selectedItem = "";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmt(n) {
    return (Number(n) || 0).toLocaleString("en-US");
  }

  function fmtG(n) {
    if (n == null || !Number.isFinite(Number(n))) return "—";
    return Number(n).toLocaleString("en-US", { maximumFractionDigits: 3 }) + " G";
  }

  function when(ms) {
    var t = Number(ms) || 0;
    if (t <= 0) return "never";
    try {
      return new Date(t).toLocaleString("en-US", { timeZone: "Pacific/Honolulu" }) + " HST";
    } catch (e) {
      return new Date(t).toISOString();
    }
  }

  function itemLabel(id) {
    return String(id || "").replace(/^minecraft:/, "").replace(/_/g, " ");
  }

  function setDates(dates, selected) {
    if (!dateSelect) return;
    var current = selected || "";
    dateSelect.innerHTML = '<option value="">Latest live scan</option>' +
      (dates || []).map(function (date) {
        return '<option value="' + esc(date) + '"' + (date === current ? " selected" : "") + ">" +
          esc(date) + " HST</option>";
      }).join("");
    dateSelect.value = current;
  }

  function setItems(rows) {
    if (!itemSelect) return;
    var ids = (rows || []).map(function (row) { return String(row.id || ""); }).filter(Boolean).sort();
    if (!ids.length) {
      itemSelect.innerHTML = '<option value="">No items in this snapshot</option>';
      selectedItem = "";
      historyPanel.hidden = true;
      return;
    }
    if (!selectedItem || ids.indexOf(selectedItem) < 0) selectedItem = ids[0];
    itemSelect.innerHTML = ids.map(function (id) {
      return '<option value="' + esc(id) + '"' + (id === selectedItem ? " selected" : "") + ">" +
        esc(itemLabel(id)) + "</option>";
    }).join("");
    itemSelect.value = selectedItem;
    loadHistory(selectedItem);
  }

  function renderHistory(itemId, points) {
    if (typeof Chart === "undefined" || !historyPanel) return;
    if (historyChart) historyChart.destroy();
    historyPanel.hidden = false;
    historyMeta.textContent = points.length > 1
      ? points.length + " daily HST snapshots"
      : "History begins with the first saved daily snapshot.";

    historyChart = new Chart(document.getElementById("res-history-chart"), {
      type: "line",
      data: {
        labels: points.map(function (row) { return row.snapshot_date; }),
        datasets: [{
          label: itemLabel(itemId),
          data: points.map(function (row) { return Number(row.item_count) || 0; }),
          borderColor: "#d8b45e",
          backgroundColor: "rgba(216, 180, 94, .14)",
          pointBackgroundColor: "#f1ce7d",
          pointRadius: points.length < 15 ? 4 : 2,
          pointHoverRadius: 5,
          borderWidth: 2,
          fill: true,
          tension: .2,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            labels: { color: "#d7dfdb", boxWidth: 14 },
          },
          tooltip: {
            callbacks: {
              label: function (ctx) { return " " + fmt(ctx.raw) + " items"; },
            },
          },
        },
        scales: {
          x: {
            grid: { color: "rgba(255,255,255,.045)" },
            ticks: { color: "#8fa19a", maxRotation: 45, minRotation: 0 },
          },
          y: {
            beginAtZero: true,
            grid: { color: "rgba(255,255,255,.055)" },
            ticks: {
              color: "#8fa19a",
              precision: 0,
              callback: function (value) { return fmt(value); },
            },
          },
        },
      },
    });
  }

  function loadHistory(itemId) {
    if (!itemId) return;
    selectedItem = itemId;
    fetch(API + "/api/realm/public/item-census?history_item=" + encodeURIComponent(itemId) + "&history_days=365", {
      credentials: "omit",
    })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        renderHistory(itemId, data.history || []);
      })
      .catch(function (e) {
        historyPanel.hidden = false;
        historyMeta.textContent = "Could not load item history: " + (e && e.message ? e.message : e);
      });
  }

  function renderRows(rows) {
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="4" class="rmc-muted">No items in this census snapshot.</td></tr>';
      return;
    }
    body.innerHTML = rows.map(function (row) {
      return "<tr><td><button class=\"resource-item-button\" type=\"button\" data-history-item=\"" +
        esc(row.id) + "\"><code>" + esc(row.id) + "</code></button></td><td>" +
        fmt(row.count) + "</td><td>" + fmtG(row.avg_g) + "</td><td>" +
        fmtG(row.mint_peg_g) + "</td></tr>";
    }).join("");
  }

  function load(q, snapshotDate) {
    var url = API + "/api/realm/public/item-census?limit=500";
    if (q) url += "&q=" + encodeURIComponent(q);
    if (snapshotDate) url += "&snapshot_date=" + encodeURIComponent(snapshotDate);
    err.hidden = true;
    fetch(url, { credentials: "omit" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        var s = data.summary || {};
        var rows = data.items || [];
        document.getElementById("res-distinct").textContent = fmt(s.distinct_items || rows.length);
        document.getElementById("res-gold").textContent = fmtG(s.gold_mint_peg_g);
        document.getElementById("res-when").textContent = when(s.scanned_at);
        summary.hidden = false;
        meta.textContent = (snapshotDate ? "HST snapshot " + snapshotDate + " · " : "") +
          (s.scan_note ? String(s.scan_note) : "Synced from Root-ItemInfo");
        setDates(data.snapshot_dates || [], snapshotDate);
        setItems(rows);
        renderRows(rows);
      })
      .catch(function (e) {
        err.hidden = false;
        err.textContent = "Could not load resources: " + (e && e.message ? e.message : e);
        meta.textContent = "";
      });
  }

  if (qInput) {
    qInput.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        load(qInput.value.trim(), dateSelect ? dateSelect.value : "");
      }, 250);
    });
  }

  if (dateSelect) {
    dateSelect.addEventListener("change", function () {
      load(qInput ? qInput.value.trim() : "", dateSelect.value);
    });
  }

  if (itemSelect) {
    itemSelect.addEventListener("change", function () {
      loadHistory(itemSelect.value);
    });
  }

  if (body) {
    body.addEventListener("click", function (event) {
      var button = event.target.closest("[data-history-item]");
      if (!button) return;
      selectedItem = button.getAttribute("data-history-item") || "";
      if (itemSelect) itemSelect.value = selectedItem;
      loadHistory(selectedItem);
      historyPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  load("", "");
})();
