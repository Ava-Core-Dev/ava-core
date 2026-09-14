(function () {
  var API = "/api/g2/rootmc/server/";
  var FEATURED_FALLBACK = "g2";
  var LIMIT = 500;

  function el(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtGold(n) {
    if (!Number.isFinite(n)) return "\u2014";
    return n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 }) + " G";
  }

  function playerLink(name) {
    if (!name) return "\u2014";
    return "<a href=\"/player/?player=" + encodeURIComponent(name) + "\">" + esc(name) + "</a>";
  }

  async function resolveServerId() {
    try {
      var res = await fetch("/api/g2/rootmc/server/config", { cache: "no-store" });
      var data = await res.json().catch(function () { return {}; });
      var sid = String((data.featured_server || {}).server_id || "").trim();
      if (sid) return { serverId: sid, serverName: (data.featured_server || {}).name || null };
    } catch (e) { /* fall through */ }
    return { serverId: FEATURED_FALLBACK, serverName: "RootMC" };
  }

  function fillTable(tableId, html, colSpan) {
    var table = el(tableId);
    if (!table) return;
    var tbody = table.querySelector("tbody");
    tbody.innerHTML = html || "<tr><td colspan=\"" + colSpan + "\" class=\"rmc-muted\">No balances synced yet.</td></tr>";
  }

  function renderSummary(data) {
    var t = data.totals || {};
    el("bal-total-players").textContent = fmtGold(t.player_notes_g);
    el("bal-total-towns").textContent = fmtGold(t.town_notes_g);
    el("bal-total-nations").textContent = fmtGold(t.nation_notes_g);
    el("bal-total-circ").textContent = fmtGold(t.circulating_notes_g);
    el("bal-count-players").textContent = (t.player_count || 0) + " with balance";
    el("bal-count-towns").textContent = (t.town_count || 0) + " with balance";
    el("bal-count-nations").textContent = (t.nation_count || 0) + " with balance";

    var synced = data.synced_at ? "Updated " + new Date(data.synced_at).toLocaleString() : "";
    el("balances-subtitle").textContent = (data.server_id || FEATURED_FALLBACK) + (synced ? " \u00b7 " + synced : "");
  }

  function renderPlayers(rows) {
    fillTable("bal-players", (rows || []).map(function (row) {
      return "<tr><td>" + esc(row.rank) + "</td><td>" + playerLink(row.display_name || row.minecraft_username)
        + "</td><td class=\"gold\">" + fmtGold(row.notes_g) + "</td></tr>";
    }).join(""), 3);
  }

  function renderTowns(rows) {
    fillTable("bal-towns", (rows || []).map(function (row) {
      return "<tr><td>" + esc(row.rank) + "</td><td>" + esc(row.display_name)
        + "</td><td>" + esc(row.nation_name || "\u2014")
        + "</td><td>" + playerLink(row.mayor_name)
        + "</td><td class=\"gold\">" + fmtGold(row.bonded_g != null ? row.bonded_g : row.notes_g)
        + "</td><td class=\"gold\">" + fmtGold(row.bond_earnings_g || 0) + "</td></tr>";
    }).join(""), 6);
  }

  function renderNations(rows) {
    fillTable("bal-nations", (rows || []).map(function (row) {
      return "<tr><td>" + esc(row.rank) + "</td><td>" + esc(row.display_name)
        + "</td><td>" + playerLink(row.leader_name)
        + "</td><td>" + esc(row.town_count != null ? row.town_count : "\u2014")
        + "</td><td class=\"gold\">" + fmtGold(row.bonded_g != null ? row.bonded_g : row.notes_g)
        + "</td><td class=\"gold\">" + fmtGold(row.bond_earnings_g || 0) + "</td></tr>";
    }).join(""), 6);
  }

  async function load() {
    var errNode = el("balances-error");
    errNode.hidden = true;
    var resolved = await resolveServerId();
    try {
      var res = await fetch(
        API + encodeURIComponent(resolved.serverId) + "/economy/circulating-balances?limit=" + LIMIT,
        { cache: "no-store" }
      );
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) throw new Error(data.detail || ("HTTP " + res.status));
      renderSummary(data);
      renderPlayers(data.players);
      renderTowns(data.towns);
      renderNations(data.nations);
    } catch (err) {
      errNode.hidden = false;
      errNode.textContent = err && err.message ? err.message : "Failed to load balances.";
      el("balances-subtitle").textContent = "Could not load balance data.";
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }
})();
