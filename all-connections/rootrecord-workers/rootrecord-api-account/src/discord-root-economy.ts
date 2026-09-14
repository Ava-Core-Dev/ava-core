import type { ExecutionContext } from "@cloudflare/workers-types";

import { handleDiscordEconomyCommandInteractions, type DiscordRootUnitsEnv } from "./discord-root-units";

export type DiscordEconomyEnv = DiscordRootUnitsEnv & {
  /** Root Economy Discord application public key (hex). */
  DISCORD_ECONOMY_PUBLIC_KEY?: string;
  /** Root Economy bot token (`wrangler secret put DISCORD_ECONOMY_BOT_TOKEN`). */
  DISCORD_ECONOMY_BOT_TOKEN?: string;
  /** Root Economy application id. */
  DISCORD_ECONOMY_CLIENT_ID?: string;
};

/** Map economy-bot secrets onto fields used by shared command handlers. */
export function mapDiscordEconomyEnv(env: DiscordEconomyEnv): DiscordRootUnitsEnv {
  const token = String(env.DISCORD_ECONOMY_BOT_TOKEN || env.DISCORD_BOT_TOKEN || "")
    .replace(/^bot\s+/i, "")
    .trim();
  const publicKey = String(env.DISCORD_ECONOMY_PUBLIC_KEY || "").trim();
  const clientId = String(env.DISCORD_ECONOMY_CLIENT_ID || "").trim();
  return {
    ...env,
    DISCORD_BOT_TOKEN: token || env.DISCORD_BOT_TOKEN,
    DISCORD_PUBLIC_KEY: publicKey || env.DISCORD_PUBLIC_KEY,
    DISCORD_CLIENT_ID: clientId || env.DISCORD_CLIENT_ID,
  };
}

/** Root Economy bot — `/bal`, `/send`, dev tools, dice, etc. (not `/root`). */
export async function handleDiscordEconomyInteractions(
  request: Request,
  env: DiscordEconomyEnv,
  ctx?: ExecutionContext,
): Promise<Response> {
  const mapped = mapDiscordEconomyEnv(env);
  const pk = String(mapped.DISCORD_PUBLIC_KEY || "").trim();
  if (!pk) {
    return new Response(JSON.stringify({ detail: "DISCORD_ECONOMY_PUBLIC_KEY is not set on this Worker." }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  return handleDiscordEconomyCommandInteractions(request, mapped, ctx);
}
