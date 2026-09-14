/** Shared RootMC site chrome — player / operator / developer nav. */
(function (global) {
  var DISCORD = "https://discord.gg/rFFQYrNaqS";

  var DATA_KEYS = {
    data: true,
    mesh: true,
  };

  var PLAYER = [
    { key: "home", label: "Home", href: "/" },
    { key: "data", label: "Data", href: "/data/" },
    { key: "mesh", label: "Mesh", href: "/mesh/" },
    { key: "wiki", label: "Wiki", href: "/wiki/" },
    { key: "blog", label: "Blog", href: "/blog/" },
    { key: "radio", label: "Radio", href: "/radio/" },
    { key: "timeline", label: "Timeline", href: "/timeline/" },
    { key: "thanks", label: "Tokens", href: "/thanks/" },
    { key: "plugins", label: "Plugins", href: "/plugins/" },
    { key: "developers", label: "Developers", href: "/developer/" },
    { key: "login", label: "Login/Register", href: "/login/", cta: true, guest: true },
    { key: "my-stats", label: "My Stats", href: "/my-stats/", cta: true, auth: true },
  ];

  var OPERATOR = [
    { key: "home", label: "Home", href: "/" },
    { key: "data", label: "Data", href: "/data/" },
    { key: "mesh", label: "Mesh", href: "/mesh/" },
    { key: "blog", label: "Blog", href: "/blog/" },
    { key: "radio", label: "Radio", href: "/radio/" },
    { key: "plugins", label: "Plugins", href: "/plugins/" },
    { key: "developers", label: "Developers", href: "/developer/" },
    { key: "wiki", label: "Wiki", href: "/wiki/" },
    { key: "discord", label: "Discord", href: DISCORD, external: true },
  ];

  var DEVELOPER = [
    { key: "portal", label: "Portal", href: "/developer/" },
    { key: "keys", label: "My Keys", href: "/developer/keys/" },
    { key: "servers", label: "My Servers", href: "/developer/servers/" },
    { key: "plugins", label: "Plugins", href: "/plugins/" },
    { key: "blog", label: "Blog", href: "/blog/" },
    { key: "players", label: "Players", href: "/" },
    { key: "login", label: "Sign in", href: "/developer/login/", guest: true },
    { key: "register", label: "Register", href: "/developer/register/", cta: true, guest: true },
  ];

  function pathBase() {
    var p = location.pathname || "/";
    if (p === "/g2" || p.indexOf("/g2/") === 0) return "/g2";
    return "";
  }

  /** When chrome is loaded on off-site Webstat hosts, point nav at rootmc.net. */
  function offSiteOrigin() {
    var h = (location.hostname || "").toLowerCase();
    if (
      !h ||
      h === "rootmc.net" ||
      h === "www.rootmc.net" ||
      h === "developer.rootmc.net" ||
      h.indexOf("pages.dev") >= 0 ||
      h === "localhost" ||
      h === "127.0.0.1"
    ) {
      return "";
    }
    return "https://rootmc.net";
  }

  function sniffCurrent() {
    var p = (location.pathname || "/").replace(/\/+$/, "") || "/";
    if (p === "/" || p === "/g2") return "home";
    if (p.indexOf("/developer/keys") === 0) return "keys";
    if (p.indexOf("/developer/servers") === 0) return "servers";
    if (p.indexOf("/developer/login") === 0) return "login";
    if (p.indexOf("/developer/register") === 0) return "register";
    if (p.indexOf("/developer") === 0) return "portal";
    if (p.indexOf("/thanks") === 0) return "thanks";
    if (p.indexOf("/plugins") === 0) return "plugins";
    if (p.indexOf("/servers") === 0) return "home";
    if (p.indexOf("/data") === 0 || p.indexOf("/old") === 0) return "data";
    if (p.indexOf("/mesh") === 0) return "mesh";
    if (p.indexOf("/market") >= 0) return "data";
    if (p.indexOf("/time") >= 0) return "data";
    if (p.indexOf("/leaderboard") >= 0) return "data";
    if (p.indexOf("/economy") >= 0 || p.indexOf("/mint") >= 0 || p.indexOf("/balances") >= 0 || p.indexOf("/resources") >= 0) return "data";
    if (p.indexOf("/daily-report") >= 0) return "data";
    if (p.indexOf("/player") >= 0) return "data";
    if (p.indexOf("/health") >= 0) return "data";
    if (p.indexOf("/wiki") >= 0) return "wiki";
    if (p.indexOf("/timeline") >= 0) return "timeline";
    if (p.indexOf("/blog") >= 0) return "blog";
    if (p.indexOf("/radio") >= 0) return "radio";
    if (p.indexOf("/verify") >= 0) return "verify";
    if (p.indexOf("/login") >= 0) return "login";
    if (p.indexOf("/my-stats") >= 0) return "my-stats";
    if (p.indexOf("/history") >= 0) return "home";
    return "";
  }

  function resolveHref(item, base) {
    if (item.external || item.href.indexOf("http") === 0) return item.href;
    var origin = offSiteOrigin();
    // Network-wide operator/dev links stay absolute (not under /g2).
    if (
      item.key === "plugins" ||
      item.key === "developers" ||
      item.key === "portal" ||
      item.key === "keys" ||
      item.key === "servers" ||
      item.key === "login" ||
      item.key === "register" ||
      item.key === "my-stats" ||
      item.key === "players"
    ) {
      return origin ? origin + item.href : item.href;
    }
    var path = item.href;
    if (base) {
      path = item.href === "/" ? base + "/" : base + item.href;
    }
    return origin ? origin + path : path;
  }

  function itemsForMode(mode) {
    if (mode === "operator") return OPERATOR;
    if (mode === "developer") return DEVELOPER;
    return PLAYER;
  }

  function renderLink(item, current, base) {
    var href = resolveHref(item, base);
    var attrs = 'href="' + href + '"';
    if (item.key === current) attrs += ' aria-current="page"';
    if (item.external) attrs += ' target="_blank" rel="noopener"';
    var cls = [];
    if (item.cta) cls.push("rmc-nav-cta");
    if (cls.length) attrs += ' class="' + cls.join(" ") + '"';
    if (item.guest) {
      if (href.indexOf("/developer") === 0) attrs += " data-dev-guest";
      else attrs += " data-nav-guest";
    }
    if (item.auth) attrs += " data-nav-auth hidden";
    return "<a " + attrs + ">" + item.label + "</a>";
  }

  function renderGroup(item, current, base) {
    var childKeys = (item.children || []).map(function (c) {
      return c.key;
    });
    var active = childKeys.indexOf(current) >= 0;
    var classes = "rmc-nav-group";
    if (active) classes += " is-open is-active";
    var links = (item.children || [])
      .map(function (child) {
        return renderLink(child, current, base);
      })
      .join("");
    return (
      '<div class="' +
      classes +
      '" data-nav-group="' +
      item.key +
      '">' +
      '<button type="button" class="rmc-nav-group-toggle" aria-expanded="' +
      (active ? "true" : "false") +
      '">' +
      item.label +
      '<span class="rmc-nav-group-chevron" aria-hidden="true"></span>' +
      "</button>" +
      '<div class="rmc-nav-submenu" role="group">' +
      links +
      "</div>" +
      "</div>"
    );
  }

  function renderItem(item, current, base) {
    if (item.children && item.children.length) {
      return renderGroup(item, current, base);
    }
    return renderLink(item, current, base);
  }

  function wireToggle() {
    document.querySelectorAll("[data-nav-toggle]").forEach(function (btn) {
      if (btn.getAttribute("data-site-nav-bound") === "1") return;
      btn.setAttribute("data-site-nav-bound", "1");
      btn.addEventListener("click", function () {
        var header = btn.closest(".rmc-header") || document.querySelector(".rmc-header");
        if (header) header.classList.toggle("is-open");
      });
    });
  }

  function wireGroups(nav) {
    nav.querySelectorAll("[data-nav-group]").forEach(function (group) {
      var btn = group.querySelector(".rmc-nav-group-toggle");
      if (!btn || btn.getAttribute("data-nav-group-bound") === "1") return;
      btn.setAttribute("data-nav-group-bound", "1");
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        var willOpen = !group.classList.contains("is-open");
        nav.querySelectorAll("[data-nav-group].is-open").forEach(function (other) {
          if (other !== group) {
            other.classList.remove("is-open");
            var ob = other.querySelector(".rmc-nav-group-toggle");
            if (ob) ob.setAttribute("aria-expanded", "false");
          }
        });
        group.classList.toggle("is-open", willOpen);
        btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
      });
    });
  }

  function wireOutsideClose() {
    if (document.documentElement.getAttribute("data-site-nav-outside") === "1") return;
    document.documentElement.setAttribute("data-site-nav-outside", "1");
    document.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("[data-nav-group]")) return;
      document.querySelectorAll(".rmc-nav [data-nav-group].is-open").forEach(function (group) {
        if (group.classList.contains("is-active")) return;
        group.classList.remove("is-open");
        var b = group.querySelector(".rmc-nav-group-toggle");
        if (b) b.setAttribute("aria-expanded", "false");
      });
    });
  }

  function updatePlayerAuthNav(signedIn) {
    document.querySelectorAll(".rmc-nav").forEach(function (nav) {
      if ((nav.getAttribute("data-site-nav") || "").toLowerCase() !== "player") return;
      nav.querySelectorAll("[data-nav-guest]").forEach(function (node) {
        node.hidden = Boolean(signedIn);
      });
      nav.querySelectorAll("[data-nav-auth]").forEach(function (node) {
        node.hidden = !signedIn;
      });
    });
  }

  function refreshPlayerSession() {
    var hasPlayer = false;
    document.querySelectorAll("[data-site-nav]").forEach(function (nav) {
      if ((nav.getAttribute("data-site-nav") || "").toLowerCase() === "player") hasPlayer = true;
    });
    if (!hasPlayer) return;
    var headers = {};
    try {
      var token = localStorage.getItem("rootmc_token") || "";
      if (token) headers.Authorization = "Bearer " + token;
    } catch (_) {}
    fetch("/api/account/me", { credentials: "include", headers: headers, cache: "no-store" })
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (me) {
        updatePlayerAuthNav(Boolean(me && me.signed_in));
      })
      .catch(function () {
        updatePlayerAuthNav(false);
      });
  }

  function mount(opts) {
    opts = opts || {};
    var nodes = document.querySelectorAll("[data-site-nav]");
    if (!nodes.length && opts.mode) {
      var fallback = document.querySelector(".rmc-nav");
      if (fallback && !fallback.getAttribute("data-site-nav")) {
        fallback.setAttribute("data-site-nav", opts.mode);
        nodes = [fallback];
      }
    }
    var base = opts.base != null ? opts.base : pathBase();
    nodes.forEach(function (nav) {
      var mode = (opts.mode || nav.getAttribute("data-site-nav") || "player").toLowerCase();
      var current =
        opts.current ||
        nav.getAttribute("data-site-nav-current") ||
        sniffCurrent();
      var items = itemsForMode(mode);
      var useBase = mode === "player" ? base : "";
      nav.innerHTML = items
        .map(function (item) {
          return renderItem(item, current, useBase);
        })
        .join("");
      nav.setAttribute("aria-label", "Main");
      wireGroups(nav);
    });
    wireToggle();
    wireOutsideClose();
    refreshPlayerSession();
    injectEcoBar();
    injectDisruptionBanner();
    try {
      document.dispatchEvent(new CustomEvent("rootmc:nav-ready"));
    } catch (_) {}
  }

  function injectEcoBar() {
    if (document.querySelector(".eco-bar")) return;
    var bar = document.createElement("nav");
    bar.className = "eco-bar";
    bar.setAttribute("aria-label", "Ecosystem");
    var host = (location.hostname || "").toLowerCase();
    var active = "rootrecord";
    if (host.indexOf("rootmc") >= 0) active = "rootmc";
    else if (host.indexOf("avaivy") >= 0 || host === "ava.rootmc.net") active = "ava";
    var items = [
      { href: "https://rootrecord.cloud/", key: "rootrecord", label: "RootRecord" },
      { href: "https://rootmc.net/", key: "rootmc", label: "RootMC" },
      { href: "https://avaivy.cloud/", key: "ava", label: "Ava" },
    ];
    bar.innerHTML = items
      .map(function (it) {
        var on = it.key === active ? ' aria-current="page"' : "";
        return '<a href="' + it.href + '"' + on + ">" + it.label + "</a>";
      })
      .join("");
    document.body.insertBefore(bar, document.body.firstChild);
  }

  function injectDisruptionBanner() {
    if (document.querySelector('script[src*="disruption-banner.js"]')) return;
    var s = document.createElement("script");
    s.src = "/scripts/disruption-banner.js";
    s.defer = true;
    document.head.appendChild(s);
  }

  function foldWikiSidebars() {
    var wide = window.matchMedia("(min-width: 960px)");
    document.querySelectorAll("aside.wiki-sidebar").forEach(function (aside) {
      if (aside.closest("details.wiki-sidebar-fold")) return;
      var parent = aside.parentNode;
      if (!parent) return;
      var details = document.createElement("details");
      details.className = "wiki-sidebar-fold";
      var summary = document.createElement("summary");
      summary.textContent = "On this page";
      parent.insertBefore(details, aside);
      details.appendChild(summary);
      details.appendChild(aside);
      function syncOpen() {
        details.open = wide.matches;
      }
      syncOpen();
      if (wide.addEventListener) wide.addEventListener("change", syncOpen);
      else if (wide.addListener) wide.addListener(syncOpen);
    });
  }

  function autoMount() {
    if (document.querySelector("[data-site-nav]")) mount();
    foldWikiSidebars();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", autoMount);
  } else {
    autoMount();
  }

  global.RootMcSiteNav = { mount: mount, refreshPlayerSession: refreshPlayerSession };
})(typeof window !== "undefined" ? window : globalThis);
