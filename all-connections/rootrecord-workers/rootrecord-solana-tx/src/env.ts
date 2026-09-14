import type { D1Database } from "@cloudflare/workers-types";

/** Bindings for treasury Raydium maintenance + Discord → `developer_messages` sync. */
export interface SolanaTxEnv {
  DB: D1Database;
  RR_PUSH_ADMIN_SECRET?: string;
  SOLANA_RPC_URL?: string;
  /** Secret signer for Root Record Global Updater mint/treasury transaction creation. */
  ROOT_RECORD_GLOBAL_UPDATER_SECRET_KEY_B58?: string;
  /** Public wallet guard for the Root Record Global Updater signer. */
  ROOT_RECORD_GLOBAL_UPDATER_PUBKEY?: string;
  /** Official ROOTS SPL mint used by Discord `/mint` and Root Economy backing. */
  ROOTS_MINT_BASE58?: string;
  ROOTS_DECIMALS?: string;
  RRTT_MINT_BASE58?: string;
  RRTT_DECIMALS?: string;
  RRESERVE_MINT_BASE58?: string;
  TREASURY_LIQ_MIN_RRTT_UI?: string;
  TREASURY_LIQ_MIN_RRESERVE_UI?: string;
  TREASURY_MAINTENANCE_SOURCE_SECRET_KEY_B58?: string;
  TREASURY_CP_MM_POOL_ID?: string;
  TREASURY_SOL_CP_POOL_ID?: string;
  TREASURY_MIN_SOL_UI?: string;
  DISCORD_WEBHOOK_SOLANA_TOOLS?: string;
  DISCORD_BOT_TOKEN?: string;
  DISCORD_ANNOUNCEMENTS_CHANNEL_ID?: string;
}
