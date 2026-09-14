(function () {
  const TOKEN_KEY = "rootmc_token";

  function el(id) {
    return document.getElementById(id);
  }

  function authToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function queryParam(name) {
    return new URLSearchParams(window.location.search).get(name);
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

  function stripDiscordAuthQuery() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has("discord")) return;
    params.delete("discord");
    const q = params.toString();
    history.replaceState(null, "", window.location.pathname + (q ? "?" + q : ""));
  }

  async function startDiscordSignIn() {
    const returnTo = window.location.pathname + window.location.search;
    const res = await fetch("/api/governance/auth/discord/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ return_to: returnTo }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.authorize_url) {
      throw new Error(data.detail || "Could not start Discord sign-in.");
    }
    window.location.href = data.authorize_url;
  }

  function bindDiscordSignInButtons(root) {
    (root || document).querySelectorAll("[data-discord-signin]").forEach(function (btn) {
      if (btn.dataset.bound === "1") return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", function () {
        startDiscordSignIn().catch(function (e) {
          alert(String(e.message || e));
        });
      });
    });
  }

  function discordAuthNotice() {
    const code = queryParam("discord");
    if (!code) return "";
    const notes = {
      signed_in: "Signed in with Discord.",
      not_linked:
        "Discord account is not linked to a Minecraft player yet. Run /link in-game, complete verify with Discord once, then sign in again.",
      error: "Discord sign-in failed. Try again.",
      expired: "Discord sign-in expired. Try again.",
    };
    if (!notes[code]) return "";
    const kind = code === "signed_in" ? "info" : "err";
    stripDiscordAuthQuery();
    return (
      '<p class="verify-status verify-status-' +
      kind +
      '">' +
      notes[code] +
      (code === "not_linked"
        ? ' <a href="/verify/">Link in-game account</a>'
        : "") +
      "</p>"
    );
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = String(s ?? "");
    return d.innerHTML;
  }

  function fmtDate(iso) {
    if (!iso) return "—";
    return iso.replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
  }

  function fmtPct(n) {
    return (Number(n) || 0).toFixed(1) + "%";
  }

  function fmtHours(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? h + "h " + m + "m" : m + "m";
  }

  function fmtGold(n) {
    return (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 }) + " G";
  }

  async function govFetch(path, opts) {
    const headers = Object.assign({ "Content-Type": "application/json" }, (opts && opts.headers) || {});
    const token = authToken();
    if (token) headers.Authorization = "Bearer " + token;
    const res = await fetch("/api/governance/" + path.replace(/^\//, ""), {
      credentials: "include",
      ...(opts || {}),
      headers,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }

  async function loadMe() {
    return (await govFetch("me", { method: "GET" })).data;
  }

  async function acceptTerms() {
    return govFetch("terms/accept", { method: "POST", body: "{}" });
  }

  function renderStatusBanner(me, container) {
    if (!container) return;
    const notice = discordAuthNotice();
    if (!me || !me.signed_in) {
      container.innerHTML =
        notice +
        '<p class="rmc-muted">Sign in with Discord to vote (same account as in-game + #voting). New proposals: in-game <code>/proposal</code>.</p>' +
        '<p><button type="button" class="rmc-btn rmc-btn-primary" data-discord-signin>Sign in with Discord</button></p>';
      bindDiscordSignInButtons(container);
      return;
    }
    if (!me.linked) {
      container.innerHTML =
        notice +
        '<p class="verify-status verify-status-err">' +
        (me.message ||
          "Discord signed in but Minecraft is not linked. Run /link in-game, complete verify with Discord once, then sign in again.") +
        ' <a href="/verify/">Verify account</a></p>' +
        '<p><button type="button" class="rmc-btn rmc-btn-secondary" data-discord-signin>Retry Discord sign-in</button></p>';
      bindDiscordSignInButtons(container);
      return;
    }
    const parts = [
      `<strong>${esc(me.minecraft_username)}</strong> · governance power <strong>${fmtPct(me.share_percent)}</strong>`,
    ];
    if (!me.eligible) {
      parts.push(" · need Vote Shards in /ec to vote (anyone linked can /proposal)");
    }
    if (!me.terms_accepted) {
      parts.push(
        ' · <span class="gold">Terms not accepted</span> — <a href="/terms/">read & accept</a>',
      );
    }
    container.innerHTML = notice + `<p class="rmc-muted gov-me">${parts.join("")}</p>`;
  }

  function categoryLabel(c) {
    return (
      { constitution: "Constitution", governance: "Governance", plugin: "Plugin", metric: "Metric" }[
        String(c || "").toLowerCase()
      ] || c
    );
  }

  function voteButtonsHtml(poll, me) {
    if (!poll.open) return "";
    if (poll.is_creator) {
      return "<p class=\"rmc-muted\">You submitted this grant request and cannot vote on it.</p>";
    }
    if (!me || !me.linked || !me.eligible || !me.terms_accepted) {
      return (
        "<p class=\"rmc-muted\">" +
        (!me || !me.signed_in
          ? "<button type=\"button\" class=\"rmc-btn rmc-btn-primary\" data-discord-signin>Sign in with Discord</button> to vote here"
          : "Accept <a href=\"/terms/\">terms</a> and meet eligibility to vote here") +
        " — or use Discord #voting buttons.</p>"
      );
    }
    const cur = poll.my_vote ? " (your vote: " + poll.my_vote + ")" : "";
    return (
      "<div class=\"vote-bar\">" +
      "<button type=\"button\" class=\"rmc-btn rmc-btn-primary\" data-v=\"for\">For</button>" +
      "<button type=\"button\" class=\"rmc-btn rmc-btn-secondary\" data-v=\"against\">Against</button>" +
      "<button type=\"button\" class=\"rmc-btn rmc-btn-ghost\" data-v=\"abstain\">Abstain</button>" +
      "</div><p class=\"rmc-muted\">Weighted by your governance %." + cur + "</p>" +
      "<p class=\"vote-status verify-status\" role=\"status\" hidden></p>"
    );
  }

  function renderVotePanel(container, poll, me, pollId, opts) {
    if (!container || !poll) return;
    opts = opts || {};
    const isGrant = poll.kind === "grant";
    const isLegislation = poll.kind === "legislation";
    const grantHeader =
      isGrant && poll.grant_amount
        ? "<p class=\"rmc-muted\"><strong>" +
          esc(String(poll.grant_amount)) +
          " G</strong> → <strong>" +
          esc(poll.grant_recipient_username || "?") +
          "</strong> from treasury</p>"
        : "";
    const majorityNote =
      isGrant && poll.open
        ? poll.majority_direction && poll.majority_since
          ? "<p class=\"rmc-muted\">Weighted majority <strong>" +
            esc(poll.majority_direction) +
            "</strong> since " +
            fmtDate(poll.majority_since) +
            " — holds 24h to resolve</p>"
          : "<p class=\"rmc-muted\">Resolves when a weighted majority holds for 24 hours</p>"
        : poll.open
          ? "<p class=\"rmc-muted\">Closes " + fmtDate(poll.closes_at) + "</p>"
          : "";
    const heading = opts.heading
      ? "<h2 style=\"margin-top:0\">" + esc(opts.heading) + "</h2>"
      : "";
    const note = opts.note ? "<p class=\"rmc-muted\">" + opts.note + "</p>" : "";
    const badge = isGrant
      ? "Treasury grant vote"
      : isLegislation
        ? "Citizen proposal vote"
        : "Council vote";

    container.innerHTML =
      heading +
      note +
      "<p class=\"market-badge\">" +
      badge +
      " · " +
      (poll.open ? "open" : esc(poll.status)) +
      "</p>" +
      grantHeader +
      (poll.bill_summary ? "<p class=\"rmc-muted\">" + esc(poll.bill_summary) + "</p>" : "") +
      majorityNote +
      "<div class=\"vote-stats\">" +
      "<div class=\"vote-stat\"><div class=\"gold\">" + fmtPct(poll.weighted_for_pct) + "</div>For</div>" +
      "<div class=\"vote-stat\"><div>" + fmtPct(poll.weighted_against_pct) + "</div>Against</div>" +
      "<div class=\"vote-stat\"><div>" + fmtPct(poll.weighted_abstain_pct) + "</div>Abstain</div>" +
      "</div>" +
      "<p class=\"rmc-muted\">" + (poll.voter_count || 0) + " linked voters</p>" +
      voteButtonsHtml(poll, me);

    bindDiscordSignInButtons(container);
    container.querySelectorAll("[data-v]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        const st = container.querySelector(".vote-status");
        if (!st) return;
        st.hidden = false;
        st.textContent = "Recording vote…";
        const res = await govFetch("votes/" + encodeURIComponent(pollId), {
          method: "POST",
          body: JSON.stringify({ vote: btn.getAttribute("data-v") }),
        });
        if (res.ok && res.data.ok) {
          st.className = "vote-status verify-status verify-status-info";
          st.textContent = res.data.detail || "Vote recorded.";
          setTimeout(function () {
            location.reload();
          }, 800);
        } else {
          st.className = "vote-status verify-status verify-status-err";
          st.textContent = (res.data && res.data.detail) || "Vote failed.";
        }
      });
    });
  }

  window.RootMcGovernance = {
    el,
    authToken,
    queryParam,
    esc,
    fmtDate,
    fmtPct,
    fmtHours,
    fmtGold,
    govFetch,
    loadMe,
    acceptTerms,
    renderStatusBanner,
    categoryLabel,
    renderVotePanel,
    persistTokenFromHash,
    startDiscordSignIn,
    bindDiscordSignInButtons,
  };

  persistTokenFromHash();

  document.querySelector("[data-nav-toggle]")?.addEventListener("click", () => {
    document.querySelector(".rmc-nav")?.classList.toggle("is-open");
  });
})();
