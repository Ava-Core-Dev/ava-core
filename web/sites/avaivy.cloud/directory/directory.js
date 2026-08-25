(() => {
  const state = {
    path: "",
    recursive: false,
    entries: [],
    selected: null,
    rootAbs: "/home/ava-core",
    rootName: "ava-core",
    truncated: false,
  };

  const $ = (id) => document.getElementById(id);
  const fileBody = $("fileBody");
  const crumbs = $("crumbs");
  const viewBody = $("viewBody");
  const viewTitle = $("viewTitle");
  const viewMeta = $("viewMeta");
  const svcStatus = $("svcStatus");
  const filterEl = $("filter");
  const recursiveEl = $("recursive");

  function setStatus(on, label) {
    svcStatus.classList.toggle("on", on);
    svcStatus.classList.toggle("off", !on);
    const span = svcStatus.querySelector("span");
    if (span) span.textContent = label;
  }

  async function api(url) {
    const r = await fetch(url, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, data: j };
  }

  function fmtTime(iso) {
    if (!iso) return "—";
    try {
      return iso.replace("T", " ").replace(/\.\d+/, "").replace("+00:00", "Z");
    } catch {
      return iso;
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  /**
   * Parse the filesystem-relative path from the browser URL.
   * Supports:
   *   /home/ava-core/.ollama
   *   /home/ava-ivy/operations
   *   /.ollama
   *   /directory?path=.ollama
   *   /?path=.ollama
   *   /ava-ivy/tree/.ollama   (optional future prefix)
   */
  function pathFromLocation() {
    const params = new URLSearchParams(location.search);
    if (params.has("path")) return (params.get("path") || "").replace(/^\/+|\/+$/g, "");

    let p = decodeURIComponent(location.pathname || "/");
    // strip known UI prefixes
    p = p.replace(/^\/directory\/?/, "/");
    p = p.replace(/^\/ava-ivy\/tree\/?/, "/");
    // strip absolute home prefixes the UI shows in the address bar
    p = p.replace(/^\/home\/ava-core\/?/, "/");
    p = p.replace(/^\/home\/ava-ivy\/?/, "/");
    p = p.replace(/^\/+/, "").replace(/\/+$/, "");
    if (!p || p === "index.html") return "";
    return p;
  }

  /** Canonical browser path that mirrors the real filesystem location. */
  function browserPathFor(rel) {
    const root = state.rootAbs || "/home/ava-core";
    if (!rel) return root;
    return root.replace(/\/+$/, "") + "/" + rel.replace(/^\/+/, "");
  }

  /** Direct raw-file URL agents can fetch without JS. */
  function fileUrlFor(rel) {
    return "/ava-ivy/file/" + (rel || "").split("/").map(encodeURIComponent).join("/");
  }

  /** JSON API URL for the same file. */
  function apiFileUrlFor(rel) {
    return "/api/directory/file?path=" + encodeURIComponent(rel || "") + "&format=json";
  }

  function listApiUrl(rel, recursive) {
    const q = new URLSearchParams({
      path: rel || "",
      recursive: recursive ? "1" : "0",
    });
    return "/api/directory/list?" + q.toString();
  }

  function pushPath(rel, replace) {
    const url = browserPathFor(rel);
    try {
      if (replace) history.replaceState({ path: rel || "" }, "", url);
      else history.pushState({ path: rel || "" }, "", url);
    } catch {
      /* ignore */
    }
  }

  function renderCrumbs() {
    const parts = state.path ? state.path.split("/").filter(Boolean) : [];
    let html = `<a href="${escapeAttr(browserPathFor(""))}" data-path="">${escapeHtml(state.rootName || "root")}</a>`;
    let acc = "";
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      html += `<span class="sep">/</span><a href="${escapeAttr(browserPathFor(acc))}" data-path="${escapeAttr(acc)}">${escapeHtml(part)}</a>`;
    }
    crumbs.innerHTML = html;
    crumbs.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        navigate(a.getAttribute("data-path") || "", true);
      });
    });
  }

  function filteredEntries() {
    const q = (filterEl.value || "").trim().toLowerCase();
    if (!q) return state.entries;
    return state.entries.filter(
      (e) => e.name.toLowerCase().includes(q) || (e.rel || "").toLowerCase().includes(q)
    );
  }

  function renderTable() {
    const rows = filteredEntries();
    const countEl = $("entryCount");
    const hintEl = $("listHint");
    if (countEl) countEl.textContent = String(rows.length) + (state.truncated ? "+" : "");
    if (hintEl) hintEl.textContent = state.truncated ? "truncated at limit" : `${rows.length} shown`;

    if (!rows.length) {
      fileBody.innerHTML = `<tr><td colspan="5" class="muted">No entries</td></tr>`;
      return;
    }

    fileBody.innerHTML = rows
      .map((e) => {
        const isDir = e.type === "dir";
        const badges = [];
        if (e.sensitive) badges.push(`<span class="badge sens">sensitive</span>`);
        if (!e.readable && !isDir) badges.push(`<span class="badge block">no content</span>`);
        const href = isDir ? browserPathFor(e.rel) : fileUrlFor(e.rel);
        const nameHtml = isDir
          ? `<a href="${escapeAttr(href)}" data-open="${escapeAttr(e.rel)}">${escapeHtml(e.name)}</a>`
          : e.readable
            ? `<a href="${escapeAttr(href)}" data-view="${escapeAttr(e.rel)}">${escapeHtml(e.name)}</a>`
            : `<span>${escapeHtml(e.name)}</span>`;
        const action = isDir
          ? `<button type="button" class="btn-link" data-open="${escapeAttr(e.rel)}">Open</button>`
          : e.readable
            ? `<button type="button" class="btn-link" data-view="${escapeAttr(e.rel)}">View</button>`
            : `<span class="muted">—</span>`;
        const sel = state.selected === e.rel ? "selected" : "";
        return `<tr class="${sel}" data-rel="${escapeAttr(e.rel)}">
          <td class="name ${isDir ? "dir" : ""}">${nameHtml}${badges.join("")}</td>
          <td>${escapeHtml(e.type)}</td>
          <td>${e.size_h || "—"}</td>
          <td>${fmtTime(e.mtime)}</td>
          <td>${action}</td>
        </tr>`;
      })
      .join("");

    fileBody.querySelectorAll("[data-open]").forEach((el) => {
      el.addEventListener("click", (ev) => {
        ev.preventDefault();
        navigate(el.getAttribute("data-open") || "", true);
      });
    });
    fileBody.querySelectorAll("[data-view]").forEach((el) => {
      el.addEventListener("click", (ev) => {
        ev.preventDefault();
        viewFile(el.getAttribute("data-view") || "");
      });
    });
  }

  function showLoading() {
    fileBody.innerHTML = `<tr><td colspan="5" class="muted">Loading…</td></tr>`;
  }

  async function navigate(path, push) {
    state.path = path || "";
    state.selected = null;
    viewBody.textContent = "Select a file to preview.";
    viewBody.classList.remove("blocked");
    viewTitle.textContent = "PREVIEW";
    viewMeta.textContent = "";
    $("modeLabel").textContent = state.recursive ? "RECURSIVE" : "LIST";
    renderCrumbs();
    showLoading();

    if (push) pushPath(state.path, false);
    else pushPath(state.path, true);

    const { ok, status, data } = await api(listApiUrl(state.path, state.recursive));
    if (!ok || !data.ok) {
      fileBody.innerHTML = `<tr><td colspan="5" class="muted">${escapeHtml(
        (data && data.error) || "failed (" + status + ")"
      )}</td></tr>`;
      if (status === 503) setStatus(false, "DIRECTORY OFF");
      return;
    }
    state.entries = data.entries || [];
    state.truncated = !!data.truncated;
    if (data.root) {
      state.rootAbs = data.root;
      state.rootName = data.root.split("/").filter(Boolean).pop() || "root";
    }
    $("rootPath").textContent = data.root || "—";
    // keep address bar in sync with resolved root
    pushPath(state.path, true);
    renderCrumbs();
    renderTable();
  }

  async function viewFile(rel) {
    state.selected = rel;
    renderTable();
    viewTitle.textContent = rel.split("/").pop() || rel;
    viewMeta.textContent = "loading…";
    viewBody.textContent = "…";
    viewBody.classList.remove("blocked");

    const q = new URLSearchParams({ path: rel, format: "json" });
    const { data } = await api(`/api/directory/file?${q}`);
    const meta = data.meta || {};

    const locLine =
      `location: ${browserPathFor(rel)}\n` +
      `raw:      ${location.origin}${fileUrlFor(rel)}\n` +
      `api:      ${location.origin}${apiFileUrlFor(rel)}\n`;

    viewMeta.textContent = [
      meta.size_h || "",
      meta.content_type || "",
      meta.sensitive ? "sensitive" : "",
      meta.blocked ? "blocked" : "",
    ]
      .filter(Boolean)
      .join(" · ");

    if (data.content != null) {
      // Prefix preview with stable URLs so humans + agents share the same context
      viewBody.textContent = locLine + "\n" + data.content;
      viewBody.classList.toggle("blocked", !!(meta.blocked || data.status === 403));
    } else {
      viewBody.textContent = locLine + "\n" + (data.error || "Unable to load");
      viewBody.classList.add("blocked");
    }
  }

  async function checkStatus() {
    const { ok, data } = await api("/api/directory/status");
    if (!ok) {
      setStatus(false, "OFFLINE");
      return data;
    }
    if (data.enabled) {
      setStatus(true, "DIRECTORY ON");
      if (data.root) {
        state.rootAbs = data.root;
        state.rootName = data.root.split("/").filter(Boolean).pop() || "root";
        $("rootPath").textContent = data.root;
      }
    } else {
      setStatus(false, "DIRECTORY OFF");
    }
    return data;
  }

  $("btnRefresh").addEventListener("click", () => navigate(state.path, false));
  recursiveEl.addEventListener("change", () => {
    state.recursive = recursiveEl.checked;
    navigate(state.path, false);
  });
  filterEl.addEventListener("input", () => renderTable());

  window.addEventListener("popstate", (ev) => {
    const p = (ev.state && ev.state.path != null) ? ev.state.path : pathFromLocation();
    navigate(p || "", false);
  });

  // Boot: resolve path from URL (pathname or ?path=), never leave "Loading…" stuck
  checkStatus()
    .then(() => navigate(pathFromLocation(), false))
    .catch(() => {
      fileBody.innerHTML = `<tr><td colspan="5" class="muted">Failed to load directory</td></tr>`;
      setStatus(false, "OFFLINE");
    });
})();
