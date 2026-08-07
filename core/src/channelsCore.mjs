/**
 * Hard-programmed Ava-core surface map (Pacific Root Server = this Linux host).
 * SSD home — no /mnt/e runtime dependency.
 */
export const AVA_CORE_HOST = {
  label: "HI Pacific Solar Root Server",
  home: "/home/ava-core/ava",
  handoff: "/home/ava-core/ava",
  workspace: "/home/ava-core/ava/workstations/rootmc",
  code: "/home/ava-core/ava/core",
  plugins: "/home/ava-core/ava/workstations/plugins",
  apps: "/home/ava-core/ava/workstations/apps",
  envFile: "/home/ava-core/ava/.env",
  publicHome: "https://ava.rootmc.net/",
  publicOrigin: "https://ava-origin.rootmc.net/",
  localHttp: "http://127.0.0.1:8787/",
  ollama: "http://127.0.0.1:11434",
  bindDefault: "0.0.0.0",
  portDefault: 8787,
};

export const AVA_CORE_IDS = {
  guild: "1516108585740800042",
  avaBot: "1532751879875072070",
  alexDiscord: "1497037418979786823",
  meleeDiscord: "154446475789729792",
  alexTelegram: "6644482344",
  alexSlack: "U0BLWBTGYTU",
  storeySlack: "U0BLQ5Q8WTD",
  avaSlackBot: "U0BMBNYPYA2",
  zuppaNeverMention: "788153722198294618",
};

export const AVA_CORE_DISCORD = {
  rules: "1516392367869919243",
  admins: "1516121832493678612",
  general: "1516108586307158088",
  ingameChat: "1516706598519832677",
  updates: "1520665313631408251",
  unverified: "1519249871326937138",
  timezoneSelector: "1516453333047574558",
  memesMedia: "1516389376198840421",
  avaMedia: "1533268458668687392",
  constitution: "1522406019152478210",
  governance: "1522406451413385317",
  voting: "1522413185364398090",
  mobileApp: "1516178360815059045",
  randomFacts: "1531432703675596942",
  development: "1532929974154166522",
  musicController: "1516697007639498792",
  solarServer: "1533915343766949949",
  dailySummary: "1516395175780286615",
  economyInfo: "1516804780884889621",
  proposals: "1526664180491358419",
  home: "1516121832493678612",
  voiceLobby: "1516108586307158091",
  catVoice: "1516108586307158090",
};

export const AVA_CORE_DISCORD_LABELS = {
  "1516392367869919243": "rules",
  "1516121832493678612": "admins",
  "1516108586307158088": "general",
  "1516706598519832677": "ingame-chat",
  "1520665313631408251": "updates",
  "1519249871326937138": "unverified",
  "1516453333047574558": "timezone-selector",
  "1516389376198840421": "memes-and-media",
  "1533268458668687392": "ava-media",
  "1522406019152478210": "constitution",
  "1522406451413385317": "governance",
  "1522413185364398090": "voting",
  "1516178360815059045": "mobile-app",
  "1531432703675596942": "random-facts",
  "1532929974154166522": "development",
  "1516697007639498792": "music-controller",
  "1533915343766949949": "solar-server",
  "1516395175780286615": "daily-summary",
  "1516804780884889621": "economy-info",
  "1526664180491358419": "proposals",
};

export const AVA_CORE_SLACK = {
  watch: {
    developmentFeed: "C0BMCPMDDQR",
    pluginPlans: "C0BM4P3GVDX",
    generalChat: "C0BMDLAS5QS",
  },
  all: {
    generalChat: "C0BMDLAS5QS",
    allRootmc: "C0BLWBTUCR0",
    apiDescription: "C0BM6HN0WMA",
    automatedReports: "C0BM6KVFS0L",
    cronsAutomation: "C0BLMHKTCTH",
    decisions: "C0BLYV4SA6M",
    developmentFeed: "C0BMCPMDDQR",
    discordChannels: "C0BM4QT5U0Z",
    feedback: "C0BLMGBVAMD",
    newChannel: "C0BLQ5C342F",
    pluginPlans: "C0BM4P3GVDX",
    opsFeed: "C0BLV24TVP0",
    overview: "C0BM4B4RT8S",
    pluginSales: "C0BLZCVAC3X",
    plugins: "C0BLTNDJB4M",
    serverLogs: "C0BMX0QKSTS",
    serverReports: "C0BLY49H13M",
    shockbyteStatus: "C0BMRPDUH0Q",
    social: "C0BLT3B9RQV",
    workLog: "C0BM0N1MUJY",
  },
};

export const AVA_CORE_TELEGRAM = {
  alexDm: "6644482344",
  groups: {
    fernForestOps: "-1003868178598",
  },
};

export function avaCoreDiscordWatchList() {
  return [
    AVA_CORE_DISCORD.proposals,
    AVA_CORE_DISCORD.admins,
    AVA_CORE_DISCORD.general,
    AVA_CORE_DISCORD.governance,
    AVA_CORE_DISCORD.voting,
    AVA_CORE_DISCORD.constitution,
    AVA_CORE_DISCORD.memesMedia,
    AVA_CORE_DISCORD.development,
    AVA_CORE_DISCORD.updates,
    AVA_CORE_DISCORD.solarServer,
  ];
}

export function avaCoreSlackWatchList() {
  return Object.values(AVA_CORE_SLACK.watch);
}

export function avaCoreDiscordAllIds() {
  return Object.keys(AVA_CORE_DISCORD_LABELS);
}

export function avaCoreSlackAllIds() {
  return Object.values(AVA_CORE_SLACK.all);
}
