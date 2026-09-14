(function () {
  const TOKEN_KEY = "rootmc_token";

  function el(id) {
    return document.getElementById(id);
  }

  function showPanel(name) {
    ["panel-loading", "panel-verify", "panel-success", "panel-advanced"].forEach((id) => {
      const n = el(id);
      if (n) n.hidden = id !== name;
    });
  }

  function setStatus(msg, kind) {
    const s = el("status");
    if (!s) return;
    s.textContent = msg || "";
    s.className = "verify-status" + (kind ? " verify-status-" + kind : "");
    s.hidden = !msg;
  }

  function codeFromUrl() {
    return (new URLSearchParams(window.location.search).get("code") || "").trim().toUpperCase();
  }

  function queryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  function hexDeviceId() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  function getOrCreateDeviceId() {
    let id = localStorage.getItem("rootmc_device_id");
    if (id && id.length >= 8 && id.length <= 128) return id;
    id = hexDeviceId();
    localStorage.setItem("rootmc_device_id", id);
    return id;
  }

  function authToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  async function fetchMembership() {
    const token = authToken();
    if (!token) return null;
    const res = await fetch("/api/rootmc/server/membership", {
      credentials: "include",
      headers: { Authorization: "Bearer " + token },
    });
    if (!res.ok) return null;
    return res.json();
  }

  async function realmFetch(path, opts) {
    const headers = Object.assign({ "Content-Type": "application/json" }, (opts && opts.headers) || {});
    const token = authToken();
    if (token) headers.Authorization = "Bearer " + token;
    return fetch("/api/realm/minecraft" + path, {
      credentials: "include",
      ...(opts || {}),
      headers,
    });
  }

  async function previewCode(code) {
    if (!code) return null;
    const res = await realmFetch("/link/preview?code=" + encodeURIComponent(code), { method: "GET" });
    if (!res.ok) return null;
    return res.json();
  }

  async function completeLink(code) {
    const res = await realmFetch("/link/complete", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Link failed.");
    if (data.token) localStorage.setItem(TOKEN_KEY, data.token);
    return data;
  }

  async function startDiscordLink(code) {
    const res = await realmFetch("/link/discord/start", {
      method: "POST",
      body: JSON.stringify({ code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Could not start Discord linking.");
    if (!data.authorize_url) throw new Error("Discord authorize URL missing.");
    window.location.href = data.authorize_url;
  }

  async function login(email, password) {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        email,
        password,
        device_id: getOrCreateDeviceId(),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || "Sign in failed.");
    if (data.token) localStorage.setItem(TOKEN_KEY, data.token);
    return data;
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

  function showSuccess(player, discordLinked, alreadyLinked) {
    const detail = el("success-detail");
    if (detail) {
      if (alreadyLinked) {
        detail.textContent =
          "Already linked as " + player + ". You're set — head back to the server.";
      } else {
        detail.textContent = discordLinked
          ? "Linked " + player + " to Discord and RootMC. Your server nickname was set to your in-game name. You can now chat in the RootMC Discord. 100 G from the server treasury is queued — join the server to receive it."
          : "Linked " + player + " to RootMC. Return to the server — sync runs within a minute. Link with Discord on this page to unlock Discord chat.";
      }
    }
    showPanel("panel-success");
    setStatus("", "");
  }

  async function refreshVerifyUi(code) {
    const previewEl = el("code-preview");
    const btnDiscord = el("btn-discord");
    const btnComplete = el("btn-complete");
    if (!code) {
      if (previewEl) previewEl.textContent = "Enter the 6-character code from /link in-game.";
      if (btnDiscord) btnDiscord.disabled = true;
      if (btnComplete) btnComplete.disabled = true;
      return;
    }
    const preview = await previewCode(code);
    if (!previewEl) return;
    if (preview && preview.valid) {
      previewEl.textContent = "Linking player: " + preview.minecraft_username;
      if (btnDiscord) btnDiscord.disabled = false;
      if (btnComplete) btnComplete.disabled = false;
    } else if (preview && preview.reason === "expired") {
      previewEl.textContent = "That code expired. Run /link in-game again.";
      if (btnDiscord) btnDiscord.disabled = true;
      if (btnComplete) btnComplete.disabled = true;
    } else if (preview && preview.reason === "consumed") {
      previewEl.textContent = "That code was already used.";
      if (btnDiscord) btnDiscord.disabled = true;
      if (btnComplete) btnComplete.disabled = true;
    } else {
      previewEl.textContent = "Code not found. Check the code from /link.";
      if (btnDiscord) btnDiscord.disabled = true;
      if (btnComplete) btnComplete.disabled = true;
    }
  }

  function handleDiscordReturn() {
    const discord = queryParam("discord");
    if (!discord) return false;
    const player = queryParam("player") || "your player";
    if (discord === "linked") {
      if (!persistTokenFromHash()) {
        setStatus("Linked — sign in with Discord on governance pages to vote.", "info");
      }
      showSuccess(player, true, false);
      return true;
    }
    const messages = {
      error: "Discord authorization failed. Try again.",
      expired: "Discord link session expired. Enter your code and try again.",
      code_invalid: "That link code is no longer valid.",
      already_linked: "That Discord account is already linked to another account.",
      invalid_client: "Discord app secret is invalid. Staff must update the RootMC Discord client secret.",
      invalid_grant: "Discord rejected this auth code. Please run /link again and retry.",
      token_exchange_failed: "Discord token exchange failed. Please retry in a moment.",
    };
    setStatus(messages[discord] || "Discord linking did not complete.", "err");
    showPanel("panel-verify");
    return true;
  }

  async function init() {
    showPanel("panel-loading");

    persistTokenFromHash();

    if (handleDiscordReturn()) return;

    const code = codeFromUrl();
    const membership = await fetchMembership();
    if (membership && membership.minecraft_linked && !code) {
      showSuccess(membership.minecraft_username || "your player", true, true);
      return;
    }

    const input = el("input-code");
    if (input && code) input.value = code;

    showPanel("panel-verify");
    if (membership && membership.minecraft_linked) {
      setStatus(
        "Already linked as " + (membership.minecraft_username || "your player") + ". Enter a new code only to link a different player.",
        "info",
      );
    }
    await refreshVerifyUi(code || (input && input.value.trim().toUpperCase()));

    el("form-verify")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const linkCode = String(fd.get("code") || "")
        .trim()
        .toUpperCase();
      if (!linkCode) return;
      setStatus("Linking…", "info");
      try {
        const result = await completeLink(linkCode);
        showSuccess(result.minecraft_username || "player", false, false);
      } catch (e) {
        setStatus(String(e.message || e), "err");
      }
    });

    el("btn-discord")?.addEventListener("click", async () => {
      const linkCode = String(el("input-code")?.value || "")
        .trim()
        .toUpperCase();
      if (!linkCode) return;
      setStatus("Opening Discord…", "info");
      try {
        await startDiscordLink(linkCode);
      } catch (e) {
        setStatus(String(e.message || e), "err");
      }
    });

    el("input-code")?.addEventListener("input", () => {
      void refreshVerifyUi(el("input-code").value.trim().toUpperCase());
    });
  }

  el("form-login")?.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    setStatus("Signing in…", "info");
    try {
      await login(String(fd.get("email") || ""), String(fd.get("password") || ""));
      const code = codeFromUrl() || String(el("input-code")?.value || "").trim().toUpperCase();
      window.location.href = code ? "/verify/?code=" + encodeURIComponent(code) : "/verify/";
    } catch (e) {
      setStatus(String(e.message || e), "err");
    }
  });

  el("btn-show-advanced")?.addEventListener("click", () => {
    showPanel("panel-advanced");
    setStatus("", "");
  });

  el("btn-back-verify")?.addEventListener("click", () => {
    showPanel("panel-verify");
    setStatus("", "");
  });

  el("btn-logout")?.addEventListener("click", () => {
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = "/verify/";
  });

  void init();
})();
