import {
  ROOTMC_DISCORD_INVITE,
  ROOTMC_MAP_URL,
  ROOTMC_WIKI_COMMANDS,
  ROOTMC_WIKI_ECONOMY,
  ROOTMC_WIKI_PLAYER,
  siteUrl,
} from "./rootmc-site";
import { str } from "./realm-lib";

/** Canonical RootMC facts for in-game /ask  -  aligned with rootmc.net/wiki/player/ */
export function rootMcAskServerKnowledge(baseUrl: string): Record<string, unknown> {
  const wiki = `${baseUrl}/wiki/player/`;
  return {
    overview:
      "RootMC is a public survival SMP: Gold economy, Towny land, mcMMO skills, player chest shops (rootmc-shops), optional personal loans.",
    currency: {
      name: "Gold",
      symbol: "G",
      net_worth:
        "wallet + inventory value + shop stock qty x blended buy-side market reference (not your listing prices)",
      wallet: "spendable balance only (Vault / Root Essentials)",
    },
    towns: {
      plugin: "Towny",
      new_town_command: "/town new <name>",
      new_town_cost_gold: 400,
      claim_command: "/town claim",
      claim_note: "claims the chunk you stand in; cost scales per claim",
      deposit_command: "/town deposit <amount>",
      plot_claim_command: "/plot claim",
      map_command: "/towny map",
      invite_command: "/town invite <player>",
      daily_taxes: "none  -  no daily town or plot upkeep on RootMC",
      loan_hint: "short on gold? /loan take  -  personal loans from Server Reserve; 400 G typical for founding",
      wiki_anchor: `${wiki}#towny`,
    },
    nations: {
      note: "nations group towns; mayor/nation leader Discord channels auto-created",
      wiki_anchor: `${wiki}#towny`,
    },
    shops: {
      buy_command: "/buy <item> [amount]",
      sell_command: "/sell <item> [amount]",
      buy_cancel: "/buy cancel",
      sell_cancel: "/sell cancel",
      market_command: "/market",
      tied_prices:
        "/buy and /sell split across shops at the same best price; clicking a shop sign quotes that shop only",
      wiki_anchor: `${wiki}#shops`,
    },
    economy: {
      baltop: "/baltop players | towns | nations",
      reserve: "/reserve  -  Server Reserve treasury stats",
      pay: "/pay <player> <amount>",
      vote: "/vote  -  listing sites; 1-20 G per vote from Server Reserve",
      playtime_rewards: "/rewards  -  playtime milestone gold from Server Reserve",
      wiki: ROOTMC_WIKI_ECONOMY,
    },
    ranks: {
      command: "/rank",
      aliases: "/ranks, /rankup",
      note: "player track ranks purchased with Gold via LuckPerms",
      wiki_anchor: `${wiki}#commands`,
    },
    account: {
      link_command: "/link",
      verify_url: `${baseUrl}/verify`,
      discord: ROOTMC_DISCORD_INVITE,
      player_stats: `${baseUrl}/player/`,
      leaderboard: `${baseUrl}/leaderboard/`,
    },
    world: {
      spawn: "/spawn",
      map_url: ROOTMC_MAP_URL,
    },
    wiki: {
      player_guide: ROOTMC_WIKI_PLAYER,
      commands: ROOTMC_WIKI_COMMANDS,
      economy: ROOTMC_WIKI_ECONOMY,
    },
  };
}

export function rootMcAskWikiTopicLinks(baseUrl: string): Record<string, string> {
  const wiki = `${baseUrl}/wiki/player/`;
  return {
    towns_towny: `${wiki}#towny`,
    shops_buy_sell: `${wiki}#shops`,
    economy_gold: ROOTMC_WIKI_ECONOMY,
    commands_all: ROOTMC_WIKI_COMMANDS,
    loans: `${wiki}#loans`,
    link_verify: `${wiki}#link`,
    rewards_vote: `${wiki}#rewards`,
    player_guide: ROOTMC_WIKI_PLAYER,
    market: `${baseUrl}/market/`,
    reserve: `${baseUrl}/economy/#server-reserve`,
    leaderboard: `${baseUrl}/leaderboard/`,
    map: ROOTMC_MAP_URL,
    verify: `${baseUrl}/verify`,
  };
}

export function suggestAskWikiLink(question: string, baseUrl: string): string {
  const q = question.toLowerCase();
  const links = rootMcAskWikiTopicLinks(baseUrl);
  if (/\btown\b|\bnation\b|\bclaim\b|\bplot\b|\bmayor\b|\bresident\b/.test(q)) {
    return links.towns_towny;
  }
  if (/\bshop\b|\bbuy\b|\bsell\b|\bmarket\b|\blisting\b|\bstock\b/.test(q)) {
    return links.shops_buy_sell;
  }
  if (/\bloan\b|\bborrow\b/.test(q)) {
    return links.loans;
  }
  if (/\bvote\b|\breward\b|\bplaytime\b/.test(q)) {
    return links.rewards_vote;
  }
  if (/\brank\b|\brankup\b/.test(q)) {
    return links.commands_all;
  }
  if (/\bgold\b|\beconomy\b|\bnet worth\b|\bwallet\b|\bbaltop\b|\breserve\b|\btreasury\b/.test(q)) {
    return links.economy_gold;
  }
  if (/\blink\b|\bverify\b|\bdiscord\b|\baccount\b/.test(q)) {
    return links.link_verify;
  }
  if (/\bmap\b/.test(q)) {
    return links.map;
  }
  if (/\bcommand\b|\bhow do i\b|\bhow to\b/.test(q)) {
    return links.commands_all;
  }
  return links.player_guide;
}

export async function loadAskTownyContext(
  db: D1Database,
  serverId: string,
  uuid: string,
): Promise<Record<string, unknown>> {
  const mayorTown = await db
    .prepare(
      `SELECT town_name, resident_count, nation_name, is_capital
       FROM rootmc_towny_towns
       WHERE server_id = ? AND LOWER(mayor_uuid) = LOWER(?) AND is_active = 1
       LIMIT 1`,
    )
    .bind(serverId, uuid)
    .first<Record<string, unknown>>();

  const nationLead = await db
    .prepare(
      `SELECT nation_name, town_count
       FROM rootmc_towny_nations
       WHERE server_id = ? AND LOWER(leader_uuid) = LOWER(?) AND is_active = 1
       LIMIT 1`,
    )
    .bind(serverId, uuid)
    .first<Record<string, unknown>>();

  const townCount = await db
    .prepare(`SELECT COUNT(*) AS c FROM rootmc_towny_towns WHERE server_id = ? AND is_active = 1`)
    .bind(serverId)
    .first<{ c: number }>();

  const nationCount = await db
    .prepare(`SELECT COUNT(*) AS c FROM rootmc_towny_nations WHERE server_id = ? AND is_active = 1`)
    .bind(serverId)
    .first<{ c: number }>();

  const topTowns = await db
    .prepare(
      `SELECT town_name, mayor_name, resident_count, nation_name
       FROM rootmc_towny_towns WHERE server_id = ? AND is_active = 1
       ORDER BY resident_count DESC, town_name ASC LIMIT 5`,
    )
    .bind(serverId)
    .all<Record<string, unknown>>();

  return {
    you_are_mayor_of: mayorTown
      ? {
          town: str(mayorTown.town_name),
          residents: Number(mayorTown.resident_count) || 0,
          nation: str(mayorTown.nation_name) || null,
          is_capital: Boolean(mayorTown.is_capital),
        }
      : null,
    you_lead_nation: nationLead
      ? {
          nation: str(nationLead.nation_name),
          towns: Number(nationLead.town_count) || 0,
        }
      : null,
    server_totals: {
      active_towns: Number(townCount?.c) || 0,
      active_nations: Number(nationCount?.c) || 0,
    },
    top_towns_by_residents: (topTowns.results || []).map((row) => ({
      town: str(row.town_name),
      mayor: str(row.mayor_name) || "?",
      residents: Number(row.resident_count) || 0,
      nation: str(row.nation_name) || null,
    })),
  };
}

export function askWikiHintForQuestion(question: string, env?: { SITE_URL?: string }): string {
  const base = siteUrl(env);
  const link = suggestAskWikiLink(question, base);
  return `Prefer server_knowledge for commands and costs. If more detail is needed, set link_url to ${link}.`;
}
