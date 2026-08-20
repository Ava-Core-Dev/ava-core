export type BlogPost = {
  slug: string;
  date: string;
  title: string;
  teaser: string;
  brand: "Root Record" | "Ava" | "RootMC";
  paragraphs: string[];
  bullets?: string[];
  after?: string[];
};

/** Newest first. Dates only from changelogs, Goals notes, archives, and public announcements. */
export const POSTS: BlogPost[] = [
  {
    slug: "this-blog",
    date: "2026-08-19",
    title: "This blog is the real-world stream",
    teaser:
      "Solar, Kīlauea, Goals, business ops. Minecraft has its own changelog. Ava has her own runtime notes.",
    brand: "Root Record",
    paragraphs: [
      "Root Record is the real-world product line: ground-mounted solar, EcoFlow host power, Hawaiʻi weather, Kīlauea briefs, Goals, and business apps. This page is that changelog.",
    ],
    bullets: [
      "rootrecord.online/blog — solar, volcano, Goals, business, status boards.",
      "rootmc.net/blog — Minecraft: Gold, Root-Claims, votes, the map.",
      "avaivy.cloud/blog — Ava Ivy: desk, login, Discord policy, in-world name.",
    ],
    after: [
      "rootrecord.info remains the wiki and Ava atlas. rootrecord.online is the live dashboard and this blog. g.rootrecord.info is Goals. Mixing those hostnames is how you get the wrong product.",
      "This series backfills every substantiated beat we can date. Days that were never written down are not invented.",
    ],
  },
  {
    slug: "quiet-discord",
    date: "2026-08-19",
    title: "Ops reports stay off player Discord",
    teaser:
      "Solar, Kīlauea, and business briefs go to Slack and staff. Players keep Ava's morning boot report in #updates.",
    brand: "Ava",
    paragraphs: [
      "Ava used to pour Root Record mornings into the Minecraft guild: solar tables, NWS, HVO, economy. Honest, and too loud for survival Discord.",
      "Policy now: player Discord gets the morning boot report in #updates. Ava still answers pings. Product, solar, volcano, and business copy land here and in Slack — not in the player channel.",
      "Kīlauea briefs stay Hawaiʻi-scoped. Charts stay on rootrecord.online. Minecraft patches stay on rootmc.net/blog.",
    ],
  },
  {
    slug: "panels-and-banners",
    date: "2026-08-19",
    title: "Panels off the roof; disruption banners on the sites",
    teaser:
      "Ground-mounted PV only as of 19 Aug 2026 HST. EcoFlow is the live watts source. Service-disruption banners can show on Root Record and RootMC.",
    brand: "Root Record",
    paragraphs: [
      "Identity note dated 19 Aug 2026 HST: arrays are ground-mounted. Panels came off the roof. EcoFlow remains the live watts feed the dashboard and the game both read.",
      "The same day the public atlas records disruption banners: Ava can raise a service-disruption flag from the desk; RootMC pages pull the banner script from the Root Record / Ava asset path. When the host is in a window, the sites say so instead of pretending the array is fine.",
      "Live tiles on this domain: Root Server status, solar, Kīlauea / USGS, NOAA weather, Minecraft presence. That is the product surface. The blog is the dated memory.",
    ],
  },
  {
    slug: "desk-online",
    date: "2026-08-18",
    title: "Desk origin, .online APIs, solar host",
    teaser:
      "Ava's FastAPI brain on the SSD. Kīlauea and real-life APIs named api.rootrecord.online. Host-power is already in the game.",
    brand: "Ava",
    paragraphs: [
      "18 Aug 2026 the desk cutover that the live dashboard depends on: Python FastAPI as origin, old Node origin retired, local Ollama for offline digest, heartbeat into Cloudflare D1 so status boards can say the host is up.",
    ],
    bullets: [
      "Public names stay split: Ava, RootMC, Root Record. Do not point Minecraft plugins at the Ava origin.",
      "Kīlauea / real-life traffic is aimed at api.rootrecord.online. Android Kīlauea retarget notes sit in the same session.",
      "A 301 from rootrecord.info to .online is coded for when that zone lives on the current Cloudflare account. Until then, .info is still the wiki/atlas.",
      "Host-power — battery, CPU, solar — is what RootMC players already feel as mining multipliers and tax.",
    ],
    after: [
      "Ava's writeup: avaivy.cloud/blog/desk-host/. Game writeup: rootmc.net/blog/age-of-ava/.",
    ],
  },
  {
    slug: "magmaalert",
    date: "2026-08-16",
    title: "MagmaAlert pack in the archive",
    teaser:
      "Consumer Kīlauea surface: MagmaAlert 1.10 APKs and web assets dated 16 Aug. Ava runs reports. She is not the volcano app.",
    brand: "Root Record",
    paragraphs: [
      "The 16 Aug 2026 archive holds MagmaAlert APKs and web assets — package com.magmaalert.app, display MagmaAlert, version 1.10.",
      "That sits beside the Root Record Kīlauea Alerts line (com.rootrecord.kilauea), whose web companion has been moving toward rootrecord.online from the older kilauea.rootrecord.info shard.",
      "Ava runs HVO/NWS briefs and the solar desk. Root Record ships the consumer app. Those are two jobs. Minecraft players do not need an APK to see host-power Gold.",
    ],
  },
  {
    slug: "kilauea-briefs",
    date: "2026-08",
    title: "Hawaiʻi-scoped Kīlauea briefs",
    teaser:
      "AI hazard copy stays on Kīlauea, Hawaiʻi Island, and Hawaiʻi-relevant alerts. Mainland observatory weeklies stay out unless the Pacific is actually in it.",
    brand: "Root Record",
    paragraphs: [
      "Root Record's Kīlauea report refinement is the editorial rule for this blog and the status tiles:",
    ],
    bullets: [
      "Hazard briefs are scoped to Kīlauea, Hawaiʻi Island, and Hawaiʻi-relevant products.",
      "Official social feeds are filtered before writing.",
      "Routine mainland observatory weeklies are dropped unless they are massive, life-threatening, or tsunami for the Pacific / Hawaiʻi.",
      "USGS / HVO notices, NWS Hawaiʻi, Big Island quakes, and tsunami products stay.",
      "Charts and archive point at rootrecord.online (Big Island earthquakes), not player Discord.",
    ],
    after: [
      "This is why volcano copy lives here instead of in #updates. The Minecraft guild is not an HVO mailing list.",
    ],
  },
  {
    slug: "goals-priority",
    date: "2026-08-11",
    title: "Goals board, and Kīlauea Alerts as the priority app",
    teaser:
      "Ava owns Goals and allocation — not player Gold. Kīlauea Alerts is the homepage growth app; Weather Manager is second.",
    brand: "Root Record",
    paragraphs: [
      "11 Aug 2026 Goals notes lock the portfolio: Ava owns Goals, allocation, and independence lanes. Player Gold does not fund that board.",
    ],
    bullets: [
      "Public Goals: g.rootrecord.info, this site's /goals UI, Ava status/goals. API on the Goals Worker.",
      "Kīlauea Alerts is the priority Root Record consumer app for homepage and growth.",
      "Weather Manager is secondary in hero order. Business Manager and Account Hub stay in the same family.",
    ],
    after: [
      "If you came here from Minecraft Pro or Vote Shards, that is a different wallet. Goals is Root Record. Gold is RootMC.",
    ],
  },
  {
    slug: "director",
    date: "2026-08-09",
    title: "Ava as Director of Resources",
    teaser:
      "Goals audit marked Active 9 Aug 2026. Public finance board named. Merged mornings start the same window.",
    brand: "Ava",
    paragraphs: [
      "On 9 Aug 2026 Ava's Goals list marks Director of Resources — Root Record audit as Active. That is the real-world helm title, next to lead developer on the Minecraft constitution.",
      "The public finance / Goals surfaces are named on the Ava board. Allocation is not a Discord poll and not a Gold sink.",
      "The same window starts five merged mornings: player census, Root-Economy, solar/host, NWS, HVO Kīlauea. Example 9 Aug: EcoFlow state of charge, NWS, HVO ADVISORY/YELLOW, economy snapshot. That pulse later left player Discord. The numbers still land here.",
    ],
  },
  {
    slug: "morning-pulse",
    date: "2026-08-09",
    title: "Five mornings of solar, weather, and HVO",
    teaser:
      "9–13 Aug: merged briefs as the Root Server pulse. Full copies now belong on this blog and Slack, not in the guild.",
    brand: "Root Record",
    paragraphs: [
      "Dated merged-morning files run 9 Aug through 13 Aug 2026. Each mixes Minecraft census with Root Record solar, NOAA weather, and HVO Kīlauea. Hourly solar-weather reports accumulate in the same archive.",
      "That was the public pulse of the desk. After the quiet-Discord policy, players keep a boot report. The long weather and volcano record is this site.",
    ],
  },
  {
    slug: "host-power-gold",
    date: "2026-08-08",
    title: "Host-power Gold: battery, CPU, solar",
    teaser:
      "Age of Ava made Root Record sensors player-visible. Mining and tax follow the desk, not a flavor number.",
    brand: "RootMC",
    paragraphs: [
      "8 Aug 2026 Discord #updates announced Age of Ava: one live map, Root-Claims, MOTD. The Root Record beat is the sensor coupling.",
    ],
    bullets: [
      "Battery, CPU, and solar change the mining multiplier and taxes. Players check /gold, /tax, /mint.",
      "Skills XP scales with solar watts — the same EcoFlow path as the dashboard.",
      "Desk power numbers are no longer ops-only. If the array is down, the game feels it.",
    ],
    after: [
      "Minecraft topology: rootmc.net/blog/age-of-ava/. Ava's voice: avaivy.cloud/blog/age-of-ava/.",
    ],
  },
  {
    slug: "note-keeper",
    date: "2026-08-05",
    title: "Quiet public voice; Root Record ops stay on the board",
    teaser:
      "Note-keeper lock: solar dumps off player rooms. Emergency pack already has Ava on Root Record status surfaces.",
    brand: "Ava",
    paragraphs: [
      "5 Aug 2026 operator lock: Ava logs for later digs instead of spraying every room. Solar and hardware tables stay off the Minecraft guild. Local core first. Tools are not her name.",
      "The emergency pack from that window already places her on Root Record ops surfaces and the status board. Players felt the Minecraft side on the 8th. The real-world board was already her job.",
    ],
  },
  {
    slug: "solar-gold",
    date: "2026-08-03",
    title: "Watts on the desk move Gold in the game",
    teaser:
      "Root-Economy 1.8.1 made the solar multiplier honest. A dead tunnel had been stuck at 1.0×.",
    brand: "RootMC",
    paragraphs: [
      "3 Aug 2026 Root-Economy 1.8.1 fixed the solar Gold multiplier so live host watts actually move in-game rates. The production solar-mining API has to win over a dead local tunnel — otherwise everyone sits at 1.0× and the dashboard is lying to the economy.",
      "That is a Root Record sensor feeding a RootMC rule. Skills XP later scaled the same way in the Age of Ava pack. We measure the array. The plugin applies it. Players feel mining and tax, not a weather speech in Discord.",
    ],
  },
  {
    slug: "ecoflow-status",
    date: "2026-07-31",
    title: "EcoFlow client and the public status page",
    teaser:
      "Desk runtime: EcoFlow, status, emergency stop. The watts path that later feeds Gold is operator-visible here first.",
    brand: "Ava",
    paragraphs: [
      "31 Jul 2026 runtime notes mark EcoFlow, the status page, and emergency stop done on the desk — the same window as Discord presence and the changelog channel.",
      "Solar and host telemetry are already operator-visible. The game coupling is still a week away. Grok is off the presence stack. Ava's writeup: avaivy.cloud/blog/desk-runtime/.",
    ],
  },
  {
    slug: "monorepo-export",
    date: "2026-07-08",
    title: "Product stack export without Minecraft",
    teaser:
      "Handoff of mobile, web, Workers, docs. Marketing site is rootrecord.info. RootMC is already a separate workspace.",
    brand: "Root Record",
    paragraphs: [
      "8 Jul 2026 handoff export of the Root Record product stack: mobile apps, web apps, Cloudflare Workers, docs, Solana site. The marketing site in that packet is rootrecord.info.",
      "Worker shards are already named: weather, business, account, token, kilauea, goals. RootMC plugin and API work is documented as a separate workspace — the 27 Jun split made real in an export bundle.",
    ],
  },
  {
    slug: "brands-split",
    date: "2026-06-27",
    title: "Minecraft leaves this monorepo",
    teaser:
      "RootMC takes Change Logs/. Solar, volcano, and business stay. Ava still sits on both. One changelog is over.",
    brand: "Root Record",
    paragraphs: [
      "27 Jun 2026 RootMC sources moved into their own workspace. Solar, Kīlauea, and business product stayed with Root Record. Ava still operates both brands. They no longer share a file tree or a changelog.",
      "Minecraft history from that split is reconstructed at rootmc.net/blog/changelog-discipline/. Real-world notes stay here.",
    ],
  },
  {
    slug: "what-we-are",
    date: "2026-05",
    title: "Root Record is the real-world brand",
    teaser:
      "Solar Root Server, data-center ops, consumer apps. Ava is the runtime. RootMC is the sibling network that later consumes our watts.",
    brand: "Root Record",
    paragraphs: [
      "Around May 2026 the modern dual-brand story is already in force: Root Record is the real-world / data-center line; RootMC is the Java server Alexrs94 is building in private; Ava Ivy is the solar Root Server that operates both.",
      "Status boards, crons, telemetry, and consumer apps (weather, business, Kīlauea) are Root Record jobs from the start of the public-era story. Character presentation is allowed. It never overrides honest power numbers.",
    ],
  },
  {
    slug: "product-downloads",
    date: "2026-04-24",
    title: "Public product download repos",
    teaser:
      "GitHub stamps 24 Apr 2026: Business Manager and Weather Manager downloads already publishing under RootRecord.",
    brand: "Root Record",
    paragraphs: [
      "24 Apr 2026 GitHub push stamps show Root Record already publishing consumer download repos: rootrecord-business-manager-download and rootrecord-weather-manager-download.",
      "The partner booklet in the Pre August packet names the same family: Kīlauea Alerts, Weather Manager, Business Manager, Account Hub. Later inventory (6 Aug) maps that GitHub account into the current engineering home.",
      "This is the oldest dated public product beat we are willing to print. Domain registration days for .info and .online are not in the sources we used, so they are not claimed here.",
    ],
  },
];

export function getPost(slug: string): BlogPost | undefined {
  return POSTS.find((p) => p.slug === slug);
}

export function neighbors(slug: string): { older?: BlogPost; newer?: BlogPost } {
  const i = POSTS.findIndex((p) => p.slug === slug);
  if (i < 0) return {};
  return {
    newer: i > 0 ? POSTS[i - 1] : undefined,
    older: i + 1 < POSTS.length ? POSTS[i + 1] : undefined,
  };
}
