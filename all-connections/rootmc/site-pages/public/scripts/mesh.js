/** Live mesh peers for /mesh/ — GET /api/rootmc/transfer-mesh/public */
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

  function onlinePill(online) {
    if (online === true) return '<span class="mesh-pill mesh-pill--online">Online</span>';
    if (online === false) return '<span class="mesh-pill mesh-pill--offline">Offline</span>';
    return "";
  }

  function kindPill(kind) {
    if (kind === "official") return '<span class="mesh-pill mesh-pill--official">Official</span>';
    return '<span class="mesh-pill mesh-pill--myserver">My Server</span>';
  }

  function card(p) {
    var aliases = (p.aliases || []).length
      ? "<p>Aliases: <code>" + esc((p.aliases || []).join(", ")) + "</code></p>"
      : "";
    var gotoHint = "<p>In-game: <code>/goto " + esc(p.slug) + "</code></p>";
    return (
      '<article class="mesh-card">' +
      '<div class="mesh-card-top">' +
      "<h3>" +
      esc(p.label || p.slug) +
      "</h3>" +
      '<span style="display:flex;gap:0.35rem;flex-wrap:wrap">' +
      kindPill(p.kind) +
      onlinePill(p.online) +
      "</span></div>" +
      "<p><code>" +
      esc(p.slug) +
      "</code> · <code>" +
      esc(p.join || p.host + ":" + p.port) +
      "</code></p>" +
      aliases +
      gotoHint +
      "</article>"
    );
  }

  async function load() {
    var meta = el("mesh-meta");
    var err = el("mesh-error");
    var root = el("mesh-nodes");
    try {
      var res = await fetch("/api/rootmc/transfer-mesh/public", { cache: "no-store" });
      var data = await res.json().catch(function () {
        return null;
      });
      if (!res.ok) {
        throw new Error((data && (data.detail || data.error)) || "HTTP " + res.status);
      }
      var peers = data.peers || [];
      var official = peers.filter(function (p) {
        return p.kind === "official";
      });
      var mine = peers.filter(function (p) {
        return p.kind !== "official";
      });
      if (meta) {
        meta.textContent =
          peers.length +
          " node(s) · " +
          official.length +
          " official · " +
          mine.length +
          " My Servers · " +
          (data.computed_at || "");
      }
      if (root) {
        root.innerHTML = peers.map(card).join("") || '<p class="rmc-muted">No peers reported.</p>';
      }
      if (err) err.hidden = true;
    } catch (e) {
      if (err) {
        err.hidden = false;
        err.textContent = e instanceof Error ? e.message : String(e);
      }
      if (meta) meta.textContent = "Could not load live mesh — showing static official nodes.";
      if (root) {
        root.innerHTML = [
          {
            slug: "rootmc",
            label: "RootMC",
            join: "play.rootmc.net",
            kind: "official",
            aliases: ["play"],
            online: null,
          },
          {
            slug: "test",
            label: "ROOTMC DEV portal",
            join: "test (dev)",
            kind: "official",
            aliases: ["dev", "devportal"],
            online: null,
          },
        ]
          .map(card)
          .join("");
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }
})();
