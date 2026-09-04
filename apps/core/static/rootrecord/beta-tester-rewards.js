(function () {
  const TOKEN_KEY = "rootrecord_portal_token";
  /** Same app_id as account.js — summary balance is account-wide. */
  const BETA_EARN_APP_ID = "rootrecord_weather_manager_android";

  function notifyPortalAuthChange() {
    try {
      window.dispatchEvent(new CustomEvent("rootrecord-portal-auth-change"));
    } catch {
      /* ignore */
    }
  }

  function el(id) {
    return document.getElementById(id);
  }

  function showPanel(name) {
    const map = { loading: "panel-rewards-loading", guest: "panel-rewards-guest", main: "panel-rewards-main" };
    const target = map[name] || map.loading;
    ["panel-rewards-loading", "panel-rewards-guest", "panel-rewards-main"].forEach((id) => {
      const n = el(id);
      if (n) n.hidden = id !== target;
    });
  }

  function setStatus(msg, kind) {
    const s = el("rewards-balance-status");
    if (!s) return;
    if (!msg) {
      s.textContent = "";
      s.hidden = true;
      s.className = "status";
      return;
    }
    s.textContent = msg;
    s.hidden = false;
    s.className = "status" + (kind ? " status-" + kind : "");
  }

  async function loadApiBase() {
    const res = await fetch("/api/site-config", { cache: "no-store" });
    if (!res.ok) throw new Error("config");
    const j = await res.json();
    return typeof j.apiBase === "string" ? j.apiBase.replace(/\/+$/, "") : "";
  }

  function formatBalance(atomic) {
    if (typeof formatRootUnitsAtomicBalance === "function") return formatRootUnitsAtomicBalance(atomic);
    var a = Number.isFinite(Number(atomic)) ? Math.max(0, Math.floor(Number(atomic))) : 0;
    if (a <= 0) return "0";
    return (a / 100000000).toLocaleString(undefined, { maximumFractionDigits: 8 });
  }

  function rootUnitsFromSummary(j) {
    if (typeof parseRootUnitsBalanceFromSummary === "function") {
      return parseRootUnitsBalanceFromSummary(j);
    }
    if (!j || typeof j !== "object") return NaN;
    const candidates = [j.balance, j.ledger_balance, j.root_units_balance, j.root_units, j.balance_display]
      .map(Number)
      .filter(function (n) {
        return Number.isFinite(n) && n >= 0;
      });
    return candidates.length ? Math.floor(Math.max.apply(null, candidates)) : NaN;
  }

  function niceAppName(appId) {
    const s = String(appId || "").trim();
    if (!s) return "Unknown";
    if (s === "rootrecord_weather_manager_android") return "Weather Manager (Android)";
    if (s === "rootrecord_business_manager_android") return "Business Manager (Android)";
    if (s === "rootrecord_account_hub_android") return "Account Hub (Android)";
    if (s === "rootrecord_token_manager_android") return "Token Manager (Android)";
    if (s === "rootrecord_kilauea_alerts_android") return "Kilauea Alerts (Android)";
    return s.replace(/_/g, " ");
  }

  function renderSources(summary) {
    const wrap = el("rewards-sources");
    const list = el("rewards-sources-list");
    if (!wrap || !list) return;

    const arr = summary && typeof summary === "object" ? summary.per_app_total : null;
    if (!Array.isArray(arr) || arr.length === 0) {
      wrap.hidden = true;
      list.innerHTML = "";
      return;
    }
    const rows = arr
      .map(function (r) {
        const app = r && typeof r === "object" ? String(r.app_id || "") : "";
        const total = r && typeof r === "object" ? Number(r.total_units) : NaN;
        const n = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
        return { app_id: app, total_units: n };
      })
      .filter(function (r) {
        return r.app_id && r.total_units > 0;
      })
      .sort(function (a, b) {
        return b.total_units - a.total_units;
      });

    if (rows.length === 0) {
      wrap.hidden = true;
      list.innerHTML = "";
      return;
    }

    list.innerHTML =
      '<div class="account-grid">' +
      rows
        .map(function (r) {
          return (
            '<div class="account-row"><span class="account-k">' +
            (niceAppName(r.app_id) + "</span><span class=account-v><strong>" + formatBalance(r.total_units) + "</strong></span></div>")
          );
        })
        .join("") +
      "</div>";
    wrap.hidden = false;
  }

  async function refreshRewardsBalance() {
    showPanel("loading");
    setStatus("");

    let apiBase;
    try {
      apiBase = await loadApiBase();
    } catch {
      showPanel("main");
      const bal = el("beta-rewards-balance-val");
      if (bal) bal.textContent = "—";
      setStatus("We could not load your balance. Please try again in a moment.", "warn");
      return;
    }

    if (!apiBase) {
      showPanel("main");
      const bal = el("beta-rewards-balance-val");
      if (bal) bal.textContent = "—";
      setStatus("Balance is not available on this copy of the site yet.", "warn");
      return;
    }

    const path = "/api/earn/summary?app_id=" + encodeURIComponent(BETA_EARN_APP_ID);
    const headers = new Headers();
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers.set("Authorization", "Bearer " + token);
    let res;
    try {
      res = await fetch(apiBase + path, {
        headers,
        credentials: "include",
        cache: "no-store",
      });
    } catch {
      showPanel("main");
      const bal = el("beta-rewards-balance-val");
      if (bal) bal.textContent = "—";
      setStatus("We could not load your balance. Please try again in a moment.", "warn");
      return;
    }

    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      notifyPortalAuthChange();
      showPanel("guest");
      setStatus("");
      return;
    }

    if (!res.ok) {
      showPanel("main");
      const bal = el("beta-rewards-balance-val");
      if (bal) bal.textContent = "—";
      setStatus("We could not load your balance. Please try again in a moment.", "warn");
      return;
    }

    let j;
    try {
      j = await res.json();
    } catch {
      showPanel("main");
      const bal = el("beta-rewards-balance-val");
      if (bal) bal.textContent = "—";
      setStatus("We could not load your balance. Please try again in a moment.", "warn");
      return;
    }

    const n = rootUnitsFromSummary(j);
    const bal = el("beta-rewards-balance-val");
    if (bal) {
      bal.textContent = Number.isFinite(n) ? formatBalance(n) : "—";
    }
    showPanel("main");
    renderSources(j);
    if (!Number.isFinite(n)) {
      setStatus("Balance could not be read. Please try again in a moment.", "warn");
    }
    if (token) {
      try {
        await fetch(apiBase + "/api/app-session/start", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token,
          },
          credentials: "include",
          body: JSON.stringify({
            app_id: "rootrecord_root_units_portal_web",
            mode: "signed_in",
          }),
        });
      } catch {
        /* ignore */
      }
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    refreshRewardsBalance();
    window.addEventListener("storage", (e) => {
      if (e.key === TOKEN_KEY) refreshRewardsBalance();
    });
    window.addEventListener("rootrecord-portal-auth-change", refreshRewardsBalance);
  });
})();
