import { json } from "./cors";
import { requireSignedInAccount, str } from "./realm-lib";
import { shopListingsForPlayer } from "./rootmc-economy";
import { FEATURED_SERVER_DEFAULTS } from "./rootmc-server";
import type { RootStatEnv } from "./rootstat-minecraft";

export async function handleRootMcTownyFacing(
  request: Request,
  env: RootStatEnv,
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (method !== "GET" || subpath !== "/rootmc/towny/me") return null;

  const auth = await requireSignedInAccount(request, env);
  if (auth instanceof Response) return auth;

  const url = new URL(request.url);
  const serverId = str(url.searchParams.get("server_id")) || FEATURED_SERVER_DEFAULTS.server_id;

  const link = await env.DB.prepare(
    `SELECT minecraft_uuid, minecraft_username FROM rootstat_minecraft_links WHERE account_id = ? LIMIT 1`,
  )
    .bind(auth.accountId)
    .first<{ minecraft_uuid: string; minecraft_username: string | null }>();

  if (!link?.minecraft_uuid) {
    return json({
      server_id: serverId,
      minecraft_linked: false,
      is_mayor: false,
      town: null,
    });
  }

  const uuid = str(link.minecraft_uuid);
  const username = link.minecraft_username ? str(link.minecraft_username) : null;

  const town = await env.DB.prepare(
    `SELECT town_uuid, town_name, mayor_uuid, mayor_name, resident_count, nation_uuid, nation_name,
            is_capital, is_active, synced_at
     FROM rootmc_towny_towns
     WHERE server_id = ? AND LOWER(mayor_uuid) = LOWER(?) AND is_active = 1
     LIMIT 1`,
  )
    .bind(serverId, uuid)
    .first<Record<string, unknown>>();

  if (!town) {
    return json({
      server_id: serverId,
      minecraft_linked: true,
      minecraft_uuid: uuid,
      minecraft_username: username,
      is_mayor: false,
      town: null,
    });
  }

  const townUuid = str(town.town_uuid);
  const channel = await env.DB.prepare(
    `SELECT channel_id, invite_url, status FROM rootmc_discord_town_channels
     WHERE server_id = ? AND town_uuid = ? LIMIT 1`,
  )
    .bind(serverId, townUuid)
    .first<{ channel_id: string; invite_url: string | null; status: string }>();

  const listings = await shopListingsForPlayer(env.DB, serverId, uuid, 24);
  const sellListings = listings.filter((l) => str(l.listing_type) === "sell");

  return json({
    server_id: serverId,
    minecraft_linked: true,
    minecraft_uuid: uuid,
    minecraft_username: username,
    is_mayor: true,
    town: {
      town_uuid: townUuid,
      town_name: str(town.town_name),
      mayor_name: town.mayor_name ? str(town.mayor_name) : username,
      resident_count: Number(town.resident_count) || 0,
      nation_uuid: town.nation_uuid ? str(town.nation_uuid) : null,
      nation_name: town.nation_name ? str(town.nation_name) : null,
      is_capital: Number(town.is_capital) === 1,
      synced_at: town.synced_at ? str(town.synced_at) : null,
      discord_channel_id: channel?.channel_id ? str(channel.channel_id) : null,
      discord_invite_url: channel?.invite_url ? str(channel.invite_url) : null,
      shop_listing_count: sellListings.length,
      shop_listings: sellListings.slice(0, 12),
    },
  });
}
