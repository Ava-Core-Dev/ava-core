/** Lists connected servers from GET /api/rootmc/server/featured. */
(function () {
  function el(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function hrefFor(id) {
    return "/economy/all-servers/" + encodeURIComponent(id) + "/";
  }

  async function load() {
    var root = el("servers-root");
    var sub = el("servers-subtitle");
    var err = el("servers-error");
    try {
      var res = await fetch("/api/rootmc/server/featured", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      var data = await res.json();
      var servers = data.servers || [];
      if (err) err.hidden = true;
      if (sub) {
        sub.textContent = servers.length
          ? servers.length + " listed host" + (servers.length === 1 ? "" : "s")
          : "No connected servers reported yet.";
      }
      if (!servers.length) {
        root.innerHTML = '<p class="rmc-muted">When operators bind a product key, hosts appear here.</p>';
        return;
      }
      root.innerHTML = servers
        .map(function (s) {
          var id = String(s.server_id || "").trim();
          if (!id) return "";
          var name = s.name || id;
          var addr = s.address || "—";
          var connected = s.connected ? "Connected" : "Listed";
          var feat = s.featured ? ' <span class="market-badge">Featured</span>' : "";
          return (
            '<a class="economy-server-row" href="' +
            hrefFor(id) +
            '">' +
            '<span class="economy-server-name">' +
            esc(name) +
            feat +
            "</span>" +
            '<span class="economy-server-meta">' +
            esc(connected) +
            " · " +
            esc(addr) +
            "</span>" +
            '<span class="economy-server-id">' +
            esc(id) +
            "</span>" +
            "</a>"
          );
        })
        .join("");
    } catch (e) {
      if (err) {
        err.hidden = false;
        err.textContent = "Could not load servers: " + (e && e.message ? e.message : e);
      }
      if (sub) sub.textContent = "Unavailable";
      root.innerHTML = "";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }
})();
