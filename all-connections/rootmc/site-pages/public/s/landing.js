(function () {
  var S = window.RootMcServerSite;
  var serverId = S.serverIdFromPath();

  function el(id) {
    return document.getElementById(id);
  }

  function render(hub) {
    var name = (hub && hub.server_name) || "Server";
    document.title = name + " — RootMC";
    window.RootMcServerChrome.mount({ serverId: serverId, serverName: name, current: "home" });

    el("s-hero-brand").textContent = name;
    el("s-title").textContent = name;
    var addr = hub && hub.server_address ? hub.server_address : "Address not reported";
    el("s-lead").textContent =
      "Public status page for this linked host. Address: " + addr + ".";

    var stale = hub && hub.times_summary && hub.times_summary.stale;
    var live = hub && hub.times_summary && !hub.times_summary.stale;
    el("s-live-label").textContent = live ? "Live · Times reporting" : stale ? "Stale · waiting for Times" : "Waiting for Times";
    el("s-times-live").textContent = live ? "LIVE" : stale ? "STALE" : "OFF";

    var base = S.basePath(serverId);
    el("s-actions").innerHTML =
      '<a class="rmc-btn rmc-btn-primary" href="' +
      base +
      'time/">Open Times</a>' +
      (hub && hub.server_address
        ? '<a class="rmc-btn rmc-btn-ghost" href="minecraft://?addExternalServer=' +
          encodeURIComponent(name) +
          "|" +
          encodeURIComponent(hub.server_address) +
          '">Join address</a>'
        : "") +
      '<a class="rmc-btn rmc-btn-ghost" href="https://rootmc.net/wiki/">Wiki</a>';

    var online = hub && hub.online_players != null ? String(hub.online_players) : "—";
    var game = (hub && hub.game_version) || "—";
    var core = (hub && hub.rootmc_plugin_version) || "—";
    el("s-stats").innerHTML =
      '<div class="s-stat"><span class="rmc-muted">Online</span><strong>' +
      S.esc(online) +
      "</strong></div>" +
      '<div class="s-stat"><span class="rmc-muted">MC</span><strong>' +
      S.esc(game) +
      "</strong></div>" +
      '<div class="s-stat"><span class="rmc-muted">RootMC</span><strong>' +
      S.esc(core) +
      "</strong></div>";

    var ts = hub && hub.times_summary;
    if (ts) {
      el("s-times-aside").innerHTML =
        '<p style="margin:0;font-size:1.2rem;font-family:Bricolage Grotesque,sans-serif">Day #' +
        S.esc(ts.dayId) +
        "</p>" +
        '<p class="rmc-muted" style="margin:0.35rem 0 0">' +
        S.esc(ts.todTicks) +
        " ticks · " +
        S.esc(ts.phase) +
        " · " +
        S.esc(ts.lengthMinutes) +
        " min/day</p>" +
        '<p style="margin:0.5rem 0 0">' +
        S.esc(ts.online) +
        " online · " +
        S.esc(ts.afk) +
        " AFK</p>";
    }

    var features = (hub && hub.features) || [];
    el("s-features").innerHTML = features
      .map(function (f) {
        var href = f.href ? base + f.href : base;
        var st = f.status === "live" ? "live" : f.status === "stub" ? "stub" : "";
        var ver = f.version ? " · v" + f.version : "";
        return (
          '<a class="s-feature-card" href="' +
          href +
          '"><div class="s-feature-status ' +
          st +
          '">' +
          S.esc(f.status) +
          ver +
          "</div><strong>" +
          S.esc(f.label) +
          "</strong></a>"
        );
      })
      .join("");
  }

  function boot() {
    if (!serverId) {
      el("s-title").textContent = "Missing server id";
      el("s-lead").textContent = "Open this page as /s/<server-id>/ from Developer → Manage.";
      return;
    }
    window.RootMcServerChrome.mount({ serverId: serverId, serverName: "Server", current: "home" });
    S.fetchHub(serverId).then(function (hub) {
      if (!hub) {
        el("s-live-label").textContent = "Not found";
        el("s-lead").textContent = "No linked server with this id.";
        return;
      }
      render(hub);
    });
  }

  boot();
})();
