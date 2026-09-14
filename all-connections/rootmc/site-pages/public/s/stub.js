(function () {
  var S = window.RootMcServerSite;
  var serverId = S.serverIdFromPath();
  var page = document.body.getAttribute("data-s-page") || "economy";
  var title = document.body.getAttribute("data-s-title") || "Feature";

  function el(id) {
    return document.getElementById(id);
  }

  S.fetchHub(serverId).then(function (hub) {
    var name = (hub && hub.server_name) || "Server";
    document.title = title + " — " + name;
    window.RootMcServerChrome.mount({ serverId: serverId, serverName: name, current: page });
    if (el("s-stub-home")) el("s-stub-home").href = S.basePath(serverId);
    if (el("s-stub-server")) el("s-stub-server").textContent = name;
    var feat = ((hub && hub.features) || []).find(function (f) {
      return f.id === page || f.href === page + "/";
    });
    if (el("s-stub-status") && feat) {
      el("s-stub-status").textContent =
        feat.status === "live"
          ? "Live"
          : feat.status === "installed"
            ? "Plugin installed · metrics not reporting yet"
            : "Not reporting yet — install the matching Root plugin when available";
    }
  });

  if (serverId) {
    window.RootMcServerChrome.mount({ serverId: serverId, serverName: "Server", current: page });
    if (el("s-stub-home")) el("s-stub-home").href = S.basePath(serverId);
  }
})();
