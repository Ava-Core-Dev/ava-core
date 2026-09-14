(function () {
  const TOKEN_KEY = "rootmc_token";

  function el(id) {
    return document.getElementById(id);
  }

  function authToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function queryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function persistTokenFromHash() {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return false;
    const params = new URLSearchParams(hash);
    const token = params.get("token");
    if (!token) return false;
    localStorage.setItem(TOKEN_KEY, token);
    history.replaceState(null, "", window.location.pathname + window.location.search);
    return true;
  }

  function stripDiscordAuthQuery() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("discord")) return;
    params.delete("discord");
    const q = params.toString();
    history.replaceState(null, "", window.location.pathname + (q ? "?" + q : ""));
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = String(s ?? "");
    return d.innerHTML;
  }

  async function startDiscordRegister(returnTo) {
    const res = await fetch("/api/developer/auth/discord/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ return_to: returnTo || "/developer/" }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.authorize_url) {
      throw new Error(data.detail || "Could not start Discord registration.");
    }
    window.location.href = data.authorize_url;
  }

  function bindDiscordButtons(root) {
    (root || document).querySelectorAll("[data-discord-register]").forEach(function (btn) {
      if (btn.dataset.bound === "1") return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", function () {
        const ret = btn.getAttribute("data-return") || "/developer/";
        startDiscordRegister(ret).catch(function (e) {
          alert(String(e.message || e));
        });
      });
    });
  }

  function discordAuthNotice() {
    const code = queryParam("discord");
    if (!code) return "";
    const notes = {
      registered: "Developer account created with Discord.",
      signed_in: "Signed in with Discord.",
      error: "Discord sign-in failed. Try again.",
      expired: "Discord sign-in expired. Try again.",
    };
    if (!notes[code]) return "";
    const kind = code === "registered" || code === "signed_in" ? "info" : "err";
    stripDiscordAuthQuery();
    return (
      '<p class="verify-status verify-status-' +
      kind +
      '">' +
      notes[code] +
      "</p>"
    );
  }

  async function devFetch(path, opts) {
    const headers = Object.assign({ "Content-Type": "application/json" }, (opts && opts.headers) || {});
    const token = authToken();
    if (token) headers.Authorization = "Bearer " + token;
    const res = await fetch("/api/developer/" + path.replace(/^\//, ""), {
      credentials: "include",
      ...(opts || {}),
      headers,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  async function loadMe() {
    return (await devFetch("me", { method: "GET" })).data;
  }

  async function logout() {
    await devFetch("auth/logout", { method: "POST", body: "{}" });
    localStorage.removeItem(TOKEN_KEY);
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return Promise.reject(new Error("Clipboard unavailable"));
  }

  function onceBanner(html) {
    return (
      '<div class="rmc-card verify-card" style="border-color:rgba(245,185,66,0.35);margin-bottom:1rem" id="dev-once">' +
      html +
      "</div>"
    );
  }

  function keysListHtml(keys) {
    const active = (keys || []).filter(function (k) {
      return !k.revoked_at;
    });
    if (!active.length) {
      return '<p class="rmc-muted">No account keys yet. Generate one, put <code>server-name</code> + <code>product-key</code> in <code>root-core.yml</code>, start Root-Core — the server appears on My Servers after first presence.</p>';
    }
    return (
      '<ul class="rmc-network-list" style="margin-top:0.75rem">' +
      active
        .map(function (k) {
          const serverName =
            k.label && k.label !== "default" ? k.label : "Unnamed server";
          return (
            "<li style=\"padding:0.75rem 1rem;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:0.65rem\">" +
            "<div><strong>" +
            esc(serverName) +
            "</strong>" +
            '<div style="margin-top:0.3rem"><code>' +
            esc(k.display) +
            "</code></div>" +
            '<div class="rmc-muted" style="font-size:0.8rem;margin-top:0.25rem">' +
            esc(k.created_at || "") +
            "</div></div>" +
            '<div style="display:flex;gap:0.45rem;flex-wrap:wrap">' +
            '<button type="button" class="rmc-btn rmc-btn-ghost" data-issue-cloud="' +
            esc(k.id) +
            '" style="font-size:0.85rem;padding:0.45rem 0.85rem">Manual override: cloud.yml</button>' +
            '<button type="button" class="rmc-btn rmc-btn-ghost" data-rename-key="' +
            esc(k.id) +
            '" data-rename-current="' +
            esc(serverName) +
            '" style="font-size:0.85rem;padding:0.45rem 0.85rem">Rename</button>' +
            '<button type="button" class="rmc-btn rmc-btn-danger" data-delete-key="' +
            esc(k.id) +
            '" style="font-size:0.85rem;padding:0.45rem 0.85rem">Delete</button>' +
            "</div>" +
            "</li>"
          );
        })
        .join("") +
      "</ul>"
    );
  }

  function keyOptionsHtml(keys) {
    const active = (keys || []).filter(function (k) {
      return !k.revoked_at;
    });
    if (!active.length) return "";
    return active
      .map(function (k, i) {
        return (
          '<option value="' +
          esc(k.id) +
          '"' +
          (i === 0 ? " selected" : "") +
          ">" +
          esc(k.label && k.label !== "default" ? k.label : "Unnamed server") +
          "  -  " +
          esc(k.display) +
          "</option>"
        );
      })
      .join("");
  }

  function serversListHtml(servers) {
    if (!servers || !servers.length) {
      return '<p class="rmc-muted">No servers linked yet. Put <code>server-name</code> + <code>product-key</code> in <code>root-core.yml</code> and start Root-Core — bind/presence registers the server automatically.</p>';
    }
    return (
      '<ul class="rmc-network-list" style="margin-top:0.75rem">' +
      servers
        .map(function (s) {
          return (
            "<li style=\"padding:0.75rem 1rem;border-bottom:1px solid rgba(255,255,255,0.06);display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:0.65rem\">" +
            "<div><strong>" +
            esc(s.server_name || "Server") +
            "</strong>" +
            '<div class="rmc-muted" style="font-size:0.85rem;margin-top:0.25rem">server-id <code>' +
            esc(s.server_id) +
            '</code></div></div>' +
            '<a class="rmc-btn rmc-btn-ghost" href="/developer/servers/manage/?id=' +
            encodeURIComponent(s.server_id || "") +
            '">Manage</a></li>'
          );
        })
        .join("") +
      "</ul>" +
      '<p class="verify-actions" style="margin-top:0.75rem">' +
      '<a class="rmc-btn rmc-btn-secondary" href="/developer/servers/">My Servers  -  health &amp; connection</a>' +
      "</p>"
    );
  }

  function formatAge(sec) {
    if (sec == null || !Number.isFinite(sec)) return "never";
    if (sec < 60) return sec + "s ago";
    if (sec < 3600) return Math.floor(sec / 60) + "m ago";
    if (sec < 86400) return Math.floor(sec / 3600) + "h ago";
    return Math.floor(sec / 86400) + "d ago";
  }

  function connectionBadge(conn) {
    const map = {
      online: { label: "Online", bg: "rgba(93,211,158,0.15)", color: "var(--rmc-emerald)", border: "rgba(93,211,158,0.32)" },
      degraded: { label: "Degraded", bg: "rgba(245,185,66,0.15)", color: "var(--rmc-gold-bright)", border: "rgba(245,185,66,0.35)" },
      offline: { label: "Offline", bg: "rgba(239,91,91,0.15)", color: "#ff8a8a", border: "rgba(239,91,91,0.35)" },
      never: { label: "Never seen", bg: "rgba(255,255,255,0.06)", color: "var(--rmc-muted)", border: "rgba(255,255,255,0.12)" },
    };
    const m = map[conn] || map.never;
    return (
      '<span class="rmc-badge" style="background:' +
      m.bg +
      ";color:" +
      m.color +
      ";border-color:" +
      m.border +
      '">' +
      m.label +
      "</span>"
    );
  }

  function serverHealthCard(s) {
    const players =
      s.online_players != null && Number.isFinite(Number(s.online_players))
        ? String(s.online_players) + " online"
        : " - ";
    const addr = s.server_address || "No address reported";
    const keyLine = s.product_key_display
      ? "Key <code>" +
        esc(s.product_key_display) +
        "</code>" +
        (s.product_key_revoked ? ' <span style="color:#ff8a8a">(revoked)</span>' : "")
      : "No account key bound";
    const meta = [];
    if (s.rootmc_plugin_version) meta.push("RootMC " + esc(s.rootmc_plugin_version));
    if (s.game_version) meta.push("MC " + esc(s.game_version));
    meta.push("seen " + formatAge(s.seconds_since_seen));
    const manageHref =
      "/developer/servers/manage/?id=" + encodeURIComponent(s.server_id || "");
    return (
      '<article class="rmc-card verify-card" style="margin-bottom:0.85rem;padding:1.15rem 1.25rem">' +
      '<div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:0.65rem">' +
      "<h3 style=\"margin:0;font-size:1.05rem\">" +
      esc(s.server_name || "Server") +
      "</h3>" +
      connectionBadge(s.connection) +
      "</div>" +
      '<p class="rmc-muted" style="margin:0.55rem 0 0;font-size:0.9rem">' +
      esc(addr) +
      " · " +
      players +
      "</p>" +
      '<p class="rmc-muted" style="margin:0.35rem 0 0;font-size:0.85rem">' +
      keyLine +
      "</p>" +
      '<p class="rmc-muted" style="margin:0.35rem 0 0;font-size:0.8rem">' +
      meta.join(" · ") +
      "</p>" +
      '<p class="rmc-muted" style="margin:0.45rem 0 0;font-size:0.78rem">server-id <code>' +
      esc(s.server_id) +
      "</code></p>" +
      (s.mesh_enabled
        ? '<p class="rmc-muted" style="margin:0.35rem 0 0;font-size:0.8rem">Mesh: on' +
          (s.transfer_slug ? " · <code>/goto " + esc(s.transfer_slug) + "</code>" : "") +
          "</p>"
        : '<p class="rmc-muted" style="margin:0.35rem 0 0;font-size:0.8rem">Mesh: off</p>') +
      '<p class="verify-actions" style="margin-top:0.85rem">' +
      '<a class="rmc-btn rmc-btn-secondary" href="' +
      manageHref +
      '">Manage</a>' +
      "</p>" +
      "</article>"
    );
  }

  function renderServersPage(me, health) {
    const host = el("dev-panel");
    if (!host) return;
    const notice = discordAuthNotice();
    if (!me || !me.signed_in) {
      host.innerHTML =
        notice +
        '<div class="rmc-card verify-card">' +
        "<h2 style=\"margin-top:0\">Sign in required</h2>" +
        '<p class="rmc-muted">Sign in with Discord to see server health for your account keys.</p>' +
        '<p class="verify-actions">' +
        '<button type="button" class="rmc-btn rmc-btn-primary" data-discord-register data-return="/developer/servers/">' +
        " Continue with Discord</button>" +
        "</p>" +
        '<p class="rmc-muted verify-note"><a href="/developer/">Developer portal</a></p>' +
        "</div>";
      bindDiscordButtons(host);
      return;
    }

    const servers = (health && health.servers) || [];
    const summary = (health && health.summary) || {
      total: servers.length,
      online: 0,
      degraded: 0,
      offline: 0,
    };
    const name =
      me.discord_global_name || me.discord_username || me.display_name || me.email || "Developer";

    const listHtml = servers.length
      ? servers.map(serverHealthCard).join("")
      : '<div class="rmc-card verify-card"><p class="rmc-muted" style="margin:0">No linked servers yet. Put <code>server-name</code> + <code>product-key</code> in <code>root-core.yml</code>, start Root-Core, then refresh this page after first presence.</p></div>';

    host.innerHTML =
      notice +
      '<div class="rmc-card verify-card">' +
      '<p class="rmc-badge" style="background: rgba(93,211,158,0.15); color: var(--rmc-emerald); border-color: rgba(93,211,158,0.32);">Signed in</p>' +
      "<h2 style=\"margin-top:0\">" +
      esc(name) +
      "</h2>" +
      '<p class="rmc-muted" style="margin-bottom:0">License presence from Root-Core on each Paper server (<code>root-core.yml</code> product-key).</p>' +
      '<div style="display:flex;flex-wrap:wrap;gap:0.65rem;margin-top:1rem">' +
      '<span class="rmc-badge" style="background:rgba(93,211,158,0.12);color:var(--rmc-emerald);border-color:rgba(93,211,158,0.28)">' +
      summary.online +
      " online</span>" +
      '<span class="rmc-badge" style="background:rgba(245,185,66,0.12);color:var(--rmc-gold-bright);border-color:rgba(245,185,66,0.28)">' +
      summary.degraded +
      " degraded</span>" +
      '<span class="rmc-badge" style="background:rgba(239,91,91,0.12);color:#ff8a8a;border-color:rgba(239,91,91,0.28)">' +
      summary.offline +
      " offline</span>" +
      '<span class="rmc-badge">' +
      summary.total +
      " total</span>" +
      "</div>" +
      '<p class="verify-actions" style="margin-top:1rem">' +
      '<button type="button" class="rmc-btn rmc-btn-secondary" id="btn-refresh-servers">Refresh</button>' +
      '<a class="rmc-btn rmc-btn-ghost" href="/developer/">Portal</a>' +
      '<button type="button" class="rmc-btn rmc-btn-ghost" id="btn-logout">Sign out</button>' +
      "</p>" +
      "</div>" +
      '<div style="margin-top:1rem">' +
      listHtml +
      "</div>";

    el("btn-logout")?.addEventListener("click", function () {
      logout().then(function () {
        window.location.reload();
      });
    });
    el("btn-refresh-servers")?.addEventListener("click", function () {
      const btn = el("btn-refresh-servers");
      if (btn) btn.disabled = true;
      loadServersHealth()
        .then(function (h) {
          return loadMe().then(function (fresh) {
            renderServersPage(fresh, h);
          });
        })
        .catch(function (e) {
          alert(String(e.message || e));
          if (btn) btn.disabled = false;
        });
    });
  }

  async function loadServersHealth() {
    const r = await devFetch("servers", { method: "GET" });
    if (!r.ok) throw new Error(r.data.detail || "Could not load servers.");
    return r.data;
  }

  async function loadServerDetail(serverId) {
    const id = String(serverId || "").trim();
    if (!id) throw new Error("Missing server id.");

    // Prefer list endpoint (stable); fall back to GET /servers/:id when present.
    try {
      const list = await loadServersHealth();
      const fromList = (list.servers || []).find(function (s) {
        return s && s.server_id === id;
      });
      if (fromList) {
        return { ok: true, server: fromList, thresholds: list.thresholds || null };
      }
    } catch (e) {
      /* try single-server route next */
    }

    const r = await devFetch("servers/" + encodeURIComponent(id), { method: "GET" });
    if (r.ok && r.data && r.data.server) return r.data;
    if (r.status === 404) {
      throw new Error(
        "This server is not linked to your developer account. Open My Servers and use Manage on a listed card (or re-bind Root-Core with your product key).",
      );
    }
    throw new Error(r.data.detail || "Could not load server (" + r.status + ").");
  }

  function renderServerManagePage(me, detail, errMsg) {
    const host = el("dev-panel");
    if (!host) return;
    const notice = discordAuthNotice();
    const serverId = queryParam("id") || "";

    if (!me || !me.signed_in) {
      host.innerHTML =
        notice +
        '<div class="rmc-card verify-card">' +
        "<h2 style=\"margin-top:0\">Sign in required</h2>" +
        '<p class="rmc-muted">Sign in with Discord to manage a connected server.</p>' +
        '<p class="verify-actions">' +
        '<button type="button" class="rmc-btn rmc-btn-primary" data-discord-register data-return="' +
        esc("/developer/servers/manage/" + (serverId ? "?id=" + encodeURIComponent(serverId) : "")) +
        '">Continue with Discord</button>' +
        "</p>" +
        '<p class="rmc-muted verify-note"><a href="/developer/servers/">My Servers</a></p>' +
        "</div>";
      bindDiscordButtons(host);
      return;
    }

    if (!serverId) {
      host.innerHTML =
        notice +
        '<div class="rmc-card verify-card">' +
        "<h2 style=\"margin-top:0\">No server selected</h2>" +
        '<p class="rmc-muted">Open a server from <a href="/developer/servers/">My Servers</a>.</p>' +
        "</div>";
      return;
    }

    if (errMsg || !detail || !detail.server) {
      host.innerHTML =
        notice +
        '<div class="rmc-card verify-card">' +
        "<h2 style=\"margin-top:0\">Server not found</h2>" +
        '<p class="rmc-muted">' +
        esc(errMsg || "This server is not linked to your account.") +
        "</p>" +
        '<p class="verify-actions"><a class="rmc-btn rmc-btn-secondary" href="/developer/servers/">Back to My Servers</a></p>' +
        "</div>";
      return;
    }

    const s = detail.server;
    const players =
      s.online_players != null && Number.isFinite(Number(s.online_players))
        ? String(s.online_players)
        : "—";
    const keyLine = s.product_key_display
      ? "<code>" +
        esc(s.product_key_display) +
        "</code>" +
        (s.product_key_revoked ? ' <span style="color:#ff8a8a">(revoked)</span>' : "")
      : '<span class="rmc-muted">None bound</span>';

    host.innerHTML =
      notice +
      '<p class="wiki-breadcrumb" style="margin:0 0 1rem"><a href="/developer/servers/">My Servers</a> / ' +
      esc(s.server_name || "Server") +
      "</p>" +
      '<div class="rmc-card verify-card">' +
      '<div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:0.65rem">' +
      "<h2 style=\"margin:0\">" +
      esc(s.server_name || "Server") +
      "</h2>" +
      connectionBadge(s.connection) +
      "</div>" +
      '<p class="rmc-muted" style="margin:0.75rem 0 0">License presence from Root-Core. Portal actions below do not restart Paper.</p>' +
      '<dl style="margin:1.15rem 0 0;display:grid;gap:0.65rem;font-size:0.92rem">' +
      "<div><dt class=\"rmc-muted\" style=\"font-size:0.75rem;text-transform:uppercase;letter-spacing:0.08em\">server-id</dt><dd style=\"margin:0.2rem 0 0\"><code id=\"mgr-server-id\">" +
      esc(s.server_id) +
      "</code> <button type=\"button\" class=\"rmc-btn rmc-btn-ghost\" id=\"btn-copy-server-id\" style=\"margin-left:0.35rem;padding:0.2rem 0.55rem;font-size:0.8rem\">Copy</button></dd></div>" +
      "<div><dt class=\"rmc-muted\" style=\"font-size:0.75rem;text-transform:uppercase;letter-spacing:0.08em\">Address</dt><dd style=\"margin:0.2rem 0 0\">" +
      esc(s.server_address || "Not reported") +
      "</dd></div>" +
      "<div><dt class=\"rmc-muted\" style=\"font-size:0.75rem;text-transform:uppercase;letter-spacing:0.08em\">Players</dt><dd style=\"margin:0.2rem 0 0\">" +
      esc(players) +
      "</dd></div>" +
      "<div><dt class=\"rmc-muted\" style=\"font-size:0.75rem;text-transform:uppercase;letter-spacing:0.08em\">Last presence</dt><dd style=\"margin:0.2rem 0 0\">" +
      esc(formatAge(s.seconds_since_seen)) +
      (s.rootmc_last_seen_at ? " <span class=\"rmc-muted\">(" + esc(s.rootmc_last_seen_at) + ")</span>" : "") +
      "</dd></div>" +
      "<div><dt class=\"rmc-muted\" style=\"font-size:0.75rem;text-transform:uppercase;letter-spacing:0.08em\">Versions</dt><dd style=\"margin:0.2rem 0 0\">" +
      esc(
        [s.rootmc_plugin_version ? "RootMC " + s.rootmc_plugin_version : null, s.game_version ? "MC " + s.game_version : null]
          .filter(Boolean)
          .join(" · ") || "—",
      ) +
      "</dd></div>" +
      "<div><dt class=\"rmc-muted\" style=\"font-size:0.75rem;text-transform:uppercase;letter-spacing:0.08em\">Product key</dt><dd style=\"margin:0.2rem 0 0\">" +
      keyLine +
      "</dd></div>" +
      "<div><dt class=\"rmc-muted\" style=\"font-size:0.75rem;text-transform:uppercase;letter-spacing:0.08em\">Linked</dt><dd style=\"margin:0.2rem 0 0\">" +
      esc(s.created_at || "—") +
      "</dd></div>" +
      "</dl>" +
      '<p class="verify-actions" style="margin-top:1.15rem">' +
      '<button type="button" class="rmc-btn rmc-btn-secondary" id="btn-refresh-server">Refresh</button>' +
      '<a class="rmc-btn rmc-btn-ghost" href="/developer/servers/">All servers</a>' +
      '<a class="rmc-btn rmc-btn-ghost" href="/plugins/root-core/">Install guide</a>' +
      "</p>" +
      "</div>" +
      '<div class="rmc-card verify-card" style="margin-top:1rem">' +
      "<h3 style=\"margin-top:0\">Links</h3>" +
      '<p class="rmc-muted">Public per-server site (mirrors official RootMC pages for this host).</p>' +
      '<dl style="margin:1rem 0 0;display:grid;gap:0.65rem;font-size:0.92rem">' +
      "<div><dt class=\"rmc-muted\" style=\"font-size:0.75rem;text-transform:uppercase;letter-spacing:0.08em\">Server site</dt><dd style=\"margin:0.2rem 0 0\"><code id=\"mgr-site-url\">" +
      esc("https://rootmc.net/s/" + s.server_id + "/") +
      '</code> <a class="rmc-btn rmc-btn-ghost" href="/s/' +
      encodeURIComponent(s.server_id) +
      '/" target="_blank" rel="noopener" style="margin-left:0.35rem;padding:0.2rem 0.55rem;font-size:0.8rem">Open</a> <button type="button" class="rmc-btn rmc-btn-ghost" id="btn-copy-site-url" style="margin-left:0.25rem;padding:0.2rem 0.55rem;font-size:0.8rem">Copy</button></dd></div>' +
      "<div><dt class=\"rmc-muted\" style=\"font-size:0.75rem;text-transform:uppercase;letter-spacing:0.08em\">Times</dt><dd style=\"margin:0.2rem 0 0\"><a href=\"/s/" +
      encodeURIComponent(s.server_id) +
      '/time/" target="_blank" rel="noopener">/s/…/time/</a></dd></div>' +
      "</dl>" +
      "</div>" +
      '<div class="rmc-card verify-card" style="margin-top:1rem">' +
      "<h3 style=\"margin-top:0\">Portal label</h3>" +
      '<p class="rmc-muted">Display name on My Servers. Prefer matching <code>server-name</code> in <code>root-core.yml</code>.</p>' +
      '<label class="rmc-muted" for="mgr-server-name" style="display:block;margin-top:0.85rem;font-size:0.85rem">Server name</label>' +
      '<input id="mgr-server-name" type="text" maxlength="80" value="' +
      esc(s.server_name || "") +
      '" style="width:100%;max-width:28rem;margin-top:0.35rem;padding:0.55rem 0.7rem;border-radius:8px;border:1px solid var(--rmc-outline);background:rgba(0,0,0,0.25);color:inherit;font:inherit">' +
      '<p class="verify-actions" style="margin-top:0.85rem">' +
      '<button type="button" class="rmc-btn rmc-btn-primary" id="btn-rename-server">Save name</button>' +
      "</p>" +
      "</div>" +
      '<div class="rmc-card verify-card" style="margin-top:1rem">' +
      "<h3 style=\"margin-top:0\">Transfer mesh (/goto)</h3>" +
      '<p class="rmc-muted">Opt into the RootMC cross-server mesh so other hosts list this server under <code>/goto</code>. License bind and My Servers stay active when mesh is off.</p>' +
      '<label class="rmc-muted" for="mgr-mesh-address" style="display:block;margin-top:0.85rem;font-size:0.85rem">Reachable host:port</label>' +
      '<input id="mgr-mesh-address" type="text" maxlength="120" placeholder="play.example.com:25565" value="' +
      esc(s.server_address || "") +
      '" style="width:100%;max-width:28rem;margin-top:0.35rem;padding:0.55rem 0.7rem;border-radius:8px;border:1px solid var(--rmc-outline);background:rgba(0,0,0,0.25);color:inherit;font:inherit">' +
      '<p class="rmc-muted" style="margin:0.55rem 0 0;font-size:0.85rem">Also set <code>transfer.advertise</code> (or <code>license.server-address</code>) in <code>root-core.yml</code> so presence refreshes this address.</p>' +
      '<label style="display:flex;align-items:center;gap:0.55rem;margin-top:0.95rem;font-size:0.92rem;cursor:pointer">' +
      '<input id="mgr-mesh-enabled" type="checkbox"' +
      (s.mesh_enabled ? " checked" : "") +
      '> Join transfer mesh' +
      "</label>" +
      (s.transfer_slug
        ? '<p class="rmc-muted" style="margin:0.65rem 0 0;font-size:0.85rem">Slug: <code>/goto ' +
          esc(s.transfer_slug) +
          "</code></p>"
        : "") +
      '<p class="verify-actions" style="margin-top:0.85rem">' +
      '<button type="button" class="rmc-btn rmc-btn-primary" id="btn-save-mesh">Save mesh settings</button>' +
      "</p>" +
      "</div>" +
      '<div class="rmc-card verify-card rmc-redcard" style="margin-top:1rem">' +
      '<p class="rmc-redcard-title">Unlink from portal</p>' +
      "<p style=\"margin:0;font-size:0.9rem;line-height:1.45;color:#ffd0d0\">Removes this row from My Servers. Does <strong>not</strong> revoke the product key or wipe Paper <code>cloud.yml</code>. The host can reappear after the next Root-Core bind/presence.</p>" +
      '<p class="verify-actions" style="margin-top:0.85rem">' +
      '<button type="button" class="rmc-btn rmc-btn-danger" id="btn-unlink-server">Unlink server</button>' +
      "</p>" +
      "</div>";

    el("btn-copy-server-id")?.addEventListener("click", function () {
      const text = s.server_id || "";
      if (!text) return;
      (navigator.clipboard && navigator.clipboard.writeText
        ? navigator.clipboard.writeText(text)
        : Promise.reject(new Error("Clipboard unavailable"))
      )
        .then(function () {
          alert("server-id copied.");
        })
        .catch(function () {
          window.prompt("Copy server-id:", text);
        });
    });

    el("btn-copy-site-url")?.addEventListener("click", function () {
      const text = "https://rootmc.net/s/" + (s.server_id || "") + "/";
      if (!s.server_id) return;
      (navigator.clipboard && navigator.clipboard.writeText
        ? navigator.clipboard.writeText(text)
        : Promise.reject(new Error("Clipboard unavailable"))
      )
        .then(function () {
          alert("Server site URL copied.");
        })
        .catch(function () {
          window.prompt("Copy URL:", text);
        });
    });

    el("btn-refresh-server")?.addEventListener("click", function () {
      const btn = el("btn-refresh-server");
      if (btn) btn.disabled = true;
      loadServerDetail(serverId)
        .then(function (d) {
          return loadMe().then(function (fresh) {
            renderServerManagePage(fresh, d);
          });
        })
        .catch(function (e) {
          alert(String(e.message || e));
          if (btn) btn.disabled = false;
        });
    });

    el("btn-rename-server")?.addEventListener("click", function () {
      const name = (el("mgr-server-name") && el("mgr-server-name").value) || "";
      const btn = el("btn-rename-server");
      if (btn) btn.disabled = true;
      devFetch("servers/rename", {
        method: "POST",
        body: JSON.stringify({ server_id: serverId, server_name: name }),
      })
        .then(function (r) {
          if (!r.ok) throw new Error(r.data.detail || "Could not rename.");
          return loadServerDetail(serverId);
        })
        .then(function (d) {
          return loadMe().then(function (fresh) {
            renderServerManagePage(fresh, d);
          });
        })
        .catch(function (e) {
          alert(String(e.message || e));
          if (btn) btn.disabled = false;
        });
    });

    el("btn-save-mesh")?.addEventListener("click", function () {
      const enabled = !!(el("mgr-mesh-enabled") && el("mgr-mesh-enabled").checked);
      const address = ((el("mgr-mesh-address") && el("mgr-mesh-address").value) || "").trim();
      const btn = el("btn-save-mesh");
      if (btn) btn.disabled = true;
      const body = { server_id: serverId, enabled: enabled };
      if (address) body.address = address;
      devFetch("servers/mesh", {
        method: "POST",
        body: JSON.stringify(body),
      })
        .then(function (r) {
          if (!r.ok) throw new Error(r.data.detail || "Could not update mesh settings.");
          return loadServerDetail(serverId);
        })
        .then(function (d) {
          return loadMe().then(function (fresh) {
            renderServerManagePage(fresh, d);
          });
        })
        .catch(function (e) {
          alert(String(e.message || e));
          if (btn) btn.disabled = false;
        });
    });

    el("btn-unlink-server")?.addEventListener("click", function () {
      if (
        !window.confirm(
          "Unlink this server from My Servers?\n\nThe product key stays valid. Paper can re-register on next Root-Core presence.",
        )
      ) {
        return;
      }
      const btn = el("btn-unlink-server");
      if (btn) btn.disabled = true;
      devFetch("servers/unlink", {
        method: "POST",
        body: JSON.stringify({ server_id: serverId }),
      })
        .then(function (r) {
          if (!r.ok) throw new Error(r.data.detail || "Could not unlink.");
          window.location.href = "/developer/servers/";
        })
        .catch(function (e) {
          alert(String(e.message || e));
          if (btn) btn.disabled = false;
        });
    });
  }

  function renderKeysPage(me, flash) {
    const host = el("dev-panel");
    if (!host) return;
    const notice = discordAuthNotice();
    if (!me || !me.signed_in) {
      host.innerHTML =
        notice +
        '<div class="rmc-card verify-card">' +
        "<h2 style=\"margin-top:0\">Sign in required</h2>" +
        '<p class="rmc-muted">Sign in with Discord to generate and manage account keys.</p>' +
        '<p class="verify-actions">' +
        '<button type="button" class="rmc-btn rmc-btn-primary" data-discord-register data-return="/developer/keys/">' +
        " Continue with Discord</button>" +
        "</p>" +
        '<p class="rmc-muted verify-note"><a href="/developer/">Developer portal</a></p>' +
        "</div>";
      bindDiscordButtons(host);
      return;
    }

    const name =
      me.discord_global_name || me.discord_username || me.display_name || me.email || "Developer";
    const keys = me.account_keys || me.product_keys || [];
    const activeCount = keys.filter(function (k) {
      return !k.revoked_at;
    }).length;

    host.innerHTML =
      notice +
      (flash || "") +
      '<div class="rmc-card verify-card">' +
      '<p class="rmc-badge" style="background: rgba(93,211,158,0.15); color: var(--rmc-emerald); border-color: rgba(93,211,158,0.32);">Signed in</p>' +
      "<h2 style=\"margin-top:0\">" +
      esc(name) +
      "</h2>" +
      '<p class="rmc-muted">Discord' +
      (me.discord_username ? " @" + esc(me.discord_username) : "") +
      " · " +
      activeCount +
      " active key" +
      (activeCount === 1 ? "" : "s") +
      "</p>" +
      '<aside class="rmc-redcard" role="note" style="display:block;margin:1rem 0 1.25rem;padding:1rem 1.1rem;border-radius:10px;background:rgba(120,18,18,0.55);border:2px solid #ef5b5b;color:#ffd0d0;box-shadow:0 0 0 1px rgba(239,91,91,0.25),0 8px 24px rgba(0,0,0,0.35)">' +
      '<p class="rmc-redcard-title" style="margin:0 0 0.45rem;font-family:ui-monospace,monospace;font-size:0.72rem;font-weight:700;letter-spacing:0.14em;text-transform:uppercase;color:#ff6b6b">Red card  -  key deletion</p>' +
      "<p style=\"margin:0;font-size:0.9rem;line-height:1.45;color:#ffd0d0\">Deleting an account key is permanent. Any Paper server still using that key in <code>root-core.yml</code> will fail future license checks. You cannot recover the plaintext key. Cloud <code>server-id</code> / <code>server-secret</code> are separate  -  delete the key only if you intend to rotate licensing.</p>" +
      "</aside>" +
      "<h3 style=\"margin:0 0 .35rem;font-size:1rem\">Account keys</h3>" +
      '<p class="rmc-muted">One key per Paper server. Put <code>server-name</code> and <code>product-key</code> in <code>plugins/RootMC/root-core.yml</code>, then start Root-Core. My Servers updates from license presence — no portal cloud.yml step required.</p>' +
      keysListHtml(keys) +
      '<p class="rmc-muted" style="margin-top:0.75rem;font-size:0.85rem"><strong>Manual override:</strong> use the button below only if you need to mint cloud credentials by hand (blank <code>cloud.yml</code> without Root-Core bind).</p>' +
      '<p class="verify-actions" style="margin-top:1rem">' +
      '<button type="button" class="rmc-btn rmc-btn-primary" id="btn-gen-key">Generate account key</button>' +
      '<a class="rmc-btn rmc-btn-ghost" href="/developer/">Portal</a>' +
      '<a class="rmc-btn rmc-btn-ghost" href="/developer/servers/">My Servers</a>' +
      '<button type="button" class="rmc-btn rmc-btn-ghost" id="btn-logout">Sign out</button>' +
      "</p>" +
      "</div>";

    el("btn-logout")?.addEventListener("click", function () {
      logout().then(function () {
        window.location.reload();
      });
    });

    host.querySelectorAll("[data-issue-cloud]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const keyId = btn.getAttribute("data-issue-cloud");
        const selected = keys.find(function (k) {
          return k.id === keyId && !k.revoked_at;
        });
        if (!selected) return;
        const serverName =
          selected.label && selected.label !== "default"
            ? String(selected.label).trim()
            : "Minecraft server";
        btn.disabled = true;
        devFetch("servers", {
          method: "POST",
          body: JSON.stringify({ server_name: serverName, product_key_id: selected.id }),
        })
          .then(function (r) {
            if (!r.ok) throw new Error(r.data.detail || "Could not issue cloud credentials.");
            const sid = r.data.server_id;
            const secret = r.data.server_secret;
            const yaml =
              "cloud:\n  api-base: \"https://api.rootmc.net\"\n  server-id: \"" +
              sid +
              "\"\n  server-secret: \"" +
              secret +
              "\"\n";
            const flashHtml = onceBanner(
              "<h3 style=\"margin-top:0\">Manual cloud.yml for " +
                esc(serverName) +
                "</h3>" +
                '<p class="rmc-muted">Optional override. Prefer Root-Core bind from <code>root-core.yml</code>. Secret shown once.</p>' +
                "<pre style=\"overflow:auto;padding:0.75rem;background:rgba(0,0,0,0.35);border-radius:8px\"><code>" +
                esc(yaml) +
                "</code></pre>" +
                '<p class="verify-actions">' +
                '<button type="button" class="rmc-btn rmc-btn-primary" id="btn-copy-cloud">Copy YAML</button>' +
                "</p>",
            );
            return loadMe().then(function (fresh) {
              renderKeysPage(fresh, flashHtml);
              el("btn-copy-cloud")?.addEventListener("click", function () {
                copyText(yaml).then(
                  function () {
                    alert("cloud.yml snippet copied.");
                  },
                  function () {
                    alert(yaml);
                  },
                );
              });
            });
          })
          .catch(function (e) {
            alert(String(e.message || e));
            btn.disabled = false;
          });
      });
    });

    host.querySelectorAll("[data-rename-key]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const keyId = btn.getAttribute("data-rename-key");
        if (!keyId) return;
        const current = btn.getAttribute("data-rename-current") || "";
        const next = window.prompt(
          "Portal label (match root-core.yml server-name):",
          current === "Unnamed server" || current === "default" ? "" : current,
        );
        if (next == null) return;
        const serverName = String(next).trim().slice(0, 80);
        if (!serverName) {
          alert("Label is required.");
          return;
        }
        btn.disabled = true;
        devFetch("keys/rename", {
          method: "POST",
          body: JSON.stringify({ id: keyId, label: serverName }),
        })
          .then(function (r) {
            if (!r.ok) throw new Error(r.data.detail || "Could not rename key.");
            return loadMe().then(function (fresh) {
              renderKeysPage(fresh);
            });
          })
          .catch(function (e) {
            alert(String(e.message || e));
            btn.disabled = false;
          });
      });
    });

    host.querySelectorAll("[data-delete-key]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const keyId = btn.getAttribute("data-delete-key");
        if (!keyId) return;
        const ok = window.confirm(
          "Delete this account key?\n\nThis also removes any My Servers entries bound to this key. Paper hosts still using it in root-core.yml will fail future license checks.",
        );
        if (!ok) return;
        btn.disabled = true;
        devFetch("keys/delete", { method: "POST", body: JSON.stringify({ id: keyId }) })
          .then(function (r) {
            if (!r.ok) throw new Error(r.data.detail || "Could not delete key.");
            const n = Number(r.data.servers_deleted) || 0;
            if (n > 0) {
              alert("Key deleted. Removed " + n + " server(s) from My Servers.");
            }
            return loadMe().then(function (fresh) {
              renderKeysPage(fresh);
            });
          })
          .catch(function (e) {
            alert(String(e.message || e));
            btn.disabled = false;
          });
      });
    });

    el("btn-gen-key")?.addEventListener("click", function () {
      const btn = el("btn-gen-key");
      if (btn) btn.disabled = true;
      devFetch("keys", { method: "POST", body: JSON.stringify({}) })
        .then(function (r) {
          if (!r.ok) throw new Error(r.data.detail || "Could not create key.");
          const key = r.data.account_key;
          const yaml =
            "# plugins/RootMC/root-core.yml\nserver-name: \"\"\nproduct-key: \"" +
            key +
            "\"\n";
          const flashHtml = onceBanner(
            "<h3 style=\"margin-top:0\">Copy into root-core.yml</h3>" +
              '<p class="rmc-muted">One file. Set <code>server-name</code>, paste <code>product-key</code>, start Root-Core. Cloud id/secret are filled by bind.</p>' +
              "<pre style=\"overflow:auto;padding:0.75rem;background:rgba(0,0,0,0.35);border-radius:8px\"><code>" +
              esc(yaml) +
              "</code></pre>" +
              '<p class="verify-actions">' +
              '<button type="button" class="rmc-btn rmc-btn-primary" id="btn-copy-key">Copy YAML</button>' +
              "</p>",
          );
          return loadMe().then(function (fresh) {
            renderKeysPage(fresh, flashHtml);
            el("btn-copy-key")?.addEventListener("click", function () {
              copyText(yaml).then(
                function () {
                  alert("root-core.yml snippet copied.");
                },
                function () {
                  alert(yaml);
                },
              );
            });
          });
        })
        .catch(function (e) {
          alert(String(e.message || e));
          if (btn) btn.disabled = false;
        });
    });
  }

  function renderPortal(me, flash) {
    const host = el("dev-panel");
    if (!host) return;
    const notice = discordAuthNotice();
    if (!me || !me.signed_in) {
      host.innerHTML =
        notice +
        '<div class="rmc-card verify-card">' +
        "<h2 style=\"margin-top:0\">Developer account</h2>" +
        '<p class="rmc-muted">Sign in with Discord to generate a free account key and link Paper servers to Root-Core.</p>' +
        '<p class="verify-actions">' +
        '<button type="button" class="rmc-btn rmc-btn-primary" data-discord-register data-return="/developer/">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.32 4.37A19.79 19.79 0 0 0 15.43 3a13.4 13.4 0 0 0-.62 1.27 18.27 18.27 0 0 0-5.62 0A12.5 12.5 0 0 0 8.57 3 19.74 19.74 0 0 0 3.67 4.37 21.05 21.05 0 0 0 .17 18.7a19.92 19.92 0 0 0 6.05 3.06 14.6 14.6 0 0 0 1.3-2.11 12.86 12.86 0 0 1-2.05-1c.17-.13.34-.27.5-.4a14.18 14.18 0 0 0 12.06 0c.17.14.34.27.5.4a12.79 12.79 0 0 1-2.06 1 14.45 14.45 0 0 0 1.3 2.12 19.92 19.92 0 0 0 6.06-3.07 21 21 0 0 0-3.51-14.33Z"/></svg>' +
        " Continue with Discord</button>" +
        "</p>" +
        '<p class="rmc-muted verify-note">Players linking Minecraft should use <a href="/verify/">/verify</a> instead.</p>' +
        "</div>";
      bindDiscordButtons(host);
      return;
    }

    const name =
      me.discord_global_name || me.discord_username || me.display_name || me.email || "Developer";
    const keys = me.account_keys || me.product_keys || [];
    const servers = me.servers || [];
    const activeKeys = keys.filter(function (k) {
      return !k.revoked_at;
    }).length;

    host.innerHTML =
      notice +
      (flash || "") +
      '<div class="rmc-card verify-card">' +
      '<p class="rmc-badge" style="background: rgba(93,211,158,0.15); color: var(--rmc-emerald); border-color: rgba(93,211,158,0.32);">Signed in</p>' +
      "<h2 style=\"margin-top:0\">" +
      esc(name) +
      "</h2>" +
      '<p class="rmc-muted">Discord' +
      (me.discord_username ? " @" + esc(me.discord_username) : "") +
      (me.email ? " · " + esc(me.email) : "") +
      "</p>" +
      '<p class="verify-actions" style="margin-top:1rem">' +
      '<a class="rmc-btn rmc-btn-primary" href="/developer/keys/">My Keys' +
      (activeKeys ? " (" + activeKeys + ")" : "") +
      "</a>" +
      '<a class="rmc-btn rmc-btn-secondary" href="/developer/servers/">My Servers' +
      (servers.length ? " (" + servers.length + ")" : "") +
      "</a>" +
      "</p>" +
      '<p class="rmc-muted" style="margin-top:1.25rem">Generate a key on <a href="/developer/keys/">My Keys</a>, set <code>root-core.yml</code>, start Root-Core. Online status is on <a href="/developer/servers/">My Servers</a> (license presence).</p>' +
      '<p class="verify-actions" style="margin-top:1.25rem">' +
      '<button type="button" class="rmc-btn rmc-btn-ghost" id="btn-logout">Sign out</button>' +
      '<a class="rmc-btn rmc-btn-ghost" href="/">rootmc.net</a>' +
      "</p>" +
      "</div>";

    el("btn-logout")?.addEventListener("click", function () {
      logout().then(function () {
        window.location.reload();
      });
    });
  }

  function renderAuthPage(mode) {
    const host = el("dev-panel");
    if (!host) return;
    const notice = discordAuthNotice();
    const isLogin = mode === "login";
    const title = isLogin ? "Developer sign in" : "Create developer account";
    const blurb = isLogin
      ? "Continue with Discord to manage account keys and linked servers."
      : "Discord sign-in creates your developer account. Then generate a free account key to link Paper servers.";
    host.innerHTML =
      notice +
      '<div class="rmc-card verify-card">' +
      "<h2 style=\"margin-top:0\">" +
      title +
      "</h2>" +
      '<p class="rmc-muted">' +
      blurb +
      "</p>" +
      '<p class="verify-actions">' +
      '<button type="button" class="rmc-btn rmc-btn-primary" data-discord-register data-return="/developer/">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.32 4.37A19.79 19.79 0 0 0 15.43 3a13.4 13.4 0 0 0-.62 1.27 18.27 18.27 0 0 0-5.62 0A12.5 12.5 0 0 0 8.57 3 19.74 19.74 0 0 0 3.67 4.37 21.05 21.05 0 0 0 .17 18.7a19.92 19.92 0 0 0 6.05 3.06 14.6 14.6 0 0 0 1.3-2.11 12.86 12.86 0 0 1-2.05-1c.17-.13.34-.27.5-.4a14.18 14.18 0 0 0 12.06 0c.17.14.34.27.5.4a12.79 12.79 0 0 1-2.06 1 14.45 14.45 0 0 0 1.3 2.12 19.92 19.92 0 0 0 6.06-3.07 21 21 0 0 0-3.51-14.33Z"/></svg>' +
      (isLogin ? " Sign in with Discord" : " Register with Discord") +
      "</button>" +
      "</p>" +
      '<p class="rmc-muted verify-note">' +
      (isLogin
        ? 'New here? <a href="/developer/register/">Create an account</a>.'
        : 'Already registered? <a href="/developer/login/">Sign in</a>.') +
      ' · <a href="/developer/">Developer home</a></p>' +
      "</div>";
    bindDiscordButtons(host);
  }

  function updateDevNav(signedIn) {
    const nav = document.querySelector(".rmc-nav");
    if (!nav) return;
    nav.querySelectorAll("[data-dev-auth]").forEach(function (node) {
      node.hidden = Boolean(signedIn);
    });
    nav.querySelectorAll("[data-dev-guest]").forEach(function (node) {
      node.hidden = Boolean(signedIn);
    });
  }

  async function boot() {
    persistTokenFromHash();
    const page = document.body.getAttribute("data-dev-page") || "home";
    if (page === "register" || page === "login") {
      const me = await loadMe();
      updateDevNav(Boolean(me && me.signed_in));
      if (me && me.signed_in) {
        window.location.replace("/developer/");
        return;
      }
      renderAuthPage(page);
      return;
    }
    if (page === "keys") {
      const me = await loadMe();
      updateDevNav(Boolean(me && me.signed_in));
      renderKeysPage(me);
      return;
    }
    if (page === "servers") {
      const me = await loadMe();
      updateDevNav(Boolean(me && me.signed_in));
      if (!me || !me.signed_in) {
        renderServersPage(me, null);
        return;
      }
      try {
        const health = await loadServersHealth();
        renderServersPage(me, health);
      } catch (e) {
        renderServersPage(me, { servers: [], summary: { total: 0, online: 0, degraded: 0, offline: 0 } });
        const host = el("dev-panel");
        if (host) {
          host.insertAdjacentHTML(
            "afterbegin",
            '<p class="verify-status verify-status-err">' + esc(String(e.message || e)) + "</p>",
          );
        }
      }
      return;
    }
    if (page === "server-manage") {
      const me = await loadMe();
      updateDevNav(Boolean(me && me.signed_in));
      const serverId = queryParam("id") || "";
      if (!me || !me.signed_in) {
        renderServerManagePage(me, null);
        return;
      }
      if (!serverId) {
        renderServerManagePage(me, null);
        return;
      }
      try {
        const detail = await loadServerDetail(serverId);
        renderServerManagePage(me, detail);
      } catch (e) {
        renderServerManagePage(me, null, String(e.message || e));
      }
      return;
    }
    const me = await loadMe();
    updateDevNav(Boolean(me && me.signed_in));
    renderPortal(me);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
