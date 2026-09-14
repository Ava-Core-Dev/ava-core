/**
 * Council shard leaderboard + vote-power charts.
 * Data: GET /api/governance/council
 */
(function () {
  var PALETTE = [
    "#f5b942",
    "#5dd39e",
    "#c97b4f",
    "#7eb8da",
    "#c084fc",
    "#ef5b5b",
    "#7fb069",
    "#ffd16a",
    "#6ea8d8",
    "#e0625a",
  ];

  function el(id) {
    return document.getElementById(id);
  }

  function num(v) {
    var n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtInt(n) {
    return Math.round(num(n)).toLocaleString("en-US");
  }

  function fmtNum(n, digits) {
    var x = num(n);
    var d = digits == null ? (Math.abs(x) >= 100 ? 0 : Math.abs(x) >= 10 ? 1 : 2) : digits;
    return x.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: 0 });
  }

  function fmtPct(n) {
    var x = num(n);
    if (!x) return "0%";
    if (x >= 10) return x.toFixed(2).replace(/\.?0+$/, "") + "%";
    if (x >= 1) return x.toFixed(2) + "%";
    return x.toFixed(2) + "%";
  }

  function fmtHours(seconds) {
    var s = Math.max(0, Math.floor(num(seconds)));
    if (!s) return "—";
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    if (h >= 48) return Math.round(h / 24) + "d";
    if (h) return h + "h " + m + "m";
    return m + "m";
  }

  function isAva(row) {
    return String(row.minecraft_username || "").toLowerCase() === "ava_ivy";
  }

  function siteBonus(row) {
    if (row.site_bonus != null) return num(row.site_bonus);
    return num(row.total_votes) * Math.max(0, num(row.site_multiplier || 1) - 1);
  }

  function shardScore(row) {
    if (row.shard_score != null) return num(row.shard_score);
    if (row.vote_points != null) return num(row.vote_points);
    return num(row.ec_vote_shard_count) + num(row.paid_vote_shards) + siteBonus(row);
  }

  function rawWeight(row) {
    if (row.raw_weight != null) return num(row.raw_weight);
    return num(row.effective_vote_points) + num(row.ava_reaction_bonus);
  }

  function enrich(row) {
    var r = Object.assign({}, row);
    r.ec = num(r.ec_vote_shard_count);
    r.paid = num(r.paid_vote_shards);
    r.votes = num(r.total_votes);
    r.siteMult = num(r.site_multiplier) || 1;
    r.bonus = siteBonus(r);
    r.score = shardScore(r);
    r.mult = num(r.pro_multiplier) || 1;
    r.effective = num(r.effective_vote_points);
    r.raw = rawWeight(r);
    r.share = num(r.share_percent);
    r.play = num(r.playtime_seconds);
    r.sites = num(r.sites_voted_count);
    r.rx = num(r.ava_reaction_bonus);
    r.ava = isAva(r);
    r.name = String(r.minecraft_username || "?").trim() || "?";
    return r;
  }

  function colorAt(i) {
    return PALETTE[i % PALETTE.length];
  }

  function pie(svg, slices) {
    var total = slices.reduce(function (s, x) {
      return s + Math.max(0, num(x.value));
    }, 0);
    svg.innerHTML = "";
    var ns = "http://www.w3.org/2000/svg";
    svg.setAttribute("viewBox", "0 0 120 120");
    svg.setAttribute("role", "img");
    var cx = 60;
    var cy = 60;
    var r = 46;
    if (total <= 0) {
      var empty = document.createElementNS(ns, "circle");
      empty.setAttribute("cx", String(cx));
      empty.setAttribute("cy", String(cy));
      empty.setAttribute("r", String(r));
      empty.setAttribute("fill", "rgba(255,255,255,.06)");
      svg.appendChild(empty);
      return;
    }
    var angle = -Math.PI / 2;
    slices.forEach(function (slice) {
      var v = Math.max(0, num(slice.value));
      if (!v) return;
      var sweep = (v / total) * Math.PI * 2;
      var a2 = angle + sweep;
      var x1 = cx + r * Math.cos(angle);
      var y1 = cy + r * Math.sin(angle);
      var x2 = cx + r * Math.cos(a2);
      var y2 = cy + r * Math.sin(a2);
      var large = sweep > Math.PI ? 1 : 0;
      var path = document.createElementNS(ns, "path");
      if (slices.filter(function (s) { return num(s.value) > 0; }).length === 1) {
        var c = document.createElementNS(ns, "circle");
        c.setAttribute("cx", String(cx));
        c.setAttribute("cy", String(cy));
        c.setAttribute("r", String(r));
        c.setAttribute("fill", slice.color);
        c.setAttribute("title", slice.label + " " + fmtPct((v / total) * 100));
        svg.appendChild(c);
      } else {
        path.setAttribute(
          "d",
          "M " + cx + " " + cy + " L " + x1 + " " + y1 + " A " + r + " " + r + " 0 " + large + " 1 " + x2 + " " + y2 + " Z",
        );
        path.setAttribute("fill", slice.color);
        path.setAttribute("title", slice.label + " · " + fmtInt(v) + " · " + fmtPct((v / total) * 100));
        svg.appendChild(path);
      }
      angle = a2;
    });
    var hole = document.createElementNS(ns, "circle");
    hole.setAttribute("cx", String(cx));
    hole.setAttribute("cy", String(cy));
    hole.setAttribute("r", "22");
    hole.setAttribute("fill", "#0a0f10");
    svg.appendChild(hole);
  }

  function legend(node, slices, total) {
    node.innerHTML = slices
      .filter(function (s) {
        return num(s.value) > 0;
      })
      .map(function (s) {
        var pct = total > 0 ? (num(s.value) / total) * 100 : 0;
        return (
          '<li><span class="swatch" style="background:' +
          esc(s.color) +
          '"></span><span>' +
          esc(s.label) +
          '</span><strong>' +
          esc(s.display || fmtInt(s.value)) +
          '</strong><em>' +
          fmtPct(pct) +
          "</em></li>"
        );
      })
      .join("");
  }

  function hBars(node, rows, opts) {
    opts = opts || {};
    var max = rows.reduce(function (m, r) {
      return Math.max(m, num(r.value));
    }, 0);
    if (max <= 0) max = 1;
    node.innerHTML = rows
      .map(function (r) {
        var pct = Math.max(0.6, (num(r.value) / max) * 100);
        return (
          '<div class="h-bar-row">' +
          '<div class="h-bar-label">' +
          esc(r.label) +
          "</div>" +
          '<div class="h-bar-track"><span style="width:' +
          pct +
          "%;background:" +
          esc(r.color || "#f5b942") +
          '"></span></div>' +
          '<div class="h-bar-val">' +
          esc(r.display || fmtNum(r.value)) +
          "</div></div>"
        );
      })
      .join("");
  }

  function stackedBars(node, rows) {
    var max = rows.reduce(function (m, r) {
      return Math.max(m, num(r.ec) + num(r.paid) + num(r.bonus));
    }, 0);
    if (max <= 0) max = 1;
    node.innerHTML = rows
      .map(function (r) {
        var tot = num(r.ec) + num(r.paid) + num(r.bonus);
        function w(v) {
          return tot <= 0 ? 0 : (num(v) / max) * 100;
        }
        return (
          '<div class="h-bar-row">' +
          '<div class="h-bar-label">' +
          esc(r.label) +
          "</div>" +
          '<div class="h-bar-track stack">' +
          (r.ec ? '<span class="seg-ec" style="width:' + w(r.ec) + '%" title="EC ' + fmtInt(r.ec) + '"></span>' : "") +
          (r.paid ? '<span class="seg-paid" style="width:' + w(r.paid) + '%" title="Paid ' + fmtInt(r.paid) + '"></span>' : "") +
          (r.bonus ? '<span class="seg-bonus" style="width:' + w(r.bonus) + '%" title="Site bonus ' + fmtInt(r.bonus) + '"></span>' : "") +
          "</div>" +
          '<div class="h-bar-val">' +
          fmtInt(tot) +
          "</div></div>"
        );
      })
      .join("");
  }

  function badgeHtml(row) {
    var bits = [];
    if (row.ava) bits.push('<span class="tier-badge ava">Locked seat</span>');
    if (row.is_lifetime) bits.push('<span class="tier-badge life">Lifetime ×' + esc(String(row.mult)) + "</span>");
    else if (row.is_pro) bits.push('<span class="tier-badge pro">Pro ×' + esc(String(row.mult)) + "</span>");
    else if (!row.ava) bits.push('<span class="tier-badge none">×' + esc(String(row.mult)) + "</span>");
    return bits.join(" ");
  }

  var sortState = { key: "share", dir: -1 };

  function sortRows(rows, key, dir) {
    var copy = rows.slice();
    copy.sort(function (a, b) {
      var va;
      var vb;
      if (key === "name") {
        va = a.name.toLowerCase();
        vb = b.name.toLowerCase();
        if (va < vb) return -1 * dir;
        if (va > vb) return 1 * dir;
        return 0;
      }
      va = num(a[key]);
      vb = num(b[key]);
      if (vb === va) return a.name.localeCompare(b.name);
      return (va - vb) * dir;
    });
    return copy;
  }

  function renderTable(tbody, rows) {
    if (!rows.length) {
      tbody.innerHTML =
        '<tr><td colspan="12" class="rmc-muted">No eligible voters yet (need linked account + Vote Shard score &gt; 0).</td></tr>';
      return;
    }
    tbody.innerHTML = rows
      .map(function (row, i) {
        return (
          "<tr>" +
          "<td>" +
          (i + 1) +
          "</td>" +
          '<td><strong><a href="/player/?player=' +
          encodeURIComponent(row.name) +
          '">' +
          esc(row.name) +
          "</a></strong> " +
          badgeHtml(row) +
          "</td>" +
          '<td class="gold">' +
          fmtPct(row.share) +
          "</td>" +
          '<td><div class="share-bar" title="' +
          fmtPct(row.share) +
          '"><span style="width:' +
          Math.min(100, row.share) +
          '%"></span></div></td>' +
          "<td>" +
          fmtInt(row.ec) +
          "</td>" +
          "<td>" +
          fmtInt(row.paid) +
          "</td>" +
          "<td>" +
          fmtInt(row.votes) +
          "</td>" +
          "<td>" +
          fmtInt(row.bonus) +
          "</td>" +
          "<td>" +
          fmtInt(row.score) +
          "</td>" +
          "<td>×" +
          esc(String(row.mult)) +
          "</td>" +
          "<td>" +
          fmtNum(row.raw) +
          "</td>" +
          "<td>" +
          fmtHours(row.play) +
          "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function groupSmall(slices, minPct) {
    var total = slices.reduce(function (s, x) {
      return s + num(x.value);
    }, 0);
    if (total <= 0) return slices;
    var keep = [];
    var other = 0;
    slices.forEach(function (s) {
      var pct = (num(s.value) / total) * 100;
      if (pct < minPct && !s.keep) other += num(s.value);
      else keep.push(s);
    });
    if (other > 0) keep.push({ label: "Others", value: other, color: "#6c7a74" });
    return keep;
  }

  function renderCharts(rows, totals) {
    var players = rows.filter(function (r) {
      return !r.ava;
    });

    var shareSlices = groupSmall(
      rows.map(function (r, i) {
        return {
          label: r.name,
          value: r.share,
          color: r.ava ? "#7eb8da" : colorAt(i),
          display: fmtPct(r.share),
          keep: r.ava || r.share >= 1,
        };
      }),
      1,
    );
    pie(el("chart-share-pie"), shareSlices);
    legend(
      el("legend-share-pie"),
      shareSlices,
      shareSlices.reduce(function (s, x) {
        return s + num(x.value);
      }, 0),
    );

    var mixSlices = [
      { label: "EC shards", value: totals.ec, color: "#f5b942" },
      { label: "Paid shards", value: totals.paid, color: "#5dd39e" },
      { label: "Lifetime site bonus", value: totals.bonus, color: "#c97b4f" },
    ];
    pie(el("chart-mix-pie"), mixSlices);
    legend(el("legend-mix-pie"), mixSlices, totals.ec + totals.paid + totals.bonus);

    var seatSlices = [
      { label: "Player shares", value: Math.max(0, 100 - (rows.find(function (r) { return r.ava; }) || { share: 0 }).share), color: "#f5b942", display: fmtPct(100 - (rows.find(function (r) { return r.ava; }) || { share: 0 }).share) },
      { label: "Ava locked seat", value: (rows.find(function (r) { return r.ava; }) || { share: 0 }).share, color: "#7eb8da", display: fmtPct((rows.find(function (r) { return r.ava; }) || { share: 0 }).share) },
    ];
    pie(el("chart-seat-pie"), seatSlices);
    legend(
      el("legend-seat-pie"),
      seatSlices,
      seatSlices.reduce(function (s, x) {
        return s + num(x.value);
      }, 0),
    );

    var memberSlices = [
      { label: "Lifetime", value: totals.lifetime, color: "#c084fc" },
      { label: "Paid Pro", value: totals.pro, color: "#5dd39e" },
      { label: "Standard", value: totals.standard, color: "#b88a2f" },
      { label: "Ava seat", value: totals.ava, color: "#7eb8da" },
    ];
    pie(el("chart-member-pie"), memberSlices);
    legend(
      el("legend-member-pie"),
      memberSlices,
      totals.lifetime + totals.pro + totals.standard + totals.ava,
    );

    hBars(
      el("chart-share-bars"),
      rows.map(function (r, i) {
        return { label: r.name, value: r.share, color: r.ava ? "#7eb8da" : colorAt(i), display: fmtPct(r.share) };
      }),
    );

    stackedBars(
      el("chart-shard-stack"),
      players.map(function (r) {
        return { label: r.name, ec: r.ec, paid: r.paid, bonus: r.bonus };
      }),
    );

    hBars(
      el("chart-paid-bars"),
      players
        .slice()
        .sort(function (a, b) {
          return b.paid - a.paid || b.score - a.score;
        })
        .map(function (r, i) {
          return { label: r.name, value: r.paid, color: "#5dd39e", display: fmtInt(r.paid) };
        }),
    );

    hBars(
      el("chart-ec-bars"),
      players
        .slice()
        .sort(function (a, b) {
          return b.ec - a.ec;
        })
        .map(function (r, i) {
          return { label: r.name, value: r.ec, color: "#f5b942", display: fmtInt(r.ec) };
        }),
    );

    hBars(
      el("chart-vote-bars"),
      players
        .slice()
        .sort(function (a, b) {
          return b.votes - a.votes;
        })
        .map(function (r, i) {
          return { label: r.name, value: r.votes, color: "#c97b4f", display: fmtInt(r.votes) };
        }),
    );

    hBars(
      el("chart-play-bars"),
      players
        .filter(function (r) {
          return r.play > 0;
        })
        .sort(function (a, b) {
          return b.play - a.play;
        })
        .map(function (r) {
          return { label: r.name, value: r.play, color: "#7eb8da", display: fmtHours(r.play) };
        }),
    );

    hBars(
      el("chart-raw-bars"),
      rows
        .slice()
        .sort(function (a, b) {
          return b.raw - a.raw;
        })
        .map(function (r, i) {
          return { label: r.name, value: r.raw, color: r.ava ? "#7eb8da" : colorAt(i), display: fmtNum(r.raw) };
        }),
    );
  }

  function renderStats(rows, totals, meta) {
    el("stat-eligible").textContent = String(meta.eligible || rows.length);
    el("stat-polls").textContent = String(meta.polls || 0);
    el("stat-ec").textContent = fmtInt(totals.ec);
    el("stat-paid").textContent = fmtInt(totals.paid);
    el("stat-score").textContent = fmtInt(totals.score);
    el("stat-raw").textContent = fmtNum(totals.raw);
    el("stat-votes").textContent = fmtInt(totals.votes);
    el("stat-lifetime").textContent = String(totals.lifetime);
    if (el("stat-pro")) el("stat-pro").textContent = String(totals.pro);
  }

  async function main() {
    var G = window.RootMcGovernance;
    if (!G) return;
    var me = await G.loadMe();
    G.renderStatusBanner(me, el("council-me"));

    var pack = await Promise.all([
      G.govFetch("council", { method: "GET" }),
      G.govFetch("polls", { method: "GET" }),
    ]);
    var councilData = pack[0].data;
    var pollData = pack[1].data;

    if (!councilData || !councilData.ok) {
      el("council-sync").textContent = "Could not load Council roster.";
      return;
    }

    var policy = councilData.policy || {};
    var rows = (councilData.council || []).map(enrich);
    var polls = (pollData && pollData.polls) || councilData.polls || [];

    el("council-sync").textContent =
      "Synced " + G.fmtDate(councilData.synced_at) + " · " + (councilData.eligible_count || rows.length) + " eligible voters · total raw " + fmtNum(councilData.total_raw);
    el("council-stats").hidden = false;

    if (policy.formula) {
      el("stat-formula").textContent = String(policy.formula).replace(/_/g, " ");
      el("policy-formula").textContent = policy.formula + "\nshare = raw ÷ Σ(all raw) → % of 100%";
    }
    if (policy.share_note) el("policy-share-note").textContent = policy.share_note;
    if (policy.constitution_url) el("policy-constitution").href = policy.constitution_url;

    var players = rows.filter(function (r) {
      return !r.ava;
    });
    var totals = {
      ec: players.reduce(function (s, r) { return s + r.ec; }, 0),
      paid: players.reduce(function (s, r) { return s + r.paid; }, 0),
      bonus: players.reduce(function (s, r) { return s + r.bonus; }, 0),
      score: players.reduce(function (s, r) { return s + r.score; }, 0),
      votes: players.reduce(function (s, r) { return s + r.votes; }, 0),
      raw: rows.reduce(function (s, r) { return s + r.raw; }, 0),
      lifetime: players.filter(function (r) { return r.is_lifetime; }).length,
      pro: players.filter(function (r) { return r.is_pro && !r.is_lifetime; }).length,
      standard: players.filter(function (r) { return !r.is_pro && !r.is_lifetime; }).length,
      ava: rows.filter(function (r) { return r.ava; }).length,
    };

    renderStats(rows, totals, {
      eligible: councilData.eligible_count,
      polls: polls.length,
    });
    renderCharts(rows, totals);

    function applySort() {
      var sorted = sortRows(rows, sortState.key, sortState.dir);
      renderTable(el("council-table").querySelector("tbody"), sorted);
      document.querySelectorAll("#council-table th[data-sort]").forEach(function (th) {
        th.classList.toggle("is-sort", th.getAttribute("data-sort") === sortState.key);
        th.setAttribute("aria-sort", th.getAttribute("data-sort") === sortState.key ? (sortState.dir < 0 ? "descending" : "ascending") : "none");
      });
    }
    applySort();

    document.querySelectorAll("#council-table th[data-sort]").forEach(function (th) {
      th.addEventListener("click", function () {
        var key = th.getAttribute("data-sort");
        if (sortState.key === key) sortState.dir *= -1;
        else {
          sortState.key = key;
          sortState.dir = key === "name" ? 1 : -1;
        }
        applySort();
      });
    });

    (function renderVoteRequirements(p) {
      p = p || {};
      var holdH = Number(p.grant_majority_hold_hours) || 24;
      var thresh = Number(p.majority_threshold_pct) || 50;
      var amendH = Number(p.amendment_hours) || 48;
      var voteDays = Number(p.bill_vote_days) || 7;
      var pubDays = Number(p.min_publication_days) || 3;
      var gMin = Number(p.grant_min_amount) || 1;
      var gMax = Number(p.grant_max_amount) || 10000;
      el("req-eligibility").innerHTML =
        "<li><strong>Propose</strong> — any linked player via in-game <code>/proposal</code> (64 G). Vote Shards not required to submit.</li>" +
        '<li><strong>Vote</strong> — Vote Shard score &gt; 0 (EC and/or paid) + <a href="' +
        G.esc(p.terms_url || "/terms/") +
        '">Terms</a> + Discord sign-in</li>' +
        "<li><strong>Discuss</strong> — any verified (linked) player in the proposal Discord thread</li>" +
        '<li><a href="' +
        G.esc(p.verify_url || "/verify/") +
        '">Link</a> Minecraft + Discord after <code>/link</code></li>';
      el("req-bill").innerHTML =
        "<li>Proposal published <strong>≥ " +
        pubDays +
        " days</strong> before Sunday compile</li>" +
        "<li><strong>" +
        amendH +
        "h</strong> amendment window after bill posts</li>" +
        "<li>Council vote runs <strong>" +
        voteDays +
        " days</strong> — For / Against / Abstain</li>" +
        "<li>Leading option needs <strong>&gt;" +
        thresh +
        "%</strong> of <em>cast</em> weighted votes</li>";
      el("req-grant").innerHTML =
        "<li>Any eligible linked player may request <strong>" +
        gMin.toLocaleString() +
        "–" +
        gMax.toLocaleString() +
        " G</strong> from reserve</li>" +
        (p.grant_proposer_cannot_vote !== false ? "<li><strong>Proposer cannot vote</strong> on their own grant</li>" : "") +
        "<li>Pass or veto: weighted <strong>For &gt; Against</strong> (Abstain does not decide grants)</li>" +
        "<li>That majority must hold <strong>" +
        holdH +
        " hours</strong> unchanged — then auto-payout or veto</li>" +
        "<li>Poll may stay open up to <strong>30 days</strong></li>";
      var sites = Array.isArray(p.listing_sites) ? p.listing_sites : [];
      var siteNote = el("req-listing-sites");
      if (sites.length) {
        siteNote.textContent =
          "Official listing sites mint Vote Shards (" +
          sites.length +
          "): " +
          sites
            .map(function (s) {
              return s.label || s.id;
            })
            .join(", ") +
          ".";
      } else {
        siteNote.textContent =
          "Listing votes mint +1 digital EC shard (same number as your vote count). Lifetime listing sites count ×2. Paid shards $1=100.";
      }
    })(policy);

    var list = el("poll-list");
    if (!polls.length) {
      list.innerHTML = '<li class="rmc-muted">No open votes right now.</li>';
    } else {
      list.innerHTML = polls
        .map(function (p) {
          var grantMeta =
            p.kind === "grant" && p.grant_amount
              ? " · Grant " + p.grant_amount + " G → " + G.esc(p.grant_recipient_username || "?")
              : "";
          var closeMeta =
            p.kind === "grant"
              ? p.majority_direction && p.majority_since
                ? "Majority " + p.majority_direction + " since " + G.fmtDate(p.majority_since)
                : "Awaiting 24h sustained majority"
              : "Closes " + G.fmtDate(p.closes_at);
          return (
            '<li><a href="/governance/vote/?id=' +
            encodeURIComponent(p.id) +
            '">' +
            G.esc(p.title) +
            "</a>" +
            (p.kind === "grant" ? ' <span class="market-badge">Grant</span>' : "") +
            '<div class="gov-meta">' +
            closeMeta +
            grantMeta +
            " · For " +
            G.fmtPct(p.weighted_for_pct) +
            " · Against " +
            G.fmtPct(p.weighted_against_pct) +
            "</div></li>"
          );
        })
        .join("");
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      main().catch(function (e) {
        var s = el("council-sync");
        if (s) s.textContent = String((e && e.message) || e);
      });
    });
  } else {
    main().catch(function (e) {
      var s = el("council-sync");
      if (s) s.textContent = String((e && e.message) || e);
    });
  }
})();
