/*! Ava disruption banner — shows only when the operator toggle is on. */
(function () {
  if (window.__AVA_DISRUPTION_EMBED__) return;
  window.__AVA_DISRUPTION_EMBED__ = true;

  var APIS = window.AVA_DISRUPTION_API
    ? [window.AVA_DISRUPTION_API]
    : [
        "https://rootrecord.info/ava/status/api/disruption-banner",
        "https://ava.rootmc.net/api/disruption-banner",
        "https://ava-origin.rootmc.net/api/disruption-banner",
      ];
  var STATUS_HREF = "https://avaivy.cloud/";
  var untilMs = null;
  var timer = null;

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function fmtLeft(ms) {
    if (ms == null || !isFinite(ms)) return "—";
    if (ms <= 0) return "ended";
    var s = Math.max(0, Math.floor(ms / 1000));
    var d = Math.floor(s / 86400);
    s %= 86400;
    var h = Math.floor(s / 3600);
    s %= 3600;
    var m = Math.floor(s / 60);
    var sec = s % 60;
    if (d > 0) return d + "d " + pad(h) + ":" + pad(m) + ":" + pad(sec);
    return pad(h) + ":" + pad(m) + ":" + pad(sec);
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function fmtDetail(s) {
    var t = esc(s);
    t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    t = t.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    return t.replace(/\n/g, "<br>");
  }

  function injectStyle() {
    if (document.getElementById("ava-disruption-embed-style")) return;
    var s = document.createElement("style");
    s.id = "ava-disruption-embed-style";
    s.textContent =
      "#ava-disruption-embed{display:none;margin:0;padding:.85rem 1.1rem;z-index:80;" +
      "font:500 15px/1.45 system-ui,Segoe UI,sans-serif;color:#fff;" +
      "border-bottom:1px solid rgba(255,176,32,.45);" +
      "background:linear-gradient(135deg,rgba(255,120,40,.22),rgba(10,17,14,.92))}" +
      "#ava-disruption-embed.show{display:block}" +
      "#ava-disruption-embed.cat-maintenance{border-color:rgba(0,229,255,.4);" +
      "background:linear-gradient(135deg,rgba(0,229,255,.16),rgba(10,17,14,.92))}" +
      "#ava-disruption-embed.cat-unexpected{border-color:rgba(226,91,91,.5);" +
      "background:linear-gradient(135deg,rgba(226,91,91,.18),rgba(10,17,14,.92))}" +
      "#ava-disruption-embed .ade-head{display:flex;flex-wrap:wrap;gap:.75rem 1.2rem;align-items:flex-start;" +
      "max-width:72rem;margin:0 auto}" +
      "#ava-disruption-embed .ade-kicker{display:block;font-size:.68rem;font-weight:800;letter-spacing:.08em;" +
      "text-transform:uppercase;color:#fde68a;margin-bottom:.2rem}" +
      "#ava-disruption-embed.cat-maintenance .ade-kicker{color:#67e8f9}" +
      "#ava-disruption-embed.cat-unexpected .ade-kicker{color:#fca5a5}" +
      "#ava-disruption-embed strong.ade-title{display:block;font-size:1.02rem;margin:0 0 .3rem}" +
      "#ava-disruption-embed .ade-detail{margin:0;font-size:.88rem;line-height:1.45}" +
      "#ava-disruption-embed .ade-eta{margin-left:auto;text-align:right;min-width:8.5rem}" +
      "#ava-disruption-embed .ade-count{font:800 1.35rem/1 ui-monospace,monospace;letter-spacing:.04em}" +
      "#ava-disruption-embed .ade-until{margin:.2rem 0 0;font-size:.78rem;opacity:.85}" +
      "#ava-disruption-embed .ade-link{color:inherit;text-decoration:underline;text-underline-offset:2px}";
    document.head.appendChild(s);
  }

  function ensureMount() {
    var existing = document.getElementById("ava-disruption-embed");
    if (existing) return existing;
    if (document.getElementById("disruption")) return null;
    var el = document.createElement("aside");
    el.id = "ava-disruption-embed";
    el.setAttribute("hidden", "");
    el.setAttribute("role", "status");
    var eco = document.querySelector(".eco-bar");
    if (eco && eco.parentNode) eco.parentNode.insertBefore(el, eco.nextSibling);
    else document.body.insertBefore(el, document.body.firstChild);
    return el;
  }

  function hide(el) {
    untilMs = null;
    el.hidden = true;
    el.className = "";
    el.innerHTML = "";
  }

  function paintCountdown() {
    var el = document.getElementById("ava-disruption-count");
    if (!el) return;
    el.textContent = untilMs == null ? "—" : fmtLeft(untilMs - Date.now());
  }

  function render(el, b) {
    if (!b || !b.show) {
      hide(el);
      return;
    }
    var cat = String(b.category || "weather").replace(/[^a-z]/g, "") || "weather";
    var detail = fmtDetail(b.detail || "");
    var hasUntil = Boolean(b.untilMs);
    untilMs = hasUntil ? Number(b.untilMs) : null;
    el.hidden = false;
    el.className = "show cat-" + cat;
    el.innerHTML =
      '<div class="ade-head">' +
        '<div class="ade-copy">' +
          '<span class="ade-kicker">' + esc(b.categoryLabel || "Notice") + "</span>" +
          '<strong class="ade-title">' + esc(b.title || "Service disruption") + "</strong>" +
          (detail ? '<p class="ade-detail">' + detail + "</p>" : "") +
          '<p class="ade-until"><a class="ade-link" href="' +
          STATUS_HREF +
          '">Ava status</a></p>' +
        "</div>" +
        (hasUntil
          ? '<div class="ade-eta">' +
              '<div class="ade-count" id="ava-disruption-count">—</div>' +
              '<p class="ade-until">until ' + esc(b.untilLabel || "cleared") + "</p>" +
            "</div>"
          : "") +
      "</div>";
    paintCountdown();
  }

  function fetchBanner() {
    var i = 0;
    function next() {
      if (i >= APIS.length) return Promise.resolve(null);
      var url = APIS[i++];
      return fetch(url, { cache: "no-store", mode: "cors" })
        .then(function (r) {
          if (!r.ok) throw new Error("http " + r.status);
          return r.json();
        })
        .catch(function () {
          return next();
        });
    }
    return next();
  }

  function tick() {
    var el = ensureMount();
    if (!el) return;
    fetchBanner().then(function (data) {
      render(el, data);
    });
  }

  function boot() {
    if (document.getElementById("disruption")) return;
    injectStyle();
    tick();
    if (!timer) {
      timer = setInterval(paintCountdown, 1000);
      setInterval(tick, 60000);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
