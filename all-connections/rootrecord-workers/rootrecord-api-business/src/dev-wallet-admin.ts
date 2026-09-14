import type { D1Database } from "@cloudflare/workers-types";

import { Connection, ComputeBudgetProgram, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createBurnCheckedInstruction,
  createCloseAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";

import { json } from "./cors";
import { verifyPushAdminKey, verifyWorkerOpsAdmin } from "./push";
import { sessionFromRequest, type AuthEnv } from "./primary-auth";
import { loadKeypairForAccount, type InternalWalletEnv } from "./solana-internal-wallet";

const ADMIN_EMAIL = "rootrecord@outlook.com";

export type DevWalletAdminEnv = InternalWalletEnv & {
  DEV_WALLET_ADMIN_ENABLED?: string;
  /** Optional: Solana site proxy only (`X-RR-Wallet-Admin-Key`). Prefer over reusing push-broadcast secret on Vercel. */
  WALLET_ADMIN_PROXY_SECRET?: string;
  /** Same as Worker `RR_PUSH_ADMIN_SECRET` for `verifyWorkerOpsAdmin` (X-RR-Push-Admin-Key). */
  RR_PUSH_ADMIN_SECRET?: string;
};

function devEnabled(env: DevWalletAdminEnv): boolean {
  return String(env.DEV_WALLET_ADMIN_ENABLED || "").trim() === "1";
}

async function requireDevWalletAdmin(env: DevWalletAdminEnv, request: Request) {
  const sess = await sessionFromRequest(env, request);
  if (!sess) return { ok: false as const, res: json({ detail: "Unauthorized" }, 401) };
  const email = String(sess.email || "").trim().toLowerCase();
  if (email !== ADMIN_EMAIL) return { ok: false as const, res: json({ detail: "Forbidden" }, 403) };
  const proxySecret = String(env.WALLET_ADMIN_PROXY_SECRET || "").trim();
  const proxyOk =
    proxySecret.length >= 8 && (await verifyPushAdminKey(request.headers.get("X-RR-Wallet-Admin-Key"), proxySecret));
  const pushOk = await verifyWorkerOpsAdmin(request, env);
  const allowed = devEnabled(env) || proxyOk || pushOk;
  if (!allowed) {
    return {
      ok: false as const,
      res: json(
        {
          detail:
            "Wallet admin disabled: set Worker secret WALLET_ADMIN_PROXY_SECRET and the same value on Vercel, or align RR_PUSH_ADMIN_SECRET on Vercel with the Worker. Local dev: DEV_WALLET_ADMIN_ENABLED=1.",
        },
        403,
      ),
    };
  }
  return { ok: true as const, sess };
}

function rpcUrl(env: { SOLANA_RPC_URL?: string }): string {
  return String(env.SOLANA_RPC_URL || "").trim() || "https://api.mainnet-beta.solana.com";
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

function textParam(u: URL, k: string, maxLen: number): string | null {
  const v = u.searchParams.get(k);
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function parseUiToRaw(ui: string, decimals: number): bigint | null {
  const s = String(ui || "").trim();
  if (!s) return null;
  if (!Number.isFinite(decimals) || decimals < 0 || decimals > 18) return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [a, bRaw] = s.split(".");
  const b = (bRaw || "").slice(0, decimals);
  const frac = b.padEnd(decimals, "0");
  try {
    const whole = BigInt(a || "0");
    const fracInt = decimals > 0 ? BigInt(frac || "0") : 0n;
    return whole * 10n ** BigInt(decimals) + fracInt;
  } catch {
    return null;
  }
}

async function countWallets(db: D1Database, search: string | null): Promise<number> {
  const s = String(search ?? "").trim();
  if (!s) {
    const row = await db.prepare("SELECT COUNT(*) AS c FROM internal_solana_wallets").first<{ c: number }>();
    return Math.max(0, Math.floor(Number(row?.c) || 0));
  }
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS c
       FROM internal_solana_wallets iw
       LEFT JOIN license_accounts la ON la.id = iw.account_id
       WHERE INSTR(LOWER(iw.account_id), LOWER(?)) > 0
          OR INSTR(LOWER(iw.pubkey), LOWER(?)) > 0
          OR INSTR(LOWER(IFNULL(la.email, '')), LOWER(?)) > 0`,
    )
    .bind(s, s, s)
    .first<{ c: number }>();
  return Math.max(0, Math.floor(Number(row?.c) || 0));
}

async function listWallets(db: D1Database, cursor: string | null, limit: number, search: string | null) {
  const s = String(search ?? "").trim();
  const baseFrom = `FROM internal_solana_wallets iw
       LEFT JOIN license_accounts la ON la.id = iw.account_id`;
  const order = `ORDER BY iw.created_at DESC
       LIMIT ?`;
  let sql: string;
  let binds: unknown[];
  if (!s) {
    sql = `SELECT iw.account_id, iw.pubkey, iw.created_at, la.email ${baseFrom}
       WHERE (? IS NULL OR iw.created_at < ?)
       ${order}`;
    binds = [cursor, cursor, limit];
  } else {
    sql = `SELECT iw.account_id, iw.pubkey, iw.created_at, la.email ${baseFrom}
       WHERE (? IS NULL OR iw.created_at < ?)
       AND (
         INSTR(LOWER(iw.account_id), LOWER(?)) > 0
         OR INSTR(LOWER(iw.pubkey), LOWER(?)) > 0
         OR INSTR(LOWER(IFNULL(la.email, '')), LOWER(?)) > 0
       )
       ${order}`;
    binds = [cursor, cursor, s, s, s, limit];
  }
  const rows = await db
    .prepare(sql)
    .bind(...binds)
    .all<{ account_id: string; pubkey: string; created_at: string; email: string | null }>();
  const items = (rows.results || []).map((r) => ({
    account_id: String(r.account_id || "").trim(),
    pubkey: String(r.pubkey || "").trim(),
    created_at: String(r.created_at || "").trim(),
    email: r.email == null ? null : String(r.email || "").trim(),
  }));
  const nextCursor = items.length === limit ? items[items.length - 1]!.created_at : null;
  return { items, next_cursor: nextCursor };
}

async function walletOverview(env: DevWalletAdminEnv, accountId: string) {
  const kp = await loadKeypairForAccount(env, accountId);
  if (!kp) return { ok: false as const, res: json({ detail: "Wallet missing or cannot decrypt key." }, 404) };
  const connection = new Connection(rpcUrl(env), "confirmed");
  const pk = kp.publicKey;
  const sol = await connection.getBalance(pk, "confirmed").catch(() => -1);
  const [classic, token2022] = await Promise.all([
    connection.getParsedTokenAccountsByOwner(pk, { programId: TOKEN_PROGRAM_ID }, "confirmed").catch(() => null),
    connection.getParsedTokenAccountsByOwner(pk, { programId: TOKEN_2022_PROGRAM_ID }, "confirmed").catch(() => null),
  ]);
  type TokenRow = {
    token_account: string;
    mint: string | null;
    owner: string | null;
    amount_raw: string | null;
    decimals: number | null;
    ui_amount: number | null;
    ui_amount_string: string | null;
  };
  function rowFromParsedEntry(v: { pubkey: PublicKey; account: { data: unknown } }): TokenRow | null {
    const raw = v.account?.data;
    if (typeof raw !== "object" || raw === null || !("parsed" in raw)) return null;
    const parsed = (raw as { parsed?: { type?: string; info?: Record<string, unknown> } }).parsed;
    if (!parsed || parsed.type !== "account" || !parsed.info) return null;
    const info = parsed.info as {
      mint?: string;
      owner?: string;
      tokenAmount?: { amount?: string; decimals?: number; uiAmount?: number; uiAmountString?: string };
    };
    const mint = String(info?.mint || "").trim();
    const owner = String(info?.owner || "").trim();
    const amount = info?.tokenAmount || {};
    return {
      token_account: v.pubkey.toBase58(),
      mint: mint || null,
      owner: owner || null,
      amount_raw: typeof amount.amount === "string" ? amount.amount : null,
      decimals: typeof amount.decimals === "number" ? amount.decimals : null,
      ui_amount: typeof amount.uiAmount === "number" ? amount.uiAmount : null,
      ui_amount_string: typeof amount.uiAmountString === "string" ? amount.uiAmountString : null,
    };
  }
  const merged = new Map<string, TokenRow>();
  for (const parsed of [classic, token2022]) {
    for (const v of parsed?.value || []) {
      const row = rowFromParsedEntry(v as { pubkey: PublicKey; account: { data: unknown } });
      if (row?.token_account) merged.set(row.token_account, row);
    }
  }
  const token_accounts = [...merged.values()];
  return {
    ok: true as const,
    data: {
      account_id: accountId,
      pubkey: pk.toBase58(),
      sol_balance_lamports: sol >= 0 ? sol : null,
      token_accounts,
    },
  };
}

async function sendSolFromCustodial(env: DevWalletAdminEnv, accountId: string, toPubkeyB58: string, lamports: number) {
  const kp = await loadKeypairForAccount(env, accountId);
  if (!kp) return json({ detail: "Wallet missing or cannot decrypt key." }, 404);
  let toPk: PublicKey;
  try {
    toPk = new PublicKey(String(toPubkeyB58 || "").trim());
  } catch {
    return json({ detail: "Invalid to_pubkey_base58." }, 422);
  }
  const l = clampInt(Number(lamports), 1, 10_000_000_000);
  const connection = new Connection(rpcUrl(env), "confirmed");
  const latest = await connection.getLatestBlockhash("confirmed");
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 120_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
    SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: toPk, lamports: l }),
  ];
  const msg = new TransactionMessage({
    payerKey: kp.publicKey,
    recentBlockhash: latest.blockhash,
    instructions: ixs,
  });
  const tx = new VersionedTransaction(msg.compileToV0Message());
  tx.sign([kp]);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction(
    { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    "confirmed",
  );
  return json({ ok: true, signature: sig }, 200);
}

async function transferSplFromCustodial(
  env: DevWalletAdminEnv,
  accountId: string,
  mintB58: string,
  toOwnerB58: string,
  amountUi: string,
  decimals: number,
) {
  const kp = await loadKeypairForAccount(env, accountId);
  if (!kp) return json({ detail: "Wallet missing or cannot decrypt key." }, 404);

  let mint: PublicKey;
  let toOwner: PublicKey;
  try {
    mint = new PublicKey(String(mintB58 || "").trim());
  } catch {
    return json({ detail: "Invalid mint_base58." }, 422);
  }
  try {
    toOwner = new PublicKey(String(toOwnerB58 || "").trim());
  } catch {
    return json({ detail: "Invalid to_owner_base58." }, 422);
  }

  const d = clampInt(Number(decimals), 0, 18);
  const raw = parseUiToRaw(String(amountUi || "").trim(), d);
  if (raw == null || raw <= 0n) return json({ detail: "Invalid amount_ui for decimals." }, 422);

  const fromAta = getAssociatedTokenAddressSync(mint, kp.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const toAta = getAssociatedTokenAddressSync(mint, toOwner, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

  const connection = new Connection(rpcUrl(env), "confirmed");
  const latest = await connection.getLatestBlockhash("confirmed");
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 260_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
    createAssociatedTokenAccountIdempotentInstruction(kp.publicKey, toAta, toOwner, mint, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
    createTransferCheckedInstruction(fromAta, mint, toAta, kp.publicKey, raw, d, [], TOKEN_PROGRAM_ID),
  ];

  const msg = new TransactionMessage({
    payerKey: kp.publicKey,
    recentBlockhash: latest.blockhash,
    instructions: ixs,
  });
  const tx = new VersionedTransaction(msg.compileToV0Message());
  tx.sign([kp]);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction(
    { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    "confirmed",
  );
  return json({ ok: true, signature: sig, from_ata: fromAta.toBase58(), to_ata: toAta.toBase58() }, 200);
}

async function burnSplFromCustodial(env: DevWalletAdminEnv, accountId: string, mintB58: string, amountUi: string, decimals: number) {
  const kp = await loadKeypairForAccount(env, accountId);
  if (!kp) return json({ detail: "Wallet missing or cannot decrypt key." }, 404);
  let mint: PublicKey;
  try {
    mint = new PublicKey(String(mintB58 || "").trim());
  } catch {
    return json({ detail: "Invalid mint_base58." }, 422);
  }
  const d = clampInt(Number(decimals), 0, 18);
  const raw = parseUiToRaw(String(amountUi || "").trim(), d);
  if (raw == null || raw <= 0n) return json({ detail: "Invalid amount_ui for decimals." }, 422);

  const ata = getAssociatedTokenAddressSync(mint, kp.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const connection = new Connection(rpcUrl(env), "confirmed");
  const latest = await connection.getLatestBlockhash("confirmed");
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 160_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
    createBurnCheckedInstruction(ata, mint, kp.publicKey, raw, d, [], TOKEN_PROGRAM_ID),
  ];
  const msg = new TransactionMessage({
    payerKey: kp.publicKey,
    recentBlockhash: latest.blockhash,
    instructions: ixs,
  });
  const tx = new VersionedTransaction(msg.compileToV0Message());
  tx.sign([kp]);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction(
    { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    "confirmed",
  );
  return json({ ok: true, signature: sig, ata: ata.toBase58() }, 200);
}

async function closeEmptyAta(env: DevWalletAdminEnv, accountId: string, tokenAccountB58: string, destinationB58: string) {
  const kp = await loadKeypairForAccount(env, accountId);
  if (!kp) return json({ detail: "Wallet missing or cannot decrypt key." }, 404);
  let tokenAccount: PublicKey;
  let dest: PublicKey;
  try {
    tokenAccount = new PublicKey(String(tokenAccountB58 || "").trim());
  } catch {
    return json({ detail: "Invalid token_account_base58." }, 422);
  }
  try {
    dest = new PublicKey(String(destinationB58 || "").trim());
  } catch {
    return json({ detail: "Invalid destination_base58." }, 422);
  }

  const connection = new Connection(rpcUrl(env), "confirmed");
  const latest = await connection.getLatestBlockhash("confirmed");
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 140_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
    createCloseAccountInstruction(tokenAccount, dest, kp.publicKey, [], TOKEN_PROGRAM_ID),
  ];
  const msg = new TransactionMessage({
    payerKey: kp.publicKey,
    recentBlockhash: latest.blockhash,
    instructions: ixs,
  });
  const tx = new VersionedTransaction(msg.compileToV0Message());
  tx.sign([kp]);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await connection.confirmTransaction(
    { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
    "confirmed",
  );
  return json({ ok: true, signature: sig }, 200);
}

/**
 * Dev-only privileged wallet admin routes (never enabled in prod).
 *
 * Base: `/api/dev/wallet-admin/*` (router passes `sub` without `/api` prefix).
 */
export async function handleDevWalletAdminRoutes(
  request: Request,
  env: DevWalletAdminEnv,
  sub: string,
  method: string,
): Promise<Response | null> {
  if (!sub.startsWith("/dev/wallet-admin")) return null;

  const gate = await requireDevWalletAdmin(env, request);
  if (!gate.ok) return gate.res;

  const url = new URL(request.url);
  const base = "/dev/wallet-admin";
  const rest = sub === base ? "" : sub.slice(base.length);

  if (method === "GET" && rest === "/wallets") {
    const lim = clampInt(Number(textParam(url, "limit", 10) || "10"), 1, 200);
    const cursor = textParam(url, "cursor", 80);
    const search = textParam(url, "q", 200);
    const total_count = await countWallets(env.DB, search);
    const r = await listWallets(env.DB, cursor, lim, search);
    return json({ ok: true, ...r, total_count }, 200);
  }

  if (method === "GET" && rest.startsWith("/wallet/") && rest.endsWith("/overview")) {
    const middle = rest.slice("/wallet/".length, rest.length - "/overview".length);
    const accountId = middle.replace(/\/+/g, "/").replace(/^\//, "").replace(/\/$/, "").trim();
    if (!accountId) return json({ detail: "Missing accountId." }, 422);
    const r = await walletOverview(env, accountId);
    if (!r.ok) return r.res;
    return json({ ok: true, ...r.data }, 200);
  }

  if (method === "POST" && rest.startsWith("/wallet/") && rest.endsWith("/transfer-sol")) {
    const middle = rest.slice("/wallet/".length, rest.length - "/transfer-sol".length);
    const accountId = middle.replace(/\/+/g, "/").replace(/^\//, "").replace(/\/$/, "").trim();
    if (!accountId) return json({ detail: "Missing accountId." }, 422);
    let body: { to_pubkey_base58?: string; lamports?: number };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ detail: "Invalid JSON" }, 400);
    }
    return await sendSolFromCustodial(env, accountId, String(body.to_pubkey_base58 || ""), Number(body.lamports || 0));
  }

  if (method === "POST" && rest.startsWith("/wallet/") && rest.endsWith("/transfer-spl")) {
    const middle = rest.slice("/wallet/".length, rest.length - "/transfer-spl".length);
    const accountId = middle.replace(/\/+/g, "/").replace(/^\//, "").replace(/\/$/, "").trim();
    if (!accountId) return json({ detail: "Missing accountId." }, 422);
    let body: { mint_base58?: string; to_owner_base58?: string; amount_ui?: string; decimals?: number };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ detail: "Invalid JSON" }, 400);
    }
    return await transferSplFromCustodial(
      env,
      accountId,
      String(body.mint_base58 || ""),
      String(body.to_owner_base58 || ""),
      String(body.amount_ui || ""),
      Number(body.decimals),
    );
  }

  if (method === "POST" && rest.startsWith("/wallet/") && rest.endsWith("/burn-spl")) {
    const middle = rest.slice("/wallet/".length, rest.length - "/burn-spl".length);
    const accountId = middle.replace(/\/+/g, "/").replace(/^\//, "").replace(/\/$/, "").trim();
    if (!accountId) return json({ detail: "Missing accountId." }, 422);
    let body: { mint_base58?: string; amount_ui?: string; decimals?: number };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ detail: "Invalid JSON" }, 400);
    }
    return await burnSplFromCustodial(env, accountId, String(body.mint_base58 || ""), String(body.amount_ui || ""), Number(body.decimals));
  }

  if (method === "POST" && rest.startsWith("/wallet/") && rest.endsWith("/close-empty-ata")) {
    const middle = rest.slice("/wallet/".length, rest.length - "/close-empty-ata".length);
    const accountId = middle.replace(/\/+/g, "/").replace(/^\//, "").replace(/\/$/, "").trim();
    if (!accountId) return json({ detail: "Missing accountId." }, 422);
    let body: { token_account_base58?: string; destination_base58?: string };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return json({ detail: "Invalid JSON" }, 400);
    }
    return await closeEmptyAta(env, accountId, String(body.token_account_base58 || ""), String(body.destination_base58 || ""));
  }

  return json({ detail: "Not found" }, 404);
}

