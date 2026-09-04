(function () {
  const TOKEN_KEY = "rootrecord_portal_token";
  const DEVICE_KEY = "rootrecord_portal_device_id";
  const DISCORD_INVITE = "https://discord.gg/uQ7kGFqtbG";

  function el(id) {
    return document.getElementById(id);
  }

  function notifyPortalAuthChange() {
    try {
      window.dispatchEvent(new CustomEvent("rootrecord-portal-auth-change"));
    } catch {
      /* ignore */
    }
  }

  function showVerifyPanel(name) {
    ["panel-loading", "panel-verify-forms", "panel-verify-action", "panel-verify-success"].forEach((id) => {
      const n = el(id);
      if (n) n.hidden = id !== name;
    });
  }

  function setStatus(msg, kind) {
    const s = el("status");
    if (!s) return;
    s.textContent = msg || "";
    s.className = "status" + (kind ? " status-" + kind : "");
  }

  function discordQueryFromUrl() {
    const qs = new URLSearchParams(window.location.search);
    return { discord: qs.get("discord"), role: qs.get("role") };
  }

  function stripDiscordQueryFromUrl() {
    try {
      const u = new URL(window.location.href);
      let changed = false;
      if (u.searchParams.has("discord")) {
        u.searchParams.delete("discord");
        changed = true;
      }
      if (u.searchParams.has("role")) {
        u.searchParams.delete("role");
        changed = true;
      }
      if (!changed) return;
      const q = u.searchParams.toString();
      history.replaceState({}, "", u.pathname + (q ? "?" + q : "") + u.hash);
    } catch {
      /* ignore */
    }
  }

  function verifyOutcome(discordCode, roleCode, linked) {
    const c = String(discordCode || "").trim();
    const role = String(roleCode || "").trim();
    if (linked && !c) {
      return {
        title: "You are verified",
        detail:
          "Your RootRecord account is linked to Discord and you should have @Verified in the RootRecord server.",
        kind: "ok",
        showReturn: true,
      };
    }
    if (c === "merged") {
      if (role === "role_join") {
        return {
          title: "Accounts combined — join the server",
          detail:
            "This Discord was already linked to another RootRecord email. We added your sign-in email to that account (no extra wallet). Join the RootRecord Discord server below for @Verified.",
          kind: "warn",
          showReturn: true,
        };
      }
      return {
        title: "Accounts combined",
        detail:
          "This Discord was already linked to another RootRecord email. Your sign-in email was added to that account so either email works — we did not create a separate wallet.",
        kind: "ok",
        showReturn: true,
      };
    }
    if (c === "linked") {
      if (role === "role_join") {
        return {
          title: "Discord linked — join the server",
          detail:
            "Your account is linked, but @Verified was not assigned yet because you are not in the RootRecord Discord server. Join the server below, then tap Re-verify if needed.",
          kind: "warn",
          showReturn: true,
        };
      }
      if (role === "role_forbidden") {
        return {
          title: "Linked — role pending",
          detail:
            "Your account is linked, but the bot could not assign @Verified (permissions). Contact a server admin, then try Re-verify.",
          kind: "warn",
          showReturn: true,
        };
      }
      if (role === "role_error" || role === "role_config") {
        return {
          title: "Linked — role pending",
          detail:
            "Your account is linked. @Verified may take a moment or need an admin fix — you can return to Discord and try Re-verify later.",
          kind: "warn",
          showReturn: true,
        };
      }
      return {
        title: "Verification complete",
        detail:
          "Your RootRecord account is linked to Discord. @Verified should appear in the RootRecord server within a few seconds.",
        kind: "ok",
        showReturn: true,
      };
    }
    if (c === "signin") {
      return {
        title: "Sign in to verify",
        detail: "Sign in with your RootRecord account, then continue with Verify with Discord.",
        kind: "warn",
        showReturn: false,
      };
    }
    if (c === "expired") {
      return { title: "Link expired", detail: "That verification link expired. Sign in and verify again.", kind: "warn", showReturn: false };
    }
    if (c === "error") {
      return {
        title: "Verification did not finish",
        detail: "Something went wrong during Discord authorization. Sign in and try Verify with Discord again.",
        kind: "err",
        showReturn: false,
      };
    }
    return null;
  }

  function renderSuccessPanel(data, discordQ) {
    const linked = Boolean(data && data.discord_linked);
    const outcome =
      verifyOutcome(discordQ.discord, discordQ.role, linked) ||
      (linked
        ? verifyOutcome(null, null, true)
        : null);

    if (!outcome || !outcome.showReturn) return false;

    const titleEl = el("verify-success-title");
    const detailEl = el("verify-success-detail");
    const labelEl = el("verify-discord-label");
    if (titleEl) titleEl.textContent = outcome.title;
    if (detailEl) detailEl.textContent = outcome.detail;
    if (labelEl) {
      const label =
        (data && (data.discord_global_name || data.discord_username || data.discord_user_id)) || "";
      labelEl.textContent = label ? "Discord: " + String(label) : "";
      labelEl.hidden = !label;
    }

    setStatus("", "");
    showVerifyPanel("panel-verify-success");
    stripDiscordQueryFromUrl();
    return true;
  }

  function hexDeviceId() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function getOrCreateDeviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (id && id.length >= 8 && id.length <= 128) return id;
    id = hexDeviceId();
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  }

  let apiBase = "";
  const API_FALLBACK_BASES = [
    "https://rootrecord-api-account.rootrecord.workers.dev",
  ];

  async function loadConfig() {
    const res = await fetch("/api/site-config", { cache: "no-store" });
    if (!res.ok) throw new Error("config");
    const j = await res.json();
    apiBase = typeof j.apiBase === "string" ? j.apiBase.replace(/\/+$/, "") : "";
    if (!apiBase) {
      setStatus("Verification is not available on this site copy yet. Please try again later.", "warn");
    }
  }

  async function apiFetch(path, opts) {
    if (!apiBase) {
      return new Response(JSON.stringify({ detail: "Service unavailable." }), {
        status: 503,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    const bases = [apiBase].concat(API_FALLBACK_BASES.filter((base) => base !== apiBase));
    let lastResponse = null;
    let lastFetchError = null;
    for (let i = 0; i < bases.length; i += 1) {
      const base = bases[i].replace(/\/+$/, "");
      const headers = new Headers(opts?.headers);
      const token = localStorage.getItem(TOKEN_KEY);
      if (token && !headers.has("Authorization")) {
        headers.set("Authorization", "Bearer " + token);
      }
      if (!headers.has("Content-Type") && opts?.body) {
        headers.set("Content-Type", "application/json");
      }
      const sameOrigin = base === window.location.origin.replace(/\/+$/, "");
      let response;
      try {
        response = await fetch(base + path, {
          ...opts,
          headers,
          credentials: sameOrigin ? "include" : "omit",
          cache: "no-store",
        });
      } catch (e) {
        lastFetchError = e;
        if (i < bases.length - 1) continue;
        break;
      }
      lastResponse = response;
      const contentType = response.headers.get("content-type") || "";
      if (contentType.toLowerCase().includes("text/html")) {
        const text = await response.clone().text().catch(() => "");
        if (looksLikeHtml(text) && i < bases.length - 1) continue;
      }
      return response;
    }
    if (lastFetchError) {
      return new Response(JSON.stringify({ detail: "Could not reach the sign-in service. Please check the connection and try again." }), {
        status: 503,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    return lastResponse || new Response(JSON.stringify({ detail: "Service unavailable." }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  async function parseJsonRes(res) {
    const text = await res.text();
    let j = {};
    try {
      j = text ? JSON.parse(text) : {};
    } catch {
      j = {};
    }
    return { j, text };
  }

  function looksLikeHtml(s) {
    return /^\s*(?:<!doctype\s+html|<html|<!--\[if\s+lt\s+IE|<head|<body)\b/i.test(String(s || ""));
  }

  function friendlyFromApiError(j, text) {
    if (looksLikeHtml(text)) {
      return "The sign-in service returned a webpage instead of an API response. Please refresh and try again.";
    }
    if (!j || typeof j !== "object") return "";
    const detail = typeof j.detail === "string" ? j.detail.trim() : "";
    if (detail && detail.length < 400) return detail;
    const error = typeof j.error === "string" ? j.error.trim() : "";
    if (error && error.length < 400) return error;
    return "";
  }

  function genericApiError(text, fallback) {
    if (looksLikeHtml(text)) {
      return "The verification service returned a webpage instead of an API response. Please refresh and try again.";
    }
    const t = String(text || "").trim();
    if (t && t.length < 240 && !/[<>]/.test(t)) return t;
    return fallback;
  }

  async function startDiscordOAuth() {
    try {
      const res = await apiFetch("/v1/discord/oauth/start?json=1&flow=verify", { method: "GET" });
      const { j, text } = await parseJsonRes(res);
      if (res.status === 401) {
        setStatus("Please sign in first.", "warn");
        showVerifyPanel("panel-verify-forms");
        return;
      }
      if (!res.ok || !j || typeof j.url !== "string") {
        const detail =
          typeof j.detail === "string" && j.detail.trim()
            ? j.detail.trim()
            : genericApiError(text, "Could not start Discord verification. Please try again.");
        setStatus(detail, res.status === 503 ? "warn" : "err");
        return;
      }
      window.location.href = j.url;
    } catch {
      setStatus("Could not start Discord verification. Please try again.", "err");
    }
  }

  function bindActionPanel(data) {
    const st = el("discord-link-status");
    const linkBtn = el("btn-discord-link");
    const signedInAs = el("verify-signed-in-as");
    if (signedInAs && data && data.email) {
      signedInAs.textContent = "Signed in as " + String(data.email);
    }
    if (st && linkBtn) {
      const linked = Boolean(data && data.discord_linked);
      const label =
        (data && (data.discord_global_name || data.discord_username || data.discord_user_id)) || "";
      st.textContent = linked
        ? "Linked: " + String(label || "Discord account")
        : "Not linked yet — authorize Discord to receive @Verified.";
      linkBtn.textContent = linked ? "Re-verify with Discord" : "Verify with Discord";
      linkBtn.onclick = function () {
        void startDiscordOAuth();
      };
    }
    const returnBtn = el("btn-return-discord-action");
    if (returnBtn) {
      returnBtn.hidden = !data || !data.discord_linked;
    }
  }

  async function refreshVerify(autoStartOAuth) {
    if (!apiBase) {
      showVerifyPanel("panel-verify-forms");
      return;
    }
    const discordQ = discordQueryFromUrl();
    showVerifyPanel("panel-loading");
    setStatus("");

    const res = await apiFetch("/v1/me", {});
    const meParsed = await parseJsonRes(res);
    if (res.status === 401) {
      localStorage.removeItem(TOKEN_KEY);
      notifyPortalAuthChange();
      showVerifyPanel("panel-verify-forms");
      const outcome = verifyOutcome(discordQ.discord, discordQ.role, false);
      if (outcome) {
        setStatus(outcome.detail, outcome.kind);
      } else {
        setStatus("Sign in with your RootRecord account to verify with Discord.", "warn");
      }
      if (discordQ.discord) stripDiscordQueryFromUrl();
      return;
    }
    if (!res.ok) {
      showVerifyPanel("panel-verify-forms");
      setStatus(genericApiError(meParsed.text, "We could not check your verification status. Please try again."), "err");
      return;
    }

    if (!meParsed.j || typeof meParsed.j !== "object" || looksLikeHtml(meParsed.text)) {
      showVerifyPanel("panel-verify-forms");
      setStatus(genericApiError(meParsed.text, "We could not check your verification status. Please try again."), "err");
      return;
    }

    const data = meParsed.j;
    notifyPortalAuthChange();

    if (renderSuccessPanel(data, discordQ)) {
      return;
    }

    showVerifyPanel("panel-verify-action");
    bindActionPanel(data);

    const pending = verifyOutcome(discordQ.discord, discordQ.role, false);
    if (pending && pending.detail) {
      setStatus(pending.detail, pending.kind);
      stripDiscordQueryFromUrl();
    }

    if (autoStartOAuth && !data.discord_linked && !discordQ.discord) {
      await startDiscordOAuth();
    }
  }

  async function onLogin(ev) {
    ev.preventDefault();
    setStatus("");
    if (!apiBase) return;
    const email = el("login-email").value.trim().toLowerCase();
    const password = el("login-password").value;
    const device_id = getOrCreateDeviceId();
    try {
      const res = await apiFetch("/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password, device_id }),
      });
      const { j, text } = await parseJsonRes(res);
      if (!res.ok) {
        setStatus(friendlyFromApiError(j, text) || genericApiError(text, "Sign-in failed."), "err");
        return;
      }
      if (j.access_token) {
        localStorage.setItem(TOKEN_KEY, j.access_token);
        notifyPortalAuthChange();
      }
      await refreshVerify(true);
    } catch {
      setStatus("Could not reach the sign-in service. Please try again.", "err");
    }
  }

  async function onLogout() {
    if (apiBase) {
      try {
        await apiFetch("/v1/auth/logout-all", { method: "POST", body: "{}" });
      } catch {
        /* ignore */
      }
    }
    localStorage.removeItem(TOKEN_KEY);
    notifyPortalAuthChange();
    showVerifyPanel("panel-verify-forms");
    setStatus("Signed out. Sign in again to verify.", "ok");
  }

  window.addEventListener("DOMContentLoaded", async () => {
    showVerifyPanel("panel-loading");
    el("btn-return-discord")?.setAttribute("href", DISCORD_INVITE);
    el("btn-return-discord-action")?.setAttribute("href", DISCORD_INVITE);
    el("btn-discord-reverify")?.addEventListener("click", () => void startDiscordOAuth());
    el("form-login")?.addEventListener("submit", onLogin);
    el("btn-logout")?.addEventListener("click", onLogout);
    el("btn-logout-success")?.addEventListener("click", onLogout);

    try {
      await loadConfig();
    } catch {
      showVerifyPanel("panel-verify-forms");
      setStatus("Could not load verification. Please refresh.", "err");
      return;
    }
    await refreshVerify(false);
  });
})();
