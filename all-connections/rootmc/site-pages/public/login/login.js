(function () {
  function el(id) {
    return document.getElementById(id);
  }

  function setStatus(msg, kind) {
    var s = el("login-status");
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

  async function fetchMe() {
    var headers = {};
    var token = localStorage.getItem("rootmc_token") || "";
    if (token) headers.Authorization = "Bearer " + token;
    var res = await fetch("/api/account/me", { credentials: "include", headers: headers, cache: "no-store" });
    if (!res.ok) return null;
    return res.json();
  }

  async function startDiscord() {
    setStatus("Redirecting to Discord…", "info");
    var res = await fetch("/api/account/auth/discord/start", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ return_to: "/my-stats/" }),
    });
    var data = await res.json().catch(function () {
      return {};
    });
    if (!res.ok) {
      setStatus(data.detail || "Could not start Discord login.", "err");
      return;
    }
    if (!data.authorize_url) {
      setStatus("Discord authorize URL missing.", "err");
      return;
    }
    window.location.href = data.authorize_url;
  }

  async function init() {
    persistTokenFromHash();
    var discord = new URLSearchParams(window.location.search).get("discord");
    if (discord === "error" || discord === "expired") {
      setStatus("Discord sign-in failed. Try again.", "err");
    }
    try {
      var me = await fetchMe();
      if (me && me.signed_in) {
        window.location.replace("/my-stats/");
        return;
      }
    } catch (_) {}
    var btn = el("btn-discord-login");
    if (btn) btn.addEventListener("click", startDiscord);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
