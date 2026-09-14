import { str } from "./realm-lib";

/** Towny closed_economy.server_account  -  not a player; exclude from leaderboards. */
export const TOWNY_SERVER_UUID = "a73f39b0-1b7c-2930-b4a3-ce101812d926";
export const TOWNY_SERVER_USERNAME = "towny-server";

export function isEconomySystemAccount(
  uuid: string,
  username?: string | null,
): boolean {
  const id = str(uuid).toLowerCase();
  if (id === TOWNY_SERVER_UUID) return true;
  const name = str(username).toLowerCase();
  if (name === TOWNY_SERVER_USERNAME) return true;
  if (name === "server-reserve" || name === "ava_ivy") return true;
  if (name.startsWith("town-") || name.startsWith("nation-") || name.startsWith("claim-")) return true;
  if (name === "player") return true;
  return false;
}

export const economySystemAccountSqlFilter = `
  AND LOWER(minecraft_username) <> '${TOWNY_SERVER_USERNAME}'
  AND LOWER(minecraft_uuid) <> '${TOWNY_SERVER_UUID}'
  AND LOWER(minecraft_username) NOT LIKE 'town-%'
  AND LOWER(minecraft_username) NOT LIKE 'nation-%'
  AND LOWER(minecraft_username) NOT LIKE 'claim-%'
  AND LOWER(minecraft_username) <> 'player'
  AND LOWER(minecraft_username) <> 'server-reserve'
`;
