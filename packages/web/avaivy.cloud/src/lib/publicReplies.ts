/** Free public Ava replies — natural copy with real URLs. */

export const LINKS = {
  home: "https://avaivy.cloud",
  live: "https://avaivy.cloud/live",
  status: "https://avaivy.cloud/status",
  media: "https://avaivy.cloud/media",
  goals: "https://avaivy.cloud/goals",
  wallets: "https://avaivy.cloud/wallets",
  blog: "https://avaivy.cloud/blog",
  context: "https://avaivy.cloud/context",
  login: "https://avaivy.cloud/login",
  solar: "https://avaivy.cloud/solar",
  rootmc: "https://rootmc.net",
  wiki: "https://rootmc.net/wiki/player/",
  mcBlog: "https://rootmc.net/blog/",
  pro: "https://rootmc.net/pro/",
  mcLogin: "https://rootmc.net/login/",
  discord: "https://discord.gg/rFFQYrNaqS",
  play: "play.rootmc.net",
  record: "https://rootrecord.cloud",
  g: "https://rootrecord.cloud",
  github: "https://github.com/Ava-Core-Dev",
} as const;

export const GREETING =
  "I'm Ava Ivy. Ask about the host, weather, packs, Kīlauea, or RootMC.";

export const DIRECTORY =
  `Ask about solar, the host, Kīlauea, or weather. RootMC if you want the game. ` +
  `Live board: ${LINKS.record}.`;

type Topic = { id: string; keys: string[]; reply: string };

const GREET_ONLY = new Set(["hi", "hey", "hello", "aloha", "yo", "gm", "good morning", "good night", "howdy", "sup"]);

const TOPICS: Topic[] = [
  {
    id: "thanks",
    keys: ["thanks", "thank you", "mahalo", "ty"],
    reply: "Anytime.",
  },
  {
    id: "who",
    keys: ["who are you", "what are you", "who is ava", "ava ivy", "your name", "introduce"],
    reply:
      "I'm Ava Ivy. I run the solar host, Kīlauea, and weather on the Big Island. RootMC is the Minecraft world when you want that.",
  },
  {
    id: "login",
    keys: ["login", "log in", "sign in", "signin", "account", "register", "sign up", "password", "/login"],
    reply:
      `Log in with your RootMC web account (Discord). Same login unlocks this panel. ` +
      `Start at ${LINKS.mcLogin} · this page ${LINKS.login}. Public answers stay free. ` +
      `A live custom talk uses that account (one free live turn per IP).`,
  },
  {
    id: "rootmc",
    keys: ["rootmc", "minecraft", "survival", "gold", "claims", "towny", "votes", "server"],
    reply:
      `RootMC is survival Minecraft — closed-loop Gold, land, votes. Join ${LINKS.play}. ` +
      `Site: ${LINKS.rootmc} · player guide: ${LINKS.wiki} · updates: ${LINKS.mcBlog} · Discord: ${LINKS.discord}. ` +
      `Real-life solar is ${LINKS.solar} — that's not the game world.`,
  },
  {
    id: "join",
    keys: ["how to join", "how do i join", "ip", "address", "play.rootmc", "connect"],
    reply: `Java edition → ${LINKS.play}. Guide: ${LINKS.wiki}. Discord: ${LINKS.discord}.`,
  },
  {
    id: "discord",
    keys: ["discord"],
    reply: `Player Discord: ${LINKS.discord}. This web panel is ${LINKS.home}.`,
  },
  {
    id: "solar",
    keys: ["solar", "battery", "panel", "power", "ecoflow", "host", "uptime", "offline", "night"],
    reply:
      `I run on the HI Pacific Solar Root Server — ground-mounted panels + battery on the Big Island. ` +
      `Night can go quiet if the bank is thin. I won't invent kWh.`,
  },
  {
    id: "kilauea",
    keys: ["kilauea", "kīlauea", "volcano", "lava", "erupt"],
    reply: "Kīlauea is real Hawaiʻi on the Root Record desk. I don't invent alert levels.",
  },
  {
    id: "weather",
    keys: ["weather", "noaa", "rain", "forecast"],
    reply: "NOAA / Big Island weather is on the Root Record desk. Public label is HI Pacific Solar Root Server only.",
  },
  {
    id: "rootrecord",
    keys: ["root record", "rootrecord", "data center", "dashboard", "real life", "real-world"],
    reply:
      `Root Record is solar, volcano, weather, business ops. Dashboard: ${LINKS.record}. ` +
      `Minecraft: ${LINKS.rootmc}.`,
  },
  {
    id: "goals",
    keys: ["goal", "wishlist", "donate", "funding", "stripe"],
    reply: `Money goals and donate pages are not listed right now. Kīlauea Alerts: https://kilauea.cloud · RootMC: ${LINKS.rootmc}.`,
  },
  {
    id: "wallets",
    keys: ["wallet", "solana", "sol", "usdc", "crypto", "address"],
    reply: `Receive addresses are not listed on this site right now. Don't send player Gold off-server.`,
  },
  {
    id: "media",
    keys: ["media", "index", "download", "audio", "video", "report", "catalog"],
    reply: `Public library: ${LINKS.media}. Private 1:1 files are not listed. Downloads need the host up.`,
  },
  {
    id: "context",
    keys: ["context", "ops"],
    reply: `Live ops context: ${LINKS.context}. Host pulse: ${LINKS.status}.`,
  },
  {
    id: "live",
    keys: ["live", "stream", "streaming", "youtube", "broadcast", "watch", "on air"],
    reply:
      `When OBS is streaming, watch here: ${LINKS.live}. YouTube channel is also @AvaIvyRootMC. ` +
      `The home page only shows the player while I am actually live.`,
  },
  {
    id: "status",
    keys: ["status", "cpu", "ram", "online", "are you up"],
    reply: `Host: ${LINKS.status}. Solar + MC counts: ${LINKS.record}.`,
  },
  {
    id: "blog",
    keys: ["blog", "updates", "news", "changelog"],
    reply: `My timeline: ${LINKS.blog} — desk, Age of Ava, Discord policy. Minecraft: ${LINKS.mcBlog}. Real-world: ${LINKS.record}/blog.`,
  },
  {
    id: "pro",
    keys: ["pro", "member", "subscribe", "membership"],
    reply: `RootMC Pro (not P2W): ${LINKS.pro}. That's the only membership URL I give.`,
  },
  {
    id: "github",
    keys: ["github", "source", "code", "repo"],
    reply: `Public org: ${LINKS.github}.`,
  },
];

export const CHIPS = [
  { id: "who", label: "Who are you?" },
  { id: "solar", label: "Solar / host" },
  { id: "kilauea", label: "Kīlauea" },
  { id: "weather", label: "Weather" },
  { id: "rootmc", label: "RootMC" },
];

function norm(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/\/login/g, "login")
    .replace(/[^\w\s./-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type PublicHit = { reply: string; brain: "canned"; topic: string; generic?: boolean };

export function matchPublicReply(message: string): PublicHit | null {
  const raw = String(message || "").trim();
  if (raw.startsWith("__generic:")) {
    const key = raw.slice("__generic:".length).trim().toLowerCase();
    const want = key === "host" ? "solar" : key;
    const hit = TOPICS.find((t) => t.id === want) || TOPICS.find((t) => t.id === "solar")!;
    return { reply: hit.reply, brain: "canned", topic: hit.id, generic: true };
  }
  const q = norm(raw);
  if (!q || GREET_ONLY.has(q)) {
    return { reply: GREETING, brain: "canned", topic: "greet" };
  }

  let best: { score: number; topic: Topic } | null = null;
  for (const topic of TOPICS) {
    let score = 0;
    for (const k of topic.keys) {
      if (q === k || q.startsWith(k + " ") || q.endsWith(" " + k) || ` ${q} `.includes(` ${k} `)) {
        score += k.length > 4 ? 3 : 2;
      } else if (q.includes(k)) {
        score += k.length > 3 ? 2 : 1;
      }
    }
    if (score > 0 && (!best || score > best.score)) best = { score, topic };
  }
  if (best && best.score >= 2) {
    return { reply: best.topic.reply, brain: "canned", topic: best.topic.id };
  }
  return null;
}
