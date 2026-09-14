import type { D1Database } from "@cloudflare/workers-types";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";

import { formatRootsAtomicLocale } from "../../shared/roots-units";
import { json } from "./cors";
import { isDiscordWebhookUrl, notifySolanaToolsDiscord } from "./discord-solana-notify";
import { verifyWorkerOpsAdmin } from "./push";
import { loadKeypairForAccount, type InternalWalletEnv } from "./solana-internal-wallet";
import { TREASURY_ACCOUNT_EMAIL, TREASURY_WALLET_PUBKEY } from "./treasury-account";

export type RootsDepositEnv = InternalWalletEnv & {
  SOLANA_RPC_URL?: string;
  RRTT_MINT_BASE58?: string;
  RRTT_DECIMALS?: string;
  RRTT_TREASURY_SECRET_KEY_B58?: string;
  RR_PUSH_ADMIN_SECRET?: string;
  DISCORD_ROOT_ECONOMY_WEBHOOK_URL?: string;
};

type DepositTokenAccount = {
  tokenAccount: PublicKey;
  mint: PublicKey;
  owner: PublicKey;
  amountRaw: bigint;
  decimals: number;
  tokenProgram: PublicKey;
};

type DepositRow = {
  account_id: string;
  email: string;
  custodial_b58: string;
};

export type RootsDepositProcessorResult = {
  ok: boolean;
  dry_run: boolean;
  scanned_wallets: number;
  deposits_found: number;
  deposits_credited: number;
  skipped_treasury_wallet: number;
  signatures: string[];
  errors: Array<{ account_id: string; detail: string }>;
};

const DEPOSIT_COMPUTE_UNITS = 600_000;
const CUSTODIAL_TOPUP_LAMPORTS = 30_000;
const ROOTS_DEPOSIT_MINT_BASE58 = "8hwxLN1Q4Yr8xFErErULCqNvcF1cMwGjpRXPz6DAH7gM";

function rpcCandidates(env: RootsDepositEnv): string[] {
  const primary = String(env.SOLANA_RPC_URL || "").trim();
  const out: string[] = [];
  for (const url of [primary, "https://solana-rpc.publicnode.com", "https://rpc.ankr.com/solana", "https://api.mainnet-beta.solana.com"]) {
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

async function pickConnection(env: RootsDepositEnv): Promise<Connection | null> {
  for (const url of rpcCandidates(env)) {
    try {
      const c = new Connection(url, "confirmed");
      await c.getLatestBlockhash("confirmed");
      return c;
    } catch {
      /* try next */
    }
  }
  return null;
}

function rawToInternalAtomic(raw: bigint, sourceDecimals: number): number {
  const dec = Math.max(0, Math.floor(Number(sourceDecimals) || 0));
  let normalized = raw;
  if (dec > 8) normalized = raw / 10n ** BigInt(dec - 8);
  if (dec < 8) normalized = raw * 10n ** BigInt(8 - dec);
  if (normalized <= 0n) return 0;
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  return Number(normalized > max ? max : normalized);
}

function collectRootTokenAccounts(
  owner: PublicKey,
  mint: PublicKey,
  programId: PublicKey,
  value: Awaited<ReturnType<Connection["getParsedTokenAccountsByOwner"]>>["value"],
): DepositTokenAccount[] {
  const out: DepositTokenAccount[] = [];
  for (const row of value || []) {
    const data = row.account.data;
    if (typeof data !== "object" || data === null || !("parsed" in data)) continue;
    const parsed = (data as { parsed?: { type?: string; info?: Record<string, unknown> } }).parsed;
    if (!parsed || parsed.type !== "account" || !parsed.info) continue;
    const info = parsed.info as {
      mint?: string;
      owner?: string;
      tokenAmount?: { amount?: string; decimals?: number };
    };
    let accMint: PublicKey;
    let accOwner: PublicKey;
    try {
      accMint = new PublicKey(String(info.mint || ""));
      accOwner = new PublicKey(String(info.owner || ""));
    } catch {
      continue;
    }
    if (!accMint.equals(mint) || !accOwner.equals(owner)) continue;
    const amountRaw = BigInt(String(info.tokenAmount?.amount ?? "0"));
    if (amountRaw <= 0n) continue;
    out.push({
      tokenAccount: row.pubkey,
      mint: accMint,
      owner: accOwner,
      amountRaw,
      decimals: Math.min(255, Math.max(0, Math.floor(Number(info.tokenAmount?.decimals) || 0))),
      tokenProgram: programId,
    });
  }
  return out;
}

async function findRootDeposits(connection: Connection, owner: PublicKey, mint: PublicKey): Promise<DepositTokenAccount[]> {
  const out: DepositTokenAccount[] = [];
  for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    const rows = await connection.getParsedTokenAccountsByOwner(owner, { programId });
    out.push(...collectRootTokenAccounts(owner, mint, programId, rows.value));
  }
  return out;
}

async function confirmShort(connection: Connection, signature: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const status = await connection.getSignatureStatuses([signature]).catch(() => null);
    const s = status?.value?.[0];
    if (s?.err) throw new Error(`transaction failed: ${JSON.stringify(s.err)}`);
    if (s?.confirmationStatus === "confirmed" || s?.confirmationStatus === "finalized") return;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
}

async function sendTx(
  connection: Connection,
  payer: Keypair,
  signers: Keypair[],
  ixs: TransactionInstruction[],
): Promise<string> {
  const latest = await connection.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: latest.blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: DEPOSIT_COMPUTE_UNITS }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
      ...ixs,
    ],
  });
  const tx = new VersionedTransaction(msg.compileToV0Message());
  const allSigners = [payer, ...signers.filter((s) => !s.publicKey.equals(payer.publicKey))];
  tx.sign(allSigners);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await confirmShort(connection, sig);
  return sig;
}

function buildSweepRootDepositInstructions(
  treasury: Keypair,
  custodial: Keypair,
  acc: DepositTokenAccount,
): TransactionInstruction[] {
  const treasuryAta = getAssociatedTokenAddressSync(
    acc.mint,
    treasury.publicKey,
    false,
    acc.tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return [
    createAssociatedTokenAccountIdempotentInstruction(
      treasury.publicKey,
      treasuryAta,
      treasury.publicKey,
      acc.mint,
      acc.tokenProgram,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
    createTransferCheckedInstruction(
      acc.tokenAccount,
      acc.mint,
      treasuryAta,
      custodial.publicKey,
      acc.amountRaw,
      acc.decimals,
      [],
      acc.tokenProgram,
    ),
    createCloseAccountInstruction(acc.tokenAccount, treasury.publicKey, custodial.publicKey, [], acc.tokenProgram),
  ];
}

async function sweepRootDeposit(
  connection: Connection,
  treasury: Keypair,
  custodial: Keypair,
  acc: DepositTokenAccount,
): Promise<{ sweepSig: string; topupSig?: string }> {
  const ixs = buildSweepRootDepositInstructions(treasury, custodial, acc);

  try {
    return { sweepSig: await sendTx(connection, treasury, [custodial], ixs) };
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    const custodialLamports = await connection.getBalance(custodial.publicKey, "confirmed").catch(() => 0);
    if (!/insufficient|debit|fund|lamport|balance/i.test(msg) || custodialLamports >= CUSTODIAL_TOPUP_LAMPORTS) throw e;

    const topupLamports = CUSTODIAL_TOPUP_LAMPORTS - custodialLamports;
    const sweepSig = await sendTx(connection, treasury, [custodial], [
      SystemProgram.transfer({
        fromPubkey: treasury.publicKey,
        toPubkey: custodial.publicKey,
        lamports: topupLamports,
      }),
      ...ixs,
      SystemProgram.transfer({
        fromPubkey: custodial.publicKey,
        toPubkey: treasury.publicKey,
        lamports: topupLamports,
      }),
    ]);
    return { sweepSig, topupSig: sweepSig };
  }
}

async function postDepositDiscord(
  env: RootsDepositEnv,
  input: {
    email: string;
    accountId: string;
    custodial: string;
    amountAtomic: number;
    amountRaw: string;
    tokenAccount: string;
    signature: string;
  },
): Promise<void> {
  const webhook = String(env.DISCORD_ROOT_ECONOMY_WEBHOOK_URL || "").trim();
  if (!webhook || !isDiscordWebhookUrl(webhook)) return;
  const body = [
    "**ROOTS deposit detected**",
    `**Account:** ${input.email || input.accountId}`,
    `**Credited:** ${formatRootsAtomicLocale(input.amountAtomic)} ROOTS`,
    `**Raw token amount:** \`${input.amountRaw}\``,
    `**Custodial wallet:** \`${input.custodial}\``,
    `**Closed ATA:** \`${input.tokenAccount}\``,
    `**Treasury:** \`${TREASURY_WALLET_PUBKEY}\``,
    `**Transaction:** https://solscan.io/tx/${input.signature}`,
  ].join("\n");
  await notifySolanaToolsDiscord(webhook, body);
}

async function ensureDepositTableRow(
  db: D1Database,
  input: {
    id: string;
    accountId: string;
    userId: string;
    email: string;
    custodial: string;
    tokenAccount: string;
    mint: string;
    tokenProgram: string;
    amountRaw: string;
    amountAtomic: number;
    decimals: number;
    nowIso: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO rr_roots_custodial_deposits (
         id, account_id, user_id, email, custodial_wallet, token_account, mint_base58,
         token_program_id, amount_raw, amount_atomic, decimals, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?)`,
    )
    .bind(
      input.id,
      input.accountId,
      input.userId,
      input.email,
      input.custodial,
      input.tokenAccount,
      input.mint,
      input.tokenProgram,
      input.amountRaw,
      input.amountAtomic,
      input.decimals,
      input.nowIso,
      input.nowIso,
    )
    .run();
}

async function creditDeposit(
  env: RootsDepositEnv,
  input: {
    id: string;
    accountId: string;
    userId: string;
    email: string;
    amountAtomic: number;
    sweepSig: string;
    topupSig?: string;
    nowIso: string;
  },
): Promise<void> {
  await env.DB.batch([
    env.DB
      .prepare("INSERT OR IGNORE INTO rr_earn_balance (user_id, balance, updated_at) VALUES (?, 0, ?)")
      .bind(input.userId, input.nowIso),
    env.DB
      .prepare("UPDATE rr_earn_balance SET balance = balance + ?, updated_at = ? WHERE user_id = ?")
      .bind(input.amountAtomic, input.nowIso, input.userId),
    env.DB
      .prepare(
        `UPDATE rr_roots_custodial_deposits
         SET status = 'credited', sweep_signature = ?, close_signature = ?, topup_signature = ?,
             credited_at = ?, updated_at = ?, error = NULL
         WHERE id = ?`,
      )
      .bind(input.sweepSig, input.sweepSig, input.topupSig || null, input.nowIso, input.nowIso, input.id),
    env.DB
      .prepare(
        `INSERT INTO rr_earn_custodial_ledger (
           id, account_id, kind, direction, units, tx_signature, recipient_pubkey,
           app_snapshot_json, earn_balance_snapshot, notes, created_at
         ) VALUES (?, ?, 'roots_deposit_to_internal', 'in', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.id,
        input.accountId,
        input.amountAtomic,
        input.sweepSig,
        TREASURY_WALLET_PUBKEY,
        JSON.stringify({ source: "custodial_roots_deposit", email: input.email }),
        0,
        "On-chain ROOTS deposit swept to treasury and credited to internal ROOTS balance.",
        input.nowIso,
      ),
  ]);
  const { touchRootEconomy } = await import("../../shared/root-economy-snapshot");
  await touchRootEconomy(env.DB, "roots_deposit").catch(() => {});
}

async function isOutboundMintOutput(
  db: D1Database,
  accountId: string,
  custodialWallet: string,
  amountAtomic: number,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT id
       FROM rr_roots_mint_requests
       WHERE account_id = ?
         AND destination_owner = ?
         AND CAST(amount_atomic AS INTEGER) = ?
         AND status IN ('submitted', 'confirmed')
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .bind(accountId, custodialWallet, amountAtomic)
    .first<{ id: string }>()
    .catch(() => null);
  return Boolean(row?.id);
}

export async function runRootsCustodialDepositProcessor(
  env: RootsDepositEnv,
  opts: { dryRun?: boolean; limit?: number; accountId?: string } = {},
): Promise<RootsDepositProcessorResult> {
  const result: RootsDepositProcessorResult = {
    ok: true,
    dry_run: opts.dryRun === true,
    scanned_wallets: 0,
    deposits_found: 0,
    deposits_credited: 0,
    skipped_treasury_wallet: 0,
    signatures: [],
    errors: [],
  };

  const mintStr = ROOTS_DEPOSIT_MINT_BASE58;
  const treasurySk = String(env.RRTT_TREASURY_SECRET_KEY_B58 || "").trim();
  if (!opts.dryRun && !treasurySk) {
    result.ok = false;
    result.errors.push({ account_id: "", detail: "RRTT_TREASURY_SECRET_KEY_B58 is required." });
    return result;
  }

  const connection = await pickConnection(env);
  if (!connection) {
    result.ok = false;
    result.errors.push({ account_id: "", detail: "No working Solana RPC." });
    return result;
  }

  let mint: PublicKey;
  let treasury: Keypair | null = null;
  try {
    mint = new PublicKey(mintStr);
    if (!opts.dryRun) treasury = Keypair.fromSecretKey(bs58.decode(treasurySk));
  } catch (e) {
    result.ok = false;
    result.errors.push({ account_id: "", detail: String(e instanceof Error ? e.message : e) });
    return result;
  }

  const limit = Math.max(1, Math.min(25, Math.floor(Number(opts.limit) || 8)));
  const rows = opts.accountId
    ? await env.DB
        .prepare(
          `SELECT iw.account_id, lower(trim(la.email)) AS email, iw.pubkey AS custodial_b58
           FROM internal_solana_wallets iw
           JOIN license_accounts la ON la.id = iw.account_id
           WHERE iw.account_id = ?`,
        )
        .bind(opts.accountId)
        .all<DepositRow>()
    : await env.DB
        .prepare(
          `SELECT iw.account_id, lower(trim(la.email)) AS email, iw.pubkey AS custodial_b58
           FROM internal_solana_wallets iw
           JOIN license_accounts la ON la.id = iw.account_id
           WHERE lower(trim(la.email)) != ?
           ORDER BY RANDOM()
           LIMIT ?`,
        )
        .bind(TREASURY_ACCOUNT_EMAIL, limit)
        .all<DepositRow>();

  for (const row of rows.results || []) {
    const accountId = String(row.account_id || "").trim();
    const email = String(row.email || "").trim().toLowerCase();
    const userId = `user:${email}`;
    const pkStr = String(row.custodial_b58 || "").trim();
    if (!accountId || !email || !pkStr) continue;
    result.scanned_wallets += 1;

    let owner: PublicKey;
    try {
      owner = new PublicKey(pkStr);
    } catch {
      result.errors.push({ account_id: accountId, detail: "Invalid custodial pubkey." });
      continue;
    }
    if (owner.toBase58() === TREASURY_WALLET_PUBKEY) {
      result.skipped_treasury_wallet += 1;
      continue;
    }

    let deposits: DepositTokenAccount[] = [];
    try {
      deposits = await findRootDeposits(connection, owner, mint);
    } catch (e) {
      result.errors.push({ account_id: accountId, detail: String(e instanceof Error ? e.message : e).slice(0, 200) });
      continue;
    }

    for (const acc of deposits) {
      result.deposits_found += 1;
      const amountAtomic = rawToInternalAtomic(acc.amountRaw, acc.decimals);
      if (amountAtomic <= 0) continue;
      if (await isOutboundMintOutput(env.DB, accountId, owner.toBase58(), amountAtomic)) continue;
      if (opts.dryRun) continue;
      if (!treasury) continue;

      const custodial = await loadKeypairForAccount(env, accountId);
      if (!custodial || !custodial.publicKey.equals(owner)) {
        result.errors.push({ account_id: accountId, detail: "Could not decrypt custodial signer." });
        continue;
      }

      const id = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      try {
        await ensureDepositTableRow(env.DB, {
          id,
          accountId,
          userId,
          email,
          custodial: owner.toBase58(),
          tokenAccount: acc.tokenAccount.toBase58(),
          mint: acc.mint.toBase58(),
          tokenProgram: acc.tokenProgram.toBase58(),
          amountRaw: acc.amountRaw.toString(),
          amountAtomic,
          decimals: acc.decimals,
          nowIso,
        });
        const sweep = await sweepRootDeposit(connection, treasury, custodial, acc);
        await creditDeposit(env, {
          id,
          accountId,
          userId,
          email,
          amountAtomic,
          sweepSig: sweep.sweepSig,
          topupSig: sweep.topupSig,
          nowIso: new Date().toISOString(),
        });
        result.deposits_credited += 1;
        result.signatures.push(sweep.sweepSig);
        await postDepositDiscord(env, {
          email,
          accountId,
          custodial: owner.toBase58(),
          amountAtomic,
          amountRaw: acc.amountRaw.toString(),
          tokenAccount: acc.tokenAccount.toBase58(),
          signature: sweep.sweepSig,
        });
      } catch (e) {
        const detail = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e).slice(0, 500);
        result.errors.push({ account_id: accountId, detail });
        await env.DB
          .prepare("UPDATE rr_roots_custodial_deposits SET status = 'error', error = ?, updated_at = ? WHERE id = ?")
          .bind(detail, new Date().toISOString(), id)
          .run()
          .catch(() => {});
      }
    }
  }

  result.ok = result.errors.length === 0;
  return result;
}

export async function handleRootsCustodialDepositsRoute(
  request: Request,
  env: RootsDepositEnv,
  sub: string,
  method: string,
): Promise<Response | null> {
  if (sub !== "/internal/process-roots-custodial-deposits" || method !== "POST") return null;
  if (!(await verifyWorkerOpsAdmin(request, env))) return json({ ok: false, detail: "Unauthorized." }, 401);
  let body: { dry_run?: boolean; limit?: number; account_id?: string | null } = {};
  try {
    body = (await request.json().catch(() => ({}))) as typeof body;
  } catch {
    body = {};
  }
  const result = await runRootsCustodialDepositProcessor(env, {
    dryRun: body.dry_run === true,
    limit: body.limit,
    accountId: String(body.account_id || "").trim() || undefined,
  });
  return json(result, result.ok ? 200 : 503);
}
