/**
 * Canonical Ava / Root Record / RootMC links for the Ava Ivy console.
 */
export const AVA_LINK_GROUPS = [
  {
    id: "live",
    label: "Live boards",
    links: [
      {
        title: "Status / solar board",
        url: "https://rootrecord.info/ava/status",
        note: "Battery, solar, load, CPU, multiplier (connected 1+1%+1%/10% battery+1%/100W; offline 1.00× +1% env)",
      },
      {
        title: "Ava tunnel home",
        url: "https://ava.rootmc.net/",
        note: "Redirects to canonical status",
      },
      {
        title: "Solar (tunnel)",
        url: "https://ava.rootmc.net/solar",
        note: "Same board via Cloudflare tunnel",
      },
      {
        title: "Connections",
        url: "https://rootrecord.info/ava/status/connections",
        note: "Players · servers · app sessions",
      },
      {
        title: "Services",
        url: "https://rootrecord.info/ava/status/services",
        note: "Services panel",
      },
      {
        title: "Logs",
        url: "https://rootrecord.info/ava/logs",
        note: "Process activity · no message content",
      },
      {
        title: "Minecraft status",
        url: "https://rootrecord.info/ava/status/minecraft",
        note: "Paper test status only — console is in this app",
      },
      {
        title: "Economy board",
        url: "https://ava.rootmc.net/economy",
        note: "Live Root-Economy · wallets, ledger, gold, playtime",
      },
      {
        title: "Ava Finance",
        url: "https://ava.rootmc.net/finance",
        note: "Public ops expenses + optimal monthly budget",
      },
      {
        title: "Public files",
        url: "https://ava.rootmc.net/publicfiles/",
        note: "Download jars / APKs / AABs",
      },
      {
        title: "Health",
        url: "https://ava.rootmc.net/health",
        note: "JSON liveness",
      },
    ],
  },
  {
    id: "local",
    label: "Local OptiPlex",
    links: [
      {
        title: "Local status",
        url: "http://127.0.0.1:8787/",
        note: "HTTP home on this host",
      },
      {
        title: "Local solar",
        url: "http://127.0.0.1:8787/solar",
        note: "Direct board (no tunnel)",
      },
      {
        title: "Local finance",
        url: "http://127.0.0.1:8787/finance",
        note: "Public ops expenses board",
      },
      {
        title: "Local connections",
        url: "http://127.0.0.1:8787/connections",
      },
      {
        title: "Local services",
        url: "http://127.0.0.1:8787/services",
      },
      {
        title: "Local plugins API",
        url: "http://127.0.0.1:8787/api/plugins/status",
        note: "Private · Ava Client Release tab",
      },
      {
        title: "Local apps API",
        url: "http://127.0.0.1:8787/api/apps/status",
        note: "Private · Ava Client Release tab",
      },
      {
        title: "Local context",
        url: "http://127.0.0.1:8787/context",
        note: "AI pickup HTML",
      },
      {
        title: "LAN status",
        url: "http://192.168.1.62:8787/",
        note: "LAN reach to Ava HTTP",
      },
      {
        title: "phpMyAdmin",
        url: "https://ava.rootmc.net/phpmyadmin/",
        note: "Needs MySQL up on host",
      },
    ],
  },
  {
    id: "wiki",
    label: "Wiki & context",
    links: [
      {
        title: "Ava wiki hub",
        url: "https://rootrecord.info/ava/",
        note: "Human atlas",
      },
      {
        title: "AI context (HTML)",
        url: "https://rootrecord.info/ava/context",
        note: "Hand to any AI to resume Ava work",
      },
      {
        title: "AI context (markdown)",
        url: "https://rootrecord.info/ava/context.md",
      },
      {
        title: "Core",
        url: "https://rootrecord.info/ava/core.html",
      },
      {
        title: "Brains",
        url: "https://rootrecord.info/ava/brains.html",
      },
      {
        title: "Crons",
        url: "https://rootrecord.info/ava/crons.html",
      },
      {
        title: "Data",
        url: "https://rootrecord.info/ava/data.html",
      },
      {
        title: "Surfaces",
        url: "https://rootrecord.info/ava/surfaces.html",
      },
      {
        title: "Hosting",
        url: "https://rootrecord.info/ava/hosting.html",
      },
      {
        title: "RootMC (wiki)",
        url: "https://rootrecord.info/ava/rootmc.html",
      },
      {
        title: "Root Record (wiki)",
        url: "https://rootrecord.info/ava/root-record.html",
      },
      {
        title: "Glossary",
        url: "https://rootrecord.info/ava/glossary.html",
      },
    ],
  },
  {
    id: "products",
    label: "Root Record · RootMC",
    links: [
      {
        title: "Root Record",
        url: "https://rootrecord.info/",
        note: "Data center + ops software",
      },
      {
        title: "Account / sign in",
        url: "https://rootrecord.info/account",
      },
      {
        title: "Merged homepage + Ava chat",
        url: "https://merged.rootrecord.info/",
        note: "The Root bridge",
      },
      {
        title: "RootMC",
        url: "https://rootmc.net/",
        note: "Minecraft network site",
      },
      {
        title: "Play",
        url: "https://play.rootmc.net/",
        note: "Production join address",
      },
      {
        title: "RootMC wiki",
        url: "https://rootmc.net/wiki/",
      },
      {
        title: "RootMC API",
        url: "https://api.rootmc.net/",
      },
      {
        title: "Public files",
        url: "https://ava.rootmc.net/publicfiles/",
        note: "Jars / APKs / misc",
      },
    ],
  },
  {
    id: "api",
    label: "APIs",
    links: [
      {
        title: "Status API",
        url: "https://ava.rootmc.net/api/status",
      },
      {
        title: "Solar API",
        url: "https://ava.rootmc.net/api/solar",
      },
      {
        title: "Context API",
        url: "https://ava.rootmc.net/api/context",
      },
      {
        title: "Powered-by widget",
        url: "https://ava.rootmc.net/api/powered-by",
      },
      {
        title: "Open hours",
        url: "https://ava.rootmc.net/api/ava-hours",
      },
      {
        title: "Public chat (POST)",
        url: "https://ava.rootmc.net/api/public-chat",
        note: "Merge homepage chat endpoint",
      },
      {
        title: "Connections API",
        url: "https://rootrecord.info/ava/status/api/connections",
      },
      {
        title: "Solar mining multiplier",
        url: "https://api.rootmc.net/api/rootmc/solar-mining-multiplier",
        note: "Gold boost from bank SOC",
      },
    ],
  },
  {
    id: "community",
    label: "Community & code",
    links: [
      {
        title: "RootMC Discord invite",
        url: "https://discord.gg/rFFQYrNaqS",
      },
      {
        title: "Solar ops Discord channel",
        url: "https://discord.com/channels/1516108585740800042/1533915343766949949",
        note: "#solar-server",
      },
      {
        title: "Slack solar feed",
        url: "https://rootmcworkspace.slack.com/",
        note: "#solar-feed — copy of each Discord solar report",
      },
      {
        title: "Ava-Core-Dev on GitHub",
        url: "https://github.com/Ava-Core-Dev",
        note: "Engineering org going forward",
      },
    ],
  },
];

export function listAvaLinks() {
  return {
    ok: true,
    title: "Ava links",
    updatedAt: Date.now(),
    groups: AVA_LINK_GROUPS,
  };
}
