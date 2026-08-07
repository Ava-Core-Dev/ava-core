/**
 * Canonical solar / host-site public links.
 * If https://ava.rootmc.net/solar (or the status host) does not connect → Root Server is offline.
 */

/** Discord #solar-server — HI Pacific Solar Root Server ops */
export const SOLAR_OPS_DISCORD_CHANNEL_ID =
  String(process.env.AVA_SOLAR_OPS_CHANNEL_ID || "").trim() ||
  "1533915343766949949";

export const SOLAR_OPS_DISCORD_URL = `https://discord.com/channels/1516108585740800042/${SOLAR_OPS_DISCORD_CHANNEL_ID}`;

export const SOLAR_LINKS = {
  website: "https://rootmc.net",
  avaCore: "https://ava.rootmc.net/",
  solar: "https://ava.rootmc.net/solar",
  status: "https://ava.rootmc.net/",
  health: "https://ava.rootmc.net/health",
  localSolar: "http://127.0.0.1:8787/solar",
  localStatus: "http://127.0.0.1:8787/",
  miningMultiplierApi:
    "https://api.rootmc.net/api/rootmc/solar-mining-multiplier",
  solarOpsDiscord: SOLAR_OPS_DISCORD_URL,
};

/** Hard rule — copy everywhere public that talks about the solar page. */
export const SOLAR_PAGE_OFFLINE_RULE =
  "If https://ava.rootmc.net/solar (or the Ava status host) does not connect, the Root Server is offline.";

/** Label lock: panel watts = solar input; integrated energy = kWh/Wh estimate (never call energy "solar"). */
export const SOLAR_LABEL_RULE =
  "Solar = panel input (W). Energy totals = Wh/kWh estimate from minute watts — not labeled solar.";

export function solarLinksFooterLines() {
  return [
    `**Solar board:** ${SOLAR_LINKS.solar}`,
    `**Website:** ${SOLAR_LINKS.website}`,
    `**Solar ops Discord:** ${SOLAR_LINKS.solarOpsDiscord}`,
    `_${SOLAR_PAGE_OFFLINE_RULE}_`,
  ];
}

export function publicSolarLinksPayload() {
  return {
    ...SOLAR_LINKS,
    offlineRule: SOLAR_PAGE_OFFLINE_RULE,
    labelRule: SOLAR_LABEL_RULE,
    solarOpsDiscordChannelId: SOLAR_OPS_DISCORD_CHANNEL_ID,
  };
}
