/** Shared API helpers for /s/<serverId>/ pages. */
(function (global) {
  var API = "https://api.rootmc.net";

  function serverIdFromPath() {
    var parts = location.pathname.split("/").filter(Boolean);
    // ["s", "<id>", ...]
    if (parts[0] === "s" && parts[1]) {
      return decodeURIComponent(parts[1]);
    }
    var q = new URLSearchParams(location.search).get("id");
    return q ? String(q).trim() : "";
  }

  function basePath(serverId) {
    return "/s/" + encodeURIComponent(serverId) + "/";
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function fetchJson(path) {
    try {
      var res = await fetch(API + path, { cache: "no-store" });
      if (!res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  function fetchHub(serverId) {
    return fetchJson("/api/rootmc/server/" + encodeURIComponent(serverId) + "/hub");
  }

  function fetchTimes(serverId) {
    return fetchJson("/api/rootmc/server/" + encodeURIComponent(serverId) + "/times");
  }

  global.RootMcServerSite = {
    API: API,
    serverIdFromPath: serverIdFromPath,
    basePath: basePath,
    esc: esc,
    fetchHub: fetchHub,
    fetchTimes: fetchTimes,
  };
})(window);
