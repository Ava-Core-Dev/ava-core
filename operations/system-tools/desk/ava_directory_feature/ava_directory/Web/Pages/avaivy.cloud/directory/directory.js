(() => {
  const state = { path: "", recursive: false, entries: [], selected: null };

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
    svcStatus.querySelector("span").textContent = label;
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

  function renderCrumbs() {
    const parts = state.path ? state.path.split("/").filter(Boolean) : [];
    let html = `<a href="#" data-path="">${escapeHtml(state.rootName || "/")}</a>`;
    let acc = "";
    for (const p of parts) {
      acc = acc ? `${acc}/${p}` : p;
      html += `<span class="sep">/</span><a href="#" data-path="${escapeAttr(acc)}">${escapeHtml(p)}</a>`;
    }
    crumbs.innerHTML = html;
    crumbs.querySelectorAll("a").forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        navigate(a.getAttribute("data-path") || "");
      });
    });
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

  function filteredEntries() {
    const q = (filterEl.value || "").trim().toLowerCase();
    if (!q) return state.entries;
    return state.entries.filter((e) => e.name.toLowerCase().includes(q) || (e.rel || "").toLowerCase().includes(q));
  }

  function renderTable() {
    const rows = filteredEntries();
    $("entryCount").textContent = String(rows.length) + (state.truncated ? "+" : "");
    $("listHint").textContent = state.truncated ? "truncated at limit" : `${rows.length} shown`;
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
        const nameHtml = isDir
          ? `<a href="#" data-open="${escapeAttr(e.rel)}">${escapeHtml(e.name)}</a>`
          : `<a href="#" data-view="${escapeAttr(e.rel)}">${escapeHtml(e.name)}</a>`;
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
        navigate(el.getAttribute("data-open") || "");
      });
    });
    fileBody.querySelectorAll("[data-view]").forEach((el) => {
      el.addEventListener("click", (ev) => {
        ev.preventDefault();
        viewFile(el.getAttribute("data-view") || "");
      });
    });
  }

  async function navigate(path) {
    state.path = path || "";
    state.selected = null;
    viewBody.textContent = "Select a file to preview.";
    viewBody.classList.remove("blocked");
    viewTitle.textContent = "PREVIEW";
    viewMeta.textContent = "";
    $("modeLabel").textContent = state.recursive ? "RECURSIVE" : "LIST";
    renderCrumbs();

    const q = new URLSearchParams({ path: state.path, recursive: state.recursive ? "1" : "0" });
    const { ok, status, data } = await api(`/api/directory/list?${q}`);
    if (!ok || !data.ok) {
      fileBody.innerHTML = `<tr><td colspan="5" class="muted">${escapeHtml(data.error || "failed (" + status + ")")}</td></tr>`;
      if (status === 503) setStatus(false, "DIRECTORY OFF");
      return;
    }
    state.entries = data.entries || [];
    state.truncated = !!data.truncated;
    state.rootName = (data.root || "").split("/").filter(Boolean).pop() || "root";
    $("rootPath").textContent = data.root || "—";
    renderCrumbs();
    renderTable();
  }

  async function viewFile(rel) {
    state.selected = rel;
    renderTable();
    viewTitle.textContent = rel.split("/").pop() || rel;
    viewMeta.textContent = "loading…";
    viewBody.textContent = "…";
    const q = new URLSearchParams({ path: rel, format: "json" });
    const { data } = await api(`/api/directory/file?${q}`);
    const meta = data.meta || {};
    viewMeta.textContent = [
      meta.size_h || "",
      meta.content_type || "",
      meta.sensitive ? "sensitive" : "",
      meta.blocked ? "blocked" : "",
    ]
      .filter(Boolean)
      .join(" · ");
    if (data.content != null) {
      viewBody.textContent = data.content;
      viewBody.classList.toggle("blocked", !!(meta.blocked || data.status === 403));
    } else {
      viewBody.textContent = data.error || "Unable to load";
      viewBody.classList.add("blocked");
    }
  }

  async function checkStatus() {
    const { ok, data } = await api("/api/directory/status");
    if (!ok) {
      setStatus(false, "OFFLINE");
      return;
    }
    if (data.enabled) {
      setStatus(true, "DIRECTORY ON");
      $("rootPath").textContent = data.root || "—";
    } else {
      setStatus(false, "DIRECTORY OFF");
    }
  }

  $("btnRefresh").addEventListener("click", () => navigate(state.path));
  recursiveEl.addEventListener("change", () => {
    state.recursive = recursiveEl.checked;
    navigate(state.path);
  });
  filterEl.addEventListener("input", () => renderTable());

  // deep-link: /directory?path=foo/bar
  const params = new URLSearchParams(location.search);
  const initial = params.get("path") || "";
  checkStatus().then(() => navigate(initial));
})();
