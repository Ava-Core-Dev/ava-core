(function () {
  const TOKEN_KEY = "rootrecord_portal_token";
  const DEVICE_KEY = "rootrecord_portal_device_id";

  function el(id) {
    return document.getElementById(id);
  }

  function setStatus(msg, kind) {
    const s = el("status");
    if (!s) return;
    s.textContent = msg || "";
    s.className = "status" + (kind ? " status-" + kind : "");
  }

  async function loadConfig() {
    const res = await fetch("/api/site-config", { cache: "no-store" });
    if (!res.ok) throw new Error("config");
    return await res.json();
  }

  function apiBaseFromConfig(cfg) {
    const raw = typeof cfg?.apiBase === "string" ? cfg.apiBase.trim() : "";
    return raw ? raw.replace(/\/+$/, "") : "";
  }

  function getToken() {
    const t = localStorage.getItem(TOKEN_KEY);
    return t && t.length > 10 ? t : "";
  }

  function getOrCreateDeviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (id && id.length >= 8 && id.length <= 128) return id;
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    id = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  }

  async function apiFetch(base, path, opts) {
    const headers = new Headers(opts?.headers);
    headers.set("X-Guest-Id", getOrCreateDeviceId());
    const t = getToken();
    if (t && !headers.has("Authorization")) headers.set("Authorization", "Bearer " + t);
    return fetch(base + path, { ...opts, headers, credentials: "include" });
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function cardHtml(row) {
    const id = row.id;
    const caption = row.caption || "";
    const created = row.created_at || "";
    const url = "/api/photos/file/" + encodeURIComponent(id);
    return (
      '<div class="card" style="padding:1rem">' +
      '<div style="aspect-ratio: 1 / 1; background: rgba(255,255,255,0.03); border:1px solid var(--line); display:flex; align-items:center; justify-content:center; overflow:hidden; border-radius:12px">' +
      '<img src="' +
      url +
      '" alt="" style="width:100%; height:100%; object-fit:cover" loading="lazy" />' +
      "</div>" +
      '<div style="margin-top:0.75rem; font-size:0.85rem; color:var(--ink-soft)">' +
      "<div><strong>ID</strong> <code>" +
      escapeHtml(id) +
      "</code></div>" +
      (caption ? "<div style=\"margin-top:0.25rem\"><strong>Caption</strong> " + escapeHtml(caption) + "</div>" : "") +
      (created ? "<div style=\"margin-top:0.25rem\"><strong>Created</strong> " + escapeHtml(created) + "</div>" : "") +
      "</div>" +
      '<div style="display:flex; gap:0.5rem; margin-top:0.75rem">' +
      '<button class="btn btn-small" type="button" data-action="approve" data-id="' +
      escapeHtml(id) +
      '">Approve</button>' +
      '<button class="btn btn-small" type="button" data-action="reject" data-id="' +
      escapeHtml(id) +
      '">Reject</button>' +
      "</div>" +
      "</div>"
    );
  }

  async function ensureAdminEmail(base) {
    const me = await apiFetch(base, "/v1/me", { method: "GET" });
    if (!me.ok) return { ok: false, detail: "Sign in required." };
    const j = await me.json().catch(() => ({}));
    const email = String(j?.email || "").trim().toLowerCase();
    if (email !== "rootrecord@outlook.com") return { ok: false, detail: "Unauthorized for photo approvals." };
    return { ok: true, email };
  }

  async function loadPending(base) {
    const res = await apiFetch(base, "/api/photos/admin/pending", {
      cache: "no-store",
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j?.detail || "Failed to load pending.");
    return j.items || [];
  }

  async function approve(base, id) {
    const res = await apiFetch(base, "/api/photos/admin/approve/" + encodeURIComponent(id), {
      method: "POST",
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j?.detail || "Approve failed.");
  }

  async function reject(base, id) {
    const reason = prompt("Reject reason (optional):", "");
    const res = await apiFetch(base, "/api/photos/admin/reject/" + encodeURIComponent(id), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason || "" }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j?.detail || "Reject failed.");
  }

  async function refresh(base) {
    setStatus("Loading pending submissions…");
    const wrap = el("pending");
    if (wrap) wrap.innerHTML = "";
    const items = await loadPending(base);
    if (!items.length) {
      setStatus("No pending submissions.", "ok");
      return;
    }
    setStatus(items.length + " pending submission(s).", "ok");
    if (wrap) wrap.innerHTML = items.map(cardHtml).join("");
  }

  window.addEventListener("DOMContentLoaded", async () => {
    try {
      const cfg = await loadConfig();
      const base = apiBaseFromConfig(cfg);
      if (!base) {
        setStatus("API base is unavailable on this site copy.", "warn");
        return;
      }
      const admin = await ensureAdminEmail(base);
      if (!admin.ok) {
        setStatus(admin.detail || "Unauthorized.", "warn");
        return;
      }

      el("btn-refresh")?.addEventListener("click", () => refresh(base).catch((e) => setStatus(String(e.message || e), "warn")));

      document.addEventListener("click", (ev) => {
        const t = ev.target;
        if (!t || !t.getAttribute) return;
        const action = t.getAttribute("data-action");
        const id = t.getAttribute("data-id");
        if (!action || !id) return;
        ev.preventDefault();
        if (action === "approve") {
          approve(base, id)
            .then(() => refresh(base))
            .catch((e) => setStatus(String(e.message || e), "warn"));
        }
        if (action === "reject") {
          reject(base, id)
            .then(() => refresh(base))
            .catch((e) => setStatus(String(e.message || e), "warn"));
        }
      });

      await refresh(base);
    } catch (e) {
      setStatus(String(e?.message || e), "warn");
    }
  });
})();

