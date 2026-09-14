import type { D1Database } from "@cloudflare/workers-types";
import { Connection, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

/** Same RPC env slice as `custodial-onchain-cache` (avoid circular import). */
export type CustodialTokenSlotRpcEnv = {
  DB: D1Database;
  SOLANA_RPC_URL?: string;
  RRTT_MINT_BASE58?: string;
  RRTT_DECIMALS?: string;
  CUSTODIAL_RPC_REFRESH_BUDGET_MS?: string;
};

function isLikelyInfraRpcError(e: unknown): boolean {
  const s = e instanceof Error ? e.message : String(e);
  return /429|503|504|408|ECONNRESET|ETIMEDOUT|fetch failed|Too many|rate limit|socket hang|network/i.test(s);
}

function rpcUrlCandidates(env: CustodialTokenSlotRpcEnv): string[] {
  const primary = String(env.SOLANA_RPC_URL || "").trim();
  const fallbacks = [
    "https://api.mainnet-beta.solana.com",
    "https://solana-rpc.publicnode.com",
    "https://rpc.ankr.com/solana",
  ];
  const out: string[] = [];
  for (const u of [primary, ...fallbacks]) {
    if (u && !out.includes(u)) out.push(u);
  }
  return out;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type CustodialTokenSlotRow = {
  mint_base58: string;
  token_program_id: string;
  ata_pubkey: string;
  decimals: number;
  amount_raw: string;
  updated_at: string;
};

const NATIVE_MINT_SENTINEL = "native";
const NATIVE_PROGRAM_SENTINEL = "native";

/**
 * Scans mainnet for this account's custodial pubkey (native SOL + all SPL token accounts),
 * then replaces `custodial_wallet_token_slots` for that `account_id`.
 * Best-effort: returns ok:false if no wallet row, RPC failure, or timeout (never throws).
 */
export async function syncCustodialTokenSlotsFromRpc(
  env: CustodialTokenSlotRpcEnv,
  accountId: string,
  budgetMs: number,
): Promise<{ ok: boolean; slots_written: number }> {
  const aid = String(accountId || "").trim();
  if (!aid) return { ok: false, slots_written: 0 };

  const row = await env.DB
    .prepare("SELECT pubkey FROM internal_solana_wallets WHERE account_id = ?")
    .bind(aid)
    .first<{ pubkey: string }>();
  const pkStr = String(row?.pubkey || "").trim();
  if (!pkStr) return { ok: false, slots_written: 0 };

  const owner = new PublicKey(pkStr);
  const t0 = Date.now();
  const budget = Math.max(800, Math.min(25_000, Math.floor(budgetMs || 8000)));

  for (const rpcUrl of rpcUrlCandidates(env)) {
    const remaining = () => budget - (Date.now() - t0);
    if (remaining() < 400) break;
    try {
      const connection = new Connection(rpcUrl, "confirmed");
      const solLamports = await withTimeout(
        connection.getBalance(owner, "confirmed"),
        remaining(),
        -1 as number,
      );
      if (solLamports < 0) continue;

      const nowIso = new Date().toISOString();
      const inserts: Array<{
        mint: string;
        program: string;
        ata: string;
        decimals: number;
        raw: string;
      }> = [
        {
          mint: NATIVE_MINT_SENTINEL,
          program: NATIVE_PROGRAM_SENTINEL,
          ata: "",
          decimals: 9,
          raw: String(BigInt(solLamports)),
        },
      ];

      for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
        if (remaining() < 300) break;
        let value: { pubkey: import("@solana/web3.js").PublicKey; account: unknown }[] = [];
        try {
          const res = await withTimeout(
            connection.getParsedTokenAccountsByOwner(owner, { programId }),
            remaining(),
            null as { value: typeof value } | null,
          );
          value = (res && "value" in res ? res.value : null) || [];
        } catch {
          value = [];
        }

        for (const pr of value) {
          const pkStrAta =
            pr.pubkey && typeof (pr.pubkey as { toBase58?: () => string }).toBase58 === "function"
              ? (pr.pubkey as PublicKey).toBase58()
              : String(pr.pubkey || "");
          const data = (pr.account as { data?: unknown })?.data;
          if (typeof data !== "object" || data === null || !("parsed" in data)) continue;
          const parsed = (data as { parsed?: { type?: string; info?: Record<string, unknown> } }).parsed;
          if (!parsed || parsed.type !== "account" || !parsed.info) continue;
          const info = parsed.info as {
            mint?: string;
            owner?: string;
            tokenAmount?: { amount?: string; decimals?: number };
          };
          const mintStr = String(info.mint || "").trim();
          const ownerStr = String(info.owner || "").trim();
          if (!mintStr || !ownerStr) continue;
          try {
            const mPk = new PublicKey(mintStr);
            const oPk = new PublicKey(ownerStr);
            if (!oPk.equals(owner)) continue;
            void mPk;
          } catch {
            continue;
          }
          const raw = String(info.tokenAmount?.amount ?? "0").trim() || "0";
          const dec = Math.min(255, Math.max(0, Math.floor(Number(info.tokenAmount?.decimals) || 0)));
          inserts.push({
            mint: mintStr,
            program: programId.toBase58(),
            ata: pkStrAta,
            decimals: dec,
            raw,
          });
        }
      }

      await env.DB.prepare("DELETE FROM custodial_wallet_token_slots WHERE account_id = ?").bind(aid).run();

      const stmts = inserts.map((r) =>
        env.DB
          .prepare(
            `INSERT INTO custodial_wallet_token_slots (
               account_id, mint_base58, token_program_id, ata_pubkey, decimals, amount_raw, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(aid, r.mint, r.program, r.ata, r.decimals, r.raw, nowIso),
      );
      const BATCH = 90;
      for (let i = 0; i < stmts.length; i += BATCH) {
        await env.DB.batch(stmts.slice(i, i + BATCH));
      }

      return { ok: true, slots_written: inserts.length };
    } catch (e) {
      if (!isLikelyInfraRpcError(e)) {
        console.error("syncCustodialTokenSlotsFromRpc", aid, String(e instanceof Error ? e.message : e).slice(0, 200));
      }
    }
  }

  return { ok: false, slots_written: 0 };
}

export async function readCustodialTokenSlots(
  db: D1Database,
  accountId: string,
  limit = 200,
): Promise<CustodialTokenSlotRow[]> {
  const lim = Math.min(500, Math.max(1, Math.floor(limit || 200)));
  const aid = String(accountId || "").trim();
  if (!aid) return [];
  const r = await db
    .prepare(
      `SELECT mint_base58, token_program_id, ata_pubkey, decimals, amount_raw, updated_at
       FROM custodial_wallet_token_slots
       WHERE account_id = ?
       ORDER BY mint_base58 COLLATE NOCASE
       LIMIT ?`,
    )
    .bind(aid, lim)
    .all<CustodialTokenSlotRow>();
  return (r.results || []).map((x) => ({
    mint_base58: String(x.mint_base58 || ""),
    token_program_id: String(x.token_program_id || ""),
    ata_pubkey: String(x.ata_pubkey || ""),
    decimals: Math.floor(Number(x.decimals) || 0),
    amount_raw: String(x.amount_raw || "0"),
    updated_at: String(x.updated_at || ""),
  }));
}
