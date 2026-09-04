/**

 * Public Root Economy widget — live internal circulation + top holders.

 * Fetches same-origin `/v1/economy/*` (Pages proxy → account API).

 */

(function (global) {

  function el(tag, cls, text) {

    const n = document.createElement(tag);

    if (cls) n.className = cls;

    if (text != null) n.textContent = text;

    return n;

  }



  var ROOTS_ATOMIC_PER_WHOLE = 100000000;

  function fmtUnits(atomic) {
    var a = Math.max(0, Math.floor(Number(atomic) || 0));
    var whole = a / ROOTS_ATOMIC_PER_WHOLE;
    if (whole >= 1e9) return (whole / 1e9).toFixed(2) + "B";
    if (whole >= 1e6) return (whole / 1e6).toFixed(2) + "M";
    if (whole >= 1e4) return (whole / 1e3).toFixed(1) + "K";
    if (whole >= 1e3) return (whole / 1e3).toFixed(2) + "K";
    if (whole >= 1) return whole.toLocaleString(undefined, { maximumFractionDigits: 8 });
    return whole > 0 ? whole.toFixed(8).replace(/\.?0+$/, "") : "0";
  }

  function fmtRootsLocale(atomic) {
    var a = Math.max(0, Math.floor(Number(atomic) || 0));
    var whole = a / ROOTS_ATOMIC_PER_WHOLE;
    if (whole >= 1) return whole.toLocaleString(undefined, { maximumFractionDigits: 8 });
    if (a <= 0) return "0";
    return whole.toLocaleString(undefined, { maximumFractionDigits: 8 });
  }



  function labelForEntry(e) {

    if (!e || typeof e !== "object") return "—";

    if (e.public_display_name) return String(e.public_display_name);

    if (e.discord_global_name) return String(e.discord_global_name);

    if (e.discord_username) return "@" + String(e.discord_username).replace(/^@/, "");

    return String(e.wallet_short || "—");

  }



  async function fetchJson(path) {

    const res = await fetch(path, { credentials: "same-origin", cache: "no-store" });

    const j = await res.json().catch(function () {

      return {};

    });

    if (!res.ok || !j || j.ok === false) {

      const det = (j && (j.detail || j.error)) || "HTTP " + res.status;

      throw new Error(String(det));

    }

    return j;

  }



  /**

   * @param {HTMLElement} root

   * @param {{ compact?: boolean, pollMs?: number, showLeaderboard?: boolean }} [opts]

   */

  async function mountRootEconomyWidget(root, opts) {

    opts = opts || {};

    const compact = !!opts.compact;

    const pollMs = Math.max(15000, Number(opts.pollMs) || 30000);

    const showLeaderboard = opts.showLeaderboard !== false;



    root.innerHTML = "";

    root.classList.add("re-widget");

    if (compact) root.classList.add("re-widget--compact");



    const status = el("p", "re-widget-status", "Loading Root Economy…");

    root.appendChild(status);



    const body = el("div", "re-widget-body");

    body.hidden = true;

    root.appendChild(body);



    const totalCard = el("div", "re-widget-total");

    const totalVal = el("div", "re-widget-total-val", "—");

    const totalMeta = el("p", "re-widget-total-meta", "");

    totalCard.appendChild(el("div", "re-widget-total-label", "Internal circulation (Roots)"));

    totalCard.appendChild(totalVal);

    totalCard.appendChild(totalMeta);

    body.appendChild(totalCard);



    let tableWrap = null;
    let sortKey = "balance";
    let latestBoard = null;

    function sortedRows(board) {
      var rows = ((board && Array.isArray(board.entries)) ? board.entries : []).slice();
      rows.sort(function (a, b) {
        if (sortKey === "name") {
          var byName = labelForEntry(a).localeCompare(labelForEntry(b), undefined, { sensitivity: "base" });
          return byName || (Number(b.balance) || 0) - (Number(a.balance) || 0);
        }
        if (sortKey === "farmLevel") {
          var byLevel = (Number(b.farms_plots_unlocked) || 0) - (Number(a.farms_plots_unlocked) || 0);
          return byLevel || (Number(b.balance) || 0) - (Number(a.balance) || 0) || labelForEntry(a).localeCompare(labelForEntry(b));
        }
        return (Number(b.balance) || 0) - (Number(a.balance) || 0) || labelForEntry(a).localeCompare(labelForEntry(b));
      });
      return rows.slice(0, compact ? 8 : 100);
    }

    function renderRows() {
      if (!tableWrap || !latestBoard) return;
      const tbody = tableWrap.querySelector("tbody");
      const rows = sortedRows(latestBoard);
      tableWrap.querySelectorAll("[data-re-sort]").forEach(function (btn) {
        btn.classList.toggle("is-active", btn.getAttribute("data-re-sort") === sortKey);
      });
      tbody.innerHTML = rows.length
        ? rows
            .map(function (e, i) {
              const plots = Math.max(0, Math.floor(Number(e.farms_plots_unlocked) || 0));
              const rowsAcc = Math.max(0, Math.floor(Number(e.farms_rows_accumulated) || 0));
              const farms =
                plots > 0 || rowsAcc > 0
                  ? plots + " plot" + (plots === 1 ? "" : "s") + " · " + rowsAcc + " rows"
                  : "—";
              const rank = sortKey === "balance" ? e.rank : i + 1;
              return (
                "<tr><td>" +
                rank +
                "</td><td>" +
                labelForEntry(e).replace(/</g, "&lt;") +
                '</td><td class="re-widget-farms">' +
                farms.replace(/</g, "&lt;") +
                '</td><td style="text-align:right;font-variant-numeric:tabular-nums">' +
                fmtUnits(e.balance) +
                "</td></tr>"
              );
            })
            .join("")
        : '<tr><td colspan="4">No balances yet.</td></tr>';
    }

    if (showLeaderboard) {

      tableWrap = el("div", "re-widget-table-wrap");

      const sort = el("div", "re-widget-sort");
      sort.innerHTML =
        '<span>Sort by</span><button type="button" data-re-sort="balance" class="is-active">Balance</button><button type="button" data-re-sort="farmLevel">Farm level</button><button type="button" data-re-sort="name">Name</button>';
      sort.addEventListener("click", function (event) {
        var btn = event.target && event.target.closest ? event.target.closest("[data-re-sort]") : null;
        if (!btn) return;
        sortKey = btn.getAttribute("data-re-sort") || "balance";
        renderRows();
      });
      tableWrap.appendChild(sort);

      const table = el("table", "re-widget-table");

      table.innerHTML =

        '<thead><tr><th>#</th><th>Holder</th><th>Farms</th><th style="text-align:right">Balance</th></tr></thead><tbody></tbody>';

      tableWrap.appendChild(table);

      body.appendChild(tableWrap);

    }



    const foot = el("p", "re-widget-foot");

    foot.innerHTML =

      '<a href="/charts/root-economy/">Top holders</a> · <a href="/root-units">Your Roots</a>';

    body.appendChild(foot);



    let timer = null;



    async function refresh() {

      try {

        const daily = await fetchJson("/v1/economy/daily?days=7");

        const board = showLeaderboard ? await fetchJson("/v1/economy/leaderboard") : null;

        const total = Math.max(0, Math.floor(Number(daily.total_circulation) || 0));

        const acct = Math.max(0, Math.floor(Number(daily.account_count) || 0));

        totalVal.textContent = fmtRootsLocale(total) + " Roots";

        totalMeta.textContent =

          fmtUnits(total) +

          " total · " +

          acct.toLocaleString() +

          " linked accounts · updated " +

          new Date().toLocaleTimeString();

        status.hidden = true;

        body.hidden = false;



        if (tableWrap && board && Array.isArray(board.entries)) {
          latestBoard = board;
          renderRows();
        }

      } catch (e) {

        status.hidden = false;

        status.textContent = "Could not load Root Economy: " + (e && e.message ? e.message : "error");

        body.hidden = true;

      }

    }



    await refresh();

    timer = setInterval(refresh, pollMs);

    root.addEventListener(

      "root-economy-widget-stop",

      function () {

        if (timer) clearInterval(timer);

      },

      { once: true },

    );

  }



  global.mountRootEconomyWidget = mountRootEconomyWidget;

  global.fmtRootEconomyUnits = fmtUnits;

})(typeof globalThis !== "undefined" ? globalThis : window);

