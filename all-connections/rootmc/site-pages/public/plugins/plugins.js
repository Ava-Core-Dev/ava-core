(function () {
  /** Public catalog — each plugin has /plugins/<id>/ install guide. Auto-updates via Root-Core + manifest.json. */
  var GROUPS = [
    { id: "spine", label: "Core spine" },
    { id: "economy", label: "Economy & land" },
    { id: "play", label: "Progression" },
    { id: "ops", label: "Ops & sync" },
    { id: "maps", label: "Maps" },
    { id: "official", label: "Legacy / optional" },
  ];

  /** bStats: https://bstats.org/plugin/bukkit/<name>/<id> */
  var CATALOG = [
    {
      id: "root-core",
      group: "spine",
      title: "Root-Core",
      blurb:
        "Product key, shared RootMC folder, My Servers presence, and suite auto-updater from manifest.json.",
      status: "available",
      guide: "/plugins/root-core/",
      bstats: "https://bstats.org/plugin/bukkit/Root-Core/32895",
    },
    {
      id: "root-ava-core",
      group: "spine",
      title: "Root-Ava-Core",
      blurb:
        "Ava companion on Paper — in-game solar/CPU/XP status. Root-Core ensure-installs this from the manifest.",
      status: "available",
      guide: "/plugins/root-ava-core/",
    },
    {
      id: "root-times",
      group: "spine",
      title: "Root-Times",
      blurb:
        "Minecraft-day clock, playtime, AFK, timezone activity peaks, join welcome, local status web.",
      status: "available",
      guide: "/plugins/root-times/",
      bstats: "https://bstats.org/plugin/bukkit/Root-Times/32897",
    },
    {
      id: "root-perms",
      group: "spine",
      title: "Root-Perms",
      blurb:
        "First-party groups and tracks with Bukkit attachments. Vault Permission bridge when Vault is present.",
      status: "available",
      guide: "/plugins/root-perms/",
      bstats: "https://bstats.org/plugin/bukkit/Root-Perms/32898",
    },
    {
      id: "root-economy",
      group: "economy",
      title: "Root-Economy",
      blurb:
        "Gold wallets, claim banks, Vault, treasury, shops, compounding bonds, loans, Server Reserve — MC-day economy crons.",
      status: "available",
      guide: "/plugins/root-economy/",
    },
    {
      id: "root-chestshops",
      group: "economy",
      title: "Root-ChestShops",
      blurb:
        "Chest shops + virtual bins (/item). Special keys: BONDED_NOTE, APPRECIATION_TOKEN (not plain sunflower).",
      status: "available",
      guide: "/plugins/root-chestshops/",
    },
    {
      id: "root-market",
      group: "economy",
      title: "Root-Market",
      blurb:
        "In-game /market browser — categories, live buy/sell quotes from player shops, trending sell multi.",
      status: "available",
      guide: "/plugins/root-market/",
    },
    {
      id: "root-essentials",
      group: "economy",
      title: "Root-Essentials",
      blurb:
        "QoL + travel — homes, TP, spawn, banners, potions. Paid commands debit Root-Economy treasury via SPI.",
      status: "available",
      guide: "/plugins/root-essentials/",
      bstats: "https://bstats.org/plugin/bukkit/Root-Essentials/32899",
    },
    {
      id: "root-claims",
      group: "economy",
      title: "Root-Claims",
      blurb: "Personal land claims on live RootMC (play.rootmc.net). Pair with Root-Perms; no Towny required.",
      status: "available",
      guide: "/plugins/root-claims/",
      bstats: "https://bstats.org/plugin/bukkit/Root-Claims/32900",
    },
    {
      id: "root-territories",
      group: "economy",
      title: "Root-Territories",
      blurb: "Claim territory buffers (+48), border messages, BlueMap outlines when available.",
      status: "available",
      guide: "/plugins/root-territories/",
      bstats: "https://bstats.org/plugin/bukkit/Root-Territories/32901",
    },
    {
      id: "root-play",
      group: "play",
      title: "Root-Play",
      blurb: "Purchasable ranks, vote rewards, help commands, and guided new-player road — needs Root-Perms.",
      status: "available",
      guide: "/plugins/root-play/",
      bstats: "https://bstats.org/plugin/bukkit/Root-Play/32903",
    },
    {
      id: "root-skills",
      group: "play",
      title: "Root-Skills",
      blurb:
        "Proportional XP, talents, prestige — MySQL via shared database.yml. mcMMO replacement path after migrate.",
      status: "available",
      guide: "/plugins/root-skills/",
    },
    {
      id: "root-gamble",
      group: "play",
      title: "Root-Gamble",
      blurb: "Gold-staked mini-games — treasury-safe payouts. Needs Root-Core + Root-Economy.",
      status: "available",
      guide: "/plugins/root-gamble/",
    },
    {
      id: "root-heads",
      group: "play",
      title: "Root-Heads",
      blurb: "Mob collectible heads — suite config under plugins/RootMC/root-heads.yml.",
      status: "available",
      guide: "/plugins/root-heads/",
    },
    {
      id: "root-memberships",
      group: "play",
      title: "Root-Memberships",
      blurb: "Membership / perk tracks for official hosts — needs Root-Core.",
      status: "available",
      guide: "/plugins/root-memberships/",
    },
    {
      id: "root-try",
      group: "play",
      title: "Root-Try",
      blurb: "Guided command try-list with small Gold rewards — teaches the suite on first joins.",
      status: "available",
      guide: "/plugins/root-try/",
      bstats: "https://bstats.org/plugin/bukkit/Root-Try/32908",
    },
    {
      id: "root-haste",
      group: "play",
      title: "Root-Haste",
      blurb:
        "Pass-the-torch by default (/torch). Set unlock-joint: true on 18+ servers for /joint. One jar — longest-burn record.",
      status: "available",
      guide: "/plugins/root-haste/",
      bstats: "https://bstats.org/plugin/bukkit/Root%20Haste/32894",
      spigot: "https://www.spigotmc.org/resources/root-joint-pass-the-haste.137389/",
    },
    {
      id: "root-referrals",
      group: "play",
      title: "Root-Referrals",
      blurb:
        "Share /root codes — Discord + playtime gates, Server Reserve qualify rewards and milestones.",
      status: "available",
      guide: "/plugins/root-referrals/",
    },
    {
      id: "root-appreciation",
      group: "play",
      title: "Root-Appreciation",
      blurb:
        "Appreciation Tokens — /thanks stats, /bonus streak, right-click redeem (247 rewards), player-shop trading.",
      status: "available",
      guide: "/plugins/root-appreciation/",
    },
    {
      id: "root-ops",
      group: "ops",
      title: "Root-Ops",
      blurb: "Staff tools, graceful restart countdown, rotating announcer, area mapper.",
      status: "available",
      guide: "/plugins/root-ops/",
      bstats: "https://bstats.org/plugin/bukkit/Root-Ops/32904",
    },
    {
      id: "root-iteminfo",
      group: "ops",
      title: "Root-ItemInfo",
      blurb:
        "World item census — /info totals for any material, average Gold value, mint-peg gold summary, optional MySQL sync.",
      status: "available",
      guide: "/plugins/root-iteminfo/",
      bstats: "https://bstats.org/plugin/bukkit/Root-ItemInfo/32906",
    },
    {
      id: "root-webstat",
      group: "ops",
      title: "Root-Webstat",
      blurb: "Local status web endpoints for operators — pairs with Root-Core and Times.",
      status: "available",
      guide: "/plugins/root-webstat/",
      bstats: "https://bstats.org/plugin/bukkit/Root-Webstat/32907",
    },
    {
      id: "root-ping",
      group: "ops",
      title: "Root-Ping",
      blurb:
        "Detailed connection analytics — /ping plus MySQL samples (latency, client, TPS/MSPT). Interactive dashboards on the roadmap.",
      status: "available",
      guide: "/plugins/root-ping/",
      bstats: "https://bstats.org/plugin/bukkit/Root-Ping/32911",
      spigot: "https://www.spigotmc.org/resources/root-ping-detailed-connection-analytics.137392/",
    },
    {
      id: "rootmc",
      group: "ops",
      title: "RootMC",
      blurb:
        "Account link, stats heartbeat, Discord bridge via Root-Core comms, shops reporting — primary sync jar.",
      status: "available",
      guide: "/plugins/rootmc/",
      bstats: "https://bstats.org/plugin/bukkit/RootMC/32902",
    },
    {
      id: "root-bluemap-r2-fix",
      group: "maps",
      title: "Root-BlueMap-R2-Fix",
      blurb:
        "STARTUP sidecar for BlueMap on Cloudflare R2 — sets AWS signing flags before BlueMap loads.",
      status: "available",
      guide: "/plugins/root-bluemap-r2-fix/",
      bstats: "https://bstats.org/plugin/bukkit/Root-BlueMap-R2-Fix/32905",
    },
    {
      id: "rootmc-official",
      group: "official",
      title: "RootMC-Official",
      blurb:
        "Legacy/optional network progression (playtime, skills, votes, perms). Not a live Towny↔Claims production pair — skip on a single host.",
      status: "available",
      guide: "/plugins/rootmc-official/",
      bstats: "https://bstats.org/plugin/bukkit/RootMC-Official/32909",
    },
  ];

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function statusBadge(status) {
    if (status === "available") {
      return '<span class="plugins-card-badge">Available</span>';
    }
    return '<span class="plugins-card-badge plugins-card-badge--soon">Coming soon</span>';
  }

  function cardHtml(item, entry) {
    var version = entry && entry.version ? String(entry.version) : "";
    var url = entry && entry.url ? String(entry.url) : "";
    var filename = entry && entry.filename ? String(entry.filename) : "";
    var available = item.status === "available" && url;
    var guide = item.guide || "/plugins/" + item.id + "/";
    var bstats = item.bstats || "";
    var spigot = item.spigot || "";

    var actions =
      '<div class="plugins-card-actions">' +
      (available
        ? '<a class="rmc-btn rmc-btn-primary" href="' +
          esc(url) +
          '" download>Download ' +
          esc(filename || "jar") +
          "</a>"
        : "") +
      '<a class="plugins-card-guide" href="' +
      esc(guide) +
      '">Full page →</a>' +
      (bstats
        ? ' <a class="plugins-card-guide" href="' +
          esc(bstats) +
          '" rel="noopener noreferrer" target="_blank">bStats →</a>'
        : "") +
      (spigot
        ? ' <a class="plugins-card-guide" href="' +
          esc(spigot) +
          '" rel="noopener noreferrer" target="_blank">Spigot →</a>'
        : "") +
      "</div>";

    var meta = available
      ? '<p class="plugins-card-meta">v' +
        esc(version) +
        ' · auto-updates via Root-Core · <a href="/developer/">Get a product key</a></p>'
      : '<p class="plugins-card-meta">Public download not open yet.</p>';

    return (
      '<article class="plugins-card" id="plugin-' +
      esc(item.id) +
      '">' +
      '<header class="plugins-card-head">' +
      '<h3 class="plugins-card-title"><a href="' +
      esc(guide) +
      '">' +
      esc(item.title) +
      "</a></h3>" +
      statusBadge(item.status) +
      "</header>" +
      '<p class="plugins-card-blurb">' +
      esc(item.blurb) +
      "</p>" +
      actions +
      meta +
      "</article>"
    );
  }

  function render(manifest) {
    var root =
      document.getElementById("plugin-catalog") ||
      document.getElementById("plugins-catalog");
    if (!root) return;
    root.className = "plugins-catalog";

    var byGroup = {};
    CATALOG.forEach(function (item) {
      var g = item.group || "ops";
      if (!byGroup[g]) byGroup[g] = [];
      byGroup[g].push(item);
    });

    var html = "";
    GROUPS.forEach(function (g) {
      var items = byGroup[g.id];
      if (!items || !items.length) return;
      html +=
        '<section class="plugins-catalog-section" aria-labelledby="plugins-group-' +
        esc(g.id) +
        '">';
      html +=
        '<h3 class="plugins-catalog-group" id="plugins-group-' +
        esc(g.id) +
        '">' +
        esc(g.label) +
        "</h3>";
      html += items
        .map(function (item) {
          return cardHtml(item, manifest && manifest[item.id]);
        })
        .join("");
      html += "</section>";
    });
    root.innerHTML = html;
  }

  fetch("/plugins/manifest.json?v=" + Date.now(), { cache: "no-store" })
    .then(function (res) {
      if (!res.ok) throw new Error("manifest " + res.status);
      return res.json();
    })
    .then(render)
    .catch(function () {
      render(null);
    });
})();
