/** Soft-read of connection preference + Solar/Cloud badge.
 * Solar (green) whenever play.rootmc.net is connected.
 * Cloud (orange) only when the origin has failed over and the server is down.
 */
(function () {
  var KEY = "rootmc_connection_preference";
  var LIVE_KEY = "rootmc_connection_live";
  var TTL_MS = 15000;
  var POLL_MS = 20000;
  var PLAY_HOST = "play.rootmc.net";

  function readCache(key) {
    try {
      var raw = sessionStorage.getItem(key);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.at || Date.now() - o.at > TTL_MS) return null;
      return o.data;
    } catch (e) {
      return null;
    }
  }

  function writeCache(key, data) {
    try {
      sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), data: data }));
    } catch (e) { /* ignore */ }
  }

  function cached() {
    return readCache(KEY);
  }

  function store(data) {
    writeCache(KEY, data);
  }

  function cachedLive() {
    return readCache(LIVE_KEY);
  }

  function storeLive(connected) {
    writeCache(LIVE_KEY, { connected: Boolean(connected) });
  }

  function prefProvider(data) {
    if (!data) return "unknown";
    if (data.active_provider === "solar" || data.active_provider === "cloudflare") {
      return data.active_provider;
    }
    return data.preference === "local"
      ? "solar"
      : data.preference === "cloudflare"
        ? "cloudflare"
        : "unknown";
  }

  function activeProvider(data, live) {
    var connected = live && typeof live.connected === "boolean" ? live.connected : null;
    if (connected === true) return "solar";
    var fromPref = prefProvider(data);
    if (connected === false) return "cloudflare";
    return fromPref;
  }

  function paintBadge(el, data, live) {
    if (!el) return;
    var p = activeProvider(data, live);
    el.dataset.provider = p;
    el.textContent = p === "solar" ? "Solar" : p === "cloudflare" ? "Cloud" : "…";
    el.title = p === "solar"
      ? "Solar · play.rootmc.net connected"
      : p === "cloudflare"
        ? "Cloud · origin failover (server not connected)"
        : "Active provider unknown";
    el.classList.toggle("is-solar", p === "solar");
    el.classList.toggle("is-cloudflare", p === "cloudflare");
    el.classList.toggle("is-cloud", p === "cloudflare");
  }

  function currentPaint(el) {
    paintBadge(el || ensureBadge(), cached(), cachedLive());
  }

  function ensureBadge() {
    var existing = document.getElementById("rmc-active-provider");
    if (existing) return existing;
    var nav = document.querySelector(".rmc-nav") || document.querySelector("[data-site-nav]");
    if (!nav || !nav.parentElement) return null;
    var el = document.createElement("span");
    el.id = "rmc-active-provider";
    el.className = "rmc-active-provider";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.textContent = "…";
    if (!document.getElementById("rmc-active-provider-style")) {
      var style = document.createElement("style");
      style.id = "rmc-active-provider-style";
      style.textContent =
        ".rmc-active-provider{display:inline-block;margin-left:.75rem;font:600 .72rem/1.2 ui-monospace,Consolas,monospace;" +
        "letter-spacing:.04em;text-transform:uppercase;opacity:.9;border:1px solid currentColor;padding:.2rem .5rem;border-radius:2px}" +
        ".rmc-active-provider.is-solar{color:#22c55e;border-color:#22c55e;background:rgba(34,197,94,.14);" +
        "box-shadow:0 0 12px rgba(34,197,94,.35);opacity:1}" +
        ".rmc-active-provider.is-cloudflare,.rmc-active-provider.is-cloud{color:#f59e0b;border-color:#f59e0b;" +
        "background:rgba(245,158,11,.1)}";
      document.head.appendChild(style);
    }
    nav.parentElement.insertBefore(el, nav.nextSibling);
    return el;
  }

  function fetchJson(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("http");
      return r.json();
    });
  }

  function probeLiveServer() {
    var urls = [
      "https://api.mcstatus.io/v2/status/java/" + PLAY_HOST,
      "https://api.mcsrvstat.us/3/" + PLAY_HOST,
    ];
    var i = 0;
    function next() {
      if (i >= urls.length) return Promise.resolve(null);
      var u = urls[i++];
      return fetchJson(u)
        .then(function (j) {
          if (j && typeof j.online === "boolean") return Boolean(j.online);
          return next();
        })
        .catch(function () {
          return next();
        });
    }
    return next().then(function (online) {
      if (typeof online === "boolean") {
        storeLive(online);
        return { connected: online };
      }
      return cachedLive();
    });
  }

  function fetchPreference() {
    var urls = [
      "/api/rootmc/connection-preference",
      "https://api.rootmc.net/api/rootmc/connection-preference",
      "https://ava-origin.rootmc.net/api/rootmc/connection-preference",
    ];
    var i = 0;
    function next() {
      if (i >= urls.length) return Promise.resolve(cached());
      var u = urls[i++];
      return fetchJson(u)
        .then(function (j) {
          store(j);
          return j;
        })
        .catch(function () {
          return next();
        });
    }
    return next();
  }

  window.RootMcConnectionPreference = {
    get: function () {
      return cached();
    },
    activeProvider: function (data) {
      return activeProvider(data || cached(), cachedLive());
    },
    refresh: function () {
      var el = ensureBadge();
      currentPaint(el);
      return Promise.all([fetchPreference(), probeLiveServer()]).then(function (pair) {
        paintBadge(el, pair[0], pair[1]);
        return pair[0];
      });
    },
    mountBadge: function () {
      var el = ensureBadge();
      currentPaint(el);
      return this.refresh();
    },
  };

  function start() {
    window.RootMcConnectionPreference.mountBadge();
    if (!window.__rmcPrefPoll) {
      window.__rmcPrefPoll = setInterval(function () {
        window.RootMcConnectionPreference.refresh();
      }, POLL_MS);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
