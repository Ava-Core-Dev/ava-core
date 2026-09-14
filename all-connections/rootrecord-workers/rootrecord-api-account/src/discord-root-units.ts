import type { D1Database, D1PreparedStatement, ExecutionContext } from "@cloudflare/workers-types";
import nacl from "tweetnacl";

import {
  readCustodialTokenSlots,
  syncCustodialTokenSlotsFromRpc,
  type CustodialTokenSlotRow,
} from "./custodial-wallet-token-slots";
import { transferRrttCustodialPeerViaTreasury } from "./discord-rrtt-peer-send";
import { transferSolCustodialPeerViaTreasury } from "./discord-sol-peer-send";
import type { InternalWalletEnv } from "./solana-internal-wallet";
import { buildEconomyDiscordMessage, leaderboardEntryLabel, loadEconomyLeaderboardData } from "./root-economy";
import {
  clampRootsSolSwapSlippageBps,
  executeRootsSolSwapForAccount,
  quoteRootsSolSwapForAccount,
} from "./roots-sol-swap";
import { MAX_ROOT_UNITS_PER_TRANSFER } from "../../shared/earn-program-constants";
import { formatRootsAtomicLocale, rootsWholeToAtomic } from "../../shared/roots-units";
import { loadEconomyDailySeries, readCirculationTotals } from "../../shared/root-economy-snapshot";
import { getFcmAccessToken, sendFcmNotification } from "./fcm-v1";

export type DiscordRootUnitsEnv = {
  DB: D1Database;
  JWT_SECRET: string;
  /** Application â€œPublic Keyâ€ from Discord Developer Portal (General Information). Hex string. */
  DISCORD_PUBLIC_KEY?: string;
  /** Application id (snowflake); used to PATCH deferred interaction responses. */
  DISCORD_CLIENT_ID?: string;
  /** Guild id for `/send role` member scan and account link. */
  DISCORD_GUILD_ID?: string;
  /** Max days for `/send active` lookback on `discord_user_activity.last_message_at` (default 14, max 90). */
  DISCORD_ACTIVE_LOOKBACK_DAYS?: string;
  /** Bot token (secret): `/send role` member scan; dice button flow. */
  DISCORD_BOT_TOKEN?: string;
  /** Role assigned after account-to-Discord linking succeeds. */
  DISCORD_VERIFIED_ROLE_ID?: string;
  DISCORD_LIFETIME_MEMBER_ROLE_ID?: string;
  DISCORD_MONTHLY_MEMBER_ROLE_ID?: string;
  RR_PUSH_ADMIN_SECRET?: string;
  ROOTRECORD_API_KILAUEA_URL?: string;
  DISCORD_KILAUEA_REPORT_CHANNEL_ID?: string;
  DISCORD_KILAUEA_AI_ARCHIVE_CHANNEL_ID?: string;
  /** Full Firebase service account JSON (one Wrangler secret). */
  FCM_SERVICE_ACCOUNT_JSON?: string;
  FCM_PROJECT_ID?: string;
  FCM_CLIENT_EMAIL?: string;
  FCM_PRIVATE_KEY?: string;
  ROOTRECORD_SOLANA_TX_URL?: string;
  /** Used by `/bal` to refresh `custodial_wallet_token_slots` from RPC (same as custodial routes). */
  SOLANA_RPC_URL?: string;
  RRTT_MINT_BASE58?: string;
  RRTT_DECIMALS?: string;
  CUSTODIAL_RPC_REFRESH_BUDGET_MS?: string;
  HELIUS_API_KEY?: string;
  HELIUS_RPC_URL?: string;
  NEXT_PUBLIC_HELIUS_API_KEY?: string;
  SOLANA_HELIUS_API_KEY?: string;
  NEXT_PUBLIC_RPC_URL?: string;
  /** Custodial key decrypt (RRTT `/send user`). */
  INTERNAL_WALLET_ENC_KEY_B64?: string;
  /** Treasury pays ATA + tx fees for RRTT peer sends. */
  RRTT_TREASURY_SECRET_KEY_B58?: string;
  /** ROOTS deposit/swap sweep notices. */
  DISCORD_ROOT_ECONOMY_WEBHOOK_URL?: string;
  /** Developer-only /screenshot report archive webhook. */
  DISCORD_GROK_WEBHOOK_URL?: string;
  /** Optional role id for @Developer; otherwise bot fetches role named Developer. */
  DISCORD_DEVELOPER_ROLE_ID?: string;
  /** X/Grok credentials for report collection + AI summary. */
  GROK_X_BEARER_TOKEN?: string;
  GROK_X_V1_CONSUMER_KEY?: string;
  GROK_X_V1_CONSUMER_KEY_SECRET?: string;
  GROK_X_V2_CLIENT_ID?: string;
  GROK_X_V2_CLIENT_SECRET?: string;
  GROK_API_BEARER_TOKEN?: string;
  GROK_API_URL?: string;
  GROK_MODEL?: string;
  GROK_X_USERNAME?: string;
};

const ROOT_RECORD_GLOBAL_UPDATER_PUBKEY = "G1DHctEcwkiLw8NZDfCbDCbuPktQBmWa6P2aobDuMKuZ";
const ROOTS_MINT_BASE58 = "8hwxLN1Q4Yr8xFErErULCqNvcF1cMwGjpRXPz6DAH7gM";
const MAX_SEND = MAX_ROOT_UNITS_PER_TRANSFER;
const MIN_SEND = rootsWholeToAtomic(0.00000001);
const FAUCET_COOLDOWN_MS = 12 * 3600 * 1000;

function fmtRoots(atomic: number): string {
  return formatRootsAtomicLocale(Math.max(0, Math.floor(Number(atomic) || 0)));
}

/** Discord slash command numbers are whole Roots; ledger stores atomic units. */
function ledgerFromWholeRoots(whole: number | null): number | null {
  if (whole == null || !Number.isFinite(whole) || whole <= 0) return null;
  const atomic = Math.round(whole * 100_000_000);
  return atomic > 0 ? atomic : null;
}
const DISCORD_VERIFY_URL = "https://rootrecord.cloud/discord-verify";
const ACCOUNT_URL = "https://rootrecord.cloud/account";

type DiscordSendAsset = "ROOTS" | "RRTT" | "SOL";

function sendAssetDisplayName(asset: DiscordSendAsset): string {
  if (asset === "RRTT") return "RRTT";
  if (asset === "SOL") return "SOL";
  return "ROOTS";
}

function formatSolLamports(lamports: number): string {
  const n = Math.max(0, Math.floor(Number(lamports) || 0));
  const sol = n / 1e9;
  if (sol >= 0.01) return `${sol.toLocaleString(undefined, { maximumFractionDigits: 6 })} SOL`;
  return `${n.toLocaleString()} lamports`;
}

function formatSolWhole(sol: number): string {
  const s = Number(sol);
  if (!Number.isFinite(s) || s <= 0) return "0 SOL";
  return `${s.toLocaleString(undefined, { maximumFractionDigits: 9 })} SOL`;
}

const MAX_SOL_SEND_LAMPORTS = 10_000_000_000; // 10 SOL per Discord send
const MIN_SOL_SEND_LAMPORTS = 10_000; // 0.00001 SOL

function sendFailedAmountText(unitsOrWhole: number, asset: DiscordSendAsset): string {
  return asset === "SOL"
    ? formatSolWhole(unitsOrWhole)
    : asset === "RRTT"
      ? `${Math.floor(unitsOrWhole).toLocaleString()} RRTT`
      : `${fmtRoots(unitsOrWhole)} ROOTS`;
}

/** Public reply: ping recipient so they see verify link + failed amount (not ephemeral). */
function unlinkedRecipientSendFailedContent(
  toDiscordId: string,
  unitsOrWhole: number,
  asset: DiscordSendAsset,
): string {
  const amountText = sendFailedAmountText(unitsOrWhole, asset);
  return (
    `<@${toDiscordId}> â€” a **${amountText}** transfer could not be delivered because your Discord is not linked to RootRecord.\n\n` +
    `Link at **${DISCORD_VERIFY_URL}**. Once you're verified, incoming sends are **auto-credited** to your account â€” this **${amountText}** would have been claimed automatically.`
  );
}

function verifiedButUnlinkedRecipientSendFailedContent(toDiscordId: string, amountText: string): string {
  return (
    `<@${toDiscordId}> â€” a **${amountText}** transfer could not be delivered. You have **@Verified** in Discord, but RootRecord does not have a saved account link for your Discord ID.\n\n` +
    `Open **${DISCORD_VERIFY_URL}**, sign in, and tap **Re-verify with Discord**. That rebuilds the account link so incoming sends can be **auto-credited**.`
  );
}

function hexToUint8(hex: string): Uint8Array | null {
  const s = hex.replace(/^0x/i, "").trim();
  if (s.length % 2 !== 0) return null;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    const b = parseInt(s.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(b)) return null;
    out[i] = b;
  }
  return out;
}

function verifyDiscordRequest(rawBody: string, headers: Headers, publicKeyHex: string): boolean {
  const sig = headers.get("x-signature-ed25519") || headers.get("X-Signature-Ed25519");
  const ts = headers.get("x-signature-timestamp") || headers.get("X-Signature-Timestamp");
  if (!sig || !ts) return false;
  const pk = hexToUint8(publicKeyHex);
  const sigBytes = hexToUint8(sig);
  if (!pk || pk.length !== 32 || !sigBytes || sigBytes.length !== 64) return false;
  const msg = new TextEncoder().encode(ts + rawBody);
  return nacl.sign.detached.verify(msg, sigBytes, pk);
}

function interactionResponse(
  type: number,
  data?: { content?: string; flags?: number; components?: unknown[]; embeds?: unknown[] },
): Response {
  const payload =
    type === 5
      ? { type: 5 }
      : data
        ? (() => {
            const hasEmbeds = Array.isArray(data.embeds) && data.embeds.length > 0;
            const dataOut: Record<string, unknown> = {};
            if (typeof data.content === "string") dataOut.content = data.content;
            else if (hasEmbeds) dataOut.content = "\u200b";
            if (typeof data.flags === "number" && Number.isFinite(data.flags)) dataOut.flags = data.flags;
            if (Array.isArray(data.components)) dataOut.components = data.components;
            if (hasEmbeds) dataOut.embeds = data.embeds;
            return { type, data: dataOut };
          })()
        : { type };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function jsonInteractionPayload(payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

/** After `type: 5` defer, replace the â€œthinkingâ€¦â€ placeholder with the final message. */
async function patchDeferredInteractionMessage(
  applicationId: string,
  interactionToken: string,
  data: { content?: string; flags?: number; components?: unknown[]; embeds?: unknown[] },
): Promise<void> {
  const url = `https://discord.com/api/v10/webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(
    interactionToken,
  )}/messages/@original`;
  const body: Record<string, unknown> = {};
  const hasEmbeds = Array.isArray(data.embeds) && data.embeds.length > 0;
  if (typeof data.content === "string") body.content = data.content;
  if (typeof data.flags === "number" && Number.isFinite(data.flags)) {
    body.flags = data.flags;
  }
  if (Array.isArray(data.components)) body.components = data.components;
  if (hasEmbeds) body.embeds = data.embeds;
  if (!("content" in body) && !Array.isArray(body.components) && !hasEmbeds) {
    body.content = "Done.";
  }
  if (!("content" in body) && (Array.isArray(body.components) || hasEmbeds)) {
    body.content = "\u200b";
  }
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": "RootRecord/discord-root-units",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const rt = await res.text().catch(() => "");
    console.error("discord_interaction_deferred_patch", res.status, rt.slice(0, 500));
  }
}

async function postDiscordInteractionFollowup(
  applicationId: string,
  interactionToken: string,
  data: { content?: string; flags?: number; embeds?: unknown[] },
): Promise<void> {
  const url = `https://discord.com/api/v10/webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(
    interactionToken,
  )}`;
  const body: Record<string, unknown> = {};
  const hasEmbeds = Array.isArray(data.embeds) && data.embeds.length > 0;
  if (typeof data.content === "string") body.content = data.content;
  if (typeof data.flags === "number" && Number.isFinite(data.flags)) body.flags = data.flags;
  if (hasEmbeds) body.embeds = data.embeds;
  if (!("content" in body) && !hasEmbeds) body.content = "Done.";
  if (!("content" in body) && hasEmbeds) body.content = "\u200b";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "User-Agent": "RootRecord/discord-root-units",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const rt = await res.text().catch(() => "");
    console.error("discord_interaction_followup", res.status, rt.slice(0, 500));
  }
}

async function ensureBalanceRow(db: D1Database, userId: string, nowIso: string): Promise<void> {
  await db
    .prepare("INSERT OR IGNORE INTO rr_earn_balance (user_id, balance, updated_at) VALUES (?, 0, ?)")
    .bind(userId, nowIso)
    .run();
}

async function discordLinkForUserId(
  db: D1Database,
  discordUserId: string,
): Promise<{ accountId: string; email: string; userId: string } | null> {
  const row = await db
    .prepare(
      `SELECT l.account_id AS account_id,
              lower(trim(COALESCE(NULLIF(l.email, ''), la.email))) AS e
       FROM discord_account_links l
       LEFT JOIN license_accounts la ON la.id = l.account_id
       WHERE l.discord_user_id = ?`,
    )
    .bind(String(discordUserId || "").trim())
    .first<{ account_id: string; e: string }>();
  const accountId = row?.account_id ? String(row.account_id).trim() : "";
  const e = row?.e ? String(row.e).trim().toLowerCase() : "";
  if (!accountId || !e || !e.includes("@")) return null;
  return { accountId, email: e, userId: `user:${e}` };
}

async function earnUserIdForDiscord(db: D1Database, discordUserId: string): Promise<string | null> {
  return (await discordLinkForUserId(db, discordUserId))?.userId ?? null;
}

async function getEarnBalance(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare("SELECT balance FROM rr_earn_balance WHERE user_id = ?")
    .bind(userId)
    .first<{ balance: number }>();
  if (!row) return 0;
  return Math.max(0, Math.floor(Number(row.balance) || 0));
}

function optSnowflake(opts: Array<Record<string, unknown>>, name: string): string | null {
  const o = opts.find((x) => String(x.name) === name);
  if (!o || Number(o.type) !== 6) return null;
  const v = String(o.value ?? "").trim();
  return v || null;
}

function optInteger(opts: Array<Record<string, unknown>>, name: string): number | null {
  const o = opts.find((x) => String(x.name) === name);
  if (!o || Number(o.type) !== 4) return null;
  const v = Math.floor(Number(String(o.value ?? "").trim()));
  if (!Number.isFinite(v)) return null;
  return v;
}

/** STRING (type 3), e.g. slash `choices`. */
function optStringChoice(opts: Array<Record<string, unknown>>, name: string): string | null {
  const o = opts.find((x) => String(x.name) === name);
  if (!o || Number(o.type) !== 3) return null;
  const v = String(o.value ?? "").trim();
  return v || null;
}

function parseSendAsset(raw: string | null): DiscordSendAsset {
  const u = String(raw || "").trim().toUpperCase();
  if (u === "RRTT") return "RRTT";
  if (u === "SOL") return "SOL";
  return "ROOTS";
}

/** Walk SUB_COMMAND / SUB_COMMAND_GROUP trees (Discord only sends the invoked branch; nesting varies). */
function findOptionDeep(
  opts: Array<Record<string, unknown>>,
  name: string,
  wantTypes: number[],
): Record<string, unknown> | null {
  for (const o of opts) {
    if (!o || typeof o !== "object") continue;
    const t = Number(o.type);
    if (String(o.name) === name && wantTypes.includes(t)) return o;
    const inner = (Array.isArray(o.options) ? o.options : []) as Array<Record<string, unknown>>;
    if (inner.length) {
      const hit = findOptionDeep(inner, name, wantTypes);
      if (hit) return hit;
    }
  }
  return null;
}

function optIntegerDeep(opts: Array<Record<string, unknown>>, name: string): number | null {
  const o = findOptionDeep(opts, name, [4]);
  if (!o) return null;
  const v = Math.floor(Number(String(o.value ?? "").trim()));
  if (!Number.isFinite(v)) return null;
  return v;
}

/** INTEGER or NUMBER slash options (decimals preserved for SOL / fractional Roots). */
function optNumber(opts: Array<Record<string, unknown>>, name: string): number | null {
  const o = opts.find((x) => String(x.name) === name);
  if (!o) return null;
  const t = Number(o.type);
  if (t !== 4 && t !== 10) return null;
  const v = Number(o.value);
  if (!Number.isFinite(v) || v <= 0) return null;
  return v;
}

function optNumberDeep(opts: Array<Record<string, unknown>>, name: string): number | null {
  const o = findOptionDeep(opts, name, [4, 10]);
  if (!o) return null;
  const v = Number(o.value);
  if (!Number.isFinite(v) || v <= 0) return null;
  return v;
}

function solWholeToLamports(sol: number): number | null {
  if (!Number.isFinite(sol) || sol <= 0) return null;
  const lam = Math.floor(sol * 1e9);
  if (lam < 1) return null;
  return lam;
}

function optSnowflakeDeep(opts: Array<Record<string, unknown>>, name: string): string | null {
  const o = findOptionDeep(opts, name, [3, 6, 7, 9]);
  if (!o) return null;
  const v = String(o.value ?? "").trim();
  return v || null;
}

function optStringDeep(opts: Array<Record<string, unknown>>, name: string): string | null {
  const o = findOptionDeep(opts, name, [3]);
  if (!o) return null;
  const v = String(o.value ?? "").trim();
  return v || null;
}

function optRoleDeep(opts: Array<Record<string, unknown>>, name: string): string | null {
  const o = findOptionDeep(opts, name, [8]);
  if (!o) return null;
  const v = String(o.value ?? "").trim();
  return v || null;
}

function optRole(opts: Array<Record<string, unknown>>, name: string): string | null {
  const o = opts.find((x) => String(x.name) === name);
  if (!o || Number(o.type) !== 8) return null;
  const v = String(o.value ?? "").trim();
  return v || null;
}

/** SUB_COMMAND (type 1): pick the invoked branch â€” do not `opts.find` alone; some payloads list sibling stubs first. */
function invokedSubcommand(opts: Array<Record<string, unknown>>): { name: string; inner: Array<Record<string, unknown>> } | null {
  const subs = opts.filter((x) => Number(x.type) === 1);
  if (subs.length === 0) return null;
  const nonempty = subs.find((s) => {
    const io = (Array.isArray(s.options) ? s.options : []) as Array<Record<string, unknown>>;
    return io.length > 0;
  });
  const sub = nonempty || subs[subs.length - 1];
  const name = String(sub.name || "").trim().toLowerCase();
  const inner = (Array.isArray(sub.options) ? sub.options : []) as Array<Record<string, unknown>>;
  return { name, inner };
}

async function fetchDiscordUserIdsWithGuildRole(
  guildId: string,
  roleId: string,
  botToken: string,
): Promise<{ ok: true; ids: string[] } | { ok: false; status: number; detail: string }> {
  const ids: string[] = [];
  let after = "";
  for (let page = 0; page < 50; page++) {
    const q = new URLSearchParams({ limit: "1000" });
    if (after) q.set("after", after);
    const url = `https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}/members?${q.toString()}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bot ${botToken}`,
        "User-Agent": "RootRecord/discord-root-units (members)",
      },
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, status: res.status, detail: t.slice(0, 240) };
    }
    const arr = (await res.json()) as Array<{ user?: { id?: string }; roles?: string[] }>;
    if (!Array.isArray(arr) || arr.length === 0) break;
    for (const m of arr) {
      const uid = String(m.user?.id || "").trim();
      const roles = Array.isArray(m.roles) ? m.roles : [];
      if (uid && roles.includes(roleId)) ids.push(uid);
    }
    after = String(arr[arr.length - 1]?.user?.id || "").trim();
    if (!after || arr.length < 1000) break;
  }
  return { ok: true, ids };
}

async function discordUserHasVerifiedRole(env: DiscordRootUnitsEnv, discordUserId: string): Promise<boolean> {
  const bot = String(env.DISCORD_BOT_TOKEN || "").trim();
  const guildId = String(env.DISCORD_GUILD_ID || "").trim();
  const roleId = String(env.DISCORD_VERIFIED_ROLE_ID || "").trim();
  const userId = String(discordUserId || "").trim();
  if (!bot || !guildId || !roleId || !userId) return false;
  try {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`,
      {
        headers: {
          Authorization: `Bot ${bot}`,
          "User-Agent": "RootRecord/discord-root-units (member)",
        },
      },
    );
    if (!res.ok) return false;
    const member = (await res.json()) as { roles?: unknown };
    const roles = Array.isArray(member.roles) ? member.roles.map((r) => String(r)) : [];
    return roles.includes(roleId);
  } catch {
    return false;
  }
}

function custodialSyncBudgetMs(env: DiscordRootUnitsEnv): number {
  const raw = String(env.CUSTODIAL_RPC_REFRESH_BUDGET_MS ?? "").trim();
  const n = parseInt(raw, 10);
  if (Number.isFinite(n) && n >= 2000 && n <= 25_000) return n;
  return 14_000;
}

function shortenMintBase58(mint: string): string {
  const m = String(mint || "").trim();
  if (m.length <= 12) return m;
  return `${m.slice(0, 6)}â€¦${m.slice(-4)}`;
}

function formatSlotUiAmount(rawStr: string, decimals: number): string {
  let r: bigint;
  try {
    r = BigInt(String(rawStr || "0").split(".")[0] || "0");
  } catch {
    return "?";
  }
  const d = Math.min(20, Math.max(0, Math.floor(decimals)));
  if (d === 0) return r.toString();
  const div = 10n ** BigInt(d);
  const whole = r / div;
  const frac = r % div;
  if (frac === 0n) return whole.toString();
  const fr = frac.toString().padStart(d, "0").replace(/0+$/, "");
  if (!fr) return whole.toString();
  return `${whole.toString()}.${fr}`;
}

function sortCustodialSlots(rows: CustodialTokenSlotRow[]): CustodialTokenSlotRow[] {
  return [...rows].sort((a, b) => {
    const an = a.mint_base58 === "native";
    const bn = b.mint_base58 === "native";
    if (an && !bn) return -1;
    if (!an && bn) return 1;
    return a.mint_base58.localeCompare(b.mint_base58);
  });
}

function slotHasPositiveBalance(r: CustodialTokenSlotRow): boolean {
  try {
    return BigInt(String(r.amount_raw || "0")) > 0n;
  } catch {
    return false;
  }
}

function custodialDepositQrImageUrl(pubkey: string): string {
  return `https://quickchart.io/qr?size=280x280&light=f8fafc&dark=0f172a&text=${encodeURIComponent(pubkey)}`;
}

async function handleBal(db: D1Database, fromDiscordId: string, env: DiscordRootUnitsEnv): Promise<Response> {
  const link = await discordLinkForUserId(db, fromDiscordId);
  if (!link) {
    return interactionResponse(4, {
      content:
        `No linked RootRecord account for this Discord user. Open **${DISCORD_VERIFY_URL}** to link Discord, then try \`/bal\` again.`,
    });
  }
  const uid = link.userId;
  const accountId = link.accountId;
  const now = new Date().toISOString();
  await ensureBalanceRow(db, uid, now);
  const b = await getEarnBalance(db, uid);
  const lines: string[] = [
    `**Root Units:** ${fmtRoots(b)} Roots`,
    "**About Root Units:** experimental RootRecord points for accounts, Discord, and Roots Idle Farmer. They are not cash, securities, or a promise of future value.",
    "**Sharing:** use **`/send`** for Root Units inside Discord. **SOL** is a separate deposit-wallet asset and only transfers with **`/send user`**.",
    "**Deposit wallet:** use **`/deposit`** to view your Solana address and QR. SOL and supported SPL token balances from that address appear below after confirmation.",
  ];
  if (!accountId) {
    lines.push(`\n**Deposit-address tokens:** we couldn't load this section. Try **${ACCOUNT_URL}** if it keeps happening.`);
  } else {
    await syncCustodialTokenSlotsFromRpc(env, accountId, custodialSyncBudgetMs(env)).catch(() => {});
    const slotsAll = await readCustodialTokenSlots(db, accountId, 200);
    const slots = sortCustodialSlots(slotsAll).filter(slotHasPositiveBalance);
    if (slots.length === 0) {
      lines.push(
        "\n**Deposit wallet balances:** no SOL or supported SPL tokens detected yet. Use **`/deposit`** for your address and QR, send tokens from your wallet, then run **`/bal`** again after confirmation.",
      );
    } else {
      lines.push("\n**Deposit wallet balances** (latest detected):");
      const cap = 22;
      for (const s of slots.slice(0, cap)) {
        const label = s.mint_base58 === "native" ? "Solana" : shortenMintBase58(s.mint_base58);
        const ui = formatSlotUiAmount(s.amount_raw, s.decimals);
        lines.push(`â€¢ **${label}:** ${ui}`);
      }
      if (slots.length > cap) lines.push(`â€¦ +${slots.length - cap} more â€” see **${ACCOUNT_URL}** for the full list.`);
    }
  }
  let content = lines.join("\n");
  if (content.length > 1950) content = `${content.slice(0, 1940)}â€¦`;
  return interactionResponse(4, { content });
}

const MAX_BULK_RECIPIENTS = 400;

type BulkRecipientMode = "all" | "active" | "role";

function activeLookbackDays(env: DiscordRootUnitsEnv): number {
  const raw = String(env.DISCORD_ACTIVE_LOOKBACK_DAYS ?? "").trim();
  const n = parseInt(raw, 10);
  if (Number.isFinite(n) && n >= 1 && n <= 90) return n;
  return 14;
}

async function resolveBulkRecipientDiscordIds(
  db: D1Database,
  fromDiscordId: string,
  mode: BulkRecipientMode,
  env: DiscordRootUnitsEnv,
  roleGuildMemberIds?: string[],
): Promise<{ ok: true; ids: string[] } | { ok: false; response: Response }> {
  if (mode === "role") {
    const roleSet = new Set(
      (roleGuildMemberIds || []).map((x) => String(x).trim()).filter((x) => x.length > 0),
    );
    if (roleSet.size < 1) {
      return {
        ok: false,
        response: interactionResponse(4, {
          content:
            "No members with that role were found (empty role, or the bot needs **Server Members Intent** + permission to **View Server Members**).",
        }),
      };
    }
    const rows = await db
      .prepare(
        "SELECT discord_user_id FROM discord_account_links WHERE discord_user_id != ? ORDER BY discord_user_id ASC",
      )
      .bind(fromDiscordId)
      .all<{ discord_user_id: string }>();
    const ids = (rows.results || [])
      .map((r) => String(r.discord_user_id || "").trim())
      .filter((id) => id.length > 0 && roleSet.has(id));
    return { ok: true, ids };
  }

  if (mode === "all") {
    const rows = await db
      .prepare(
        "SELECT discord_user_id FROM discord_account_links WHERE discord_user_id != ? ORDER BY discord_user_id ASC",
      )
      .bind(fromDiscordId)
      .all<{ discord_user_id: string }>();
    const ids = (rows.results || [])
      .map((r) => String(r.discord_user_id || "").trim())
      .filter((id) => id.length > 0);
    return { ok: true, ids };
  }

  if (mode === "active") {
    const days = activeLookbackDays(env);
    const cutoff = new Date(Date.now() - days * 864e5).toISOString();
    const rows = await db
      .prepare(
        `SELECT l.discord_user_id AS discord_user_id
         FROM discord_account_links l
         INNER JOIN discord_user_activity a ON a.discord_user_id = l.discord_user_id
         WHERE l.discord_user_id != ? AND a.last_message_at >= ?
         ORDER BY l.discord_user_id ASC`,
      )
      .bind(fromDiscordId, cutoff)
      .all<{ discord_user_id: string }>();
    const ids = (rows.results || [])
      .map((r) => String(r.discord_user_id || "").trim())
      .filter((id) => id.length > 0);
    return { ok: true, ids };
  }

  return {
    ok: false,
    response: interactionResponse(4, { content: "Internal: unknown bulk send mode." }),
  };
}

async function handleSendRrttUser(
  env: DiscordRootUnitsEnv,
  fromDiscordId: string,
  toDiscordId: string,
  fromUid: string,
  toUid: string,
  wholeRrtt: number,
  interactionId: string,
): Promise<Response> {
  const dupe = await env.DB
    .prepare(
      "SELECT 1 AS ok FROM rr_earn_discord_peer_transfer WHERE interaction_id = ? AND COALESCE(asset, 'ROOTS') = 'RRTT' LIMIT 1",
    )
    .bind(interactionId)
    .first<{ ok: number }>();
  if (dupe?.ok === 1) {
    return interactionResponse(4, { content: "This interaction was already completed." });
  }

  const fromLink = await env.DB
    .prepare("SELECT account_id FROM discord_account_links WHERE discord_user_id = ?")
    .bind(fromDiscordId)
    .first<{ account_id: string }>();
  const toLink = await env.DB
    .prepare("SELECT account_id FROM discord_account_links WHERE discord_user_id = ?")
    .bind(toDiscordId)
    .first<{ account_id: string }>();
  const fromAid = String(fromLink?.account_id || "").trim();
  const toAid = String(toLink?.account_id || "").trim();
  if (!fromAid) {
    return interactionResponse(4, {
      content: `Your Discord must be linked at **${DISCORD_VERIFY_URL}** before sending this asset.`,
    });
  }
  if (!toAid) {
    return interactionResponse(4, {
      content: `Recipient <@${toDiscordId}> is not linked to a RootRecord account.`,
    });
  }

  const res = await transferRrttCustodialPeerViaTreasury(env as unknown as InternalWalletEnv, fromAid, toAid, wholeRrtt);
  if (!res.ok) {
    return interactionResponse(4, { content: res.message });
  }

  const now = new Date().toISOString();
  const rowId = crypto.randomUUID();
  const sigShort = res.signature.length > 24 ? `${res.signature.slice(0, 20)}â€¦` : res.signature;
  await env.DB
    .prepare(
      `INSERT INTO rr_earn_discord_peer_transfer (
         id, interaction_id, from_user_id, to_user_id, units, from_discord_user_id, to_discord_user_id, created_at, asset, tx_signature
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'RRTT', ?)`,
    )
    .bind(rowId, interactionId, fromUid, toUid, wholeRrtt, fromDiscordId, toDiscordId, now, res.signature)
    .run();

  return interactionResponse(4, {
    content: `Sent selected asset to <@${toDiscordId}>. Tx: \`${sigShort}\``,
  });
}

async function handleSendSolUser(
  env: DiscordRootUnitsEnv,
  fromDiscordId: string,
  toDiscordId: string,
  fromUid: string,
  toUid: string,
  lamports: number,
  interactionId: string,
): Promise<Response> {
  const dupe = await env.DB
    .prepare(
      "SELECT 1 AS ok FROM rr_earn_discord_peer_transfer WHERE interaction_id = ? AND COALESCE(asset, 'ROOTS') = 'SOL' LIMIT 1",
    )
    .bind(interactionId)
    .first<{ ok: number }>();
  if (dupe?.ok === 1) {
    return interactionResponse(4, { content: "This interaction was already completed." });
  }

  const fromLink = await env.DB
    .prepare("SELECT account_id FROM discord_account_links WHERE discord_user_id = ?")
    .bind(fromDiscordId)
    .first<{ account_id: string }>();
  const toLink = await env.DB
    .prepare("SELECT account_id FROM discord_account_links WHERE discord_user_id = ?")
    .bind(toDiscordId)
    .first<{ account_id: string }>();
  const fromAid = String(fromLink?.account_id || "").trim();
  const toAid = String(toLink?.account_id || "").trim();
  if (!fromAid) {
    return interactionResponse(4, {
      content: `Your Discord must be linked at **${DISCORD_VERIFY_URL}** before sending **SOL**.`,
    });
  }
  if (!toAid) {
    return interactionResponse(4, {
      content: unlinkedRecipientSendFailedContent(toDiscordId, lamports, "SOL"),
    });
  }

  const res = await transferSolCustodialPeerViaTreasury(env as unknown as InternalWalletEnv, fromAid, toAid, lamports);
  if (!res.ok) {
    return interactionResponse(4, { content: res.message });
  }

  const now = new Date().toISOString();
  const rowId = crypto.randomUUID();
  const sigShort = res.signature.length > 24 ? `${res.signature.slice(0, 20)}â€¦` : res.signature;
  await env.DB
    .prepare(
      `INSERT INTO rr_earn_discord_peer_transfer (
         id, interaction_id, from_user_id, to_user_id, units, from_discord_user_id, to_discord_user_id, created_at, asset, tx_signature
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SOL', ?)`,
    )
    .bind(rowId, interactionId, fromUid, toUid, lamports, fromDiscordId, toDiscordId, now, res.signature)
    .run();

  return interactionResponse(4, {
    content: `Sent **${formatSolLamports(lamports)}** to <@${toDiscordId}> (custodial â†’ custodial on-chain). Tx: \`${sigShort}\``,
  });
}

async function handleSendExecute(
  db: D1Database,
  fromDiscordId: string,
  toDiscordId: string,
  fromUid: string,
  toUid: string,
  units: number,
  interactionId: string,
): Promise<Response> {
  const dupe = await db
    .prepare(
      "SELECT SUM(units) AS s FROM rr_earn_discord_peer_transfer WHERE interaction_id = ? AND COALESCE(asset, 'ROOTS') IN ('ROOTS', 'RUNIT')",
    )
    .bind(interactionId)
    .first<{ s: number | null }>();
  const dupeSum = dupe?.s != null ? Math.floor(Number(dupe.s) || 0) : 0;
  if (dupeSum > 0) {
    return interactionResponse(4, {
      content: `This interaction was already completed (**${fmtRoots(dupeSum)} ROOTS** total).`,
    });
  }

  const now = new Date().toISOString();
  await ensureBalanceRow(db, fromUid, now);
  await ensureBalanceRow(db, toUid, now);

  const debit = await db
    .prepare(
      "UPDATE rr_earn_balance SET balance = balance - ?, updated_at = ? WHERE user_id = ? AND balance >= ?",
    )
    .bind(units, now, fromUid, units)
    .run();
  if ((debit.meta?.changes ?? 0) !== 1) {
    const have = await getEarnBalance(db, fromUid);
    return interactionResponse(4, {
      content: `Insufficient ROOTS. You have **${fmtRoots(have)} ROOTS**; tried to send **${fmtRoots(units)} ROOTS**.`,
    });
  }

  const rowId = crypto.randomUUID();
  try {
    await db.batch([
      db
        .prepare("UPDATE rr_earn_balance SET balance = balance + ?, updated_at = ? WHERE user_id = ?")
        .bind(units, now, toUid),
      db
        .prepare(
          `INSERT INTO rr_earn_discord_peer_transfer (
             id, interaction_id, from_user_id, to_user_id, units, from_discord_user_id, to_discord_user_id, created_at, asset
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ROOTS')`,
        )
        .bind(rowId, interactionId, fromUid, toUid, units, fromDiscordId, toDiscordId, now),
    ]);
  } catch (e) {
    await db
      .prepare("UPDATE rr_earn_balance SET balance = balance + ?, updated_at = ? WHERE user_id = ?")
      .bind(units, now, fromUid)
      .run()
      .catch(() => {});
    throw e;
  }

  const newBal = await getEarnBalance(db, fromUid);
  return interactionResponse(4, {
    content: `Sent **${fmtRoots(units)}** Roots to <@${toDiscordId}>. Your new balance: **${fmtRoots(newBal)}**.`,
  });
}

/** Split `totalUnits` across recipients chosen by `mode` (all linked, recently active âˆ© linked, or role âˆ© linked). */
async function handleSendBulk(
  db: D1Database,
  fromDiscordId: string,
  fromUid: string,
  totalUnits: number,
  interactionId: string,
  mode: BulkRecipientMode,
  env: DiscordRootUnitsEnv,
  roleGuildMemberIds?: string[],
): Promise<Response> {
  const dupe = await db
    .prepare(
      "SELECT 1 AS ok FROM rr_earn_discord_peer_transfer WHERE interaction_id = ? AND COALESCE(asset, 'ROOTS') IN ('ROOTS', 'RUNIT') LIMIT 1",
    )
    .bind(interactionId)
    .first<{ ok: number }>();
  if (dupe?.ok === 1) {
    return interactionResponse(4, {
      content: "This interaction was already completed.",
    });
  }

  const resolved = await resolveBulkRecipientDiscordIds(db, fromDiscordId, mode, env, roleGuildMemberIds);
  if (!resolved.ok) {
    return resolved.response;
  }
  const discordIds = resolved.ids;
  const n = discordIds.length;
  if (n < 1) {
    const empty =
      mode === "active"
        ? `No **linked** members have Discord message rows in \`discord_user_activity\` within the last **${activeLookbackDays(env)}** days (cron must be ingesting channels).`
        : mode === "role"
          ? `No **linked** members have that role. They must link Discord at **${DISCORD_VERIFY_URL}** and hold the role in this server.`
          : `No other linked RootRecord members. People must link Discord at **${DISCORD_VERIFY_URL}** before they can receive a split.`;
    return interactionResponse(4, { content: empty });
  }
  if (n > MAX_BULK_RECIPIENTS) {
    return interactionResponse(4, {
      content: `Too many recipients (**${n}**). Max **${MAX_BULK_RECIPIENTS.toLocaleString()}** per \`/send everyone\` / \`/send active\` / \`/send role\`.`,
    });
  }
  if (totalUnits < n) {
    return interactionResponse(4, {
      content: `Total too small to split across **${n.toLocaleString()}** recipients (need at least **${n}** atomic units total). Try a larger Roots amount.`,
    });
  }
  if (totalUnits > MAX_SEND) {
    return interactionResponse(4, {
      content: `Max **${formatRootsAtomicLocale(MAX_SEND)}** Roots per command.`,
    });
  }

  const pairs: { discordId: string; uid: string }[] = [];
  for (const did of discordIds) {
    const uid = await earnUserIdForDiscord(db, did);
    if (uid) pairs.push({ discordId: did, uid });
  }
  if (pairs.length < 1) {
    return interactionResponse(4, {
      content: "Could not resolve linked accounts for bulk send.",
    });
  }

  const m = pairs.length;
  const base = Math.floor(totalUnits / m);
  const rem = totalUnits % m;
  if (base < 1) {
    return interactionResponse(4, {
      content: "Split is too small for the number of recipients (internal).",
    });
  }

  const have = await getEarnBalance(db, fromUid);
  if (have < totalUnits) {
    return interactionResponse(4, {
      content: `Insufficient Roots. You have **${fmtRoots(have)}**; tried to split **${fmtRoots(totalUnits)}** among **${m.toLocaleString()}** members.`,
    });
  }

  const now = new Date().toISOString();
  await ensureBalanceRow(db, fromUid, now);
  for (const p of pairs) {
    await ensureBalanceRow(db, p.uid, now);
  }

  const debit = await db
    .prepare(
      "UPDATE rr_earn_balance SET balance = balance - ?, updated_at = ? WHERE user_id = ? AND balance >= ?",
    )
    .bind(totalUnits, now, fromUid, totalUnits)
    .run();
  if ((debit.meta?.changes ?? 0) !== 1) {
    const have2 = await getEarnBalance(db, fromUid);
    return interactionResponse(4, {
      content: `Insufficient ROOTS. You have **${fmtRoots(have2)} ROOTS**; tried to split **${fmtRoots(totalUnits)} ROOTS**.`,
    });
  }

  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < m; i++) {
    const share = base + (i < rem ? 1 : 0);
    const { discordId, uid } = pairs[i];
    stmts.push(
      db
        .prepare("UPDATE rr_earn_balance SET balance = balance + ?, updated_at = ? WHERE user_id = ?")
        .bind(share, now, uid),
    );
    stmts.push(
      db
        .prepare(
          `INSERT INTO rr_earn_discord_peer_transfer (
             id, interaction_id, from_user_id, to_user_id, units, from_discord_user_id, to_discord_user_id, created_at, asset
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ROOTS')`,
        )
        .bind(crypto.randomUUID(), interactionId, fromUid, uid, share, fromDiscordId, discordId, now),
    );
  }

  try {
    await db.batch(stmts);
  } catch (e) {
    await db
      .prepare("UPDATE rr_earn_balance SET balance = balance + ?, updated_at = ? WHERE user_id = ?")
      .bind(totalUnits, now, fromUid)
      .run()
      .catch(() => {});
    throw e;
  }

  const newBal = await getEarnBalance(db, fromUid);
  const minShare = base;
  const maxShare = base + (rem > 0 ? 1 : 0);
  const cohort =
    mode === "all"
      ? "all other linked members"
      : mode === "role"
        ? "linked members who have the chosen server role"
        : `linked members with message activity in the last **${activeLookbackDays(env)}** days`;
  return interactionResponse(4, {
    content: `Split **${fmtRoots(totalUnits)} ROOTS** among **${m.toLocaleString()}** ${cohort} (${fmtRoots(minShare)}-${fmtRoots(maxShare)} ROOTS each). Your new balance: **${fmtRoots(newBal)} ROOTS**.`,
  });
}

function rollD6(): number {
  const u = new Uint32Array(1);
  crypto.getRandomValues(u);
  return 1 + (u[0] % 6);
}

async function handleEconomy(db: D1Database): Promise<Response> {
  const data = await loadEconomyLeaderboardData(db);
  return interactionResponse(4, { content: buildEconomyDiscordMessage(data) });
}

async function handleWalletDeposit(db: D1Database, fromDiscordId: string): Promise<Response> {
  const row = await db
    .prepare(
      `SELECT iw.pubkey AS pubkey FROM discord_account_links l
       INNER JOIN internal_solana_wallets iw ON iw.account_id = l.account_id
       WHERE l.discord_user_id = ?`,
    )
    .bind(fromDiscordId)
    .first<{ pubkey: string }>();
  const pk = row?.pubkey ? String(row.pubkey).trim() : "";
  if (!pk) {
    return interactionResponse(4, {
      content:
        `No deposit address is set up for this account yet. Sign in at **${ACCOUNT_URL}** â€” your wallet is created with your account.`,
    });
  }
  const qrUrl = custodialDepositQrImageUrl(pk);
  return interactionResponse(4, {
      content: `**Your deposit address (Solana)**\n\`${pk}\`\n\nSend **Solana** or supported tokens from your phone or browser wallet. Amounts show in **\`/bal\`** after a short wait. **Root Units** are the experimental points you share with **\`/send\`**.`,
    embeds: [
      {
        title: "Scan to deposit",
        color: 0x22c55e,
        image: { url: qrUrl },
        footer: { text: "QR image from quickchart.io" },
      },
    ],
  });
}

async function handleSwapCommand(env: DiscordRootUnitsEnv, fromDiscordId: string, opts: Array<Record<string, unknown>>): Promise<Response> {
  const link = await discordLinkForUserId(env.DB, fromDiscordId);
  if (!link) {
    return interactionResponse(4, {
      content: `Your Discord account is not linked. Open **${DISCORD_VERIFY_URL}** to link Discord, then try **\`/swap\`** again.`,
      flags: 64,
    });
  }

  const sc = invokedSubcommand(opts);
  const scName = sc ? String(sc.name || "").trim().toLowerCase() : "";
  const inner = (sc ? sc.inner : []) as Array<Record<string, unknown>>;
  if (scName !== "quote" && scName !== "buy" && scName !== "all") {
    return interactionResponse(4, {
      content: "Use **`/swap quote`** to preview, **`/swap buy`** to spend an amount, or **`/swap all`** to send all spendable SOL.",
      flags: 64,
    });
  }

  const amountSol = optNumber(inner, "amount") ?? optNumberDeep(opts, "amount");
  const lamports = scName === "all" ? MIN_SOL_SEND_LAMPORTS : amountSol == null ? null : solWholeToLamports(amountSol);
  if (lamports == null || (scName !== "all" && lamports < MIN_SOL_SEND_LAMPORTS)) {
    return interactionResponse(4, {
      content: `SOL amount must be at least **${(MIN_SOL_SEND_LAMPORTS / 1e9).toFixed(5)}** SOL.`,
      flags: 64,
    });
  }
  const slippageBps = clampRootsSolSwapSlippageBps(optNumber(inner, "slippage_bps") ?? optNumberDeep(opts, "slippage_bps") ?? 100);

  try {
    if (scName === "quote") {
      const quote = await quoteRootsSolSwapForAccount(env, link.accountId, lamports, slippageBps);
      return interactionResponse(4, {
        flags: 64,
        embeds: [
          {
            title: "SOL â†’ Internal ROOTS Quote",
            color: 0x38bdf8,
            description:
              "Internal swap rate is **100 ROOTS = $5**. SOL is transferred to treasury, then ROOTS are credited internally.",
            fields: [
              { name: "Spend", value: formatSolLamports(quote.input_lamports), inline: true },
              { name: "Estimated internal ROOTS", value: `${fmtRoots(quote.out_roots_atomic)} ROOTS`, inline: true },
              { name: "Rate", value: quote.rate_label, inline: true },
              { name: "SOL price", value: `$${quote.sol_usd_price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`, inline: true },
              { name: "Custodial wallet", value: `\`${quote.custodial_wallet}\``, inline: false },
            ],
          },
        ],
      });
    }

    const result = await executeRootsSolSwapForAccount(env, link.accountId, link.email, lamports, slippageBps, { all: scName === "all" });
    return interactionResponse(4, {
      flags: 64,
      embeds: [
        {
          title: result.internal_credit_status === "credited" ? "Swap Complete" : "Swap Confirmed, Credit Pending",
          color: result.internal_credit_status === "credited" ? 0x22c55e : 0xfacc15,
          description:
            result.internal_credit_status === "credited"
              ? "SOL was moved directly to treasury and internal ROOTS were credited at the fixed **100 ROOTS = $5** rate."
              : "SOL was submitted to treasury. Internal ROOTS credit is pending confirmation and will be finished by the processor shortly.",
          fields: [
            { name: "Spent", value: formatSolLamports(result.input_lamports), inline: true },
            { name: "Credited ROOTS", value: `${fmtRoots(result.quoted_roots_atomic)} ROOTS`, inline: true },
            { name: "Path", value: "SOL â†’ treasury internal credit", inline: true },
            { name: "Status", value: result.internal_credit_status === "credited" ? "Internal credit complete" : "Pending confirmation", inline: true },
            { name: "Transaction", value: `[${result.tx_signature.slice(0, 10)}â€¦](${result.explorer})`, inline: false },
          ],
        },
      ],
    });
  } catch (e) {
    return interactionResponse(4, {
      content: `Swap failed: ${String(e instanceof Error ? e.message : e)}`,
      flags: 64,
    });
  }
}

function handleSlashMenu(): Response {
  return interactionResponse(4, {
    content: "Pick an action below (only you see this). **Balance** = ROOTS + tokens from your deposit address. **Wallet** = address and QR.",
    components: [
      {
        type: 1,
        components: [
          {
            type: 3,
            custom_id: "rootrecord_menu",
            placeholder: "Root Record",
            min_values: 1,
            max_values: 1,
            options: [
              { label: "Balance", value: "bal", description: "ROOTS + deposit tokens" },
              { label: "Wallet", value: "wallet", description: "Address + QR" },
              { label: "Swap help", value: "swap", description: "Use /swap quote or /swap buy" },
              { label: "Faucet claim", value: "f_claim", description: "Random ROOTS (12h)" },
              { label: "Help", value: "help", description: "Command list" },
            ],
          },
        ],
      },
    ],
  });
}

function memberRoleSet(member: Record<string, unknown> | undefined): Set<string> {
  const roles = Array.isArray(member?.roles) ? (member.roles as unknown[]) : [];
  return new Set(roles.map((r) => String(r)));
}

async function handleFaucetClaim(db: D1Database, discordUserId: string, interactionId: string): Promise<Response> {
  const uid = await earnUserIdForDiscord(db, discordUserId);
  if (!uid) {
    return interactionResponse(4, {
      content: `Link Discord on **${DISCORD_VERIFY_URL}** before using the faucet.`,
    });
  }
  const now = new Date().toISOString();
  const prev = await db
    .prepare("SELECT last_claim_at FROM rr_discord_faucet_claim WHERE discord_user_id = ?")
    .bind(discordUserId)
    .first<{ last_claim_at: string }>();
  if (prev?.last_claim_at) {
    const last = Date.parse(String(prev.last_claim_at));
    if (Number.isFinite(last) && Date.now() - last < FAUCET_COOLDOWN_MS) {
      const next = new Date(last + FAUCET_COOLDOWN_MS).toISOString();
      return interactionResponse(4, {
        content: `Faucet cooldown â€” next claim after **${next}** (UTC).`,
      });
    }
  }
  const poolRow = await db.prepare("SELECT balance FROM rr_discord_faucet_pool WHERE id = 1").first<{ balance: number }>();
  const poolBal = Math.max(0, Math.floor(Number(poolRow?.balance) || 0));
  if (poolBal < 1) {
    return interactionResponse(4, {
      content: "Faucet pool is empty. Add ROOTS with **`/faucet deposit`** (linked users).",
    });
  }
  const maxGive = Math.min(50, poolBal, 200);
  const rnd = new Uint32Array(1);
  crypto.getRandomValues(rnd);
  const amount = rootsWholeToAtomic(1 + (rnd[0] % maxGive));
  await ensureBalanceRow(db, uid, now);
  try {
    await db.batch([
      db
        .prepare("UPDATE rr_discord_faucet_pool SET balance = balance - ? WHERE id = 1 AND balance >= ?")
        .bind(amount, amount),
      db.prepare("UPDATE rr_earn_balance SET balance = balance + ?, updated_at = ? WHERE user_id = ?").bind(amount, now, uid),
      db
        .prepare(
          "INSERT INTO rr_discord_faucet_claim (discord_user_id, last_claim_at, last_amount) VALUES (?, ?, ?) ON CONFLICT(discord_user_id) DO UPDATE SET last_claim_at = excluded.last_claim_at, last_amount = excluded.last_amount",
        )
        .bind(discordUserId, now, amount),
    ]);
  } catch (e) {
    console.error("faucet_claim", e instanceof Error ? e.message : String(e));
    return interactionResponse(4, { content: "Faucet failed (try again later)." });
  }
  const left = await db.prepare("SELECT balance FROM rr_discord_faucet_pool WHERE id = 1").first<{ balance: number }>();
  const lb = Math.max(0, Math.floor(Number(left?.balance) || 0));
  void interactionId;
  return interactionResponse(4, {
    content: `Claimed **${fmtRoots(amount)} ROOTS** from the faucet. Pool remaining: **${fmtRoots(lb)} ROOTS**.`,
  });
}

async function handleFaucetDeposit(
  db: D1Database,
  fromUid: string,
  amount: number,
): Promise<Response> {
  if (amount < MIN_SEND || amount > MAX_SEND) {
    return interactionResponse(4, { content: `Deposit **0.00000001**-**${formatRootsAtomicLocale(MAX_SEND)}** Roots (atomic ledger units).` });
  }
  const now = new Date().toISOString();
  await ensureBalanceRow(db, fromUid, now);
  const debit = await db
    .prepare(
      "UPDATE rr_earn_balance SET balance = balance - ?, updated_at = ? WHERE user_id = ? AND balance >= ?",
    )
    .bind(amount, now, fromUid, amount)
    .run();
  if ((debit.meta?.changes ?? 0) !== 1) {
    const have = await getEarnBalance(db, fromUid);
    return interactionResponse(4, {
      content: `Insufficient ROOTS to deposit. You have **${fmtRoots(have)} ROOTS**.`,
    });
  }
  try {
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO rr_discord_faucet_pool (id, balance) VALUES (1, 0)"),
      db.prepare("UPDATE rr_discord_faucet_pool SET balance = balance + ? WHERE id = 1").bind(amount),
    ]);
  } catch (e) {
    await db
      .prepare("UPDATE rr_earn_balance SET balance = balance + ?, updated_at = ? WHERE user_id = ?")
      .bind(amount, now, fromUid)
      .run()
      .catch(() => {});
    console.error("faucet_deposit", e instanceof Error ? e.message : String(e));
    return interactionResponse(4, { content: "Deposit failed. Try again." });
  }
  return interactionResponse(4, {
    content: `Deposited **${fmtRoots(amount)} ROOTS** into the **faucet pool**. Thank you!`,
  });
}

async function handleDiceCreate(
  db: D1Database,
  challengerId: string,
  opts: Array<Record<string, unknown>>,
): Promise<Response> {
  const opponentId = optSnowflake(opts, "opponent") ?? optSnowflakeDeep(opts, "opponent");
  const amountWhole = optNumber(opts, "amount") ?? optNumberDeep(opts, "amount");
  const units = amountWhole != null ? ledgerFromWholeRoots(amountWhole) : null;
  if (!opponentId || units == null) {
    return interactionResponse(4, {
      content: "Use **`/dice`** with **opponent** (user) and **amount** (Roots each puts in the pot, decimal).",
    });
  }
  if (units < MIN_SEND || units > MAX_SEND) {
    return interactionResponse(4, { content: `Amount must be **0.00000001**-**${formatRootsAtomicLocale(MAX_SEND)}** Roots.` });
  }
  if (opponentId === challengerId) {
    return interactionResponse(4, { content: "Pick someone else as your opponent." });
  }
  const chUid = await earnUserIdForDiscord(db, challengerId);
  const opUid = await earnUserIdForDiscord(db, opponentId);
  if (!chUid || !opUid) {
    return interactionResponse(4, {
      content: `Both players must be **linked** to RootRecord (**${DISCORD_VERIFY_URL}**).`,
    });
  }
  const have = await getEarnBalance(db, chUid);
  if (have < units) {
    return interactionResponse(4, {
      content: `You need at least **${fmtRoots(units)} ROOTS** to open this wager (you have **${fmtRoots(have)} ROOTS**).`,
    });
  }
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await db
      .prepare(
        "INSERT INTO discord_dice_challenges (id, challenger_discord_user_id, opponent_discord_user_id, units, state, created_at) VALUES (?, ?, ?, ?, 'pending', ?)",
      )
      .bind(id, challengerId, opponentId, units, now)
      .run();
  } catch (e) {
    console.error("dice_create", e instanceof Error ? e.message : String(e));
    return interactionResponse(4, {
      content: "Could not create challenge (database not migrated?). Run D1 migration **0043_discord_faucet_dice.sql**.",
    });
  }
  return interactionResponse(4, {
    content: `<@${opponentId}> â€” <@${challengerId}> challenges you to **dice** for **${fmtRoots(units)} ROOTS** each (winner takes **${fmtRoots(units * 2)} ROOTS**).`,
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 3,
            label: "Accept & roll",
            custom_id: `dice_ok:${id}`,
          },
        ],
      },
    ],
  });
}

async function settleDiceButtonClick(body: Record<string, unknown>, env: DiscordRootUnitsEnv): Promise<Response> {
  const data = body.data as Record<string, unknown> | undefined;
  const cid = String(data?.custom_id || "");
  if (!cid.startsWith("dice_ok:")) {
    return jsonInteractionPayload({ type: 4, data: { content: "Unknown button.", flags: 64 } });
  }
  const id = cid.slice("dice_ok:".length).trim();
  const actor = String(
    (body.member as { user?: { id?: string } } | undefined)?.user?.id ||
      (body as { user?: { id?: string } }).user?.id ||
      "",
  ).trim();
  if (!actor || !id) {
    return jsonInteractionPayload({ type: 4, data: { content: "Could not read user.", flags: 64 } });
  }

  const row = await env.DB
    .prepare(
      "SELECT challenger_discord_user_id, opponent_discord_user_id, units, state FROM discord_dice_challenges WHERE id = ?",
    )
    .bind(id)
    .first<{
      challenger_discord_user_id: string;
      opponent_discord_user_id: string;
      units: number;
      state: string;
    }>();
  if (!row || String(row.state) !== "pending") {
    return jsonInteractionPayload({
      type: 4,
      data: { content: "This challenge is already finished or expired.", flags: 64 },
    });
  }
  if (actor !== String(row.opponent_discord_user_id).trim()) {
    return jsonInteractionPayload({
      type: 4,
      data: { content: "Only the challenged user can accept.", flags: 64 },
    });
  }

  const units = Math.max(1, Math.floor(Number(row.units) || 0));
  const chDid = String(row.challenger_discord_user_id).trim();
  const opDid = String(row.opponent_discord_user_id).trim();
  const chUid = await earnUserIdForDiscord(env.DB, chDid);
  const opUid = await earnUserIdForDiscord(env.DB, opDid);
  if (!chUid || !opUid) {
    return jsonInteractionPayload({
      type: 4,
      data: { content: "Both players must stay linked to RootRecord.", flags: 64 },
    });
  }

  const hbCh = await getEarnBalance(env.DB, chUid);
  const hbOp = await getEarnBalance(env.DB, opUid);
  if (hbCh < units || hbOp < units) {
    return jsonInteractionPayload({
      type: 4,
      data: {
        content: `Someone no longer has **${fmtRoots(units)} ROOTS** for this duel.`,
        flags: 64,
      },
    });
  }

  let r1 = rollD6();
  let r2 = rollD6();
  let guard = 0;
  while (r1 === r2 && guard++ < 10) {
    r1 = rollD6();
    r2 = rollD6();
  }

  const now = new Date().toISOString();
  await ensureBalanceRow(env.DB, chUid, now);
  await ensureBalanceRow(env.DB, opUid, now);

  try {
    if (r1 === r2) {
      await env.DB
        .prepare(
          "UPDATE discord_dice_challenges SET state = 'done', challenger_roll = ?, opponent_roll = ?, winner_discord_user_id = NULL, resolved_at = ? WHERE id = ? AND state = 'pending'",
        )
        .bind(r1, r2, now, id)
        .run();
      return jsonInteractionPayload({
        type: 7,
        data: {
          content: `**Tie ${r1}â€“${r2}** (after re-rolls). No wagers taken.`,
          components: [],
        },
      });
    }

    const dCh = await env.DB
      .prepare(
        "UPDATE rr_earn_balance SET balance = balance - ?, updated_at = ? WHERE user_id = ? AND balance >= ?",
      )
      .bind(units, now, chUid, units)
      .run();
    if ((dCh.meta?.changes ?? 0) !== 1) throw new Error("debit_ch");
    const dOp = await env.DB
      .prepare(
        "UPDATE rr_earn_balance SET balance = balance - ?, updated_at = ? WHERE user_id = ? AND balance >= ?",
      )
      .bind(units, now, opUid, units)
      .run();
    if ((dOp.meta?.changes ?? 0) !== 1) {
      await env.DB
        .prepare("UPDATE rr_earn_balance SET balance = balance + ?, updated_at = ? WHERE user_id = ?")
        .bind(units, now, chUid)
        .run()
        .catch(() => {});
      throw new Error("debit_op");
    }

    const winDid = r1 > r2 ? chDid : opDid;
    const winUid = r1 > r2 ? chUid : opUid;
    await env.DB
      .prepare("UPDATE rr_earn_balance SET balance = balance + ?, updated_at = ? WHERE user_id = ?")
      .bind(units * 2, now, winUid)
      .run();
    await env.DB
      .prepare(
        "UPDATE discord_dice_challenges SET state = 'done', challenger_roll = ?, opponent_roll = ?, winner_discord_user_id = ?, resolved_at = ? WHERE id = ? AND state = 'pending'",
      )
      .bind(r1, r2, winDid, now, id)
      .run();

    return jsonInteractionPayload({
      type: 7,
      data: {
        content: `ðŸŽ² <@${chDid}> rolled **${r1}**, <@${opDid}> rolled **${r2}**. **Winner:** <@${winDid}> takes **${fmtRoots(units * 2)} ROOTS**!`,
        components: [],
      },
    });
  } catch (e) {
    console.error("dice_settle", e instanceof Error ? e.message : String(e));
    return jsonInteractionPayload({
      type: 4,
      data: { content: "Could not settle the duel. Balances may have changed â€” try **`/dice`** again.", flags: 64 },
    });
  }
}

async function withEphemeralFromResponse(r: Response): Promise<Response> {
  const j = (await r.json()) as {
    data?: { content?: string; flags?: number; components?: unknown[]; embeds?: unknown[] };
  };
  const d = j.data || {};
  const hasEmbeds = Array.isArray(d.embeds) && d.embeds.length > 0;
  return jsonInteractionPayload({
    type: 4,
    data: {
      content: String(d.content ?? (hasEmbeds ? "\u200b" : "â€”")),
      flags: (typeof d.flags === "number" ? d.flags : 0) | 64,
      ...(Array.isArray(d.components) ? { components: d.components } : {}),
      ...(hasEmbeds ? { embeds: d.embeds } : {}),
    },
  });
}

async function handleMessageComponent(body: Record<string, unknown>, env: DiscordRootUnitsEnv): Promise<Response> {
  const data = body.data as Record<string, unknown> | undefined;
  const cid = String(data?.custom_id || "");
  if (cid.startsWith("dice_ok:")) {
    return settleDiceButtonClick(body, env);
  }
  if (cid === "rootrecord_menu") {
    const vals = Array.isArray(data?.values) ? (data.values as string[]) : [];
    const v = String(vals[0] || "").trim();
    const member = body.member as Record<string, unknown> | undefined;
    const uid = String((member?.user as { id?: string } | undefined)?.id || "").trim();
    if (!uid) {
      return jsonInteractionPayload({ type: 4, data: { content: "Missing user.", flags: 64 } });
    }
    if (v === "bal") return withEphemeralFromResponse(await handleBal(env.DB, uid, env));
    if (v === "wallet") return withEphemeralFromResponse(await handleWalletDeposit(env.DB, uid));
    if (v === "swap") {
      return jsonInteractionPayload({
        type: 4,
        data: {
          flags: 64,
          content:
            "Use **`/swap quote amount:<SOL>`** to preview, **`/swap buy amount:<SOL>`** to buy, or **`/swap all`** to send all spendable SOL from your linked custodial wallet.",
        },
      });
    }
    if (v === "f_claim") {
      const iid = String(body.id || "").trim();
      return withEphemeralFromResponse(await handleFaucetClaim(env.DB, uid, iid));
    }
    if (v === "help") {
      return jsonInteractionPayload({
        type: 4,
        data: {
          flags: 64,
          content:
            "**Commands:** `/bal`, `/economy`, `/send` (Root Units sharing; SOL transfers via `/send user`), `/swap` (SOL â†’ internal ROOTS), `/wallet`, `/deposit`, `/menu`, `/faucet`, `/dice`. KÄ«lauea: use the **Kilauea Alerts** bot (`/kilauea`, `/data`). Developer: `/screenshot`, `/snapshot`, `/activity`, `/userreport`, `/token`, `/mint`. `/withdraw` & `/airdrop` soon.",
        },
      });
    }
    return jsonInteractionPayload({ type: 4, data: { content: "Unknown menu choice.", flags: 64 } });
  }
  return jsonInteractionPayload({ type: 4, data: { content: "Unknown component.", flags: 64 } });
}

const DISCORD_ELLIPSIS = "\u2026";
const DISCORD_BULLET = "\u2022";
const DISCORD_ARROW = "\u2192";

function truncateText(raw: unknown, max: number): string {
  const s = String(raw ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}${DISCORD_ELLIPSIS}` : s;
}

function accountAnonId(raw: unknown): string {
  const clean = String(raw || "").replace(/[^a-zA-Z0-9]/g, "");
  return clean ? `acct_${clean.slice(0, 10)}` : "acct_unknown";
}

function emailDomain(raw: unknown): string {
  const email = String(raw || "").trim().toLowerCase();
  const i = email.lastIndexOf("@");
  return i > 0 && i < email.length - 1 ? email.slice(i + 1) : "unknown";
}

function userIdFromEmail(raw: unknown): string {
  const email = String(raw || "").trim().toLowerCase();
  return email.includes("@") ? `user:${email}` : "";
}

function jsonForArchive(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
}

function grokChatBearerToken(env: DiscordRootUnitsEnv): string {
  return String(env.GROK_API_BEARER_TOKEN || "").trim();
}

function grokResponseText(response: Record<string, unknown>): string {
  const message = (response.choices as Array<Record<string, unknown>> | undefined)?.[0]?.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          const obj = part as Record<string, unknown>;
          return String(obj.text || obj.content || "");
        }
        return "";
      })
      .join("")
      .trim();
  }
  return "";
}

function grokErrorText(response: Record<string, unknown>, status: number): string {
  const error = response.error as Record<string, unknown> | string | undefined;
  if (typeof error === "string" && error.trim()) return `HTTP ${status}: ${error.trim()}`;
  if (error && typeof error === "object") {
    const message = String(error.message || error.detail || error.code || "").trim();
    if (message) return `HTTP ${status}: ${message}`;
  }
  const detail = String(response.detail || response.message || "").trim();
  return detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}: empty Grok response`;
}

function parseJsonObject(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function decodeHtmlEntities(raw: unknown): string {
  return String(raw ?? "")
    .replace(/&mdash;/g, "â€”")
    .replace(/&ndash;/g, "â€“")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

async function developerRoleIds(env: DiscordRootUnitsEnv): Promise<Set<string>> {
  const configured = String(env.DISCORD_DEVELOPER_ROLE_ID || "").trim();
  if (configured) return new Set([configured]);

  const bot = String(env.DISCORD_BOT_TOKEN || "").trim();
  const guildId = String(env.DISCORD_GUILD_ID || "").trim();
  if (!bot || !guildId) return new Set();

  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}/roles`, {
      headers: { Authorization: `Bot ${bot}`, "User-Agent": "RootRecord/discord-screenshot" },
    });
    if (!res.ok) return new Set();
    const roles = (await res.json()) as Array<Record<string, unknown>>;
    const match = roles.find((r) => String(r.name || "").trim().toLowerCase() === "developer");
    const id = String(match?.id || "").trim();
    return id ? new Set([id]) : new Set();
  } catch {
    return new Set();
  }
}

async function hasDeveloperRole(member: Record<string, unknown> | undefined, env: DiscordRootUnitsEnv): Promise<boolean> {
  const memberRoles = Array.isArray(member?.roles) ? member!.roles.map((r) => String(r)) : [];
  if (!memberRoles.length) return false;
  const allowed = await developerRoleIds(env);
  if (!allowed.size) return false;
  return memberRoles.some((r) => allowed.has(r));
}

async function dbAll<T>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T[]> {
  try {
    let stmt = db.prepare(sql);
    if (binds.length) stmt = stmt.bind(...binds);
    const rows = await stmt.all<T>();
    return rows.results || [];
  } catch (e) {
    return [{ error: e instanceof Error ? e.message : String(e) } as T];
  }
}

async function dbFirst<T>(db: D1Database, sql: string, ...binds: unknown[]): Promise<T | null> {
  try {
    let stmt = db.prepare(sql);
    if (binds.length) stmt = stmt.bind(...binds);
    return await stmt.first<T>();
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) } as T;
  }
}

type UserReportScopeMode = "all" | "role" | "user" | "member";

type UserReportAccountRef = {
  account_id: string;
  email: string;
  discord_user_id?: string | null;
  discord_username?: string | null;
  discord_global_name?: string | null;
};

type UserReportScope = {
  mode: UserReportScopeMode;
  label: string;
  accountIds: string[];
  userIds: string[];
  discordUserIds: string[];
  public: Record<string, unknown>;
  notes: string[];
};

function uniqueStrings(values: unknown[], max = 800): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const s = String(raw || "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

function allUserReportScope(): UserReportScope {
  return {
    mode: "all",
    label: "all RootRecord users",
    accountIds: [],
    userIds: [],
    discordUserIds: [],
    public: { mode: "all", label: "all RootRecord users" },
    notes: [],
  };
}

function publicAccountRefs(rows: UserReportAccountRef[]): Array<Record<string, unknown>> {
  return rows.slice(0, 25).map((row) => ({
    account: accountAnonId(row.account_id),
    email_domain: emailDomain(row.email),
    discord: truncateText(row.discord_global_name || row.discord_username || "", 80) || null,
    linked_discord: Boolean(String(row.discord_user_id || "").trim()),
  }));
}

function redactedLookup(raw: string): string {
  const q = raw.trim();
  const mention = q.match(/^<@!?(\d+)>$/);
  if (mention) return `discord:${mention[1]!.slice(-6)}`;
  if (q.includes("@")) return `email:*@${emailDomain(q)}`;
  if (/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(q)) return `${q.slice(0, 6)}â€¦${q.slice(-4)}`;
  if (/^\d{12,24}$/.test(q)) return `discord:${q.slice(-6)}`;
  if (q.length > 16) return `${q.slice(0, 8)}â€¦`;
  return q.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 16) || "lookup";
}

function mentionToDiscordId(raw: string): string {
  const q = raw.trim();
  const mention = q.match(/^<@!?(\d+)>$/);
  return mention?.[1] || q;
}

function scopeFromAccounts(
  mode: UserReportScopeMode,
  label: string,
  rowsRaw: UserReportAccountRef[],
  extraPublic: Record<string, unknown> = {},
  notes: string[] = [],
): UserReportScope {
  const rows = rowsRaw.filter((row) => String(row.account_id || "").trim() && String(row.email || "").includes("@"));
  const accountIds = uniqueStrings(rows.map((row) => row.account_id));
  const userIds = uniqueStrings(rows.map((row) => userIdFromEmail(row.email)).filter(Boolean));
  const discordUserIds = uniqueStrings(rows.map((row) => row.discord_user_id || "").filter(Boolean));
  return {
    mode,
    label,
    accountIds,
    userIds,
    discordUserIds,
    public: {
      mode,
      label,
      matched_accounts: accountIds.length,
      matched_discord_users: discordUserIds.length,
      accounts: publicAccountRefs(rows),
      ...extraPublic,
    },
    notes,
  };
}

function scopedWhere(column: string, values: string[], keyword: "WHERE" | "AND" = "WHERE"): { sql: string; binds: string[] } {
  const clean = uniqueStrings(values);
  if (!clean.length) return { sql: "", binds: [] };
  return { sql: ` ${keyword} ${column} IN (${clean.map(() => "?").join(",")})`, binds: clean };
}

function scopedEitherWhere(
  columnA: string,
  columnB: string,
  values: string[],
  keyword: "WHERE" | "AND" = "WHERE",
): { sql: string; binds: string[] } {
  const clean = uniqueStrings(values);
  if (!clean.length) return { sql: "", binds: [] };
  const ph = clean.map(() => "?").join(",");
  return { sql: ` ${keyword} (${columnA} IN (${ph}) OR ${columnB} IN (${ph}))`, binds: [...clean, ...clean] };
}

async function linkedAccountsForDiscordIds(db: D1Database, discordIdsRaw: string[]): Promise<UserReportAccountRef[]> {
  const discordIds = uniqueStrings(discordIdsRaw, 2000);
  const out: UserReportAccountRef[] = [];
  for (let i = 0; i < discordIds.length; i += 250) {
    const chunk = discordIds.slice(i, i + 250);
    const ph = chunk.map(() => "?").join(",");
    const rows = await dbAll<UserReportAccountRef>(
      db,
      `SELECT la.id AS account_id,
              la.email AS email,
              link.discord_user_id AS discord_user_id,
              link.discord_username AS discord_username,
              link.discord_global_name AS discord_global_name
       FROM discord_account_links link
       INNER JOIN license_accounts la ON la.id = link.account_id
       WHERE link.discord_user_id IN (${ph})
       ORDER BY la.updated_at DESC
       LIMIT 250`,
      ...chunk,
    );
    out.push(...rows.filter((row) => !(row as Record<string, unknown>).error));
  }
  return out;
}

async function resolveUserReportQuery(db: D1Database, rawQuery: string): Promise<UserReportAccountRef[]> {
  const q = rawQuery.trim();
  const normalized = mentionToDiscordId(q).trim();
  const lower = normalized.toLowerCase();
  const like = lower.length >= 3 ? `%${lower}%` : "__never_match__";
  return (
    await dbAll<UserReportAccountRef>(
      db,
      `SELECT la.id AS account_id,
              la.email AS email,
              link.discord_user_id AS discord_user_id,
              link.discord_username AS discord_username,
              link.discord_global_name AS discord_global_name
       FROM license_accounts la
       LEFT JOIN discord_account_links link ON link.account_id = la.id
       LEFT JOIN solana_linked_wallets sw ON sw.account_id = la.id
       LEFT JOIN internal_solana_wallets iw ON iw.account_id = la.id
       WHERE lower(la.email) = ?
          OR lower(la.id) = ?
          OR lower('user:' || la.email) = ?
          OR link.discord_user_id = ?
          OR lower(COALESCE(link.discord_username, '')) = ?
          OR lower(COALESCE(link.discord_global_name, '')) = ?
          OR lower(COALESCE(sw.pubkey, '')) = ?
          OR lower(COALESCE(iw.pubkey, '')) = ?
          OR lower(COALESCE(link.discord_username, '')) LIKE ?
          OR lower(COALESCE(link.discord_global_name, '')) LIKE ?
       ORDER BY la.updated_at DESC
       LIMIT 25`,
      lower,
      lower,
      lower,
      normalized,
      lower,
      lower,
      lower,
      lower,
      like,
      like,
    )
  ).filter((row) => !(row as Record<string, unknown>).error);
}

async function resolveUserReportScope(
  env: DiscordRootUnitsEnv,
  opts: Array<Record<string, unknown>>,
): Promise<{ scope: UserReportScope } | { error: string }> {
  const sub = invokedSubcommand(opts);
  if (!sub || sub.name === "all") return { scope: allUserReportScope() };

  if (sub.name === "role") {
    const roleId = optRole(sub.inner, "role") || optRoleDeep(sub.inner, "role");
    if (!roleId) return { error: "Choose a Discord role for `/userreport role`." };
    const bot = String(env.DISCORD_BOT_TOKEN || "").trim();
    const guildId = String(env.DISCORD_GUILD_ID || "").trim();
    if (!bot || !guildId) return { error: "Configure `DISCORD_BOT_TOKEN` and `DISCORD_GUILD_ID` for role reports." };
    const fetched = await fetchDiscordUserIdsWithGuildRole(guildId, roleId, bot);
    if (!fetched.ok) {
      return { error: `Could not list guild members for that role (${fetched.status}). Bot needs View Server Members + Server Members Intent.` };
    }
    const linked = await linkedAccountsForDiscordIds(env.DB, fetched.ids);
    if (!linked.length) return { error: "No verified RootRecord accounts are linked to users with that role." };
    return {
      scope: scopeFromAccounts(
        "role",
        `Discord role ${roleId.slice(-6)}`,
        linked,
        { role_id_suffix: roleId.slice(-6), discord_members_scanned: fetched.ids.length },
        fetched.ids.length > linked.length ? [`${fetched.ids.length - linked.length} role members were not linked to RootRecord accounts.`] : [],
      ),
    };
  }

  if (sub.name === "member") {
    const discordId = optSnowflakeDeep(sub.inner, "member");
    if (!discordId) return { error: "Choose a Discord member for `/userreport member`." };
    const linked = await linkedAccountsForDiscordIds(env.DB, [discordId]);
    if (!linked.length) return { error: "That Discord member is not linked to a RootRecord account." };
    return { scope: scopeFromAccounts("member", `Discord member ${discordId.slice(-6)}`, linked) };
  }

  if (sub.name === "user") {
    const query = optStringDeep(sub.inner, "query");
    if (!query || query.length < 2) return { error: "Add an email, account id, user id, Discord name/id, or Solana wallet." };
    const rows = await resolveUserReportQuery(env.DB, query);
    if (!rows.length) return { error: `No RootRecord account matched \`${redactedLookup(query)}\`.` };
    return { scope: scopeFromAccounts("user", `lookup ${redactedLookup(query)}`, rows, { lookup: redactedLookup(query) }) };
  }

  return { error: "Use `/userreport all`, `/userreport role`, `/userreport user`, or `/userreport member`." };
}

async function fetchRootRecordPageSummary(url: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "RootRecord/discord-screenshot" } });
    const text = await res.text();
    const title = text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "";
    const description =
      text.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i)?.[1] ||
      text.match(/<meta\s+content=["']([^"']*)["']\s+name=["']description["']/i)?.[1] ||
      "";
    const h1 = text.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "";
    return {
      url,
      status: res.status,
      title: truncateText(decodeHtmlEntities(title.replace(/<[^>]+>/g, "")), 160),
      description: truncateText(decodeHtmlEntities(description), 260),
      h1: truncateText(decodeHtmlEntities(h1.replace(/<[^>]+>/g, "")), 180),
      bytes: text.length,
    };
  } catch (e) {
    return { url, error: e instanceof Error ? e.message : String(e) };
  }
}

async function fetchRootRecordTweets(env: DiscordRootUnitsEnv): Promise<Record<string, unknown>> {
  const bearer = String(env.GROK_X_BEARER_TOKEN || "").trim();
  const username = String(env.GROK_X_USERNAME || "rootrecord").replace(/^@/, "").trim() || "rootrecord";
  if (!bearer) return { configured: false, username };

  const headers = { Authorization: `Bearer ${bearer}`, "User-Agent": "RootRecord/discord-screenshot" };
  try {
    const userRes = await fetch(`https://api.twitter.com/2/users/by/username/${encodeURIComponent(username)}`, { headers });
    const userJson = (await userRes.json().catch(() => ({}))) as Record<string, unknown>;
    const userId = String((userJson.data as Record<string, unknown> | undefined)?.id || "").trim();
    if (!userRes.ok || !userId) return { configured: true, username, status: userRes.status, error: userJson };
    const q = new URLSearchParams({
      max_results: "5",
      exclude: "retweets,replies",
      "tweet.fields": "created_at,public_metrics",
    });
    const twRes = await fetch(`https://api.twitter.com/2/users/${encodeURIComponent(userId)}/tweets?${q}`, { headers });
    const twJson = (await twRes.json().catch(() => ({}))) as Record<string, unknown>;
    return { configured: true, username, status: twRes.status, tweets: twJson };
  } catch (e) {
    return { configured: true, username, error: e instanceof Error ? e.message : String(e) };
  }
}

async function fetchRootRecordReddit(): Promise<Record<string, unknown>> {
  const url = "https://www.reddit.com/r/rootrecord/new.json?limit=10";
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "RootRecord/discord-ai-report/1.0 (community usage scan)" },
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const children = Array.isArray((data.data as Record<string, unknown> | undefined)?.children)
      ? ((data.data as Record<string, unknown>).children as Array<Record<string, unknown>>)
      : [];
    const posts = children
      .map((child) => {
        const p = (child.data as Record<string, unknown> | undefined) || {};
        return {
          id: String(p.id || ""),
          title: truncateText(p.title, 160),
          author: String(p.author || ""),
          score: n(p.score),
          comments: n(p.num_comments),
          created_utc: n(p.created_utc),
          permalink: p.permalink ? `https://www.reddit.com${String(p.permalink)}` : "",
          selftext: truncateText(p.selftext, 320),
        };
      })
      .filter((p) => p.id && p.title);
    return { configured: true, subreddit: "r/rootrecord", status: res.status, posts };
  } catch (e) {
    return { configured: true, subreddit: "r/rootrecord", error: e instanceof Error ? e.message : String(e) };
  }
}

function pct(part: number, total: number): number {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.round((part / total) * 1000) / 10;
}

function enrichAppUsageRows(appDays: unknown, sessionRows: unknown, openRows: unknown): Array<Record<string, unknown>> {
  const dayRows = Array.isArray(appDays) ? appDays : [];
  const sessionList = Array.isArray(sessionRows) ? sessionRows : [];
  const openList = Array.isArray(openRows) ? openRows : [];
  const byApp = new Map<string, Record<string, unknown>>();

  for (const raw of dayRows) {
    const row = raw as Record<string, unknown>;
    const appId = String(row.app_id || "").trim();
    if (!appId || row.error) continue;
    byApp.set(appId, {
      app_id: appId,
      units_earned: Math.max(0, Math.floor(n(row.units_earned))),
      active_days: Math.max(0, Math.floor(n(row.active_days))),
    });
  }
  for (const raw of sessionList) {
    const row = raw as Record<string, unknown>;
    const appId = String(row.app_id || "").trim();
    if (!appId || row.error) continue;
    const entry = byApp.get(appId) || { app_id: appId, units_earned: 0, active_days: 0 };
    entry.sec_on_page = Math.max(0, Math.floor(n(row.sec_on_page)));
    entry.active_users = Math.max(0, Math.floor(n(row.active_users)));
    entry.latest_heartbeat_at = row.latest_heartbeat_at || null;
    byApp.set(appId, entry);
  }
  for (const raw of openList) {
    const row = raw as Record<string, unknown>;
    const appId = String(row.app_id || "").trim();
    if (!appId || row.error) continue;
    const entry = byApp.get(appId) || { app_id: appId, units_earned: 0, active_days: 0 };
    entry.recent_open_users = Math.max(0, Math.floor(n(row.recent_open_users)));
    entry.latest_open_at = row.latest_open_at || null;
    byApp.set(appId, entry);
  }

  const rows = [...byApp.values()];
  const totalUnits = rows.reduce((sum, row) => sum + n(row.units_earned), 0);
  const totalSeconds = rows.reduce((sum, row) => sum + n(row.sec_on_page), 0);
  for (const row of rows) {
    row.earned_share_pct = pct(n(row.units_earned), totalUnits);
    row.time_share_pct = pct(n(row.sec_on_page), totalSeconds);
  }
  rows.sort((a, b) => n(b.time_share_pct) - n(a.time_share_pct) || n(b.units_earned) - n(a.units_earned));
  return rows;
}

async function collectDiscordActivityReportData(env: DiscordRootUnitsEnv, requesterDiscordId: string): Promise<Record<string, unknown>> {
  const nowIso = new Date().toISOString();
  const [
    totals,
    daily,
    channels,
    topUsers,
    linkedActive,
    recentMessages,
    discoveredChannels,
    announcements,
  ] = await Promise.all([
    dbFirst(
      env.DB,
      `SELECT COUNT(*) AS tracked_users,
              COALESCE(SUM(message_count), 0) AS tracked_user_messages,
              COALESCE(SUM(CASE WHEN last_message_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END), 0) AS active_users_7d,
              COALESCE(SUM(CASE WHEN last_message_at >= datetime('now', '-30 days') THEN 1 ELSE 0 END), 0) AS active_users_30d,
              MAX(last_message_at) AS latest_message_at
       FROM discord_user_activity`,
    ),
    dbAll(
      env.DB,
      `SELECT day, message_count
       FROM discord_activity_daily
       ORDER BY day DESC
       LIMIT 30`,
    ),
    dbAll(
      env.DB,
      `SELECT c.channel_id,
              COALESCE(d.name, c.channel_id) AS channel_name,
              d.type AS channel_type,
              COALESCE(SUM(c.message_count), 0) AS message_count,
              MAX(c.day) AS latest_day
       FROM discord_activity_daily_by_channel c
       LEFT JOIN discord_discovered_channels d ON d.channel_id = c.channel_id
       WHERE c.day >= date('now', '-30 days')
       GROUP BY c.channel_id
       ORDER BY message_count DESC
       LIMIT 25`,
    ),
    dbAll(
      env.DB,
      `SELECT discord_user_id,
              username,
              global_name,
              last_message_at,
              message_count
       FROM discord_user_activity
       WHERE last_message_at >= datetime('now', '-30 days')
       ORDER BY message_count DESC, last_message_at DESC
       LIMIT 25`,
    ),
    dbAll(
      env.DB,
      `SELECT l.account_id,
              l.email,
              a.discord_user_id,
              a.username,
              a.global_name,
              a.last_message_at,
              a.message_count
       FROM discord_account_links l
       INNER JOIN discord_user_activity a ON a.discord_user_id = l.discord_user_id
       WHERE a.last_message_at >= datetime('now', '-30 days')
       ORDER BY a.last_message_at DESC
       LIMIT 25`,
    ),
    dbAll(
      env.DB,
      `SELECT s.discord_message_id,
              s.channel_id,
              COALESCE(d.name, s.channel_id) AS channel_name,
              s.created_at
       FROM discord_channel_message_stats s
       LEFT JOIN discord_discovered_channels d ON d.channel_id = s.channel_id
       ORDER BY s.created_at DESC
       LIMIT 25`,
    ),
    dbAll(
      env.DB,
      `SELECT channel_id, guild_id, name, type, position, parent_id, updated_at
       FROM discord_discovered_channels
       ORDER BY position ASC, name ASC
       LIMIT 75`,
    ),
    dbAll(
      env.DB,
      `SELECT app_scope, title, body, created_at
       FROM developer_messages
       ORDER BY created_at DESC
       LIMIT 12`,
    ),
  ]);

  const days = (Array.isArray(daily) ? daily : []) as Array<Record<string, unknown>>;
  const totalMessages30d = days.reduce((sum, row) => sum + n((row as Record<string, unknown>).message_count), 0);
  const mostRecentDay = days[0] as Record<string, unknown> | undefined;
  const previousDay = days[1] as Record<string, unknown> | undefined;

  return {
    generated_at: nowIso,
    requested_by_discord_id: requesterDiscordId,
    purpose: "Developer-only Discord activity report for Root Record community operations",
    source_tables: [
      "discord_activity_daily",
      "discord_activity_daily_by_channel",
      "discord_channel_message_stats",
      "discord_discovered_channels",
      "discord_user_activity",
      "discord_account_links",
      "developer_messages",
    ],
    totals,
    calculated: {
      total_messages_30d: totalMessages30d,
      latest_day: mostRecentDay?.day || null,
      latest_day_messages: n(mostRecentDay?.message_count),
      previous_day_messages: n(previousDay?.message_count),
      latest_day_delta: n(mostRecentDay?.message_count) - n(previousDay?.message_count),
    },
    daily_30d: daily,
    channel_activity_30d: channels,
    top_users_30d: topUsers,
    linked_active_users_30d: linkedActive,
    recent_messages: recentMessages,
    discovered_channels: discoveredChannels,
    recent_announcements_feed: announcements,
  };
}

async function loadRecentActivityAiReport(env: DiscordRootUnitsEnv, maxAgeMs: number): Promise<Record<string, unknown> | null> {
  const row = await dbFirst<{ id: string; created_at: string; prompt_json: string; response_json: string }>(
    env.DB,
    `SELECT id, created_at, prompt_json, response_json
     FROM discord_ai_reports
     WHERE command_name = '/activity'
     ORDER BY created_at DESC
     LIMIT 1`,
  );
  if (!row || (row as Record<string, unknown>).error) return null;
  const createdMs = Date.parse(row.created_at);
  if (!Number.isFinite(createdMs) || Date.now() - createdMs > maxAgeMs) return null;
  const response = parseJsonObject(row.response_json);
  const final = (response?.final as Record<string, unknown> | undefined) || response;
  const prompt = parseJsonObject(row.prompt_json);
  return {
    id: row.id,
    created_at: row.created_at,
    generated_for_snapshot: false,
    content: truncateText(String(final?.content || final?.fallback || ""), 1800),
    status: final?.status || null,
    summary_metrics: (prompt?.calculated as Record<string, unknown> | undefined) || null,
  };
}

async function generateDiscordActivityAiReport(
  env: DiscordRootUnitsEnv,
  requesterDiscordId: string,
  discord: { interactionId: string; channelId: string; guildId: string; userId: string },
  opts: { generatedForSnapshot?: boolean } = {},
): Promise<Record<string, unknown>> {
  const reportData = await collectDiscordActivityReportData(env, requesterDiscordId);
  const archiveId = crypto.randomUUID();
  const final = await callGrokAnalysis(
    env,
    "Discord Activity Report",
    "Analyze Discord-only activity for the Root Record community. Focus on channel utilization, message trends, active/linked member signals, announcement feed activity, and operational watch items. Avoid token price or ROOTS balance analysis unless the Discord activity directly references it. Return Discord-ready Markdown sections: Activity Pulse, Channels, Member Signals, Watch Items, Recommended Actions.",
    reportData,
  );
  await postAiChannelMessage(env, {
    content: `**/activity Discord report ${archiveId.slice(0, 8)}${opts.generatedForSnapshot ? " (snapshot refresh)" : ""}**\n${String(final.content || "No activity AI content returned.").slice(0, 1700)}`,
  });
  await archiveAiReport(
    env,
    "/activity",
    {
      id: archiveId,
      created_at: new Date().toISOString(),
      prompt: reportData,
      response: { final },
    },
    discord,
  );
  return {
    id: archiveId,
    created_at: new Date().toISOString(),
    generated_for_snapshot: Boolean(opts.generatedForSnapshot),
    content: truncateText(String(final.content || final.fallback || "Discord activity report generated."), 1800),
    status: final.status || null,
    summary_metrics: reportData.calculated as Record<string, unknown>,
  };
}

function sanitizedUserSamples(usersRaw: unknown, appEarnRaw: unknown, appStateRaw: unknown, appOpenRaw: unknown): Array<Record<string, unknown>> {
  const users = (Array.isArray(usersRaw) ? usersRaw : []).filter((raw) => !(raw as Record<string, unknown>).error) as Array<Record<string, unknown>>;
  const byUser = new Map<string, Record<string, Record<string, unknown>>>();
  const ensureApp = (userId: string, appId: string): Record<string, unknown> => {
    const app = appId.trim() || "unknown";
    const perUser = byUser.get(userId) || {};
    const current = perUser[app] || { app_id: app };
    perUser[app] = current;
    byUser.set(userId, perUser);
    return current;
  };

  for (const raw of Array.isArray(appEarnRaw) ? appEarnRaw : []) {
    const row = raw as Record<string, unknown>;
    if (row.error) continue;
    const userId = String(row.user_id || "").trim().toLowerCase();
    const app = ensureApp(userId, String(row.app_id || ""));
    app.units_earned_30d = Math.max(0, Math.floor(n(row.units_earned_30d)));
    app.active_days_30d = Math.max(0, Math.floor(n(row.active_days_30d)));
    app.latest_earn_at = row.latest_earn_at || null;
  }
  for (const raw of Array.isArray(appStateRaw) ? appStateRaw : []) {
    const row = raw as Record<string, unknown>;
    if (row.error) continue;
    const userId = String(row.user_id || "").trim().toLowerCase();
    const app = ensureApp(userId, String(row.app_id || ""));
    app.sec_on_page = Math.max(0, Math.floor(n(row.sec_on_page)));
    app.current_page = truncateText(row.page_path || "", 120);
    app.latest_heartbeat_at = row.updated_at || null;
  }
  for (const raw of Array.isArray(appOpenRaw) ? appOpenRaw : []) {
    const row = raw as Record<string, unknown>;
    if (row.error) continue;
    const userId = String(row.user_id || "").trim().toLowerCase();
    const app = ensureApp(userId, String(row.app_id || ""));
    app.last_open_at = row.last_open_at || null;
  }

  return users.map((row) => {
    const userId = userIdFromEmail(row.email);
    const appRows = Object.values(byUser.get(userId) || {})
      .sort((a, b) => n(b.sec_on_page) - n(a.sec_on_page) || n(b.units_earned_30d) - n(a.units_earned_30d))
      .slice(0, 8);
    return {
      account: accountAnonId(row.account_id),
      email_domain: emailDomain(row.email),
      created_at: row.created_at || null,
      updated_at: row.updated_at || null,
      last_seen_at: row.last_seen_at || row.last_app_open_at || row.latest_heartbeat_at || null,
      linked_discord: Boolean(n(row.linked_discord)),
      discord_name: truncateText(row.discord_name || "", 80) || null,
      session_count: Math.max(0, Math.floor(n(row.session_count))),
      active_sessions: Math.max(0, Math.floor(n(row.active_sessions))),
      opened_apps: Math.max(0, Math.floor(n(row.opened_apps))),
      focused_apps: Math.max(0, Math.floor(n(row.focused_apps))),
      sec_on_page: Math.max(0, Math.floor(n(row.sec_on_page))),
      active_days_30d: Math.max(0, Math.floor(n(row.active_days_30d))),
      units_earned_30d: Math.max(0, Math.floor(n(row.units_earned_30d))),
      roots_balance: Math.max(0, Math.floor(n(row.roots_balance))),
      push_tokens: Math.max(0, Math.floor(n(row.push_tokens))),
      business_rows: Math.max(0, Math.floor(n(row.business_rows))),
      saved_locations: Math.max(0, Math.floor(n(row.saved_locations))),
      weather_snapshots: Math.max(0, Math.floor(n(row.weather_snapshots))),
      apps: appRows,
    };
  });
}

function compactUserAppRows(rows: unknown): Array<Record<string, unknown>> {
  return (Array.isArray(rows) ? rows : [])
    .filter((raw) => !(raw as Record<string, unknown>).error)
    .map((raw) => {
      const row = raw as Record<string, unknown>;
      return {
        app_id: String(row.app_id || "unknown"),
        units_earned: Math.max(0, Math.floor(n(row.units_earned))),
        active_days: Math.max(0, Math.floor(n(row.active_days))),
        sec_on_page: Math.max(0, Math.floor(n(row.sec_on_page))),
        active_users: Math.max(0, Math.floor(n(row.active_users))),
        recent_open_users: Math.max(0, Math.floor(n(row.recent_open_users))),
        latest_open_at: row.latest_open_at || row.latest_heartbeat_at || null,
        earned_share_pct: n(row.earned_share_pct),
        time_share_pct: n(row.time_share_pct),
      };
    });
}

async function collectScopedUserSamples(env: DiscordRootUnitsEnv, scope: UserReportScope): Promise<Array<Record<string, unknown>>> {
  if (scope.mode === "all" || !scope.accountIds.length || !scope.userIds.length) return [];
  const accountWhere = scopedWhere("la.id", scope.accountIds, "WHERE");
  const userEarn = scopedWhere("user_id", scope.userIds, "AND");
  const userOnly = scopedWhere("user_id", scope.userIds, "WHERE");
  const userRows = await dbAll(
    env.DB,
    `WITH earn30 AS (
       SELECT user_id, COALESCE(SUM(units_earned), 0) AS units_earned_30d, COUNT(DISTINCT ymd) AS active_days_30d
       FROM rr_earn_app_day
       WHERE julianday(ymd) >= julianday('now', '-30 days')${userEarn.sql}
       GROUP BY user_id
     ),
     state AS (
       SELECT user_id, COALESCE(SUM(sec_on_page), 0) AS sec_on_page, COUNT(DISTINCT app_id) AS focused_apps, MAX(updated_at) AS latest_heartbeat_at
       FROM rr_earn_state${userOnly.sql}
       GROUP BY user_id
     ),
     opens AS (
       SELECT user_id, COUNT(DISTINCT app_id) AS opened_apps, MAX(last_open_at) AS last_app_open_at
       FROM rr_app_session_last_open${userOnly.sql}
       GROUP BY user_id
     ),
     sessions AS (
       SELECT account_id, COUNT(*) AS session_count, COALESCE(SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END), 0) AS active_sessions, MAX(last_seen_at) AS last_seen_at
       FROM license_sessions
       GROUP BY account_id
     ),
     push AS (
       SELECT user_id, COUNT(*) AS push_tokens
       FROM rrwm_push_tokens${userOnly.sql}
       GROUP BY user_id
     ),
     bm AS (
       SELECT user_key, COUNT(*) AS business_rows
       FROM bm_owned_row
       GROUP BY user_key
     ),
     loc AS (
       SELECT user_id, COUNT(*) AS saved_locations
       FROM rrwm_locations${userOnly.sql}
       GROUP BY user_id
     ),
     weather AS (
       SELECT user_id, COUNT(*) AS weather_snapshots
       FROM weather_data${userOnly.sql}
       GROUP BY user_id
     )
     SELECT la.id AS account_id,
            la.email AS email,
            la.created_at AS created_at,
            la.updated_at AS updated_at,
            COALESCE(sessions.session_count, 0) AS session_count,
            COALESCE(sessions.active_sessions, 0) AS active_sessions,
            sessions.last_seen_at AS last_seen_at,
            COALESCE(opens.opened_apps, 0) AS opened_apps,
            opens.last_app_open_at AS last_app_open_at,
            COALESCE(state.focused_apps, 0) AS focused_apps,
            COALESCE(state.sec_on_page, 0) AS sec_on_page,
            state.latest_heartbeat_at AS latest_heartbeat_at,
            COALESCE(earn30.units_earned_30d, 0) AS units_earned_30d,
            COALESCE(earn30.active_days_30d, 0) AS active_days_30d,
            COALESCE(balance.balance, 0) AS roots_balance,
            COALESCE(push.push_tokens, 0) AS push_tokens,
            COALESCE(bm.business_rows, 0) AS business_rows,
            COALESCE(loc.saved_locations, 0) AS saved_locations,
            COALESCE(weather.weather_snapshots, 0) AS weather_snapshots,
            CASE WHEN link.discord_user_id IS NULL THEN 0 ELSE 1 END AS linked_discord,
            COALESCE(link.discord_global_name, link.discord_username, '') AS discord_name
     FROM license_accounts la
     LEFT JOIN earn30 ON earn30.user_id = 'user:' || lower(la.email)
     LEFT JOIN state ON state.user_id = 'user:' || lower(la.email)
     LEFT JOIN opens ON opens.user_id = 'user:' || lower(la.email)
     LEFT JOIN sessions ON sessions.account_id = la.id
     LEFT JOIN rr_earn_balance balance ON balance.user_id = 'user:' || lower(la.email)
     LEFT JOIN push ON push.user_id = 'user:' || lower(la.email)
     LEFT JOIN bm ON bm.user_key = 'user:' || lower(la.email)
     LEFT JOIN loc ON loc.user_id = 'user:' || lower(la.email)
     LEFT JOIN weather ON weather.user_id = 'user:' || lower(la.email)
     LEFT JOIN discord_account_links link ON link.account_id = la.id
     ${accountWhere.sql}
     ORDER BY COALESCE(opens.last_app_open_at, state.latest_heartbeat_at, sessions.last_seen_at, la.created_at) DESC
     LIMIT 80`,
    ...userEarn.binds,
    ...userOnly.binds,
    ...userOnly.binds,
    ...userOnly.binds,
    ...userOnly.binds,
    ...userOnly.binds,
    ...accountWhere.binds,
  );
  const appEarnRows = await dbAll(
    env.DB,
    `SELECT user_id, app_id, COALESCE(SUM(units_earned), 0) AS units_earned_30d, COUNT(DISTINCT ymd) AS active_days_30d, MAX(updated_at) AS latest_earn_at
     FROM rr_earn_app_day
     WHERE julianday(ymd) >= julianday('now', '-30 days')${userEarn.sql}
     GROUP BY user_id, app_id
     ORDER BY units_earned_30d DESC
     LIMIT 300`,
    ...userEarn.binds,
  );
  const appStateRows = await dbAll(
    env.DB,
    `SELECT user_id, app_id, page_path, sec_on_page, updated_at
     FROM rr_earn_state${userOnly.sql}
     ORDER BY updated_at DESC
     LIMIT 300`,
    ...userOnly.binds,
  );
  const appOpenRows = await dbAll(
    env.DB,
    `SELECT user_id, app_id, last_open_at
     FROM rr_app_session_last_open${userOnly.sql}
     ORDER BY last_open_at DESC
     LIMIT 300`,
    ...userOnly.binds,
  );
  return sanitizedUserSamples(userRows, appEarnRows, appStateRows, appOpenRows);
}

async function collectUserReportScopeDetails(env: DiscordRootUnitsEnv, scope: UserReportScope): Promise<Record<string, unknown>> {
  const accountWhere = scopedWhere("account_id", scope.accountIds, "WHERE");
  const userWhere = scopedWhere("user_id", scope.userIds, "WHERE");
  const userAnd = scopedWhere("user_id", scope.userIds, "AND");
  const discordWhere = scopedWhere("discord_user_id", scope.discordUserIds, "WHERE");
  const transferUsers = scopedEitherWhere("from_user_id", "to_user_id", scope.userIds, "WHERE");
  const transferDiscord = scopedEitherWhere("from_discord_user_id", "to_discord_user_id", scope.discordUserIds, "WHERE");
  const [
    scopedUserSamples,
    billingByStatus,
    billingTotals,
    linkedWallets,
    custodialWallets,
    rootsDeposits,
    rootsSwaps,
    withdrawals,
    appTransfers,
    discordTransfers,
    farmsProgress,
    farmsMarket,
    discordUsers,
  ] = await Promise.all([
    collectScopedUserSamples(env, scope),
    dbAll(
      env.DB,
      `SELECT subscription_status, COUNT(*) AS accounts,
              COALESCE(SUM(CASE WHEN pro_unlocked != 0 THEN 1 ELSE 0 END), 0) AS pro_unlocked,
              COALESCE(SUM(CASE WHEN life_member != 0 THEN 1 ELSE 0 END), 0) AS life_member
       FROM user_accounts${accountWhere.sql}
       GROUP BY subscription_status
       ORDER BY accounts DESC
       LIMIT 20`,
      ...accountWhere.binds,
    ),
    dbFirst(
      env.DB,
      `SELECT COUNT(*) AS user_account_rows,
              COALESCE(SUM(CASE WHEN pro_unlocked != 0 THEN 1 ELSE 0 END), 0) AS pro_unlocked,
              COALESCE(SUM(CASE WHEN life_member != 0 THEN 1 ELSE 0 END), 0) AS life_member,
              COALESCE(SUM(CASE WHEN pro_redeemed_until IS NOT NULL AND pro_redeemed_until > strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 1 ELSE 0 END), 0) AS active_redeemed_pro
       FROM user_accounts${accountWhere.sql}`,
      ...accountWhere.binds,
    ),
    dbFirst(env.DB, `SELECT COUNT(*) AS linked_wallets, MAX(verified_at) AS latest_verified_at FROM solana_linked_wallets${accountWhere.sql}`, ...accountWhere.binds),
    dbFirst(env.DB, `SELECT COUNT(*) AS custodial_wallets, MAX(created_at) AS latest_created_at FROM internal_solana_wallets${accountWhere.sql}`, ...accountWhere.binds),
    dbAll(
      env.DB,
      `SELECT status, COUNT(*) AS deposits, COALESCE(SUM(amount_atomic), 0) AS amount_atomic, MAX(created_at) AS latest_created_at
       FROM rr_roots_custodial_deposits${accountWhere.sql}
       GROUP BY status
       ORDER BY deposits DESC
       LIMIT 20`,
      ...accountWhere.binds,
    ),
    dbAll(
      env.DB,
      `SELECT status, COUNT(*) AS swaps, COALESCE(SUM(CAST(input_lamports AS INTEGER)), 0) AS input_lamports, COALESCE(SUM(quoted_roots_atomic), 0) AS quoted_roots_atomic, MAX(created_at) AS latest_created_at
       FROM rr_roots_sol_swaps${accountWhere.sql}
       GROUP BY status
       ORDER BY swaps DESC
       LIMIT 20`,
      ...accountWhere.binds,
    ),
    dbAll(
      env.DB,
      `SELECT status, COUNT(*) AS withdrawals, COALESCE(SUM(amount_ledger_whole), 0) AS amount_ledger_whole, MAX(created_at) AS latest_created_at
       FROM rr_withdrawal_intent${accountWhere.sql}
       GROUP BY status
       ORDER BY withdrawals DESC
       LIMIT 20`,
      ...accountWhere.binds,
    ),
    dbFirst(
      env.DB,
      `SELECT COUNT(*) AS transfers, COALESCE(SUM(units), 0) AS units, MAX(created_at) AS latest_created_at
       FROM rr_earn_internal_transfer${transferUsers.sql}`,
      ...transferUsers.binds,
    ),
    dbAll(
      env.DB,
      `SELECT COALESCE(asset, 'ROOTS') AS asset, COUNT(*) AS transfers, COALESCE(SUM(units), 0) AS units, MAX(created_at) AS latest_created_at
       FROM rr_earn_discord_peer_transfer${transferDiscord.sql}
       GROUP BY COALESCE(asset, 'ROOTS')
       ORDER BY transfers DESC
       LIMIT 20`,
      ...transferDiscord.binds,
    ),
    dbFirst(
      env.DB,
      `SELECT COUNT(*) AS farms_users,
              COALESCE(SUM(lifetime_farms_earned), 0) AS lifetime_farms_earned,
              MAX(updated_at) AS latest_updated_at
       FROM rr_farms_progress${userWhere.sql}`,
      ...userWhere.binds,
    ),
    dbAll(
      env.DB,
      `SELECT game, COUNT(*) AS plays, COALESCE(SUM(stake), 0) AS stake, COALESCE(SUM(payout), 0) AS payout, COALESCE(SUM(net), 0) AS net, MAX(created_at) AS latest_created_at
       FROM rr_farms_market_activity${userWhere.sql}
       GROUP BY game
       ORDER BY plays DESC
       LIMIT 20`,
      ...userWhere.binds,
    ),
    dbFirst(
      env.DB,
      `SELECT COUNT(*) AS tracked_discord_users,
              COALESCE(SUM(message_count), 0) AS tracked_messages,
              COALESCE(SUM(CASE WHEN julianday(last_message_at) >= julianday('now', '-7 days') THEN 1 ELSE 0 END), 0) AS active_discord_users_7d,
              MAX(last_message_at) AS latest_message_at
       FROM discord_user_activity${discordWhere.sql}`,
      ...discordWhere.binds,
    ),
  ]);
  return {
    scope: scope.public,
    notes: scope.notes,
    scoped_user_samples: scopedUserSamples,
    billing: { totals: billingTotals, by_status: billingByStatus },
    wallets: { linked_solana: linkedWallets, custodial: custodialWallets },
    roots_flows: {
      custodial_deposits: rootsDeposits,
      sol_swaps: rootsSwaps,
      withdrawals,
      app_transfers: appTransfers,
      discord_transfers: discordTransfers,
    },
    farms: { progress: farmsProgress, market_activity: farmsMarket },
    discord: discordUsers,
    telemetry_gaps: [
      "Some web apps still report Android-style app_id values unless their env overrides are set, so web/mobile split may be blended.",
      "KÄ«lauea Android normal opens/page time are not fully captured unless users login/signup or hit push/feedback/developer-message flows.",
      "Feedback is currently forwarded to Discord and not persisted in D1, so this report can only infer feedback volume when a table exists later.",
    ],
  };
}

async function collectUserBehaviorReportData(
  env: DiscordRootUnitsEnv,
  requesterDiscordId: string,
  scope: UserReportScope = allUserReportScope(),
): Promise<Record<string, unknown>> {
  const nowIso = new Date().toISOString();
  const [
    accountSummary,
    accountDomains,
    sessionSummary,
    deviceSummary,
    appDays30,
    appSessionTime,
    appRecentOpens,
    pushTokensByApp,
    weatherSummary,
    locationSummary,
    businessSummary,
    photoSummary,
    aiSummary,
    developerMessages,
    workerErrors,
    discordActivity,
    userRows,
    userAppEarnRows,
    userAppStateRows,
    userAppOpenRows,
  ] = await Promise.all([
    dbFirst(
      env.DB,
      `SELECT COUNT(*) AS total_accounts,
              COALESCE(SUM(CASE WHEN julianday(created_at) >= julianday('now', '-1 day') THEN 1 ELSE 0 END), 0) AS new_accounts_24h,
              COALESCE(SUM(CASE WHEN julianday(created_at) >= julianday('now', '-7 days') THEN 1 ELSE 0 END), 0) AS new_accounts_7d,
              COALESCE(SUM(CASE WHEN julianday(created_at) >= julianday('now', '-30 days') THEN 1 ELSE 0 END), 0) AS new_accounts_30d,
              MIN(created_at) AS first_account_at,
              MAX(created_at) AS latest_account_at
       FROM license_accounts`,
    ),
    dbAll(
      env.DB,
      `SELECT CASE WHEN instr(email, '@') > 0 THEN lower(substr(email, instr(email, '@') + 1)) ELSE 'unknown' END AS domain,
              COUNT(*) AS accounts
       FROM license_accounts
       GROUP BY domain
       ORDER BY accounts DESC
       LIMIT 15`,
    ),
    dbFirst(
      env.DB,
      `SELECT COUNT(*) AS total_sessions,
              COUNT(DISTINCT account_id) AS accounts_with_sessions,
              COALESCE(SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END), 0) AS active_sessions,
              COUNT(DISTINCT CASE WHEN julianday(last_seen_at) >= julianday('now', '-1 day') THEN account_id END) AS accounts_seen_24h,
              COUNT(DISTINCT CASE WHEN julianday(last_seen_at) >= julianday('now', '-7 days') THEN account_id END) AS accounts_seen_7d,
              COUNT(DISTINCT CASE WHEN julianday(last_seen_at) >= julianday('now', '-30 days') THEN account_id END) AS accounts_seen_30d,
              MAX(last_seen_at) AS latest_seen_at
       FROM license_sessions`,
    ),
    dbAll(
      env.DB,
      `SELECT CASE
                WHEN lower(COALESCE(user_agent, '')) LIKE '%android%' THEN 'android'
                WHEN lower(COALESCE(user_agent, '')) LIKE '%iphone%' OR lower(COALESCE(user_agent, '')) LIKE '%ipad%' THEN 'ios'
                WHEN lower(COALESCE(user_agent, '')) LIKE '%windows%' THEN 'windows'
                WHEN lower(COALESCE(user_agent, '')) LIKE '%mac%' THEN 'mac'
                WHEN lower(COALESCE(user_agent, '')) LIKE '%linux%' THEN 'linux'
                WHEN COALESCE(user_agent, '') = '' THEN 'unknown'
                ELSE 'browser_or_other'
              END AS device_kind,
              COUNT(*) AS sessions,
              COUNT(DISTINCT account_id) AS accounts,
              MAX(last_seen_at) AS latest_seen_at
       FROM license_sessions
       GROUP BY device_kind
       ORDER BY sessions DESC`,
    ),
    dbAll(
      env.DB,
      `SELECT app_id, SUM(units_earned) AS units_earned, COUNT(DISTINCT user_id) AS active_users, COUNT(DISTINCT ymd) AS active_days
       FROM rr_earn_app_day
       WHERE julianday(ymd) >= julianday('now', '-30 days')
       GROUP BY app_id
       ORDER BY units_earned DESC
       LIMIT 30`,
    ),
    dbAll(
      env.DB,
      `SELECT app_id, COUNT(DISTINCT user_id) AS active_users, COALESCE(SUM(sec_on_page), 0) AS sec_on_page, MAX(updated_at) AS latest_heartbeat_at
       FROM rr_earn_state
       GROUP BY app_id
       ORDER BY sec_on_page DESC
       LIMIT 30`,
    ),
    dbAll(
      env.DB,
      `SELECT app_id, COUNT(DISTINCT user_id) AS recent_open_users, MAX(last_open_at) AS latest_open_at
       FROM rr_app_session_last_open
       WHERE julianday(last_open_at) >= julianday('now', '-30 days')
       GROUP BY app_id
       ORDER BY recent_open_users DESC
       LIMIT 30`,
    ),
    dbAll(
      env.DB,
      `SELECT COALESCE(app_id, 'unknown') AS app_id, platform, COUNT(*) AS tokens, COUNT(DISTINCT user_id) AS users, MAX(updated_at) AS latest_token_at
       FROM rrwm_push_tokens
       GROUP BY COALESCE(app_id, 'unknown'), platform
       ORDER BY tokens DESC
       LIMIT 30`,
    ),
    dbFirst(
      env.DB,
      `SELECT COUNT(*) AS snapshots,
              COUNT(DISTINCT user_id) AS users,
              COUNT(DISTINCT location_id) AS locations,
              COUNT(DISTINCT grid_key) AS grids,
              MAX(fetched_at) AS latest_fetched_at
       FROM weather_data`,
    ),
    dbFirst(
      env.DB,
      `SELECT COUNT(*) AS saved_locations, COUNT(DISTINCT user_id) AS users, MAX(created_at) AS latest_created_at
       FROM rrwm_locations`,
    ),
    dbAll(
      env.DB,
      `SELECT coll, COUNT(*) AS rows, COUNT(DISTINCT user_key) AS users, MAX(updated_at) AS latest_updated_at
       FROM bm_owned_row
       GROUP BY coll
       ORDER BY rows DESC
       LIMIT 25`,
    ),
    dbAll(
      env.DB,
      `SELECT status, COUNT(*) AS count, COUNT(DISTINCT account_id) AS users, MAX(created_at) AS latest_created_at
       FROM volcano_photo_submissions
       GROUP BY status
       ORDER BY status ASC`,
    ),
    dbFirst(
      env.DB,
      `SELECT COUNT(*) AS reports, COUNT(DISTINCT source_type) AS source_types, MAX(created_at) AS latest_created_at
       FROM kilauea_ai_analyses`,
    ),
    dbAll(
      env.DB,
      `SELECT app_scope, title, created_at
       FROM developer_messages
       ORDER BY created_at DESC
       LIMIT 15`,
    ),
    dbAll(
      env.DB,
      `SELECT method, path_redacted, status, duration_ms, message, created_at
       FROM worker_http_error_events
       ORDER BY created_at DESC
       LIMIT 15`,
    ),
    dbFirst(
      env.DB,
      `SELECT COUNT(*) AS tracked_discord_users,
              COALESCE(SUM(message_count), 0) AS tracked_messages,
              COALESCE(SUM(CASE WHEN julianday(last_message_at) >= julianday('now', '-7 days') THEN 1 ELSE 0 END), 0) AS active_discord_users_7d,
              COALESCE(SUM(CASE WHEN julianday(last_message_at) >= julianday('now', '-30 days') THEN 1 ELSE 0 END), 0) AS active_discord_users_30d,
              MAX(last_message_at) AS latest_message_at
       FROM discord_user_activity`,
    ),
    dbAll(
      env.DB,
      `WITH earn30 AS (
         SELECT user_id, COALESCE(SUM(units_earned), 0) AS units_earned_30d, COUNT(DISTINCT ymd) AS active_days_30d
         FROM rr_earn_app_day
         WHERE julianday(ymd) >= julianday('now', '-30 days')
         GROUP BY user_id
       ),
       state AS (
         SELECT user_id, COALESCE(SUM(sec_on_page), 0) AS sec_on_page, COUNT(DISTINCT app_id) AS focused_apps, MAX(updated_at) AS latest_heartbeat_at
         FROM rr_earn_state
         GROUP BY user_id
       ),
       opens AS (
         SELECT user_id, COUNT(DISTINCT app_id) AS opened_apps, MAX(last_open_at) AS last_app_open_at
         FROM rr_app_session_last_open
         GROUP BY user_id
       ),
       sessions AS (
         SELECT account_id, COUNT(*) AS session_count, COALESCE(SUM(CASE WHEN revoked_at IS NULL THEN 1 ELSE 0 END), 0) AS active_sessions, MAX(last_seen_at) AS last_seen_at
         FROM license_sessions
         GROUP BY account_id
       ),
       push AS (
         SELECT user_id, COUNT(*) AS push_tokens
         FROM rrwm_push_tokens
         GROUP BY user_id
       ),
       bm AS (
         SELECT user_key, COUNT(*) AS business_rows
         FROM bm_owned_row
         GROUP BY user_key
       ),
       loc AS (
         SELECT user_id, COUNT(*) AS saved_locations
         FROM rrwm_locations
         GROUP BY user_id
       ),
       weather AS (
         SELECT user_id, COUNT(*) AS weather_snapshots
         FROM weather_data
         GROUP BY user_id
       )
       SELECT la.id AS account_id,
              la.email AS email,
              la.created_at AS created_at,
              la.updated_at AS updated_at,
              COALESCE(sessions.session_count, 0) AS session_count,
              COALESCE(sessions.active_sessions, 0) AS active_sessions,
              sessions.last_seen_at AS last_seen_at,
              COALESCE(opens.opened_apps, 0) AS opened_apps,
              opens.last_app_open_at AS last_app_open_at,
              COALESCE(state.focused_apps, 0) AS focused_apps,
              COALESCE(state.sec_on_page, 0) AS sec_on_page,
              state.latest_heartbeat_at AS latest_heartbeat_at,
              COALESCE(earn30.units_earned_30d, 0) AS units_earned_30d,
              COALESCE(earn30.active_days_30d, 0) AS active_days_30d,
              COALESCE(balance.balance, 0) AS roots_balance,
              COALESCE(push.push_tokens, 0) AS push_tokens,
              COALESCE(bm.business_rows, 0) AS business_rows,
              COALESCE(loc.saved_locations, 0) AS saved_locations,
              COALESCE(weather.weather_snapshots, 0) AS weather_snapshots,
              CASE WHEN link.discord_user_id IS NULL THEN 0 ELSE 1 END AS linked_discord,
              COALESCE(link.discord_global_name, link.discord_username, '') AS discord_name
       FROM license_accounts la
       LEFT JOIN earn30 ON earn30.user_id = 'user:' || lower(la.email)
       LEFT JOIN state ON state.user_id = 'user:' || lower(la.email)
       LEFT JOIN opens ON opens.user_id = 'user:' || lower(la.email)
       LEFT JOIN sessions ON sessions.account_id = la.id
       LEFT JOIN rr_earn_balance balance ON balance.user_id = 'user:' || lower(la.email)
       LEFT JOIN push ON push.user_id = 'user:' || lower(la.email)
       LEFT JOIN bm ON bm.user_key = 'user:' || lower(la.email)
       LEFT JOIN loc ON loc.user_id = 'user:' || lower(la.email)
       LEFT JOIN weather ON weather.user_id = 'user:' || lower(la.email)
       LEFT JOIN discord_account_links link ON link.account_id = la.id
       ORDER BY COALESCE(opens.last_app_open_at, state.latest_heartbeat_at, sessions.last_seen_at, la.created_at) DESC
       LIMIT 60`,
    ),
    dbAll(
      env.DB,
      `SELECT user_id, app_id, COALESCE(SUM(units_earned), 0) AS units_earned_30d, COUNT(DISTINCT ymd) AS active_days_30d, MAX(updated_at) AS latest_earn_at
       FROM rr_earn_app_day
       WHERE julianday(ymd) >= julianday('now', '-30 days')
       GROUP BY user_id, app_id
       ORDER BY units_earned_30d DESC
       LIMIT 250`,
    ),
    dbAll(
      env.DB,
      `SELECT user_id, app_id, page_path, sec_on_page, updated_at
       FROM rr_earn_state
       ORDER BY updated_at DESC
       LIMIT 250`,
    ),
    dbAll(
      env.DB,
      `SELECT user_id, app_id, last_open_at
       FROM rr_app_session_last_open
       ORDER BY last_open_at DESC
       LIMIT 250`,
    ),
  ]);

  const appUsage30d = compactUserAppRows(enrichAppUsageRows(appDays30, appSessionTime, appRecentOpens));
  const userSamples = sanitizedUserSamples(userRows, userAppEarnRows, userAppStateRows, userAppOpenRows);
  const scopedDetails = await collectUserReportScopeDetails(env, scope);
  return {
    generated_at: nowIso,
    requested_by_discord_id: requesterDiscordId,
    purpose: "Developer-only /userreport for app and web behavior analysis",
    privacy_note:
      "Sent to Grok with account ids shortened, email domains only, no password hashes, salts, raw emails, IP addresses, or session ids.",
    report_scope: scope.public,
    source_tables: [
      "license_accounts",
      "license_sessions",
      "user_accounts",
      "rr_earn_state",
      "rr_earn_app_day",
      "rr_app_session_last_open",
      "rr_earn_balance",
      "rr_earn_internal_transfer",
      "rr_earn_discord_peer_transfer",
      "rrwm_push_tokens",
      "rrwm_locations",
      "weather_data",
      "bm_owned_row",
      "volcano_photo_submissions",
      "kilauea_ai_analyses",
      "discord_user_activity",
      "discord_account_links",
      "solana_linked_wallets",
      "internal_solana_wallets",
      "rr_roots_custodial_deposits",
      "rr_roots_sol_swaps",
      "rr_withdrawal_intent",
      "rr_farms_progress",
      "rr_farms_market_activity",
      "developer_messages",
      "worker_http_error_events",
    ],
    account_summary: accountSummary,
    account_domains: accountDomains,
    session_summary: sessionSummary,
    device_summary: deviceSummary,
    app_usage_30d: appUsage30d,
    push_tokens_by_app: pushTokensByApp,
    feature_usage: {
      weather: weatherSummary,
      saved_locations: locationSummary,
      business_collections: businessSummary,
      volcano_photos: photoSummary,
      kilauea_ai: aiSummary,
      developer_messages: developerMessages,
    },
    discord_activity: discordActivity,
    recent_worker_errors: workerErrors,
    user_behavior_samples: userSamples,
    scoped_usage: scopedDetails,
    calculated: {
      sampled_users: userSamples.length,
      scoped_sampled_users: Array.isArray(scopedDetails.scoped_user_samples) ? scopedDetails.scoped_user_samples.length : 0,
      apps_with_30d_usage: appUsage30d.length,
      accounts_seen_30d: n((sessionSummary as Record<string, unknown> | null | undefined)?.accounts_seen_30d),
      accounts_with_app_opens_30d: appUsage30d.reduce((sum, row) => Math.max(sum, n(row.recent_open_users)), 0),
      total_sec_on_page_current_state: appUsage30d.reduce((sum, row) => sum + n(row.sec_on_page), 0),
      total_units_earned_30d: appUsage30d.reduce((sum, row) => sum + n(row.units_earned), 0),
    },
  };
}

function topUserBehaviorLine(row: Record<string, unknown>): string {
  const apps = Array.isArray(row.apps) ? row.apps.slice(0, 3) : [];
  const appText = apps
    .map((raw) => {
      const app = raw as Record<string, unknown>;
      return `${app.app_id}:${Math.floor(n(app.sec_on_page) / 60)}m/${formatRootsAtomicLocale(n(app.units_earned_30d))}`;
    })
    .join(", ");
  return `${row.account} (${row.email_domain}) ${Math.floor(n(row.sec_on_page) / 60)}m, ${n(row.opened_apps)} apps, ${formatRootsAtomicLocale(n(row.units_earned_30d))} ROOTS${appText ? `; ${appText}` : ""}`;
}

function buildFallbackUserBehaviorReport(reportData: Record<string, unknown>): string {
  const accounts = (reportData.account_summary as Record<string, unknown> | null | undefined) || {};
  const sessions = (reportData.session_summary as Record<string, unknown> | null | undefined) || {};
  const calc = (reportData.calculated as Record<string, unknown> | null | undefined) || {};
  const scope = (reportData.report_scope as Record<string, unknown> | null | undefined) || {};
  const scopedUsage = (reportData.scoped_usage as Record<string, unknown> | null | undefined) || {};
  const scopedUsers = Array.isArray(scopedUsage.scoped_user_samples) ? scopedUsage.scoped_user_samples : [];
  const users = (scopedUsers.length ? scopedUsers : Array.isArray(reportData.user_behavior_samples) ? reportData.user_behavior_samples : []).slice(0, 6);
  return [
    "**RootRecord User Behavior Report**",
    `_Generated ${reportTimestamp(reportData.generated_at)} for ${String(scope.label || "all RootRecord users")}. Developer-only; raw PII is redacted before Grok._`,
    "",
    "**User Base**",
    `â€¢ Accounts: **${n(accounts.total_accounts).toLocaleString()}** total; **${n(accounts.new_accounts_7d).toLocaleString()}** new in 7d; **${n(accounts.new_accounts_30d).toLocaleString()}** new in 30d.`,
    `â€¢ Sessions: **${n(sessions.total_sessions).toLocaleString()}** total; **${n(sessions.accounts_seen_7d).toLocaleString()}** accounts seen in 7d; **${n(sessions.accounts_seen_30d).toLocaleString()}** in 30d.`,
    scope.mode && scope.mode !== "all" ? `â€¢ Scope: **${n(scope.matched_accounts).toLocaleString()}** matched account(s); **${n(scope.matched_discord_users).toLocaleString()}** linked Discord user(s).` : "",
    "",
    "**App Behavior**",
    `â€¢ 30d app mix: ${formatAppUsage(reportData.app_usage_30d)}.`,
    `â€¢ Current tracked page time: **${Math.floor(n(calc.total_sec_on_page_current_state) / 60).toLocaleString()} min**; 30d earned: **${formatRootsAtomicLocale(n(calc.total_units_earned_30d))} ROOTS**.`,
    "",
    "**Sampled Users**",
    ...users.map((raw) => `â€¢ ${topUserBehaviorLine(raw as Record<string, unknown>)}`),
  ].join("\n");
}

async function callGrokUserBehaviorReport(env: DiscordRootUnitsEnv, reportData: Record<string, unknown>): Promise<Record<string, unknown>> {
  const token = grokChatBearerToken(env);
  const apiUrl = String(env.GROK_API_URL || "https://api.x.ai/v1/chat/completions").trim();
  const model = String(env.GROK_MODEL || "grok-3-latest").trim();
  const prompt =
    "Create an extensive developer-only RootRecord user behavior report from the provided app/web/mobile data. " +
    "Use report_scope and scoped_usage as the primary target; use global summaries as context. " +
    "For all-system reports, focus on account growth, retention, app usage by product, web/mobile session signals, feature adoption, friction, anomalies, and recommended product actions. " +
    "For role or specific-user reports, focus on that cohort/account first, including activity timeline, app mix, billing/access, wallet/ROOTS behavior, Discord behavior, feature adoption, and product follow-up. " +
    "Use clear Discord-ready Markdown sections: Executive Read, Scope, Growth & Retention, App/Product Behavior, User/Cohort Signals, Risks/Anomalies, Next Actions. " +
    "Do not ask for more data. Do not reveal raw credentials, full emails, raw session ids, raw push tokens, private-key material, or IP addresses. Keep it under 3600 characters.";
  const body = {
    model,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: jsonForArchive(reportData) },
    ],
    temperature: 0.25,
  };
  if (!token) {
    return {
      ok: false,
      detail: "Grok API bearer token is not configured.",
      content: buildFallbackUserBehaviorReport(reportData),
      request: body,
    };
  }
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const response = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const content = grokResponseText(response);
    const detail = content ? "" : grokErrorText(response, res.status);
    return {
      ok: res.ok && Boolean(content),
      status: res.status,
      detail,
      content: content || buildFallbackUserBehaviorReport(reportData),
      request: body,
      response,
    };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
      content: buildFallbackUserBehaviorReport(reportData),
      request: body,
    };
  }
}

function userReportEmbed(finalReport: Record<string, unknown>, reportData: Record<string, unknown>, archiveId: string): DiscordEmbed[] {
  const accounts = (reportData.account_summary as Record<string, unknown> | null | undefined) || {};
  const sessions = (reportData.session_summary as Record<string, unknown> | null | undefined) || {};
  const calc = (reportData.calculated as Record<string, unknown> | null | undefined) || {};
  const scope = (reportData.report_scope as Record<string, unknown> | null | undefined) || {};
  return [
    {
      title: "RootRecord User Behavior Report",
      description: fieldValue(finalReport.content || "User behavior report generated.", 3600),
      color: 0x0ea5e9,
      fields: [
        {
          name: "Scope",
          value: fieldValue(`${scope.label || "all RootRecord users"}${scope.mode && scope.mode !== "all" ? ` Â· ${n(scope.matched_accounts).toLocaleString()} account(s)` : ""}`, 240),
          inline: false,
        },
        {
          name: "Accounts",
          value: `${n(accounts.total_accounts).toLocaleString()} total Â· ${n(accounts.new_accounts_7d).toLocaleString()} new 7d Â· ${n(accounts.new_accounts_30d).toLocaleString()} new 30d`,
          inline: false,
        },
        {
          name: "Activity",
          value: `${n(sessions.accounts_seen_7d).toLocaleString()} seen 7d Â· ${n(sessions.accounts_seen_30d).toLocaleString()} seen 30d Â· ${n(calc.sampled_users).toLocaleString()} sampled users`,
          inline: false,
        },
      ],
      footer: { text: `AI record saved: ${archiveId.slice(0, 8)} Â· PII redacted before Grok` },
      timestamp: String(reportData.generated_at || new Date().toISOString()),
    },
  ];
}

async function collectScreenshotReportData(env: DiscordRootUnitsEnv, requesterDiscordId: string): Promise<Record<string, unknown>> {
  const nowIso = new Date().toISOString();
  const [
    leaderboard,
    circulation,
    daily,
    x,
    reddit,
    website,
    accounts,
    balances,
    appDays,
    appSessionTime,
    appRecentOpens,
    photos,
    messages,
    errors,
    discordActivity,
  ] =
    await Promise.all([
      loadEconomyLeaderboardData(env.DB).catch((e) => ({ error: e instanceof Error ? e.message : String(e) })),
      readCirculationTotals(env.DB).catch((e) => ({ error: e instanceof Error ? e.message : String(e) })),
      loadEconomyDailySeries(env.DB, 14).catch((e) => [{ error: e instanceof Error ? e.message : String(e) }]),
      fetchRootRecordTweets(env),
      fetchRootRecordReddit(),
      Promise.all(
        [
          "https://rootrecord.cloud/",
          "https://rootrecord.cloud/products/rootunits/",
          "https://rootrecord.cloud/beta-tester-rewards.html",
          "https://rootrecord.cloud/charts/root-economy/",
          "https://rootrecord.cloud/products.html",
        ].map(fetchRootRecordPageSummary),
      ),
      dbFirst(env.DB, `SELECT COUNT(*) AS total_accounts FROM license_accounts`),
      dbFirst(env.DB, `SELECT COUNT(*) AS accounts_with_balance, COALESCE(SUM(balance), 0) AS total_balance FROM rr_earn_balance WHERE balance > 0`),
      dbAll(
        env.DB,
        `SELECT app_id, SUM(units_earned) AS units_earned, COUNT(*) AS active_days
         FROM rr_earn_app_day
         WHERE ymd >= date('now', '-14 days')
         GROUP BY app_id
         ORDER BY units_earned DESC
         LIMIT 20`,
      ),
      dbAll(
        env.DB,
        `SELECT app_id, COUNT(*) AS active_users, COALESCE(SUM(sec_on_page), 0) AS sec_on_page, MAX(updated_at) AS latest_heartbeat_at
         FROM rr_earn_state
         GROUP BY app_id
         ORDER BY sec_on_page DESC
         LIMIT 20`,
      ),
      dbAll(
        env.DB,
        `SELECT app_id, COUNT(DISTINCT user_id) AS recent_open_users, MAX(last_open_at) AS latest_open_at
         FROM rr_app_session_last_open
         WHERE last_open_at >= datetime('now', '-14 days')
         GROUP BY app_id
         ORDER BY recent_open_users DESC
         LIMIT 20`,
      ),
      dbAll(
        env.DB,
        `SELECT status, COUNT(*) AS count
         FROM volcano_photo_submissions
         GROUP BY status
         ORDER BY status ASC`,
      ),
      dbAll(
        env.DB,
        `SELECT app_scope, title, body, created_at
         FROM developer_messages
         ORDER BY created_at DESC
         LIMIT 10`,
      ),
      dbAll(
        env.DB,
        `SELECT method, path_redacted, status, duration_ms, message, created_at
         FROM worker_http_error_events
         ORDER BY created_at DESC
         LIMIT 10`,
      ),
      dbAll(
        env.DB,
        `SELECT day, message_count
         FROM discord_activity_daily
         ORDER BY day DESC
         LIMIT 20`,
      ),
    ]);

  return {
    generated_at: nowIso,
    requested_by_discord_id: requesterDiscordId,
    purpose: "Root Record ecosystem report for Discord /screenshot",
    root_economy: { circulation, daily, leaderboard },
    rootrecord_x: x,
    reddit,
    website,
    accounts,
    balances,
    app_usage_14d: enrichAppUsageRows(appDays, appSessionTime, appRecentOpens),
    app_usage_raw: { earned_14d: appDays, session_time: appSessionTime, recent_opens: appRecentOpens },
    volcano_photos: photos,
    developer_messages: messages,
    recent_worker_errors: errors,
    discord_activity: discordActivity,
  };
}

async function loadPreviousScreenshotReport(env: DiscordRootUnitsEnv): Promise<Record<string, unknown> | null> {
  const row = await dbFirst<{ id: string; created_at: string; prompt_json: string; response_json: string }>(
    env.DB,
    `SELECT id, created_at, prompt_json, response_json
     FROM discord_screenshot_reports
     ORDER BY created_at DESC
     LIMIT 1`,
  );
  if (!row || (row as Record<string, unknown>).error) return null;
  const prompt = parseJsonObject(row.prompt_json);
  if (prompt) delete prompt.previous_report;
  const response = parseJsonObject(row.response_json);
  const reportResponse = (response?.report as Record<string, unknown> | undefined) || response;
  const content = truncateText(String(reportResponse?.content || reportResponse?.fallback || ""), 1800);
  return {
    id: row.id,
    created_at: row.created_at,
    prompt,
    content,
  };
}

async function callGrokReport(env: DiscordRootUnitsEnv, reportData: Record<string, unknown>): Promise<Record<string, unknown>> {
  const token = grokChatBearerToken(env);
  const apiUrl = String(env.GROK_API_URL || "https://api.x.ai/v1/chat/completions").trim();
  const model = String(env.GROK_MODEL || "grok-3-latest").trim();
  const prompt =
    "Create a concise Discord-ready Root Record ecosystem report. Use only the provided data. " +
    "Move focus away from ROOTS balances and toward actual app usage, service utilization, user activity, product updates, and community signals. " +
    "Compare current data to previous_report when present. Use clean Markdown sections: Since Last Report, App Usage & Services, Community Signals, Watch Items, X Copy. " +
    "Use app_usage_14d earned_share_pct and time_share_pct to compare apps. Mention Reddit r/rootrecord when posts exist. " +
    "Use discord_activity_ai_report as the Discord-specific subreport and fold its findings into Community Signals and Watch Items. " +
    "X Copy must be a short copy-pasteable post with no hashtags. Keep token/internal balance details secondary unless they explain adoption. " +
    "Keep the full response under 1800 characters and do not mention secrets or internal tokens.";
  const body = {
    model,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: jsonForArchive(reportData) },
    ],
    temperature: 0.3,
  };

  if (!token) {
    return {
      ok: false,
      detail: "Grok API bearer token is not configured.",
      fallback: buildFallbackScreenshotPost(reportData),
      request: body,
    };
  }

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const content = String(
      (((data.choices as Array<Record<string, unknown>> | undefined)?.[0]?.message as Record<string, unknown> | undefined)
        ?.content as string | undefined) || "",
    ).trim();
    return {
      ok: res.ok && Boolean(content),
      status: res.status,
      content: content || buildFallbackScreenshotPost(reportData),
      request: body,
      response: data,
    };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
      content: buildFallbackScreenshotPost(reportData),
      request: body,
    };
  }
}

async function callGrokSocialUpdate(
  env: DiscordRootUnitsEnv,
  reportData: Record<string, unknown>,
  reportEmbeds: DiscordEmbed[],
): Promise<Record<string, unknown>> {
  const token = grokChatBearerToken(env);
  const apiUrl = String(env.GROK_API_URL || "https://api.x.ai/v1/chat/completions").trim();
  const model = String(env.GROK_MODEL || "grok-3-latest").trim();
  const prompt =
    "You are drafting a short daily Root Record community update after reviewing the generated ecosystem report. " +
    "Return exactly two labeled sections: **DISCORD** then **X**. DISCORD must be under 400 characters. X must be under 270 characters (tweet-length). " +
    "Mention at most the top 2 apps by usage; do not paste the full app usage mix. Include only meaningful changes and no hashtags. " +
    "Do not mention internal archive ids, secrets, raw JSON, prompts, or unavailable data.";
  const body = {
    model,
    messages: [
      { role: "system", content: prompt },
      {
        role: "user",
        content: jsonForArchive({
          current_report_data: reportData,
          original_discord_report: reportEmbeds,
          fallback_social_update: buildSocialUpdateFallback(reportData),
        }),
      },
    ],
    temperature: 0.45,
  };

  if (!token) {
    return {
      ok: false,
      detail: "Grok API bearer token is not configured.",
      content: buildSocialUpdateFallback(reportData),
      request: body,
    };
  }

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const content = String(
      (((data.choices as Array<Record<string, unknown>> | undefined)?.[0]?.message as Record<string, unknown> | undefined)
        ?.content as string | undefined) || "",
    ).trim();
    return {
      ok: res.ok && Boolean(content),
      status: res.status,
      content: content || buildSocialUpdateFallback(reportData),
      request: body,
      response: data,
    };
  } catch (e) {
    return {
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
      content: buildSocialUpdateFallback(reportData),
      request: body,
    };
  }
}

function n(raw: unknown): number {
  const v = Number(raw);
  return Number.isFinite(v) ? v : 0;
}

function compactList(items: string[], maxItems: number): string {
  const kept = items.filter(Boolean).slice(0, maxItems);
  return kept.length ? kept.join(", ") : "none";
}

function reportTimestamp(raw: unknown): string {
  const ms = Date.parse(String(raw || ""));
  if (!Number.isFinite(ms)) return String(raw || "");
  return `<t:${Math.floor(ms / 1000)}:f>`;
}

function formatPhotoQueue(rows: unknown): string {
  if (!Array.isArray(rows) || !rows.length) return "unavailable";
  return rows
    .map((r) => {
      const row = r as Record<string, unknown>;
      return `${String(row.status || "unknown")}: ${n(row.count).toLocaleString()}`;
    })
    .join(" / ");
}

function formatTopHolders(leaderboard: Record<string, unknown> | undefined): string {
  const entries = Array.isArray(leaderboard?.entries) ? leaderboard!.entries.slice(0, 3) : [];
  if (!entries.length) return "No leaderboard rows returned.";
  return entries
    .map((raw, i) => {
      const e = raw as {
        balance?: number;
        public_display_name?: string | null;
        discord_username?: string | null;
        discord_global_name?: string | null;
        wallet_short?: string;
        farms_plots_unlocked?: number;
        farms_rows_accumulated?: number;
      };
      const label = truncateText(leaderboardEntryLabel({ rank: i + 1, balance: n(e.balance), wallet_short: String(e.wallet_short || ""), public_display_name: e.public_display_name || null, discord_username: e.discord_username || null, discord_global_name: e.discord_global_name || null, farms_plots_unlocked: n(e.farms_plots_unlocked), farms_rows_accumulated: n(e.farms_rows_accumulated) }), 32);
      return `#${i + 1} ${label} (${formatRootsAtomicLocale(n(e.balance))} ROOTS)`;
    })
    .join("\n");
}

function formatAppUsage(rows: unknown): string {
  if (!Array.isArray(rows) || !rows.length) return "No 14-day app usage rows returned.";
  return compactList(
    rows.slice(0, 5).map((raw) => {
      const row = raw as Record<string, unknown>;
      const time = n(row.time_share_pct) > 0 ? `, ${n(row.time_share_pct).toFixed(1)}% time` : "";
      const users = n(row.recent_open_users || row.active_users);
      return `${String(row.app_id || "unknown")}: ${n(row.earned_share_pct).toFixed(1)}% rewards${time}, ${users.toLocaleString()} users`;
    }),
    5,
  );
}

/** Short app line for Discord/X drafts (top apps only). */
function formatAppUsageBrief(rows: unknown, maxApps = 2): string {
  if (!Array.isArray(rows) || !rows.length) return "no recent app usage";
  return compactList(
    rows.slice(0, maxApps).map((raw) => {
      const row = raw as Record<string, unknown>;
      const users = n(row.recent_open_users || row.active_users);
      const id = String(row.app_id || "unknown").replace(/^rootrecord_/, "").replace(/_android$/, "");
      return `${id} (${users} users)`;
    }),
    maxApps,
  );
}

function formatRedditSummary(reddit: Record<string, unknown> | undefined): string {
  if (!reddit) return "Reddit r/rootrecord scan unavailable.";
  if (reddit.error) return `Reddit r/rootrecord error: ${truncateText(reddit.error, 100)}`;
  const posts = Array.isArray(reddit.posts) ? reddit.posts : [];
  if (!posts.length) return "Reddit r/rootrecord: no recent posts returned.";
  return compactList(
    posts.slice(0, 3).map((raw) => {
      const p = raw as Record<string, unknown>;
      const comments = n(p.comments);
      return `${truncateText(p.title, 70)} (${comments.toLocaleString()} comments)`;
    }),
    3,
  );
}

function formatXSummary(rootrecordX: Record<string, unknown> | undefined): string {
  if (!rootrecordX?.configured) return "@rootrecord lookup not configured.";
  const tweets = rootrecordX.tweets as Record<string, unknown> | undefined;
  const data = Array.isArray(tweets?.data) ? tweets!.data : [];
  if (!data.length) {
    const status = rootrecordX.status ? `status ${rootrecordX.status}` : "no posts returned";
    return `@rootrecord: ${status}.`;
  }
  const first = data[0] as Record<string, unknown>;
  const text = truncateText(first.text, 135);
  const created = first.created_at ? ` (${reportTimestamp(first.created_at)})` : "";
  return `@rootrecord latest${created}: ${text}`;
}

function formatWebsiteSummary(rows: unknown): string {
  if (!Array.isArray(rows) || !rows.length) return "Website snapshots unavailable.";
  const ok = rows.filter((raw) => n((raw as Record<string, unknown>).status) >= 200 && n((raw as Record<string, unknown>).status) < 400).length;
  const highlights = rows.slice(0, 2).map((raw) => {
    const row = raw as Record<string, unknown>;
    const title = truncateText(row.title || row.h1 || row.url, 36);
    return `${title} (${row.status || "?"})`;
  });
  return `${ok}/${rows.length} pages reachable: ${compactList(highlights, 2)}`;
}

function formatOpsSummary(reportData: Record<string, unknown>): string {
  const errors = Array.isArray(reportData.recent_worker_errors) ? reportData.recent_worker_errors : [];
  const discordDays = Array.isArray(reportData.discord_activity) ? reportData.discord_activity : [];
  const seenErrors = new Set<string>();
  const recentErrors = errors
    .filter((raw) => !(raw as Record<string, unknown>).error)
    .filter((raw) => {
      const row = raw as Record<string, unknown>;
      const key = `${row.status || "?"}:${String(row.path_redacted || row.message || "").trim()}`;
      if (seenErrors.has(key)) return false;
      seenErrors.add(key);
      return true;
    })
    .slice(0, 2);
  const discordMessages = discordDays.reduce((sum, raw) => sum + n((raw as Record<string, unknown>).message_count), 0);
  const errText = recentErrors.length
    ? recentErrors
        .map((raw) => {
          const row = raw as Record<string, unknown>;
          return `${row.status || "?"} ${truncateText(row.path_redacted || row.message || "worker event", 44)}`;
        })
        .join("; ")
    : "no recent worker errors returned";
  return `Discord messages tracked: ${discordMessages.toLocaleString()} recent. Worker signals: ${errText}.`;
}

function formatDiscordActivityAiSummary(reportData: Record<string, unknown>): string {
  const activity = reportData.discord_activity_ai_report as Record<string, unknown> | undefined;
  if (!activity) return "Discord activity AI report unavailable.";
  const age = activity.generated_for_snapshot ? "fresh" : "recent";
  const content = truncateText(activity.content || activity.fallback || "No activity report text.", 620);
  return `${age} activity pass ${activity.id ? `(${String(activity.id).slice(0, 8)})` : ""}: ${content}`;
}

function reportMetrics(reportData: Record<string, unknown> | null | undefined): {
  accounts: number;
  circulation: number;
  holders: number;
  topHolder: string;
  appLeader: string;
  appLeaderUnits: number;
  workerErrorCount: number;
} {
  const economy = reportData?.root_economy as Record<string, unknown> | undefined;
  const circulation = economy?.circulation as Record<string, unknown> | undefined;
  const balances = reportData?.balances as Record<string, unknown> | null | undefined;
  const accounts = reportData?.accounts as Record<string, unknown> | null | undefined;
  const leaderboard = economy?.leaderboard as Record<string, unknown> | undefined;
  const entries = Array.isArray(leaderboard?.entries) ? leaderboard!.entries : [];
  const top = entries[0] as
    | {
        balance?: number;
        wallet_short?: string;
        public_display_name?: string | null;
        discord_username?: string | null;
        discord_global_name?: string | null;
        farms_plots_unlocked?: number;
        farms_rows_accumulated?: number;
      }
    | undefined;
  const topHolder = top
    ? leaderboardEntryLabel({
        rank: 1,
        balance: n(top.balance),
        wallet_short: String(top.wallet_short || ""),
        public_display_name: top.public_display_name || null,
        discord_username: top.discord_username || null,
        discord_global_name: top.discord_global_name || null,
        farms_plots_unlocked: n(top.farms_plots_unlocked),
        farms_rows_accumulated: n(top.farms_rows_accumulated),
      })
    : "none";
  const appRows = Array.isArray(reportData?.app_usage_14d) ? reportData!.app_usage_14d : [];
  const appTop = appRows[0] as Record<string, unknown> | undefined;
  const errors = Array.isArray(reportData?.recent_worker_errors) ? reportData!.recent_worker_errors : [];
  return {
    accounts: n(accounts?.total_accounts),
    circulation: n(circulation?.total_circulation || balances?.total_balance),
    holders: n(circulation?.account_count || balances?.accounts_with_balance),
    topHolder,
    appLeader: String(appTop?.app_id || "none"),
    appLeaderUnits: n(appTop?.units_earned),
    workerErrorCount: errors.filter((raw) => !(raw as Record<string, unknown>).error).length,
  };
}

function signedDelta(current: number, previous: number, kind: "count" | "roots"): string {
  const delta = Math.floor(current) - Math.floor(previous);
  if (!delta) return kind === "count" ? "no change" : "no change";
  const sign = delta > 0 ? "+" : "-";
  if (kind === "roots") return `${sign}${formatRootsAtomicLocale(Math.abs(delta))} ROOTS`;
  return `${sign}${Math.abs(delta).toLocaleString()}`;
}

function previousPrompt(reportData: Record<string, unknown>): Record<string, unknown> | null {
  const previous = reportData.previous_report as Record<string, unknown> | undefined;
  return (previous?.prompt as Record<string, unknown> | null | undefined) || null;
}

function formatComparison(reportData: Record<string, unknown>): string {
  const previous = previousPrompt(reportData);
  if (!previous) return "First archived comparison run; future reports will show movement here.";
  const cur = reportMetrics(reportData);
  const prev = reportMetrics(previous);
  const topText =
    cur.topHolder === prev.topHolder
      ? `Top holder unchanged: ${truncateText(cur.topHolder, 36)}`
      : `Top holder changed: ${truncateText(prev.topHolder, 24)} ${DISCORD_ARROW} ${truncateText(cur.topHolder, 24)}`;
  return [
    `${DISCORD_BULLET} Accounts: **${signedDelta(cur.accounts, prev.accounts, "count")}** (${cur.accounts.toLocaleString()} total)`,
    `${DISCORD_BULLET} Circulation: **${signedDelta(cur.circulation, prev.circulation, "roots")}** (${formatRootsAtomicLocale(cur.circulation)} ROOTS total)`,
    `${DISCORD_BULLET} ${topText}`,
    `${DISCORD_BULLET} App leader: ${cur.appLeader} (${formatRootsAtomicLocale(cur.appLeaderUnits)} ROOTS / 14d)`,
  ].join("\n");
}

function buildXCopy(reportData: Record<string, unknown>): string {
  const cur = reportMetrics(reportData);
  const previous = previousPrompt(reportData);
  const prev = reportMetrics(previous);
  const movement = previous
    ? `Accounts ${signedDelta(cur.accounts, prev.accounts, "count")}; circulation ${signedDelta(cur.circulation, prev.circulation, "roots")}.`
    : "First comparison snapshot archived.";
  const xSignal = formatXSummary(reportData.rootrecord_x as Record<string, unknown> | undefined)
    .replace(/^@rootrecord latest(?: \([^)]*\))?:\s*/i, "Latest RootRecord update: ")
    .replace(/^@rootrecord:\s*/i, "RootRecord X: ");
  const appUsage = formatAppUsageBrief(reportData.app_usage_14d);
  return truncateText(
    [
      "Root Record ecosystem update:",
      `${cur.accounts.toLocaleString()} accounts.`,
      movement,
      `Top apps: ${appUsage}.`,
      xSignal,
    ].join(" "),
    275,
  );
}

function buildSocialUpdateFallback(reportData: Record<string, unknown>): string {
  const cur = reportMetrics(reportData);
  const previous = previousPrompt(reportData);
  const movement = previous
    ? `Accounts ${signedDelta(cur.accounts, reportMetrics(previous).accounts, "count")}; circulation ${signedDelta(cur.circulation, reportMetrics(previous).circulation, "roots")}.`
    : "First daily comparison snapshot is now archived.";
  const xCopy = buildXCopy(reportData);
  const discordCopy = truncateText(
    [
      "Daily Root Record update:",
      `${cur.accounts.toLocaleString()} accounts tracked.`,
      movement,
      `Leading apps: ${formatAppUsageBrief(reportData.app_usage_14d)}.`,
    ].join(" "),
    480,
  );
  return [`**DISCORD**`, discordCopy, "", `**X**`, xCopy].join("\n");
}

function parseSocialDraftSections(raw: string): { discord: string; x: string } {
  const text = String(raw || "").trim();
  const discordMatch = text.match(/\*\*DISCORD\*\*\s*([\s\S]*?)(?=\*\*X\*\*|$)/i);
  const xMatch = text.match(/\*\*X\*\*\s*([\s\S]*?)$/i);
  return {
    discord: (discordMatch?.[1] || text).trim(),
    x: (xMatch?.[1] || "").trim(),
  };
}

function buildSocialUpdateEmbed(social: Record<string, unknown>): DiscordEmbed[] {
  const { discord, x } = parseSocialDraftSections(String(social.content || ""));
  return [
    {
      title: "Daily Social Update Draft",
      description: "Short copy for Discord and X. No hashtags.",
      color: 0x1d9bf0,
      fields: [
        { name: "Discord", value: fieldValue(discord || "Daily update generated.", 500) },
        { name: "X (max ~280 chars)", value: fieldValue(x || "No X draft returned.", 280) },
      ],
    },
  ];
}

type DiscordEmbed = {
  title?: string;
  description?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string };
  timestamp?: string;
};

function fieldValue(raw: unknown, max = 980): string {
  const s = String(raw ?? "").trim();
  if (!s) return "No data returned.";
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}${DISCORD_ELLIPSIS}` : s;
}

async function postAiChannelMessage(
  env: DiscordRootUnitsEnv,
  payload: { content?: string; embeds?: DiscordEmbed[]; username?: string },
): Promise<void> {
  const webhook = String(env.DISCORD_GROK_WEBHOOK_URL || "").trim();
  if (!webhook) return;
  const body: Record<string, unknown> = {
    username: payload.username || "Root Record AI",
  };
  if (payload.content) body.content = truncateText(payload.content, 1900);
  if (payload.embeds?.length) body.embeds = payload.embeds;
  if (!body.content && !body.embeds) body.content = "Root Record AI report update.";
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("discord_ai_channel_post", res.status, text.slice(0, 300));
    }
  } catch (e) {
    console.error("discord_ai_channel_post", e instanceof Error ? e.message : String(e));
  }
}

function buildScreenshotReportEmbeds(reportData: Record<string, unknown>, archiveId: string): DiscordEmbed[] {
  const economy = reportData.root_economy as Record<string, unknown> | undefined;
  const circulation = economy?.circulation as Record<string, unknown> | undefined;
  const leaderboard = economy?.leaderboard as Record<string, unknown> | undefined;
  const accounts = reportData.accounts as Record<string, unknown> | null | undefined;
  const balances = reportData.balances as Record<string, unknown> | null | undefined;
  const holders = n(circulation?.account_count || balances?.accounts_with_balance);
  const total = n(circulation?.total_circulation || balances?.total_balance);
  const generated = String(reportData.generated_at || new Date().toISOString());

  return [
    {
      title: "Root Record Ecosystem Report",
      description: `Generated ${reportTimestamp(generated)} from live Worker, app usage, website, Discord, X, and Reddit data.`,
      color: 0x00a37a,
      timestamp: generated,
      fields: [
        {
          name: "Since Last Report",
          value: fieldValue(formatComparison(reportData)),
        },
        {
          name: "Account Snapshot",
          value: fieldValue(
            [
              `Accounts: **${n(accounts?.total_accounts).toLocaleString()}**`,
              `Internal ROOTS: **${formatRootsAtomicLocale(total)}**`,
              `Holders: **${holders.toLocaleString()}**`,
            ].join("\n"),
          ),
          inline: true,
        },
        {
          name: "Queues",
          value: fieldValue([`Photos: ${formatPhotoQueue(reportData.volcano_photos)}`, formatOpsSummary(reportData)].join("\n")),
          inline: true,
        },
        {
          name: "App Usage Mix",
          value: fieldValue(formatAppUsage(reportData.app_usage_14d)),
        },
        {
          name: "Content Signals",
          value: fieldValue(
            [
              formatXSummary(reportData.rootrecord_x as Record<string, unknown> | undefined),
              `Reddit: ${formatRedditSummary(reportData.reddit as Record<string, unknown> | undefined)}`,
              `Discord: ${formatDiscordActivityAiSummary(reportData)}`,
              `Website: ${formatWebsiteSummary(reportData.website)}`,
            ].join("\n"),
          ),
        },
        {
          name: "Top Holders (Secondary)",
          value: fieldValue(formatTopHolders(leaderboard)),
        },
      ],
      footer: { text: `Raw JSON saved: ${archiveId.slice(0, 8)}` },
    },
  ];
}

function buildFallbackScreenshotPost(reportData: Record<string, unknown>): string {
  const economy = reportData.root_economy as Record<string, unknown> | undefined;
  const circulation = economy?.circulation as Record<string, unknown> | undefined;
  const leaderboard = economy?.leaderboard as Record<string, unknown> | undefined;
  const accounts = reportData.accounts as Record<string, unknown> | null | undefined;
  const balances = reportData.balances as Record<string, unknown> | null | undefined;
  const photos = Array.isArray(reportData.volcano_photos) ? reportData.volcano_photos : [];
  const holders = n(circulation?.account_count || balances?.accounts_with_balance);
  const total = n(circulation?.total_circulation || balances?.total_balance);
  return [
    "**Root Record Ecosystem Report**",
    `_Generated ${reportTimestamp(reportData.generated_at)} from live Worker, app usage, website, Discord, X, and Reddit data._`,
    "",
    "**Since Last Report**",
    formatComparison(reportData),
    "",
    "**Usage & Services**",
    `${DISCORD_BULLET} Total accounts: **${n(accounts?.total_accounts).toLocaleString()}**`,
    `${DISCORD_BULLET} App usage mix: ${formatAppUsage(reportData.app_usage_14d)}`,
    `${DISCORD_BULLET} Internal ROOTS: **${formatRootsAtomicLocale(total)}** across **${holders.toLocaleString()}** holders`,
    "",
    "**Activity & Queues**",
    `${DISCORD_BULLET} Volcano photo queue: ${formatPhotoQueue(photos)}`,
    `${DISCORD_BULLET} ${formatOpsSummary(reportData)}`,
    "",
    "**Content Signals**",
    `${DISCORD_BULLET} ${formatXSummary(reportData.rootrecord_x as Record<string, unknown> | undefined)}`,
    `${DISCORD_BULLET} Reddit: ${formatRedditSummary(reportData.reddit as Record<string, unknown> | undefined)}`,
    `${DISCORD_BULLET} Discord: ${formatDiscordActivityAiSummary(reportData)}`,
    `${DISCORD_BULLET} Website: ${formatWebsiteSummary(reportData.website)}`,
    `${DISCORD_BULLET} Top holders (secondary): ${formatTopHolders(leaderboard).replace(/\n/g, "; ")}`,
    "",
    "**X Copy**",
    "```text",
    buildXCopy(reportData),
    "```",
  ].join("\n");
}

async function archiveScreenshotReport(
  env: DiscordRootUnitsEnv,
  record: Record<string, unknown>,
  discord: { interactionId: string; channelId: string; guildId: string; userId: string },
): Promise<void> {
  const id = String(record.id || crypto.randomUUID());
  const nowIso = String(record.created_at || new Date().toISOString());
  try {
    await env.DB.prepare(
      `INSERT INTO discord_screenshot_reports
       (id, interaction_id, channel_id, guild_id, requested_by_discord_id, prompt_json, response_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        discord.interactionId,
        discord.channelId,
        discord.guildId,
        discord.userId,
        jsonForArchive(record.prompt),
        jsonForArchive(record.response),
        nowIso,
      )
      .run();
  } catch (e) {
    console.error("discord_screenshot_archive_d1", e instanceof Error ? e.message : String(e));
  }

  const webhook = String(env.DISCORD_GROK_WEBHOOK_URL || "").trim();
  if (!webhook) return;
  try {
    const payload = jsonForArchive(record);
    const form = new FormData();
    form.set(
      "payload_json",
      JSON.stringify({
        content: `Root Record /screenshot archive ${id}`,
        username: "Root Record Global Updater",
      }),
    );
    form.set("files[0]", new Blob([payload], { type: "application/json" }), `rootrecord-screenshot-${id}.json`);
    await fetch(webhook, { method: "POST", body: form });
  } catch (e) {
    console.error("discord_screenshot_archive_webhook", e instanceof Error ? e.message : String(e));
  }
}

function solanaRpcUrl(env: DiscordRootUnitsEnv): string {
  const direct = String(env.HELIUS_RPC_URL || env.SOLANA_RPC_URL || env.NEXT_PUBLIC_RPC_URL || "").trim();
  if (direct) return direct;
  const key = String(env.HELIUS_API_KEY || env.NEXT_PUBLIC_HELIUS_API_KEY || env.SOLANA_HELIUS_API_KEY || "").trim();
  if (key) return `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(key)}`;
  return "https://api.mainnet-beta.solana.com";
}

async function solanaRpc(env: DiscordRootUnitsEnv, method: string, params: unknown[]): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(solanaRpcUrl(env), {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "RootRecord/discord-token-report" },
      body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method, params }),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok && !data.error, status: res.status, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function fetchJsonUrl(url: string): Promise<Record<string, unknown>> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "RootRecord/discord-token-report" } });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function collectRootsOnchainData(env: DiscordRootUnitsEnv): Promise<Record<string, unknown>> {
  const [supply, largestAccounts, asset, heliusTokenAccounts] = await Promise.all([
    solanaRpc(env, "getTokenSupply", [ROOTS_MINT_BASE58]),
    solanaRpc(env, "getTokenLargestAccounts", [ROOTS_MINT_BASE58]),
    solanaRpc(env, "getAsset", [{ id: ROOTS_MINT_BASE58 }]),
    solanaRpc(env, "getTokenAccounts", [{ mint: ROOTS_MINT_BASE58, page: 1, limit: 20, displayOptions: { showZeroBalance: false } }]),
  ]);
  return {
    mint: ROOTS_MINT_BASE58,
    solscan_holders_url: `https://solscan.io/token/${ROOTS_MINT_BASE58}#holders`,
    rpc_url_kind: solanaRpcUrl(env).includes("helius") ? "helius" : "configured_rpc",
    supply,
    largest_accounts: largestAccounts,
    asset,
    helius_token_accounts: heliusTokenAccounts,
  };
}

async function collectRootsMarketData(): Promise<Record<string, unknown>> {
  const [dex, jupiter] = await Promise.all([
    fetchJsonUrl(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(ROOTS_MINT_BASE58)}`),
    fetchJsonUrl(`https://lite-api.jup.ag/price/v3?ids=${encodeURIComponent(ROOTS_MINT_BASE58)}`),
  ]);
  const dexData = (dex.data as Record<string, unknown> | undefined) || {};
  const pairs = Array.isArray(dexData.pairs) ? (dexData.pairs as unknown[]).slice(0, 8) : [];
  return {
    roots_mint: ROOTS_MINT_BASE58,
    solscan_url: `https://solscan.io/token/${ROOTS_MINT_BASE58}`,
    solscan_holders_url: `https://solscan.io/token/${ROOTS_MINT_BASE58}#holders`,
    dexscreener: { ...dex, data: { pairs } },
    jupiter,
  };
}

async function collectTokenReportData(env: DiscordRootUnitsEnv, requesterDiscordId: string): Promise<Record<string, unknown>> {
  const nowIso = new Date().toISOString();
  const [circulation, leaderboard, internalBalances, mintRequests, cachedCustodialRoots, onchain, market, appUsage, reddit] =
    await Promise.all([
      readCirculationTotals(env.DB).catch((e) => ({ error: e instanceof Error ? e.message : String(e) })),
      loadEconomyLeaderboardData(env.DB).catch((e) => ({ error: e instanceof Error ? e.message : String(e) })),
      dbFirst(
        env.DB,
        `SELECT COUNT(*) AS accounts_with_balance,
                COALESCE(SUM(balance), 0) AS total_balance,
                COALESCE(AVG(balance), 0) AS avg_balance,
                COALESCE(MAX(balance), 0) AS max_balance
         FROM rr_earn_balance
         WHERE balance > 0`,
      ),
      dbAll(
        env.DB,
        `SELECT status, COUNT(*) AS count, COALESCE(SUM(amount_atomic), 0) AS amount_atomic
         FROM rr_roots_mint_requests
         GROUP BY status
         ORDER BY status`,
      ),
      dbFirst(
        env.DB,
        `SELECT COUNT(DISTINCT account_id) AS custodial_accounts,
                COALESCE(SUM(CAST(amount_raw AS INTEGER)), 0) AS amount_raw,
                MAX(updated_at) AS updated_at
         FROM custodial_wallet_token_slots
         WHERE mint_base58 = ? AND CAST(amount_raw AS INTEGER) > 0`,
        ROOTS_MINT_BASE58,
      ),
      collectRootsOnchainData(env),
      collectRootsMarketData(),
      dbAll(
        env.DB,
        `SELECT app_id, SUM(units_earned) AS units_earned, COUNT(*) AS active_days
         FROM rr_earn_app_day
         WHERE ymd >= date('now', '-14 days')
         GROUP BY app_id
         ORDER BY units_earned DESC
         LIMIT 20`,
      ),
      fetchRootRecordReddit(),
    ]);
  return {
    generated_at: nowIso,
    requested_by_discord_id: requesterDiscordId,
    purpose: "Developer-only Discord /token ROOTS token report",
    internal_roots: { circulation, leaderboard, internal_balances: internalBalances, mint_requests: mintRequests, cached_custodial_roots: cachedCustodialRoots },
    onchain_roots: onchain,
    market,
    usage_context: { app_usage_14d: appUsage, reddit },
  };
}

async function callGrokAnalysis(
  env: DiscordRootUnitsEnv,
  title: string,
  instruction: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const token = grokChatBearerToken(env);
  const apiUrl = String(env.GROK_API_URL || "https://api.x.ai/v1/chat/completions").trim();
  const model = String(env.GROK_MODEL || "grok-3-latest").trim();
  const body = {
    model,
    messages: [
      {
        role: "system",
        content:
          `${instruction} Use only provided data. Be precise, mention unavailable/failed sources, and keep under 1200 characters. ` +
          "Do not reveal secrets, raw credentials, provider names, model names, API configuration, archive/debug status, or provider errors.",
      },
      { role: "user", content: jsonForArchive(data) },
    ],
    temperature: 0.25,
  };
  if (!token) {
    return { ok: false, title, detail: "Grok bearer token is not configured.", content: `${title}: AI unavailable; data archived.`, request: body };
  }
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const response = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const content = grokResponseText(response);
    const detail = content ? "" : grokErrorText(response, res.status);
    return {
      ok: res.ok && Boolean(content),
      title,
      status: res.status,
      detail,
      content: content || `${title}: ${detail}`,
      request: body,
      response,
    };
  } catch (e) {
    return { ok: false, title, detail: e instanceof Error ? e.message : String(e), content: `${title}: AI request failed.`, request: body };
  }
}

async function archiveAiReport(
  env: DiscordRootUnitsEnv,
  commandName: string,
  record: Record<string, unknown>,
  discord: { interactionId: string; channelId: string; guildId: string; userId: string },
): Promise<void> {
  const id = String(record.id || crypto.randomUUID());
  const nowIso = String(record.created_at || new Date().toISOString());
  try {
    await env.DB.prepare(
      `INSERT INTO discord_ai_reports
       (id, command_name, interaction_id, channel_id, guild_id, requested_by_discord_id, prompt_json, response_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        commandName,
        discord.interactionId,
        discord.channelId,
        discord.guildId,
        discord.userId,
        jsonForArchive(record.prompt),
        jsonForArchive(record.response),
        nowIso,
      )
      .run();
  } catch (e) {
    console.error("discord_ai_report_archive_d1", e instanceof Error ? e.message : String(e));
  }

  const webhook = String(env.DISCORD_GROK_WEBHOOK_URL || "").trim();
  if (!webhook) return;
  try {
    const form = new FormData();
    form.set(
      "payload_json",
      JSON.stringify({
        content: `Root Record ${commandName} archive ${id}`,
        username: "Root Record AI",
      }),
    );
    form.set("files[0]", new Blob([jsonForArchive(record)], { type: "application/json" }), `rootrecord-${commandName.replace(/^\//, "")}-${id}.json`);
    await fetch(webhook, { method: "POST", body: form });
  } catch (e) {
    console.error("discord_ai_report_archive_webhook", e instanceof Error ? e.message : String(e));
  }
}

function tokenReportEmbed(finalReport: Record<string, unknown>, archiveId: string): DiscordEmbed[] {
  return [
    {
      title: "ROOTS Token Report",
      description: fieldValue(finalReport.content || "Token report generated.", 1800),
      color: 0x7c3aed,
      fields: [
        { name: "Mint", value: `\`${ROOTS_MINT_BASE58}\`` },
        { name: "Solscan", value: `[Token](https://solscan.io/token/${ROOTS_MINT_BASE58}) Â· [Holders](https://solscan.io/token/${ROOTS_MINT_BASE58}#holders)` },
      ],
      footer: { text: `AI record saved: ${archiveId.slice(0, 8)}` },
      timestamp: new Date().toISOString(),
    },
  ];
}

function activityReportEmbed(activityReport: Record<string, unknown>): DiscordEmbed[] {
  const metrics = (activityReport.summary_metrics as Record<string, unknown> | undefined) || {};
  const generatedForSnapshot = Boolean(activityReport.generated_for_snapshot);
  return [
    {
      title: "Discord Activity Report",
      description: fieldValue(activityReport.content || "Discord activity report generated.", 1800),
      color: 0x5865f2,
      fields: [
        {
          name: "30d Messages",
          value: n(metrics.total_messages_30d).toLocaleString(),
          inline: true,
        },
        {
          name: "Latest Day",
          value: `${metrics.latest_day || "n/a"} Â· ${n(metrics.latest_day_messages).toLocaleString()}`,
          inline: true,
        },
        {
          name: "Source",
          value: generatedForSnapshot ? "Generated for snapshot refresh" : "Developer /activity",
          inline: true,
        },
      ],
      footer: { text: `AI record saved: ${String(activityReport.id || "").slice(0, 8)}` },
      timestamp: String(activityReport.created_at || new Date().toISOString()),
    },
  ];
}

async function handleActivityCommand(
  body: Record<string, unknown>,
  env: DiscordRootUnitsEnv,
  member: Record<string, unknown> | undefined,
  requesterDiscordId: string,
): Promise<Response> {
  if (!(await hasDeveloperRole(member, env))) {
    return interactionResponse(4, { content: "Only @Developer can use `/activity`.", flags: 64 });
  }
  const activityReport = await generateDiscordActivityAiReport(env, requesterDiscordId, {
    interactionId: String(body.id || ""),
    channelId: String(body.channel_id || ""),
    guildId: String(body.guild_id || ""),
    userId: requesterDiscordId,
  });
  return jsonInteractionPayload({
    type: 4,
    data: {
      embeds: activityReportEmbed(activityReport),
      flags: 64,
    },
  });
}

async function handleUserReportCommand(
  body: Record<string, unknown>,
  env: DiscordRootUnitsEnv,
  member: Record<string, unknown> | undefined,
  requesterDiscordId: string,
  opts: Array<Record<string, unknown>>,
): Promise<Response> {
  if (!(await hasDeveloperRole(member, env))) {
    return interactionResponse(4, { content: "Only @Developer can use `/userreport`.", flags: 64 });
  }
  const resolved = await resolveUserReportScope(env, opts);
  if ("error" in resolved) {
    return interactionResponse(4, { content: resolved.error, flags: 64 });
  }
  const reportData = await collectUserBehaviorReportData(env, requesterDiscordId, resolved.scope);
  const final = await callGrokUserBehaviorReport(env, reportData);
  const archiveId = crypto.randomUUID();
  await archiveAiReport(
    env,
    "/userreport",
    {
      id: archiveId,
      created_at: new Date().toISOString(),
      prompt: reportData,
      response: final,
    },
    {
      interactionId: String(body.id || ""),
      channelId: String(body.channel_id || ""),
      guildId: String(body.guild_id || ""),
      userId: requesterDiscordId,
    },
  );
  return jsonInteractionPayload({
    type: 4,
    data: {
      embeds: userReportEmbed(final, reportData, archiveId),
      flags: 64,
    },
  });
}

async function handleTokenCommand(
  body: Record<string, unknown>,
  env: DiscordRootUnitsEnv,
  member: Record<string, unknown> | undefined,
  requesterDiscordId: string,
): Promise<Response> {
  if (!(await hasDeveloperRole(member, env))) {
    return interactionResponse(4, { content: "Only @Developer can use `/token`.", flags: 64 });
  }
  const reportData = await collectTokenReportData(env, requesterDiscordId);
  const archiveId = crypto.randomUUID();
  const sectionSpecs = [
    {
      key: "internal",
      title: "Internal ROOTS Ledger",
      instruction: "Analyze internal ROOTS balances, circulation, mint request status, and custodial cached ROOTS. Focus on what this says about usage and distribution.",
      data: reportData.internal_roots as Record<string, unknown>,
    },
    {
      key: "onchain",
      title: "On-chain ROOTS Token",
      instruction: "Analyze on-chain ROOTS supply, largest token accounts, holder/account data from Helius/RPC, and Solscan holder context.",
      data: reportData.onchain_roots as Record<string, unknown>,
    },
    {
      key: "market",
      title: "ROOTS LP Market",
      instruction: "Analyze ROOTS market/LP data from DexScreener/Jupiter/Solscan links. Call out price, liquidity, pairs, volume, and missing data.",
      data: reportData.market as Record<string, unknown>,
    },
    {
      key: "usage",
      title: "ROOTS Usage Context",
      instruction: "Analyze how ROOTS usage connects to app activity and community signals. Prefer app/service utilization over raw token balance hype.",
      data: reportData.usage_context as Record<string, unknown>,
    },
  ];
  const subreports: Record<string, unknown>[] = [];
  for (const spec of sectionSpecs) {
    const ai = await callGrokAnalysis(env, spec.title, spec.instruction, spec.data);
    subreports.push({ key: spec.key, ...ai });
    await postAiChannelMessage(env, {
      content: `**/token subreport: ${spec.title} (${archiveId.slice(0, 8)})**\n${String(ai.content || "No AI content returned.").slice(0, 1700)}`,
    });
  }
  const final = await callGrokAnalysis(
    env,
    "Final ROOTS Token Report",
    "Combine the provided subreports into one developer-ready ROOTS token report. Include internal ledger, on-chain holder/supply, LP market, app usage context, risks, and next actions. Keep it Discord-ready.",
    { report_data: reportData, subreports },
  );
  await postAiChannelMessage(env, {
    content: `**/token final report ${archiveId.slice(0, 8)}**\n${String(final.content || "No final AI content returned.").slice(0, 1700)}`,
  });
  await archiveAiReport(
    env,
    "/token",
    {
      id: archiveId,
      created_at: new Date().toISOString(),
      prompt: reportData,
      response: { subreports, final },
    },
    {
      interactionId: String(body.id || ""),
      channelId: String(body.channel_id || ""),
      guildId: String(body.guild_id || ""),
      userId: requesterDiscordId,
    },
  );
  return jsonInteractionPayload({
    type: 4,
    data: {
      embeds: tokenReportEmbed(final, archiveId),
      flags: 64,
    },
  });
}

async function handleScreenshotCommand(
  body: Record<string, unknown>,
  env: DiscordRootUnitsEnv,
  member: Record<string, unknown> | undefined,
  requesterDiscordId: string,
): Promise<Response> {
  if (!(await hasDeveloperRole(member, env))) {
    return interactionResponse(4, { content: "Only @Developer can use `/screenshot` or `/snapshot`.", flags: 64 });
  }

  const [reportData, previous] = await Promise.all([
    collectScreenshotReportData(env, requesterDiscordId),
    loadPreviousScreenshotReport(env),
  ]);
  if (previous) {
    reportData.previous_report = previous;
  }
  const recentActivityReport = await loadRecentActivityAiReport(env, 60 * 60 * 1000);
  reportData.discord_activity_ai_report =
    recentActivityReport ||
    (await generateDiscordActivityAiReport(
      env,
      requesterDiscordId,
      {
        interactionId: String(body.id || ""),
        channelId: String(body.channel_id || ""),
        guildId: String(body.guild_id || ""),
        userId: requesterDiscordId,
      },
      { generatedForSnapshot: true },
    ));
  const grok = await callGrokReport(env, reportData);
  const archiveId = crypto.randomUUID();
  const reportEmbeds = buildScreenshotReportEmbeds(reportData, archiveId);
  const social = await callGrokSocialUpdate(env, reportData, reportEmbeds);
  await archiveScreenshotReport(
    env,
    {
      id: archiveId,
      created_at: new Date().toISOString(),
      prompt: reportData,
      response: { report: grok, social },
    },
    {
      interactionId: String(body.id || ""),
      channelId: String(body.channel_id || ""),
      guildId: String(body.guild_id || ""),
      userId: requesterDiscordId,
    },
  );

  return jsonInteractionPayload({
    type: 4,
    data: {
      embeds: reportEmbeds,
    },
    rr_followup: {
      embeds: buildSocialUpdateEmbed(social),
    },
  });
}

async function handleMintCommand(
  body: Record<string, unknown>,
  env: DiscordRootUnitsEnv,
  member: Record<string, unknown> | undefined,
  requesterDiscordId: string,
  opts: Array<Record<string, unknown>>,
): Promise<Response> {
  if (!(await hasDeveloperRole(member, env))) {
    return interactionResponse(4, { content: "Only @Developer can use `/mint`.", flags: 64 });
  }
  const base = String(env.ROOTRECORD_SOLANA_TX_URL || "").trim().replace(/\/+$/, "");
  const admin = String(env.RR_PUSH_ADMIN_SECRET || "").trim();
  if (!base || !admin) {
    return interactionResponse(4, {
      content: "Mint worker is not configured. Set `ROOTRECORD_SOLANA_TX_URL` and `RR_PUSH_ADMIN_SECRET`.",
      flags: 64,
    });
  }

  const amount = optNumber(opts, "amount") ?? optNumberDeep(opts, "amount");
  const wallet = optStringDeep(opts, "wallet") || ROOT_RECORD_GLOBAL_UPDATER_PUBKEY;
  const note = optStringDeep(opts, "note") || "Discord /mint";
  const requestBody: Record<string, unknown> = {
    destination_owner: wallet,
    requested_by_discord_id: requesterDiscordId,
    interaction_id: String(body.id || ""),
    note,
  };
  let modeLabel = "";
  if (amount != null) {
    requestBody.amount_ui = String(amount);
    modeLabel = `${amount} ROOTS`;
  } else {
    const totals = await readCirculationTotals(env.DB);
    requestBody.target_atomic = String(totals.total_circulation);
    modeLabel = `top up to internal circulation (${formatRootsAtomicLocale(totals.total_circulation)} ROOTS)`;
  }

  let res: Response;
  try {
    res = await fetch(`${base}/api/internal/mint-roots`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-RR-Push-Admin-Key": admin,
        "User-Agent": "RootRecord/discord-mint",
      },
      body: JSON.stringify(requestBody),
    });
  } catch (e) {
    return interactionResponse(4, {
      content: `Mint request failed before reaching Solana worker: ${e instanceof Error ? e.message : String(e)}`,
      flags: 64,
    });
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || !data.ok) {
    return interactionResponse(4, {
      content: `Mint failed: ${String(data.detail || `HTTP ${res.status}`)}`,
      flags: 64,
    });
  }
  const sig = String(data.signature || "").trim();
  const minted = String(data.amount_ui || "").trim();
  const dest = String(data.destination_owner || wallet).trim();
  const skipped = Boolean(data.skipped);
  return interactionResponse(4, {
    embeds: [
      {
        title: skipped ? "ROOTS Mint Not Needed" : "ROOTS Mint Complete",
        color: skipped ? 0x38bdf8 : 0x22c55e,
        fields: [
          { name: "Mode", value: modeLabel, inline: false },
          { name: "Minted", value: `${minted} ROOTS`, inline: true },
          { name: "Mint", value: `\`${ROOTS_MINT_BASE58}\``, inline: false },
          { name: "Destination", value: `\`${dest}\``, inline: false },
          { name: "Transaction", value: skipped ? "No transaction needed" : sig ? `[${sig.slice(0, 10)}â€¦](${String(data.explorer || `https://solscan.io/tx/${sig}`)})` : "submitted", inline: false },
        ],
      },
    ],
  });
}

async function handleApplicationCommand(body: Record<string, unknown>, env: DiscordRootUnitsEnv): Promise<Response> {
  const data = body.data as Record<string, unknown> | undefined;
  if (!data) {
    return interactionResponse(4, { content: "Missing command data." });
  }
  const name = String(data.name || "").trim().toLowerCase();
  const member = body.member as Record<string, unknown> | undefined;
  const user = member?.user as Record<string, unknown> | undefined;
  const fromDiscordId = String(user?.id || "").trim();
  if (!fromDiscordId) {
    return interactionResponse(4, { content: "Could not read your Discord user id." });
  }

  const opts = (Array.isArray(data.options) ? data.options : []) as Array<Record<string, unknown>>;

  if (name === "root") {
    return interactionResponse(4, { flags: 64 });
  }

  if (name === "bal") {
    return handleBal(env.DB, fromDiscordId, env);
  }

  if (name === "economy") {
    return handleEconomy(env.DB);
  }

  if (name === "screenshot" || name === "snapshot") {
    return handleScreenshotCommand(body, env, member, fromDiscordId);
  }

  if (name === "activity") {
    return handleActivityCommand(body, env, member, fromDiscordId);
  }

  if (name === "userreport") {
    return handleUserReportCommand(body, env, member, fromDiscordId, opts);
  }

  if (name === "token") {
    return handleTokenCommand(body, env, member, fromDiscordId);
  }

  if (name === "mint") {
    return handleMintCommand(body, env, member, fromDiscordId, opts);
  }

  if (name === "wallet" || name === "deposit") {
    return handleWalletDeposit(env.DB, fromDiscordId);
  }

  if (name === "swap") {
    return handleSwapCommand(env, fromDiscordId, opts);
  }

  if (name === "menu") {
    return handleSlashMenu();
  }

  if (name === "withdraw") {
    return interactionResponse(4, {
      content: "**`/withdraw`** isn't in the bot yet. Use **`/deposit`** / **`/bal`** for what you've added to your address.",
    });
  }

  if (name === "airdrop") {
    return interactionResponse(4, {
      content: "**`/airdrop`** `claim` / `create` â€” coming soon.",
    });
  }

  if (name === "dice") {
    return handleDiceCreate(env.DB, fromDiscordId, opts);
  }

  if (name === "faucet") {
    const interactionId = String(body.id || "").trim();
    if (!interactionId) {
      return interactionResponse(4, { content: "Missing interaction id." });
    }
    const fromUid = await earnUserIdForDiscord(env.DB, fromDiscordId);
    if (!fromUid) {
      return interactionResponse(4, {
        content: `Your Discord account is not linked. Open **${DISCORD_VERIFY_URL}** to link Discord.`,
      });
    }
    const sc = invokedSubcommand(opts);
    const scName = sc ? sc.name : "";
    const inner = sc ? sc.inner : [];
    if (scName === "claim") {
      return handleFaucetClaim(env.DB, fromDiscordId, interactionId);
    }
    if (scName === "deposit") {
      const amt = ledgerFromWholeRoots(optNumber(inner, "amount") ?? optNumberDeep(opts, "amount"));
      if (amt == null) {
        return interactionResponse(4, {
          content: "Use **`/faucet deposit`** with **amount** (whole Roots into the shared pool).",
        });
      }
      return handleFaucetDeposit(env.DB, fromUid, amt);
    }
    return interactionResponse(4, { content: "Use **`/faucet claim`** or **`/faucet deposit`**." });
  }

  if (name === "send") {
    const interactionId = String(body.id || "").trim();
    if (!interactionId) {
      return interactionResponse(4, { content: "Missing interaction id." });
    }

    const fromUid = await earnUserIdForDiscord(env.DB, fromDiscordId);
    if (!fromUid) {
      return interactionResponse(4, {
        content:
          `Your Discord account is not linked to RootRecord. Open **${DISCORD_VERIFY_URL}** to link Discord.`,
      });
    }

    const sc = invokedSubcommand(opts);
    const scName = sc ? String(sc.name || "").trim().toLowerCase() : "";
    const inner = (sc ? sc.inner : []) as Array<Record<string, unknown>>;
    const sendAsset = parseSendAsset(optStringChoice(inner, "asset") ?? optStringDeep(opts, "asset"));
    if (sendAsset === "RRTT") {
      return interactionResponse(4, {
        content: "That asset is not available in Discord sends. Use **ROOTS** or **SOL**.",
      });
    }
    if (sendAsset === "SOL" && scName !== "" && scName !== "user") {
      return interactionResponse(4, {
        content:
          `**${sendAsset}** only works under **\`/send user\`**: pick **${sendAsset}**, **member**, then **amount**. For splits to many people, use **ROOTS** with **everyone** / **active** / **role**.`,
      });
    }
    if (scName === "everyone") {
      const total = ledgerFromWholeRoots(optNumber(inner, "amount") ?? optNumberDeep(opts, "amount"));
      if (total == null) {
        return interactionResponse(4, {
          content:
            "Use **`/send everyone`**: **asset** = **ROOTS**, then **amount** (total ROOTS to split, decimal e.g. `0.01`).",
        });
      }
      return handleSendBulk(env.DB, fromDiscordId, fromUid, total, interactionId, "all", env);
    }

    if (scName === "active") {
      const total = ledgerFromWholeRoots(optNumber(inner, "amount") ?? optNumberDeep(opts, "amount"));
      if (total == null) {
        return interactionResponse(4, {
          content:
            "Use **`/send active`**: **asset** = **ROOTS**, then **amount** (total ROOTS to split, decimal).",
        });
      }
      return handleSendBulk(env.DB, fromDiscordId, fromUid, total, interactionId, "active", env);
    }

    if (scName === "role") {
      const roleId = optRole(inner, "role") ?? optRoleDeep(opts, "role");
      const total = ledgerFromWholeRoots(optNumber(inner, "amount") ?? optNumberDeep(opts, "amount"));
      if (!roleId || total == null) {
        return interactionResponse(4, {
          content:
            "Use **`/send role`**: **asset** = **ROOTS**, **role**, and **amount** (total ROOTS to split, decimal).",
        });
      }
      const bot = String(env.DISCORD_BOT_TOKEN || "").trim();
      const guildId = String(env.DISCORD_GUILD_ID || "").trim();
      if (!bot || !guildId) {
        return interactionResponse(4, {
          content: "Configure **`DISCORD_BOT_TOKEN`** (secret) and **`DISCORD_GUILD_ID`** for **role** sends.",
        });
      }
      const fetched = await fetchDiscordUserIdsWithGuildRole(guildId, roleId, bot);
      if (!fetched.ok) {
        return interactionResponse(4, {
          content: `Could not list guild members (${fetched.status}). Bot needs **View Server Members** + **Server Members Intent**.`,
        });
      }
      return handleSendBulk(env.DB, fromDiscordId, fromUid, total, interactionId, "role", env, fetched.ids);
    }

    if (scName === "user") {
      const toDiscordId = optSnowflake(inner, "member") ?? optSnowflakeDeep(opts, "member");
      const amountRaw = optNumber(inner, "amount") ?? optNumberDeep(opts, "amount");
      if (!toDiscordId || amountRaw == null) {
        return interactionResponse(4, {
          content:
            "Use **`/send user`**: **asset**, **member**, **amount** (SOL = decimal e.g. `0.00001`; ROOTS = decimal ROOTS).",
        });
      }
      if (toDiscordId === fromDiscordId) {
        return interactionResponse(4, { content: "You cannot send to yourself." });
      }
      const failedDisplayUnits =
        sendAsset === "ROOTS"
          ? ledgerFromWholeRoots(amountRaw) ?? 0
          : amountRaw;
      const toUid = await earnUserIdForDiscord(env.DB, toDiscordId);
      if (!toUid) {
        const hasVerifiedRole = await discordUserHasVerifiedRole(env, toDiscordId);
        return interactionResponse(4, {
          content: hasVerifiedRole
            ? verifiedButUnlinkedRecipientSendFailedContent(
                toDiscordId,
                sendFailedAmountText(failedDisplayUnits, sendAsset),
              )
            : unlinkedRecipientSendFailedContent(toDiscordId, failedDisplayUnits, sendAsset),
        });
      }
      if (sendAsset === "SOL") {
        const lamports = solWholeToLamports(amountRaw);
        if (lamports == null || lamports < MIN_SOL_SEND_LAMPORTS) {
          return interactionResponse(4, {
            content: `SOL amount must be at least **${(MIN_SOL_SEND_LAMPORTS / 1e9).toFixed(5)}** SOL (e.g. \`0.00001\`).`,
          });
        }
        if (lamports > MAX_SOL_SEND_LAMPORTS) {
          return interactionResponse(4, {
            content: `Max **${(MAX_SOL_SEND_LAMPORTS / 1e9).toFixed(0)}** SOL per send (\`${MAX_SOL_SEND_LAMPORTS.toLocaleString()}\` lamports).`,
          });
        }
        return handleSendSolUser(env, fromDiscordId, toDiscordId, fromUid, toUid, lamports, interactionId);
      }
      const units = ledgerFromWholeRoots(amountRaw);
      if (units == null) {
        return interactionResponse(4, { content: "Amount must be at least **0.00000001** Roots." });
      }
      if (units < MIN_SEND) {
        return interactionResponse(4, { content: "Amount must be at least **0.00000001** Roots." });
      }
      if (units > MAX_SEND) {
        return interactionResponse(4, {
          content: `Max **${formatRootsAtomicLocale(MAX_SEND)}** Roots per send.`,
        });
      }
      return handleSendExecute(env.DB, fromDiscordId, toDiscordId, fromUid, toUid, units, interactionId);
    }

    return interactionResponse(4, {
      content:
        "Use **`/send user`**, **`everyone`**, **`active`**, or **`role`**. **ROOTS** = Root Units shared inside Discord; **SOL** = deposit-wallet transfer (**`/send user`** only). `@everyone` is not a user field â€” use **everyone** (linked members only).",
    });
  }

  return interactionResponse(4, { content: "Unknown command." });
}

/** `/root bal` — linked RootRecord users on any server. */
export async function handleRootSlashBalResponse(env: DiscordRootUnitsEnv, fromDiscordId: string): Promise<Response> {
  if (!fromDiscordId) {
    return interactionResponse(4, { content: "Could not read your Discord user id.", flags: 64 });
  }
  const res = await handleBal(env.DB, fromDiscordId, env);
  try {
    const payload = (await res.json()) as { type?: number; data?: { content?: string; flags?: number; embeds?: unknown[] } };
    if (payload.data) payload.data.flags = 64;
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch {
    return res;
  }
}

/** `/root send user` — ROOTS peer transfer (linked accounts only). */
export async function handleRootSlashSendUserResponse(
  env: DiscordRootUnitsEnv,
  body: Record<string, unknown>,
  fromDiscordId: string,
  innerOptions: Array<Record<string, unknown>>,
): Promise<Response> {
  const interactionId = String(body.id || "").trim();
  if (!interactionId) {
    return interactionResponse(4, { content: "Missing interaction id.", flags: 64 });
  }
  if (!fromDiscordId) {
    return interactionResponse(4, { content: "Could not read your Discord user id.", flags: 64 });
  }

  const fromUid = await earnUserIdForDiscord(env.DB, fromDiscordId);
  if (!fromUid) {
    return interactionResponse(4, {
      content: `Link your Discord to RootRecord at **${DISCORD_VERIFY_URL}** to send ROOTS.`,
      flags: 64,
    });
  }

  const toDiscordId = optSnowflake(innerOptions, "member");
  const amountRaw = optNumber(innerOptions, "amount");
  if (!toDiscordId || amountRaw == null) {
    return interactionResponse(4, {
      content: "Use **`/root send user`**: **member** and **amount** (decimal ROOTS, e.g. `0.01`).",
      flags: 64,
    });
  }
  if (toDiscordId === fromDiscordId) {
    return interactionResponse(4, { content: "You cannot send ROOTS to yourself.", flags: 64 });
  }

  const failedDisplayUnits = ledgerFromWholeRoots(amountRaw) ?? 0;
  const toUid = await earnUserIdForDiscord(env.DB, toDiscordId);
  if (!toUid) {
    const hasVerifiedRole = await discordUserHasVerifiedRole(env, toDiscordId);
    return interactionResponse(4, {
      content: hasVerifiedRole
        ? verifiedButUnlinkedRecipientSendFailedContent(toDiscordId, sendFailedAmountText(failedDisplayUnits, "ROOTS"))
        : unlinkedRecipientSendFailedContent(toDiscordId, failedDisplayUnits, "ROOTS"),
      flags: 64,
    });
  }

  const units = ledgerFromWholeRoots(amountRaw);
  if (units == null || units < MIN_SEND) {
    return interactionResponse(4, { content: "Amount must be at least **0.00000001** ROOTS.", flags: 64 });
  }
  if (units > MAX_SEND) {
    return interactionResponse(4, {
      content: `Max **${formatRootsAtomicLocale(MAX_SEND)}** ROOTS per send.`,
      flags: 64,
    });
  }

  const res = await handleSendExecute(env.DB, fromDiscordId, toDiscordId, fromUid, toUid, units, interactionId);
  return res;
}

export async function handleDiscordEconomyCommandInteractions(
  request: Request,
  env: DiscordRootUnitsEnv,
  ctx?: ExecutionContext,
): Promise<Response> {
  const pk = String(env.DISCORD_PUBLIC_KEY || "").trim();
  if (!pk) {
    return new Response(JSON.stringify({ detail: "DISCORD_PUBLIC_KEY is not set on this Worker." }), {
      status: 503,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const rawBody = await request.text();
  if (!verifyDiscordRequest(rawBody, request.headers, pk)) {
    const hasSig = Boolean(request.headers.get("x-signature-ed25519") || request.headers.get("X-Signature-Ed25519"));
    console.error(
      "discord_economy_interaction_verify_fail",
      JSON.stringify({ has_sig: hasSig, body_len: rawBody.length, pk_len: pk.length }),
    );
    return new Response("invalid request signature", { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const t = Number(body.type);
  if (t === 1) {
    return interactionResponse(1);
  }
  if (t === 4) {
    return new Response(JSON.stringify({ type: 8, data: { choices: [] } }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  if (t === 3) {
    try {
      return await handleMessageComponent(body, env);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error("discord_message_component", msg.slice(0, 400));
      return jsonInteractionPayload({
        type: 4,
        data: { content: "Something went wrong. Try again.", flags: 64 },
      });
    }
  }
  if (t === 2) {
    const rawAppId = body.application_id;
    const applicationId =
      typeof rawAppId === "string" && /^\d{10,22}$/.test(rawAppId.trim())
        ? rawAppId.trim()
        : String(env.DISCORD_CLIENT_ID || "").trim();
    const interactionToken = String(body.token || "").trim();
    if (!interactionToken) {
      return interactionResponse(4, {
        content: "Invalid Discord interaction (missing token). Check the Interactions URL points at this Worker.",
      });
    }
    const runCmd = async (): Promise<Response> => {
      try {
        return await handleApplicationCommand(body, env);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("discord_economy_cmd", msg.slice(0, 400));
        return interactionResponse(4, {
          content: "Something went wrong processing that command. Try again in a moment.",
        });
      }
    };

    if (ctx?.waitUntil && interactionToken) {
      const appIdForPatch = applicationId || String(env.DISCORD_CLIENT_ID || "").trim();
      ctx.waitUntil(
        (async () => {
          if (!appIdForPatch) {
            console.error("discord_interaction_deferred_missing_application_id");
            return;
          }
          try {
            const r = await runCmd();
            let payload: {
              type?: number;
              data?: { content?: string; flags?: number; components?: unknown[]; embeds?: unknown[] };
              rr_followup?: { content?: string; flags?: number; embeds?: unknown[] };
            };
            try {
              payload = (await r.json()) as typeof payload;
            } catch {
              await patchDeferredInteractionMessage(appIdForPatch, interactionToken, {
                content: "Invalid bot response. Try again.",
              });
              return;
            }
            const hasEmbeds = Array.isArray(payload.data?.embeds) && payload.data!.embeds!.length > 0;
            const patchData: { content?: string; flags?: number; components?: unknown[]; embeds?: unknown[] } = {};
            if (typeof payload.data?.content === "string") patchData.content = payload.data.content;
            else if (hasEmbeds || Array.isArray(payload.data?.components)) patchData.content = "\u200b";
            else patchData.content = "Done.";
            if (typeof payload.data?.flags === "number" && Number.isFinite(payload.data.flags)) {
              patchData.flags = payload.data.flags;
            }
            if (Array.isArray(payload.data?.components)) {
              patchData.components = payload.data.components;
            }
            if (hasEmbeds) patchData.embeds = payload.data!.embeds;
            await patchDeferredInteractionMessage(appIdForPatch, interactionToken, patchData);
            if (payload.rr_followup) {
              await postDiscordInteractionFollowup(appIdForPatch, interactionToken, payload.rr_followup);
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error("discord_economy_deferred", msg.slice(0, 400));
            await patchDeferredInteractionMessage(appIdForPatch, interactionToken, {
              content: "Something went wrong processing that command. Try again in a moment.",
            });
          }
        })(),
      );
      return interactionResponse(5);
    }

    return runCmd();
  }

  return interactionResponse(4, { content: "Unsupported interaction type." });
}

/** @deprecated Use handleDiscordUpdaterInteractions or handleDiscordEconomyInteractions. */
export async function handleDiscordInteractions(
  request: Request,
  env: DiscordRootUnitsEnv,
  ctx?: ExecutionContext,
): Promise<Response> {
  return handleDiscordEconomyCommandInteractions(request, env, ctx);
}
