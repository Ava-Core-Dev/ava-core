/** Shared header/nav chrome for /s/<serverId>/ pages. */
(function (global) {
  var NAV = [
    { key: "home", label: "Home", href: "" },
    { key: "market", label: "Market", href: "market/" },
    { key: "time", label: "Time", href: "time/" },
    { key: "leaderboard", label: "Leaderboard", href: "leaderboard/" },
    { key: "economy", label: "Economy", href: "economy/" },
    { key: "daily-report", label: "Daily report", href: "daily-report/" },
    { key: "player", label: "Players", href: "player/" },
    { key: "wiki", label: "Wiki", href: "https://rootmc.net/wiki/", external: true },
  ];

  function mountChrome(opts) {
    var S = global.RootMcServerSite;
    var serverId = opts.serverId || S.serverIdFromPath();
    var current = opts.current || "home";
    var name = opts.serverName || "Server";
    var base = S.basePath(serverId);

    var brand = document.querySelector("[data-s-brand]");
    if (brand) {
      brand.href = base;
      var tag = brand.querySelector(".rmc-brand-tag");
      if (tag) tag.textContent = name.length > 18 ? name.slice(0, 16) + "…" : name;
    }

    var nav = document.querySelector("[data-s-nav]");
    if (nav) {
      nav.innerHTML = NAV.map(function (item) {
        var href = item.external ? item.href : base + item.href;
        var cur = item.key === current ? ' aria-current="page"' : "";
        var extra = item.external ? ' target="_blank" rel="noopener"' : "";
        return '<a href="' + href + '"' + cur + extra + ">" + item.label + "</a>";
      }).join("");
    }

    document.querySelectorAll("[data-nav-toggle]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.body.classList.toggle("rmc-nav-open");
      });
    });
  }

  global.RootMcServerChrome = { mount: mountChrome, NAV: NAV };
})(window);
