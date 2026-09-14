(function () {
  function el(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setStatus(msg, kind) {
    var s = el("mystats-status");
    if (!s) return;
    s.textContent = msg || "";
    s.className = "verify-status" + (kind ? " verify-status-" + kind : "");
    s.hidden = !msg;
  }

  function persistTokenFromHash() {
    var hash = window.location.hash.replace(/^#/, "");
    if (!hash) return false;
    var params = new URLSearchParams(hash);
    var token = params.get("token");
    if (!token) return false;
    localStorage.setItem("rootmc_token", token);
    history.replaceState(null, "", window.location.pathname + window.location.search);
    return true;
  }

  function stripDiscordQuery() {
    var params = new URLSearchParams(window.location.search);
    if (!params.has("discord")) return;
    var code = params.get("discord");
    params.delete("discord");
    var q = params.toString();
    history.replaceState(null, "", window.location.pathname + (q ? "?" + q : ""));
    if (code === "registered") setStatus("Welcome — Discord account registered.", "info");
    else if (code === "signed_in") setStatus("Signed in with Discord.", "info");
    else if (code === "error" || code === "expired") setStatus("Discord sign-in failed.", "err");
  }

  function authHeaders() {
    var headers = {};
    var token = localStorage.getItem("rootmc_token") || "";
    if (token) headers.Authorization = "Bearer " + token;
    return headers;
  }

  async function fetchMe() {
    var res = await fetch("/api/account/me", {
      credentials: "include",
      headers: authHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return res.json();
  }

  async function logout() {
    await fetch("/api/account/auth/logout", {
      method: "POST",
      credentials: "include",
      headers: authHeaders(),
    });
    localStorage.removeItem("rootmc_token");
    window.location.href = "/login/";
  }

  function formatDate(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString();
    } catch (e) {
      return String(iso);
    }
  }

  function formatPlaytime(totalSeconds) {
    var seconds = Number(totalSeconds) || 0;
    if (seconds <= 0) return "0m";
    var hours = Math.floor(seconds / 3600);
    var minutes = Math.floor((seconds % 3600) / 60);
    return hours > 0 ? hours + "h " + minutes + "m" : minutes + "m";
  }

  function formatCurrency(value) {
    var n = Number(value) || 0;
    if (n <= 0) return "0.000";
    if (n >= 1000000) return (n / 1000000).toFixed(3) + "M";
    if (n >= 1000) return (n / 1000).toFixed(3) + "K";
    return n.toFixed(3);
  }

  function titleCaseSkill(key) {
    if (!key) return "";
    return key.charAt(0).toUpperCase() + key.slice(1);
  }

  function avatarUrl(uuid) {
    return "https://crafatar.com/avatars/" + String(uuid).replace(/-/g, "") + "?overlay&size=128";
  }

  function row(label, value) {
    return (
      '<div class="mystats-row"><dt>' +
      esc(label) +
      "</dt><dd>" +
      value +
      "</dd></div>"
    );
  }

  function overviewTile(label, value, hint) {
    return (
      '<div class="mystats-overview-tile">' +
      '<p class="mystats-overview-label">' +
      esc(label) +
      "</p>" +
      '<p class="mystats-overview-value">' +
      value +
      "</p>" +
      (hint
        ? '<p class="mystats-overview-hint">' + esc(hint) + "</p>"
        : "") +
      "</div>"
    );
  }

  function netWorthTotal(netWorth) {
    if (!netWorth) return 0;
    var parts =
      (Number(netWorth.balance_value) || 0) +
      (Number(netWorth.inventory_value) || 0) +
      (Number(netWorth.chest_value) || 0) +
      (Number(netWorth.shop_stock_value) || 0);
    var stored = Number(netWorth.total_value);
    if (!Number.isFinite(stored) || Math.abs(parts - stored) > 0.01) return parts;
    return stored;
  }

  function renderOverview(me, stats) {
    var card = el("mystats-overview");
    var grid = el("mystats-overview-grid");
    if (!card || !grid) return;
    if (!me.minecraft_linked) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    var playtime = stats && stats.playtime;
    var netWorth = stats && stats.net_worth;
    var mcmmo = stats && stats.mcmmo;
    grid.innerHTML =
      overviewTile(
        "Playtime",
        esc(formatPlaytime(playtime && playtime.total_playtime_seconds)),
        "Live host sync",
      ) +
      overviewTile(
        "Net worth",
        esc(formatCurrency(netWorthTotal(netWorth))) +
          ' <span style="color:var(--rmc-gold);font-size:0.85em">G</span>',
        "Wallet + items",
      ) +
      overviewTile(
        "McMMO power",
        esc(mcmmo && mcmmo.power_level != null ? String(mcmmo.power_level) : "—"),
        "Skill total",
      );
  }

  function renderPlaytime(playtime) {
    var empty = el("mystats-playtime-empty");
    var panel = el("mystats-playtime-panel");
    if (!empty || !panel) return;
    if (!playtime || !playtime.total_playtime_seconds) {
      empty.hidden = false;
      panel.hidden = true;
      return;
    }
    empty.hidden = true;
    panel.hidden = false;
    el("mystats-playtime-total").textContent = formatPlaytime(playtime.total_playtime_seconds);
    el("mystats-playtime-first").textContent = formatDate(playtime.first_join_at);
    el("mystats-playtime-last").textContent = formatDate(playtime.last_login_at);
  }

  function renderNetWorth(netWorth) {
    var empty = el("mystats-networth-empty");
    var panel = el("mystats-networth-panel");
    if (!empty || !panel) return;
    if (!netWorth || (!netWorth.total_value && !netWorthTotal(netWorth))) {
      empty.hidden = false;
      panel.hidden = true;
      return;
    }
    empty.hidden = true;
    panel.hidden = false;
    el("mystats-networth-total").textContent = formatCurrency(netWorthTotal(netWorth));
    el("mystats-networth-balance").textContent = formatCurrency(netWorth.balance_value);
    el("mystats-networth-inventory").textContent = formatCurrency(netWorth.inventory_value);
    el("mystats-networth-chests").textContent = formatCurrency(netWorth.chest_value);
    el("mystats-networth-shop").textContent = formatCurrency(netWorth.shop_stock_value);
    el("mystats-networth-synced").textContent = formatDate(netWorth.synced_at || netWorth.updated_at);
  }

  function renderMcmmo(mcmmo) {
    var empty = el("mystats-mcmmo-empty");
    var panel = el("mystats-mcmmo-panel");
    var skillsEl = el("mystats-mcmmo-skills");
    if (!empty || !panel || !skillsEl) return;
    if (!mcmmo || !mcmmo.skills || !Object.keys(mcmmo.skills).length) {
      empty.hidden = false;
      panel.hidden = true;
      return;
    }
    empty.hidden = true;
    panel.hidden = false;
    el("mystats-mcmmo-power").textContent =
      mcmmo.power_level != null ? String(mcmmo.power_level) : "—";
    el("mystats-mcmmo-synced").textContent = formatDate(mcmmo.synced_at);
    var entries = Object.keys(mcmmo.skills)
      .map(function (key) {
        return { key: key, level: mcmmo.skills[key] };
      })
      .sort(function (a, b) {
        return b.level - a.level;
      });
    skillsEl.innerHTML = entries
      .map(function (row) {
        return (
          '<div class="player-mcmmo-skill"><span>' +
          esc(titleCaseSkill(row.key)) +
          "</span><strong>" +
          esc(row.level) +
          "</strong></div>"
        );
      })
      .join("");
  }

  function render(me) {
    var loading = el("mystats-loading");
    var panel = el("mystats-panel");
    var consoleCard = el("mystats-console");
    if (loading) loading.hidden = true;
    if (!panel) return;
    panel.hidden = false;

    var stats = me.stats || null;
    var discordName =
      me.discord_global_name || me.discord_username || me.discord_user_id || "—";

    var title = el("mystats-title");
    var subtitle = el("mystats-subtitle");
    var avatar = el("mystats-avatar");
    if (title) {
      title.textContent = me.minecraft_linked
        ? me.minecraft_username || "Linked player"
        : "Account";
    }
    if (subtitle) {
      subtitle.textContent = me.minecraft_linked
        ? "Discord · " + discordName
        : "Signed in with Discord";
    }
    if (avatar) {
      if (me.minecraft_uuid) {
        avatar.hidden = false;
        avatar.src = avatarUrl(me.minecraft_uuid);
        avatar.alt = me.minecraft_username || "Minecraft avatar";
      } else {
        avatar.hidden = true;
      }
    }

    var html =
      row("Discord", esc(discordName)) +
      row(
        "Minecraft",
        me.minecraft_linked
          ? esc(me.minecraft_username || me.minecraft_uuid || "Linked")
          : '<span class="rmc-muted">Not linked</span>',
      );
    if (me.minecraft_uuid) {
      html += row(
        "UUID",
        '<span class="rmc-mono" style="font-size:0.82rem">' + esc(me.minecraft_uuid) + "</span>",
      );
    }
    el("mystats-account").innerHTML = html;

    var actions = el("mystats-actions");
    if (actions) {
      var bits = [];
      if (!me.minecraft_linked) {
        bits.push('<a class="rmc-btn rmc-btn-primary" href="/verify/">Link Minecraft</a>');
      } else if (me.minecraft_username) {
        bits.push(
          '<a class="rmc-btn rmc-btn-primary" href="/player/?u=' +
            encodeURIComponent(me.minecraft_username) +
            '">Public profile</a>',
        );
        bits.push('<a class="rmc-btn rmc-btn-secondary" href="/economy/">Economy</a>');
        bits.push('<a class="rmc-btn rmc-btn-secondary" href="/map/">Map</a>');
      }
      bits.push(
        '<button type="button" class="rmc-btn rmc-btn-ghost" id="btn-logout">Log out</button>',
      );
      actions.innerHTML = bits.join("");
      var logoutBtn = el("btn-logout");
      if (logoutBtn) logoutBtn.addEventListener("click", logout);
    }

    renderOverview(me, stats);

    if (consoleCard) {
      consoleCard.hidden = false;
      var note = el("mystats-console-note");
      if (note) {
        note.textContent = me.minecraft_linked
          ? "Live snapshot for " +
            (me.minecraft_username || "your linked account") +
            " — updates when the game servers sync."
          : "Run /link in-game, then finish at /verify to unlock playtime, net worth, and McMMO.";
      }
      if (me.minecraft_linked && stats) {
        renderPlaytime(stats.playtime);
        renderNetWorth(stats.net_worth);
        renderMcmmo(stats.mcmmo);
      }
    }

    var lead = el("mystats-lead");
    if (lead && me.minecraft_linked && me.minecraft_username) {
      lead.textContent = "Signed in · " + me.minecraft_username;
    } else if (lead) {
      lead.textContent =
        "Signed in with Discord" +
        (me.discord_username ? " · @" + me.discord_username : "");
    }
  }

  async function init() {
    persistTokenFromHash();
    stripDiscordQuery();
    try {
      var me = await fetchMe();
      if (!me || !me.signed_in) {
        window.location.replace("/login/");
        return;
      }
      render(me);
    } catch (e) {
      setStatus("Could not load account.", "err");
      window.location.replace("/login/");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
