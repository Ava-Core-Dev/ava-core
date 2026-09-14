(function () {
  var API = "";
  var SCOPE_ORDER = [
    { id: "claims", title: "Claims" },
    { id: "towny", title: "Towny" },
    { id: "official", title: "Official (Claims + Towny)" },
    { id: "global", title: "Global (all servers)" },
  ];
  var GROUP_ORDER = [
    { id: "treasury_type", title: "Entry types" },
    { id: "towny_intake", title: "Towny intake" },
    { id: "supply", title: "Supply" },
    { id: "pools", title: "Pools" },
  ];
  var FALLBACK_COLLECTION_START = "2026-07-01";

  function el(id) {
    return document.getElementById(id);
  }

  function formatG(v) {
    if (v === null || v === undefined) return "…";
    var n = Number(v);
    if (!Number.isFinite(n)) return "…";
    return n.toLocaleString(undefined, { maximumFractionDigits: 3 }) + " G";
  }

  function formatStartDate(isoDate) {
    if (!isoDate) return "—";
    var d = new Date(String(isoDate) + (String(isoDate).length <= 10 ? "T12:00:00" : ""));
    if (!Number.isFinite(d.getTime())) return String(isoDate);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  }

  function isOpeningRow(row) {
    var cat = String((row && row.category) || "").toUpperCase();
    var lbl = String((row && row.label) || "").toLowerCase();
    return cat === "OPENING" || lbl === "opening balance";
  }

  function renderScope(scopeId, title, catalog, startDate) {
    var section = document.createElement("section");
    section.className = "rmc-card list-scope";
    section.setAttribute("aria-labelledby", "list-" + scopeId);
    var h2 = document.createElement("h2");
    h2.id = "list-" + scopeId;
    h2.textContent = title;
    section.appendChild(h2);

    var meta = document.createElement("p");
    meta.className = "list-collection-start";
    meta.textContent =
      "Server Data Collection Start Date: " + formatStartDate(startDate);
    section.appendChild(meta);

    GROUP_ORDER.forEach(function (group) {
      var items = ((catalog && catalog[group.id]) || []).filter(function (row) {
        return !isOpeningRow(row);
      });
      var wrap = document.createElement("div");
      wrap.className = "list-group";
      var h3 = document.createElement("h3");
      h3.textContent = group.title;
      wrap.appendChild(h3);
      var ul = document.createElement("ul");
      ul.className = "list-lines";
      if (!items.length) {
        var empty = document.createElement("li");
        empty.innerHTML = '<span class="lbl">—</span><span class="val">…</span>';
        ul.appendChild(empty);
      } else {
        items.forEach(function (row) {
          var li = document.createElement("li");
          li.innerHTML =
            '<span class="lbl"></span><span class="val"></span>';
          li.querySelector(".lbl").textContent = row.label || row.category;
          li.querySelector(".val").textContent = formatG(row.amount_g);
          ul.appendChild(li);
        });
      }
      wrap.appendChild(ul);
      section.appendChild(wrap);
    });
    return section;
  }

  function startForScope(data, scopeId) {
    var meta = data && data.scope_meta && data.scope_meta[scopeId];
    if (meta && meta.data_collection_start) return meta.data_collection_start;
    if (data && data.data_collection_start) return data.data_collection_start;
    return FALLBACK_COLLECTION_START;
  }

  async function load() {
    var root = el("list-root");
    var sub = el("list-subtitle");
    var err = el("list-error");
    try {
      var res = await fetch(API + "/api/rootmc/list", { cache: "no-store" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      var data = await res.json();
      if (err) err.hidden = true;
      if (sub) {
        sub.textContent = data.updated_at
          ? "Updated " + new Date(data.updated_at).toLocaleString()
          : "No snapshot yet — totals show 0 until the first host refresh.";
      }
      root.innerHTML = "";
      var scopes = data.scopes || {};
      SCOPE_ORDER.forEach(function (s) {
        root.appendChild(
          renderScope(s.id, s.title, scopes[s.id] || null, startForScope(data, s.id)),
        );
      });
    } catch (e) {
      if (err) {
        err.hidden = false;
        err.textContent = "Could not load list totals: " + (e && e.message ? e.message : e);
      }
      if (sub) sub.textContent = "Unavailable";
      root.innerHTML = "";
      SCOPE_ORDER.forEach(function (s) {
        root.appendChild(
          renderScope(s.id, s.title, null, FALLBACK_COLLECTION_START),
        );
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }
})();
