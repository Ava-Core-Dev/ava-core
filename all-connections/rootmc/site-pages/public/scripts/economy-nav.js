/** Shared sub-navigation for economy satellite pages. */
(function () {
  function basePath() {
    var body = document.body;
    var raw = (body && body.getAttribute("data-economy-base")) || "/economy/";
    if (raw.charAt(raw.length - 1) !== "/") raw += "/";
    return raw;
  }

  function items() {
    var base = basePath();
    var scope = (document.body && document.body.getAttribute("data-economy-scope")) || "";
    var overviewHref = scope === "server" ? location.pathname.replace(/\/?$/, "/") : base;
    return [
      { href: "/economy/", label: "Scopes", page: "landing" },
      { href: overviewHref, label: "Overview", page: "overview" },
      { href: "/list/", label: "Lists", page: "list" },
      { href: overviewHref + "#live-audit", label: "Live audit", page: "overview", anchor: "live-audit" },
      { href: "/mint/", label: "/Mint", page: "mint" },
      { href: "/balances/", label: "Balances", page: "balances" },
      { href: "/economy/", label: "Gold Backed Bonds", page: "overview" },
      { href: overviewHref + "#gold-supply", label: "Gold supply", page: "overview", anchor: "gold-supply" },
      { href: overviewHref + "#server-reserve", label: "Reserve", page: "overview", anchor: "server-reserve" },
      { href: "/market/", label: "Market", page: "market" },
      { href: "/resources/", label: "Resources", page: "resources" },
      { href: "/leaderboard/", label: "Leaderboards", page: "leaderboard" },
      { href: "/economy/official/", label: "Official", page: "official" },
      { href: "/economy/all-servers/", label: "All servers", page: "all-servers" },
    ];
  }

  function detectPage() {
    var body = document.body;
    if (!body) return "overview";
    if (body.getAttribute("data-economy-page")) return body.getAttribute("data-economy-page");
    if (body.classList.contains("mint-page")) return "mint";
    if (body.classList.contains("balances-page")) return "balances";
    if (body.classList.contains("bonds-page")) return "bonds";
    if (body.classList.contains("list-page")) return "list";
    if (body.classList.contains("economy-landing-page")) return "landing";
    if (body.classList.contains("economy-page") || body.classList.contains("reserve-page")) return "overview";
    return "";
  }

  function mount() {
    var host = document.querySelector("[data-economy-nav]");
    if (!host) return;
    var page = detectPage();
    var hash = (window.location.hash || "").replace(/^#/, "");
    host.innerHTML = items().map(function (item) {
      var active = item.page === page
        && (!item.anchor || (page === "overview" && hash === item.anchor));
      var cls = "economy-subnav-link" + (active ? " is-active" : "");
      return "<a class=\"" + cls + "\" href=\"" + item.href + "\">" + item.label + "</a>";
    }).join("");
    host.hidden = false;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount);
  } else {
    mount();
  }
  window.addEventListener("hashchange", mount);
})();
