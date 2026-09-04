(function () {
  const TOKEN_KEY = "rootrecord_portal_token";
  const LIFETIME_NAV_KEY = "rootrecord_portal_lifetime_nav";
  /** Set when /v1/me succeeds with HttpOnly cookie (no localStorage JWT). Cleared on auth-change. */
  const WEB_AUTH_HINT = "data-rootrecord-web-auth";

  function clearWebSessionHint() {
    document.documentElement.removeAttribute(WEB_AUTH_HINT);
  }

  function navSignedInFromStorage() {
    return !!localStorage.getItem(TOKEN_KEY) || document.documentElement.getAttribute(WEB_AUTH_HINT) === "1";
  }

  function syncNavSignedIn() {
    document.documentElement.classList.toggle("nav-signed-in", navSignedInFromStorage());
  }

  function syncLifetimeNav() {
    const signedIn = navSignedInFromStorage();
    const lifetime = signedIn && localStorage.getItem(LIFETIME_NAV_KEY) === "1";
    document.documentElement.classList.toggle("nav-lifetime", lifetime);
  }

  function storedTruthy(value) {
    const normalized = String(value ?? "").trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes";
  }

  function isLifetimeMember(data) {
    const d = data && typeof data === "object" ? data : {};
    const raw = d.raw && typeof d.raw === "object" ? d.raw : {};
    const access = d.access && typeof d.access === "object" ? d.access : {};
    const rawAccess = raw.access && typeof raw.access === "object" ? raw.access : {};
    const tier = String(d.tier || d.plan || access.tier || raw.tier || raw.plan || rawAccess.tier || "").trim().toLowerCase();
    return (
      storedTruthy(d.life_member) ||
      storedTruthy(d.lifeMember) ||
      storedTruthy(d.lifetime_member) ||
      storedTruthy(d.lifetimeMember) ||
      storedTruthy(d.lifetime) ||
      storedTruthy(access.life_member) ||
      storedTruthy(access.lifeMember) ||
      storedTruthy(raw.life_member) ||
      storedTruthy(raw.lifeMember) ||
      storedTruthy(rawAccess.life_member) ||
      storedTruthy(rawAccess.lifeMember) ||
      tier === "life" ||
      tier === "lifetime"
    );
  }

  async function probeWebSession() {
    if (localStorage.getItem(TOKEN_KEY)) return;
    try {
      const res = await fetch("/v1/me", { method: "GET", credentials: "include", cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      const email = data && typeof data === "object" ? String(data.email || "").trim() : "";
      if (!email) return;
      document.documentElement.setAttribute(WEB_AUTH_HINT, "1");
      if (isLifetimeMember(data)) {
        localStorage.setItem(LIFETIME_NAV_KEY, "1");
      } else {
        localStorage.removeItem(LIFETIME_NAV_KEY);
      }
    } catch {
      /* ignore */
    }
  }

  function closeAccountPanel() {
    const btn = document.querySelector(".nav-account-trigger");
    const panel = document.getElementById("nav-account-panel");
    if (btn) btn.setAttribute("aria-expanded", "false");
    if (panel) panel.hidden = true;
  }

  function openAccountPanel() {
    const btn = document.querySelector(".nav-account-trigger");
    const panel = document.getElementById("nav-account-panel");
    if (btn) btn.setAttribute("aria-expanded", "true");
    if (panel) panel.hidden = false;
  }

  function toggleAccountPanel() {
    const panel = document.getElementById("nav-account-panel");
    if (!panel) return;
    if (panel.hidden === false) closeAccountPanel();
    else openAccountPanel();
  }

  async function portalSignOut() {
    const headers = { "Content-Type": "application/json" };
    const token = localStorage.getItem(TOKEN_KEY);
    if (token) headers.Authorization = "Bearer " + token;
    try {
      await fetch("/v1/auth/logout-all", {
        method: "POST",
        credentials: "include",
        headers,
        body: "{}",
      });
    } catch {
      /* ignore */
    }
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem("rootrecord_portal_device_id");
    localStorage.removeItem(LIFETIME_NAV_KEY);
    clearWebSessionHint();
    window.dispatchEvent(new CustomEvent("rootrecord-portal-auth-change"));
    const page = document.body && document.body.getAttribute("data-account-page");
    window.location.href = page === "discord-verify" ? "/discord-verify" : "/account.html";
  }

  function ensureNavSignOut() {
    const panel = document.getElementById("nav-account-panel");
    if (!panel || panel.querySelector("[data-nav-signout]")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.role = "menuitem";
    btn.className = "nav-account-signout";
    btn.setAttribute("data-nav-signout", "1");
    btn.setAttribute("data-testid", "nav-sign-out");
    btn.textContent = "Sign out";
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      closeAccountPanel();
      void portalSignOut();
    });
    panel.appendChild(btn);
  }

  function ensureFooterTesterRewardsLink() {
    const footer = document.querySelector(".site-footer");
    if (!footer) return;

    // Avoid duplicates if any page already includes it.
    const existing = footer.querySelector('a[href="/root-units"], a[href="/root-units.html"], a[href="/beta-tester-rewards.html"], a[href="https://rootrecord.info/root-units"], a[href="https://rootrecord.info/beta-tester-rewards"], a[href="https://rootrecord.info/beta-tester-rewards.html"]');
    if (existing) return;

    const cols = Array.from(footer.querySelectorAll(".footer-col"));
    const companyCol = cols.find((c) => (c.querySelector("h4")?.textContent || "").trim() === "Company");
    const ul = companyCol?.querySelector("ul");
    if (!ul) return;

    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = "/root-units";
    a.textContent = "Roots";
    li.appendChild(a);
    ul.appendChild(li);
  }

  window.addEventListener("DOMContentLoaded", () => {
    syncNavSignedIn();
    syncLifetimeNav();
    ensureFooterTesterRewardsLink();
    ensureNavSignOut();
    void probeWebSession().then(() => {
      syncNavSignedIn();
      syncLifetimeNav();
    });

    window.addEventListener("storage", (e) => {
      if (e.key === TOKEN_KEY) {
        syncNavSignedIn();
        syncLifetimeNav();
      }
      if (e.key === LIFETIME_NAV_KEY) syncLifetimeNav();
    });
    window.addEventListener("rootrecord-portal-auth-change", () => {
      clearWebSessionHint();
      syncNavSignedIn();
      syncLifetimeNav();
      void probeWebSession().then(() => {
        syncNavSignedIn();
        syncLifetimeNav();
      });
    });
    window.addEventListener("rootrecord-portal-lifetime-nav-change", syncLifetimeNav);

    const trigger = document.querySelector(".nav-account-trigger");
    const panel = document.getElementById("nav-account-panel");
    if (!trigger || !panel) return;

    trigger.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      toggleAccountPanel();
    });
    panel.querySelectorAll('a[role="menuitem"]').forEach((a) => {
      a.addEventListener("click", () => closeAccountPanel());
    });
    document.addEventListener("click", (ev) => {
      if (!trigger.contains(ev.target) && !panel.contains(ev.target)) closeAccountPanel();
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") closeAccountPanel();
    });
  });
})();
