/** Shared sub-navigation for economy satellite pages. */
(function () {
  var ITEMS = [
    { href: "/g2/economy/", label: "Overview", page: "overview" },
    { href: "/g2/economy/#live-audit", label: "Live audit", page: "overview", anchor: "live-audit" },
    { href: "/g2/mint/", label: "/Mint", page: "mint" },
    { href: "/g2/balances/", label: "Balances", page: "balances" },
    { href: "/g2/economy/bonds/", label: "Gold Backed Bonds", page: "bonds" },
    { href: "/g2/economy/#gold-supply", label: "Gold supply", page: "overview", anchor: "gold-supply" },
    { href: "/g2/economy/#server-reserve", label: "Reserve", page: "overview", anchor: "server-reserve" },
    { href: "/g2/market/", label: "Market", page: "market" },
    { href: "/g2/resources/", label: "Resources", page: "resources" },
    { href: "/g2/leaderboard/", label: "Leaderboards", page: "leaderboard" },
  ];

  function detectPage() {
    var body = document.body;
    if (!body) return "overview";
    if (body.classList.contains("mint-page")) return "mint";
    if (body.classList.contains("balances-page")) return "balances";
    if (body.classList.contains("bonds-page")) return "bonds";
    if (body.classList.contains("economy-page") || body.classList.contains("reserve-page")) return "overview";
    return body.getAttribute("data-economy-page") || "";
  }

  function mount() {
    var host = document.querySelector("[data-economy-nav]");
    if (!host) return;
    var page = detectPage();
    var hash = (window.location.hash || "").replace(/^#/, "");
    host.innerHTML = ITEMS.map(function (item) {
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
