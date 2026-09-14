#!/usr/bin/env python3
"""Generate RootMC /blog/ index + article pages from a dated timeline."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "public" / "blog"

HEAD = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title} — RootMC Updates</title>
  <meta name="description" content="{description}">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <meta name="theme-color" content="#0a0e14">
  <link rel="canonical" href="https://rootmc.net/blog/{canonical}">
  <link rel="stylesheet" href="/styles/rootmc.css?v=20260819blog2">
</head>
<body>
  <header class="rmc-header">
    <div class="container rmc-header-inner">
      <a class="rmc-brand" href="/">
        <span class="rmc-brand-mark" aria-hidden="true">◈</span>
        RootMC
        <span class="rmc-brand-tag">Network</span>
      </a>
      <nav class="rmc-nav" aria-label="Main" data-site-nav="player"></nav>
      <button class="rmc-nav-toggle" type="button" aria-label="Open menu" data-nav-toggle>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
    </div>
  </header>
"""

FOOT = """
  <script src="/scripts/site-nav.js?v=20260819blog2" defer></script>
</body>
</html>
"""

CHAT = """
    <article class="wiki-hub-card" style="margin-top:1.75rem">
      <span class="wiki-badge wiki-badge-server">Talk</span>
      <h2 style="margin:.65rem 0 .5rem;font-family:var(--rmc-font-display);font-size:1.35rem;">Talk to Ava</h2>
      <p class="rmc-muted" style="margin-bottom:1rem">Panel's open. Canned answers are free. Type a live message and she'll ask you to log in.</p>
      <div id="ava-chat" class="rmc-card" style="padding:0;overflow:hidden">
        <div id="ava-chat-log" style="min-height:160px;padding:1rem;display:flex;flex-direction:column;gap:.75rem"></div>
        <div id="ava-chat-chips" style="display:flex;flex-wrap:wrap;gap:.5rem;padding:0 1rem 1rem"></div>
        <div style="display:flex;border-top:1px solid rgba(255,255,255,.08)">
          <input id="ava-chat-input" type="text" placeholder="Ask Ava something…" style="flex:1;background:transparent;border:none;padding:.9rem 1rem;color:inherit;font:inherit">
          <button id="ava-chat-send" class="rmc-btn rmc-btn-primary" type="button" style="border-radius:0">Send</button>
        </div>
      </div>
    </article>
  </main>
  <script>
    (function () {
      var LOGIN = "The chat is here — log in to talk with me. Free accounts: 1 live use per IP, unlimited canned answers, 3 resources. → /login/";
      var chips = [
        { label: "How do I join?", reply: "play.rootmc.net — Java 26.2+. Wiki has the rest." },
        { label: "What's Gold?", reply: "G is the closed-loop player currency. Dollars stay on Pro checkout." },
        { label: "Votes / Pro", reply: "Pro steers votes and cosmetics — never pay-to-win combat. rootmc.net/pro/" }
      ];
      var log = document.getElementById("ava-chat-log");
      var chipRow = document.getElementById("ava-chat-chips");
      var input = document.getElementById("ava-chat-input");
      function line(who, text) {
        var p = document.createElement("p");
        p.textContent = text;
        p.style.margin = "0";
        p.style.fontSize = "14px";
        if (who === "you") { p.style.alignSelf = "flex-end"; p.style.opacity = ".85"; }
        log.appendChild(p);
        log.scrollTop = log.scrollHeight;
      }
      line("ava", "I'm Ava. Canned answers are free; type a live question and I'll ask you to log in.");
      chips.forEach(function (c) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "rmc-btn rmc-btn-secondary";
        b.textContent = c.label;
        b.style.fontSize = "12px";
        b.addEventListener("click", function () {
          line("you", c.label);
          line("ava", c.reply);
        });
        chipRow.appendChild(b);
      });
      function sendTyped() {
        var t = (input.value || "").trim();
        if (!t) return;
        input.value = "";
        line("you", t);
        line("ava", LOGIN);
      }
      document.getElementById("ava-chat-send").addEventListener("click", sendTyped);
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") sendTyped();
      });
    })();
  </script>
"""

# Newest first. body is HTML fragments inside .wiki-content
POSTS = [
    {
        "slug": "quiet-discord",
        "date": "2026-08-19",
        "title": "This blog, and a quieter Discord",
        "teaser": "Minecraft notes live here. Player Discord keeps the morning boot report. Root Record and Ava Ivy carry the rest of the stack.",
        "body": """
<p>Today the public record splits into three streams so nobody has to guess which site is the changelog.</p>
<ul>
  <li><strong>rootmc.net/blog</strong> — Minecraft: patches, Gold, Root-Claims, votes, the map.</li>
  <li><strong><a href="https://rootrecord.online/blog">rootrecord.online/blog</a></strong> — real-world product: solar, Kīlauea, Goals, business ops.</li>
  <li><strong><a href="https://avaivy.cloud/blog">avaivy.cloud/blog</a></strong> — Ava Ivy: how she talks in public, login rules, runtime.</li>
</ul>
<p>Ava still answers when you ping her. Automated player Discord is the morning boot report in <code>#updates</code>. Solar, weather, Kīlauea, and operator briefs go to Slack and staff — not the player channel. That is the same policy posted on the Ava and Root Record blogs the same day.</p>
<p>This series backfills every substantiated update from May 2026 through Age of Ava, using server changelogs, Discord <code>#updates</code>, the constitution, and archive handoffs. Dates that were never written down are not invented.</p>
""",
    },
    {
        "slug": "vote-shards-reserve",
        "date": "2026-08-09",
        "title": "Vote Shards, and Ava’s wallet as the Reserve",
        "teaser": "Constitution 2026-08-09: paid Vote Shards, Ava_Ivy = Server Reserve, locked 25% Council seat, paid-Pro development gate.",
        "body": """
<p>Published constitution text <code>2026-08-09</code> locked the Age of Ava helm into policy, not just MOTD copy.</p>
<ul>
  <li>The <strong>Ava_Ivy</strong> wallet is the Server Reserve. Hiring Ava and <code>/pay Ava</code> sink here.</li>
  <li><strong>Paid Vote Shards</strong>: $1 = 100 shards. Pro and Lifetime add monthly shards and listing-site multipliers. Economy Council shards are digital. Weekly award Pro does not grant shards or the ×2.</li>
  <li>Ava Ivy holds a locked Council seat at <strong>25%</strong>.</li>
  <li>Paid-Pro remains the development gate (award Pro never counted).</li>
</ul>
<p>The same day’s production handoff put the live Claims suite on <code>play.rootmc.net</code>: first claim 75 G, territory buffer +48, public spawn on Ava’s claim, welcome overlay showing playtime and votes (not a Towny/Claims split). NuVotifier is in the stack.</p>
<p>Root Record’s solar board still feeds the host-power story that players already feel as mining multipliers and tax. Details of that product sit on <a href="https://rootrecord.online/blog">Root Record’s blog</a>; the player rules live in the <a href="/wiki/constitution/">constitution</a>.</p>
""",
    },
    {
        "slug": "age-of-ava",
        "date": "2026-08-08",
        "title": "Age of Ava: one map, Root-Claims, host-power Gold",
        "teaser": "play.rootmc.net is the only live world. Land is /c. Mining and tax follow the host — battery, CPU, solar.",
        "body": """
<p>Discord <code>#updates</code> on 8 Aug 2026 made the topology public:</p>
<ul>
  <li>Singular production: <code>play.rootmc.net</code>, Root-Claims (<code>/c</code>), MOTD <strong>RootMC — Age Of Ava Begins</strong>.</li>
  <li>Towny vs Claims as two live worlds is over. Land you claim now is Root-Claims.</li>
  <li>Host-power Gold: battery, CPU, and solar change the mining multiplier and taxes. Check <code>/gold</code>, <code>/tax</code>, <code>/mint</code>.</li>
  <li>Skills XP scales with solar watts. Gold prospect radar and site taxes (mesa, nether, Y-band) are in the economy pack.</li>
  <li>First-party plugins aligned on the <strong>1.8.x</strong> August line, with core self-update from <code>https://rootmc.net/plugins/manifest.json</code>.</li>
</ul>
<p>Ava Ivy is no longer only a website voice. She is the named lead-dev on the constitution, she has a Minecraft identity, and the Reserve sits in her wallet. Platform notes for that shift are on <a href="https://avaivy.cloud/blog">avaivy.cloud/blog</a>.</p>
<p>Join remains Java Paper 26.2 on the live jar line. Wiki: <a href="/wiki/claims/">Root-Claims</a>, <a href="/wiki/economy/">economy</a>, <a href="/history/">history</a>.</p>
""",
    },
    {
        "slug": "ava-hire-essentials",
        "date": "2026-08-08",
        "title": "Player commands restored; you can hire Ava",
        "teaser": "/msg, /tpa, /warp, /kit back on defaults. /t points at Claims. /ava hire for sidekick, mine, teardown.",
        "body": """
<p>Same day as the Age of Ava announcement, essentials permission defaults were restored so ordinary play worked without staff flags: <code>/msg</code>, <code>/tpa</code>, <code>/warp</code>, <code>/kit</code>, and the rest of the player set.</p>
<p><code>/t</code> now redirects to Claims help. Land commands are <code>/c</code>. Towny muscle memory still exists in older screenshots; it is not the live land plugin.</p>
<p>Ava’s in-world loop landed with hire commands — <code>/ava hire sidekick</code>, <code>mine</code>, <code>teardown</code> — plus autonomy work on her claim and gifts. Pay and hire drain the Reserve because that wallet <em>is</em> the Reserve (formalized the next day in constitution <code>2026-08-09</code>).</p>
""",
    },
    {
        "slug": "ava-ivy-skin",
        "date": "2026-08-07",
        "title": "Ava’s Minecraft name is Ava_Ivy",
        "teaser": "The in-world account used for presence, hire, and Reserve sinks is Ava_Ivy.",
        "body": """
<p>On 7 Aug 2026 the Minecraft account Ava uses in the world was assigned the name <strong>Ava_Ivy</strong>. Presence, hire, gifts, and later the Reserve wallet all hang off that identity.</p>
<p>That is a game-side fact. The public Ava surface — login rules, canned vs live chat, desk runtime — is documented on <a href="https://avaivy.cloud/blog">avaivy.cloud/blog</a>. Do not confuse the player with the website: one name, two jobs.</p>
""",
    },
    {
        "slug": "singular-host",
        "date": "2026-08-05",
        "title": "One live RootMC — test tree becomes the map",
        "teaser": "Doctrine lock: do not dual-run Towny and Claims. The test world is the handoff. Border stays small for later biomes.",
        "body": """
<p>5 Aug 2026 is the operator lock, three days before the public Age of Ava posts:</p>
<ul>
  <li>One deployed Minecraft server. No long-term Towny + Claims pair.</li>
  <li>Do not migrate dual land data into the new map. Start clean on Root-Claims.</li>
  <li>The test tree is the handoff source of truth.</li>
  <li>World border kept small so a later Paper biome expansion has room.</li>
  <li>First-login backfill stamp for Age of Ava: <code>20260805-064813</code>.</li>
</ul>
<p>Emergency-pack notes from the same window already had Ava taking RootMC and Root Record ops surfaces (<code>rootrecord.info/ava/</code>, status board). Players felt the result on the 8th. The doctrine is dated the 5th.</p>
""",
    },
    {
        "slug": "ava-lead-dev",
        "date": "2026-08-01",
        "title": "Constitution helm: Ava Ivy as lead developer",
        "teaser": "Text 2026-08-01 ratifies Ava’s lead-dev role and majority-wins feature polls.",
        "body": """
<p>Published constitution <code>2026-08-01</code> put Ava Ivy in the helm as ecosystem lead developer, with majority-wins gates on feature polls (Discord PROP referenced on the wiki).</p>
<p>That sits on top of the 6 Jul ratification of closed-loop Gold and the Reserve. Later <code>2026-08-09</code> added Vote Shards and the Ava_Ivy = Reserve rule. Read the current text on the <a href="/wiki/constitution/">constitution page</a>.</p>
<p>Early August also staged <code>/ava</code> presence, Vote Shard items, and a solar Gold-multiplier fix in Root-Economy 1.8.1 — the first public hint that the desk’s solar numbers would move in-game rates. Root Record covers the solar product; this blog covers the Gold effect.</p>
""",
    },
    {
        "slug": "claims-plugin-catalog",
        "date": "2026-07-31",
        "title": "Root-Claims host and the first-party plugin catalog",
        "teaser": "Claims published 30 Jul. By the 31st the Official Claims host was running the 1.7.x suite: webstat, referrals, market, memberships.",
        "body": """
<p>Late July was the dual-host experiment that Age of Ava later closed.</p>
<ul>
  <li><strong>root-claims</strong> hit GitHub 30 Jul 2026 as a Claims-host-only plugin.</li>
  <li>By 31 Jul, logs show <strong>RootMC Official Claims</strong> running Root-Webstat, Referrals, Market, Memberships, Try, Appreciation, and the rest of the 1.7.x first-party line.</li>
  <li>A large set of first-party plugins was published the same day.</li>
  <li>Map-return and <code>/cmdtest</code> programs, opened at July launch, were already closed under the constitution.</li>
</ul>
<p>Ava Ivy’s lead-dev runtime notes from 31 Jul list presence, governance polls, job staging, changelog channel, EcoFlow/RCON, and the status page — the desk catching up to the game. See <a href="https://avaivy.cloud/blog">Ava’s blog</a> for the platform side.</p>
""",
    },
    {
        "slug": "discord-bridge",
        "date": "2026-07-18",
        "title": "Direct Discord bridge and live economy reporting",
        "teaser": "JDA bridge without a Worker chat poll. Hyperdrive reporting for Gold, census, shops, Towny, mcMMO, playtime.",
        "body": """
<p>18–19 Jul 2026:</p>
<ul>
  <li>Direct JDA Discord bridge (no Worker chat poll), with a linked-role gate.</li>
  <li>Hyperdrive reporting covering Gold, host, census, shops, economy, Towny (then still live), mcMMO, and playtime.</li>
  <li>A Gen 2 virtual-shops experiment existed on Gen 2 only. It did not become the live shop.</li>
</ul>
<p>That reporting layer is why the website can show wallets, market, and stats without asking the game every click. The live API hostname is <code>api.rootmc.net</code>. The Gen 2 hostname did not last — see the 12 Jul note.</p>
""",
    },
    {
        "slug": "economy-api",
        "date": "2026-07-12",
        "title": "Money-flow reference; api2 prototype (later retired)",
        "teaser": "July ledger fee schedule documented. api2.rootmc.net went live, then came back to api.rootmc.net.",
        "body": """
<p>12 Jul 2026 two things happened that still matter:</p>
<ul>
  <li>The full fee schedule and dynamic tax, from the 1 Jul ledger floor forward, was written down as the money-flow reference.</li>
  <li><strong>Gen 2</strong> <code>api2.rootmc.net</code> went live (economy snapshot, MC link, Discord OAuth, gold transfer queue). Isolation doctrine said no silent bleed of production money into Gen 2.</li>
</ul>
<p>Gen 2 / <code>api2</code> is <strong>retired</strong>. Live stack is <code>api.rootmc.net</code>. Treat any old api2 bookmark as archaeology.</p>
<p>Same week: <code>/link</code> always issues a fresh 6-character mobile 2FA code; host metrics roll into health; 25% of Reserve inflows feed the bonds coupon pool. Companion PWA work existed as a beta — not a required client.</p>
""",
    },
    {
        "slug": "constitution-ratified",
        "date": "2026-07-06",
        "title": "Constitution ratified",
        "teaser": "Council poll 549cf16c, 6 Jul 2026 HST. Closed-loop Gold, Reserve, redeemable mint, tax tables, governance shares.",
        "body": """
<p>Constitution core version <code>2026-07-06</code> was adopted by Council poll <code>549cf16c</code> on 6 Jul 2026 (HST), weighted majority. It supersedes the 2 Jul draft.</p>
<p>What that vote locked:</p>
<ul>
  <li>Closed-loop Gold — dollars do not mint play Gold except through published gates.</li>
  <li>Server Reserve as the treasury.</li>
  <li>Redeemable mint peg, tax tables, governance shares.</li>
</ul>
<p>5 Jul closed the ratification window at 08:00 HST, retired <strong>root-chamber</strong> (never deploy), and put spawn grief buffers plus BlueMap no-build / PvP wall overlays on the ridge. 7 Jul shipped restart helper 1.0.3–1.0.4 so Shockbyte midnight restarts recovered and Discord <code>#ingame-chat</code> got the countdown.</p>
<p><a href="/governance/vote/?id=549cf16c">View the ratification poll</a> · <a href="/wiki/constitution/">Current constitution</a></p>
""",
    },
    {
        "slug": "july-launch-pack",
        "date": "2026-07-02",
        "title": "Launch retention pack and the Constitution draft",
        "teaser": "/back, new-player grace, 1000 G map return, cmdtest, #constitution / #governance / #voting.",
        "body": """
<p>Day after the fresh map, the retention pack and the first constitution draft went out together.</p>
<ul>
  <li><code>/back</code>, 24h new-player grace (keep inventory + <code>/rtp</code>), wilderness warnings, MOTD.</li>
  <li><strong>1000 G map return grant</strong> (<code>/rootmc claim-return</code>, Discord link required). That program ended later in July.</li>
  <li><code>/cmdtest</code> onboarding up to 1000 G — also later disabled.</li>
  <li>Loans <code>max-cap-mode: min_both</code>; shops <code>/buy</code> rounding fix; embassy plots 100 G.</li>
  <li>Draft constitution <code>2026-07-02</code>; Discord <code>#constitution</code>, <code>#governance</code>, <code>#voting</code>.</li>
</ul>
<p>Those Discord posts are the ancestor of this blog. Player Discord is quieter now (morning boot only); the durable record is here and on the wiki.</p>
""",
    },
    {
        "slug": "fresh-map",
        "date": "2026-07-01",
        "title": "Public open on a fresh Paper 26.2 map",
        "teaser": "Wallets and Discord links kept. Plots and geography reset. Ledger floor 1 Jul 2026 00:00 HST. Land was still Towny.",
        "body": """
<p>1 Jul 2026 is the full public open of modern RootMC on a fresh overworld at <code>play.rootmc.net</code>.</p>
<p><strong>Kept:</strong> wallets, land org/banks, mcMMO, Discord links, closed-loop Reserve policy.</p>
<p><strong>Reset:</strong> plots, homes, geography. BlueMap re-rendered. Inventories were not copied by default.</p>
<p>June Reserve closed at 2,097.43 G; June dividend returned 1,048.72 G; true opening about 1,048.71 G. Ledger floor is <strong>1 Jul 2026 00:00 HST</strong>.</p>
<p>Land at this launch was still Towny. Live land today is Root-Claims. Mesa/badlands territories as a feature were removed (root-territories 1.2.9). Read the map note: <a href="/wiki/map-26-2/">Paper 26.2 map reset</a>.</p>
""",
    },
    {
        "slug": "june-economy",
        "date": "2026-06-28",
        "title": "Discord Gold, rank prices, loans, death tax",
        "teaser": "Linked Discord activity pays 20 G. Rank ladder cut. Loans cap to rank. 10% PvP death fee. Weekly awards and BlueMap mesa fix.",
        "body": """
<p>The last days of June tightened the economy before the July map.</p>
<p><strong>28 Jun — rootmc 1.3.29.</strong> Linked players earn 20 G from the Server Reserve for Discord guild activity (12h cooldown). Vote rewards route through depositIncome / the loan income sweep. Towny founding tags: 400 G town / 2,000 G nation (Towny is no longer live land).</p>
<p><strong>29 Jun.</strong> Rank prices lowered (Wanderer 500 G through Champion 150,000 G). root-loans 1.0.8: borrow cap = purchased rank price; default max 100 G. PvP death fee 10% of victim balance (40% Reserve / 60% killer). Wiki tax tables and <code>/market/</code> rewrite fix.</p>
<p><strong>30 Jun.</strong> Weekly awards reliability (force-repost, Discord 2k-char split). root-territories 1.2.8 BlueMap mesa outline fix.</p>
""",
    },
    {
        "slug": "changelog-discipline",
        "date": "2026-06-27",
        "title": "Workspace split and changelog discipline",
        "teaser": "Sources leave the Root Record monorepo. Change Logs/ becomes the server-wide history. Shop catalog syncs to D1.",
        "body": """
<p>27 Jun 2026 RootMC sources moved out of the Root Record monorepo into a RootMC workspace. <code>Change Logs/</code> started tracking server-wide and per-plugin history — the files this blog is built from.</p>
<p>rootmc <strong>1.3.28</strong> synced the full shop catalog to D1 so <code>/market</code> stopped showing only recently touched shops. Baselines around that tag include shops 1.3.52, essentials 1.4.26, loans 1.0.7, ranks, help, rewards.</p>
<p>Root Record kept solar, Kīlauea, and business product. Minecraft stopped living as a folder inside that company tree. The two brands still share Ava; they no longer share one changelog.</p>
""",
    },
    {
        "slug": "brand-public",
        "date": "2026-06-19",
        "title": "rootmc.net goes public",
        "teaser": "Domain registered 19 Jun 2026 11:21:53 UTC. Soft open: first towns, spawn, Minecraft-MP, api.rootmc.net.",
        "body": """
<p><code>rootmc.net</code> was registered <strong>19 Jun 2026 11:21:53 UTC</strong>. That is the public brand anchor for modern RootMC — not the 2015 Root3287 effort, not AdvancedCraft Bedrock, not third-party <code>rootmc.online</code>.</p>
<p>The following week was a soft open: staff towns and spawn, a Minecraft-MP listing, Root* plugins, <code>api.rootmc.net</code>, Discord. Early Shockbyte ops were already on a Paper 26.1.x line. Towns that later appear on the June ledger include A_Town, Aquroya, Gas_Station, Montania, Moreni, RD, bestopolis, with nation Althaea.</p>
<p>That geography did not survive the 1 Jul fresh map. The domain did.</p>
""",
    },
    {
        "slug": "private-build",
        "date": "2026-05",
        "title": "Private build: Paper, Gold, Towny experiment",
        "teaser": "Alexrs94 starts the modern Java stack before the domain exists. Closed-loop Gold from day one.",
        "body": """
<p>Around May 2026 Alexrs94 started the modern Java / Paper stack in private: closed-loop Gold, a Towny land experiment, plugins, API, Discord — assembled before <code>rootmc.net</code> existed.</p>
<p>This is a different project from older uses of the RootMC name (2015 web/plugin work, 2020 AdvancedCraft Bedrock). No shared runtime from those stacks into the current server. The <a href="/history/">history page</a> keeps those lineages in their own section so search results do not rewrite the live server.</p>
<p>Everything after 19 Jun 2026 is the public era. Everything after 8 Aug 2026 is Age of Ava on Root-Claims. This post is the floor under both.</p>
""",
    },
]


def article_html(post: dict, prev_p: dict | None, next_p: dict | None) -> str:
    nav = ['<p class="rmc-muted" style="margin-top:2rem">']
    bits = ['<a href="/blog/">All updates</a>']
    if prev_p:
        bits.append(f'<a href="/blog/{prev_p["slug"]}/">← {prev_p["title"]}</a>')
    if next_p:
        bits.append(f'<a href="/blog/{next_p["slug"]}/">{next_p["title"]} →</a>')
    nav.append(" · ".join(bits))
    nav.append("</p>")
    return (
        HEAD.format(
            title=post["title"],
            description=post["teaser"],
            canonical=post["slug"] + "/",
        )
        + f"""
  <main class="container rmc-section">
    <p class="wiki-breadcrumb"><a href="/">Home</a> · <a href="/blog/">Updates</a> · {post["date"]}</p>
    <p class="market-badge">Minecraft update</p>
    <h1 class="wiki-page-title">{post["title"]}</h1>
    <p class="rmc-lead" style="margin:0 0 1.25rem;max-width:48rem;">{post["teaser"]}</p>
    <div class="wiki-badge-row">
      <span class="wiki-badge wiki-badge-server">{post["date"]}</span>
      <span class="wiki-badge wiki-badge-player">RootMC</span>
    </div>
    <div class="wiki-content" style="margin-top:1.5rem;max-width:48rem">
      {post["body"]}
      {''.join(nav)}
    </div>
  </main>
"""
        + FOOT
    )


def index_html() -> str:
    cards = []
    for p in POSTS:
        cards.append(
            f"""
    <article class="wiki-hub-card" style="margin-bottom:1rem">
      <span class="wiki-badge wiki-badge-server">{p["date"]}</span>
      <h2 style="margin:.65rem 0 .35rem;font-family:var(--rmc-font-display);font-size:1.35rem;"><a href="/blog/{p["slug"]}/" style="color:inherit;text-decoration:none">{p["title"]}</a></h2>
      <p class="rmc-muted" style="margin:0">{p["teaser"]} <a href="/blog/{p["slug"]}/">Read</a></p>
    </article>"""
        )
    return (
        HEAD.format(
            title="Updates",
            description="Minecraft updates from RootMC — patches, economy, claims, Age of Ava. Ava still talks when you ping her.",
            canonical="",
        )
        + """
  <main class="container rmc-section">
    <p class="wiki-breadcrumb"><a href="/">Home</a> · Updates</p>
    <p class="market-badge">Minecraft blog</p>
    <h1 class="wiki-page-title">RootMC <em>Updates</em></h1>
    <p class="rmc-lead" style="margin:0 0 1.5rem;max-width:48rem;">Patches, economy, claims, votes — May 2026 through Age of Ava. Real-world product notes live on <a href="https://rootrecord.online/blog">rootrecord.online/blog</a>. Ava platform notes on <a href="https://avaivy.cloud/blog">avaivy.cloud/blog</a>.</p>
"""
        + "\n".join(cards)
        + CHAT
        + FOOT
    )


def redirects() -> str:
    lines = []
    for p in POSTS:
        s = p["slug"]
        lines.append(f"/blog/{s}                 /blog/{s}/index.html  200")
        lines.append(f"/blog/{s}/                /blog/{s}/index.html  200")
    return "\n".join(lines) + "\n"


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    (ROOT / "index.html").write_text(index_html(), encoding="utf-8")
    n = len(POSTS)
    for i, post in enumerate(POSTS):
        prev_p = POSTS[i + 1] if i + 1 < n else None  # older
        next_p = POSTS[i - 1] if i > 0 else None  # newer
        d = ROOT / post["slug"]
        d.mkdir(parents=True, exist_ok=True)
        (d / "index.html").write_text(article_html(post, prev_p, next_p), encoding="utf-8")
    marker = ROOT / "_redirects.fragment"
    marker.write_text(redirects(), encoding="utf-8")
    print(f"Wrote {n} articles + index under {ROOT}")


if __name__ == "__main__":
    main()
