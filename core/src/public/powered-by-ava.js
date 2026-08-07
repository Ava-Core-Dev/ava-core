/*! Powered by Ava — last-hour CPU | RAM | SOC */
(function () {
  var API =
    window.AVA_POWERED_BY_API ||
    "https://rootrecord.info/ava/status/api/powered-by";
  var HREF = "https://ava.rootmc.net/";

  function fmt(n, suffix) {
    if (n == null || n === "" || Number.isNaN(Number(n))) return "—";
    var x = Math.round(Number(n) * 10) / 10;
    return x + (suffix || "");
  }

  function ensureMount() {
    var el = document.getElementById("powered-by-ava");
    if (el) return el;
    el = document.createElement("div");
    el.id = "powered-by-ava";
    el.className = "powered-by-ava";
    el.setAttribute("data-powered-by-ava", "1");
    document.body.appendChild(el);
    return el;
  }

  function render(el, data) {
    var cpu = data && data.ok ? fmt(data.cpu, "%") : "—";
    var ram = data && data.ok ? fmt(data.ram, "%") : "—";
    var soc = data && data.ok ? fmt(data.soc, "%") : "—";
    el.innerHTML =
      '<a class="pba-link" href="' +
      HREF +
      '" rel="noopener">' +
      "Powered by Ava" +
      "</a>" +
      '<span class="pba-sep" aria-hidden="true">·</span>' +
      '<span class="pba-metrics" title="Last hour averages">' +
      "CPU " +
      cpu +
      " <span class=\"pba-pipe\">|</span> RAM " +
      ram +
      " <span class=\"pba-pipe\">|</span> SOC " +
      soc +
      "</span>";
  }

  function injectStyle() {
    if (document.getElementById("powered-by-ava-style")) return;
    var s = document.createElement("style");
    s.id = "powered-by-ava-style";
    s.textContent =
      ".powered-by-ava{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:.45rem .75rem;" +
      "padding:.65rem 1rem;font:500 12px/1.4 system-ui,Segoe UI,sans-serif;letter-spacing:.02em;" +
      "color:#8aa394;background:rgba(10,17,14,.92);border-top:1px solid rgba(110,231,168,.18)}" +
      ".powered-by-ava .pba-link{color:#6ee7a8;text-decoration:none;font-weight:650}" +
      ".powered-by-ava .pba-link:hover{text-decoration:underline}" +
      ".powered-by-ava .pba-metrics{color:#c5d6cb;font-variant-numeric:tabular-nums}" +
      ".powered-by-ava .pba-pipe{opacity:.45;padding:0 .15rem}" +
      ".powered-by-ava .pba-sep{opacity:.35}";
    document.head.appendChild(s);
  }

  function boot() {
    injectStyle();
    var el = ensureMount();
    render(el, null);
    fetch(API, { cache: "no-store" })
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        render(el, data);
      })
      .catch(function () {
        render(el, null);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
