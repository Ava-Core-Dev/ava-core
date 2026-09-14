import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import bs58 from "bs58";

import { json } from "./cors";
import { notifySolanaToolsDiscord } from "./discord-solana-notify";
import { verifyWorkerOpsAdmin } from "./ops-auth";
import type { SolanaTxEnv } from "./env";
import { loadRootRecordGlobalUpdaterSigner } from "./root-record-global-updater";
import { confirmSignedTxWithPoll } from "./solana-confirm";
import { raydiumClusterFromRpcUrl, withdrawTreasuryCpmmLpForDeficits } from "./treasury-raydium-cpmm";

/** Same fallbacks as RRTT custodial cron (Cloudflare egress often blocked on public RPC). */
const SOLANA_RPC_FALLBACKS = [
  "https://solana-rpc.publicnode.com",
  "https://rpc.ankr.com/solana",
  "https://api.mainnet-beta.solana.com",
] as const;

export async function pickWorkingConnection(envUrl: string): Promise<{ connection: Connection; rpcUrl: string } | null> {
  const candidates: string[] = [];
  const u = String(envUrl || "").trim();
  if (u) candidates.push(u);
  for (const f of SOLANA_RPC_FALLBACKS) {
    if (!candidates.includes(f)) candidates.push(f);
  }
  for (const url of candidates) {
    try {
      const connection = new Connection(url, "confirmed");
      await connection.getLatestBlockhash("confirmed");
      return { connection, rpcUrl: url };
    } catch {
      // try next
    }
  }
  return null;
}

function parseUiWholeMin(s: string | undefined, fallback: string): bigint {
  const t = String(s ?? "").trim() || fallback;
  if (!/^\d+$/.test(t)) return BigInt(fallback);
  return BigInt(t);
}

function minRawFromUiWhole(ui: bigint, decimals: number): bigint {
  if (decimals < 0 || decimals > 18) return 0n;
  return ui * 10n ** BigInt(decimals);
}

async function readOwnerSplRaw(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
): Promise<{ raw: bigint; decimals: number; tokenProgram: PublicKey } | null> {
  const mintAcct = await connection.getAccountInfo(mint, "confirmed");
  if (!mintAcct) return null;
  const tokenProgram = mintAcct.owner;
  let decimals = 0;
  try {
    const m = await getMint(connection, mint, "confirmed", tokenProgram);
    decimals = m.decimals;
  } catch {
    return null;
  }
  let raw = 0n;
  try {
    const ata = getAssociatedTokenAddressSync(mint, owner, false, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
    const bal = await connection.getTokenAccountBalance(ata, "confirmed");
    raw = BigInt(bal.value.amount);
  } catch {
    // no ATA or empty — treat as zero balance
  }
  return { raw, decimals, tokenProgram };
}

/**
 * Sends SPL from maintenance source → treasury (creates treasury ATA if missing). Source pays tx fee + rent.
 */
async function topUpTreasuryFromSource(
  connection: Connection,
  source: Keypair,
  treasury: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey,
  decimals: number,
  amountRaw: bigint,
): Promise<string> {
  if (amountRaw <= 0n) throw new Error("topUp: amount must be positive");
  const sourceAta = getAssociatedTokenAddressSync(
    mint,
    source.publicKey,
    false,
    tokenProgram,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  const treasuryAta = getAssociatedTokenAddressSync(mint, treasury, false, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID);
  const srcBal = await connection.getTokenAccountBalance(sourceAta, "confirmed").catch(() => null);
  const srcRaw = srcBal?.value?.amount != null ? BigInt(String(srcBal.value.amount)) : 0n;
  if (srcRaw < amountRaw) {
    throw new Error(`source ATA short: have_raw=${srcRaw} need_raw=${amountRaw}`);
  }
  const latest = await connection.getLatestBlockhash("confirmed");
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 500_000 }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 0 }),
    createAssociatedTokenAccountIdempotentInstruction(
      source.publicKey,
      treasuryAta,
      treasury,
      mint,
      tokenProgram,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ),
    createTransferCheckedInstruction(
      sourceAta,
      mint,
      treasuryAta,
      source.publicKey,
      amountRaw,
      decimals,
      [],
      tokenProgram,
    ),
  ];
  const msg = new TransactionMessage({
    payerKey: source.publicKey,
    recentBlockhash: latest.blockhash,
    instructions: ixs,
  }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign([source]);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
  await confirmSignedTxWithPoll(connection, sig, latest);
  return sig;
}

export type TreasuryLiquidityCheckResult = {
  ok: boolean;
  skipped: boolean;
  skip_reason?: string;
  treasury_b58?: string;
  maintenance_source_b58?: string | null;
  topup_signatures?: string[];
  topup_errors?: string[];
  lp_withdraw_signatures?: string[];
  lp_withdraw_errors?: string[];
  rpc_url_used?: string;
  rrtt_mint?: string;
  rrtt_raw?: string;
  rrtt_min_raw?: string;
  rrtt_ok?: boolean;
  rreserve_mint?: string | null;
  rreserve_raw?: string | null;
  rreserve_min_raw?: string | null;
  rreserve_ok?: boolean | null;
  alerts: string[];
};

/**
 * Every hour at :30 UTC: ensure treasury holds at least the configured RRTT / RRESERVE minimums.
 * 1) If `TREASURY_CP_MM_POOL_ID` is set, treasury **burns LP** from that Raydium CPMM pool (must hold LP) to receive both legs.
 * 2) If still short and `TREASURY_MAINTENANCE_SOURCE_SECRET_KEY_B58` is set (pubkey ≠ treasury), SPL top-up from that wallet.
 * 3) Discord on remaining shortfall / errors. Uses the Root Record Global Updater as the treasury signer.
 */
export async function runTreasuryLiquidityReserveCheck(env: SolanaTxEnv): Promise<TreasuryLiquidityCheckResult> {
  const alerts: string[] = [];
  const rrttMintStr = String(env.RRTT_MINT_BASE58 || "").trim();
  const rreserveMintStr = String(env.RRESERVE_MINT_BASE58 || "").trim();

  if (!rrttMintStr) {
    const r: TreasuryLiquidityCheckResult = {
      ok: true,
      skipped: true,
      skip_reason: "no RRTT_MINT_BASE58",
      alerts: [],
    };
    console.log("treasury_liquidity_check", JSON.stringify(r));
    return r;
  }

  const signer = loadRootRecordGlobalUpdaterSigner(env);
  if (!signer.ok) {
    const msg = `Treasury liquidity check: ${signer.detail}`;
    const r: TreasuryLiquidityCheckResult = {
      ok: true,
      skipped: true,
      skip_reason: signer.detail,
      alerts: [],
    };
    console.error("treasury_liquidity_check", JSON.stringify(r));
    await notifySolanaToolsDiscord(env.DISCORD_WEBHOOK_SOLANA_TOOLS, msg).catch(() => {});
    return r;
  }
  const treasury = signer.keypair;

  const picked = await pickWorkingConnection(String(env.SOLANA_RPC_URL || "").trim());
  if (!picked) {
    const msg =
      "Treasury liquidity check: **no working Solana RPC** from this Worker. Set `SOLANA_RPC_URL` to Helius/QuickNode/etc.";
    alerts.push(msg);
    const r: TreasuryLiquidityCheckResult = {
      ok: false,
      skipped: false,
      treasury_b58: treasury.publicKey.toBase58(),
      alerts,
    };
    console.error("treasury_liquidity_check", JSON.stringify(r));
    await notifySolanaToolsDiscord(env.DISCORD_WEBHOOK_SOLANA_TOOLS, msg);
    return r;
  }

  const { connection, rpcUrl } = picked;
  const rrttMint = new PublicKey(rrttMintStr);
  const minRrttUi = parseUiWholeMin(env.TREASURY_LIQ_MIN_RRTT_UI, "5000000");
  const minReserveUi = parseUiWholeMin(env.TREASURY_LIQ_MIN_RRESERVE_UI, "5");

  const topupSignatures: string[] = [];
  const topupErrors: string[] = [];

  let maintenanceSource: Keypair | null = null;
  const maintSk = String(env.TREASURY_MAINTENANCE_SOURCE_SECRET_KEY_B58 || "").trim();
  if (maintSk) {
    try {
      maintenanceSource = Keypair.fromSecretKey(bs58.decode(maintSk));
    } catch {
      topupErrors.push("invalid TREASURY_MAINTENANCE_SOURCE_SECRET_KEY_B58 (cannot decode)");
    }
  }

  const rrttInfo = await readOwnerSplRaw(connection, treasury.publicKey, rrttMint);
  if (!rrttInfo) {
    const msg = `Treasury liquidity check: **cannot read RRTT mint** \`${rrttMintStr}\` on-chain.`;
    alerts.push(msg);
    const r: TreasuryLiquidityCheckResult = {
      ok: false,
      skipped: false,
      treasury_b58: treasury.publicKey.toBase58(),
      rpc_url_used: rpcUrl.slice(0, 96),
      rrtt_mint: rrttMintStr,
      alerts,
    };
    console.error("treasury_liquidity_check", JSON.stringify(r));
    await notifySolanaToolsDiscord(env.DISCORD_WEBHOOK_SOLANA_TOOLS, msg);
    return r;
  }

  const rrttMinRaw = minRawFromUiWhole(minRrttUi, rrttInfo.decimals);
  const shortRrtt = rrttInfo.raw >= rrttMinRaw ? 0n : rrttMinRaw - rrttInfo.raw;

  let resMintPk: PublicKey | null = null;
  let resMinRaw = 0n;
  let resInfoInitial: Awaited<ReturnType<typeof readOwnerSplRaw>> | null = null;
  let rreserveMint: string | null = null;
  if (rreserveMintStr) {
    rreserveMint = rreserveMintStr;
    resMintPk = new PublicKey(rreserveMintStr);
    resInfoInitial = await readOwnerSplRaw(connection, treasury.publicKey, resMintPk);
    if (!resInfoInitial) {
      topupErrors.push(`cannot read RRESERVE mint ${rreserveMintStr}`);
    } else {
      resMinRaw = minRawFromUiWhole(minReserveUi, resInfoInitial.decimals);
    }
  }
  const shortReserve =
    resInfoInitial && resMintPk ? (resInfoInitial.raw >= resMinRaw ? 0n : resMinRaw - resInfoInitial.raw) : 0n;

  const needsTopUp = shortRrtt > 0n || shortReserve > 0n;
  const lpPoolId = String(env.TREASURY_CP_MM_POOL_ID || "").trim();
  const lpWithdrawSigs: string[] = [];
  const lpWithdrawErrors: string[] = [];

  if (needsTopUp && lpPoolId && rreserveMintStr) {
    const cluster = raydiumClusterFromRpcUrl(rpcUrl);
    const w = await withdrawTreasuryCpmmLpForDeficits({
      connection,
      cluster,
      treasury,
      poolId: lpPoolId,
      rrttMintStr,
      rreserveMintStr,
      deficitRrttRaw: shortRrtt,
      deficitReserveRaw: shortReserve,
    });
    if (w.ok && "signature" in w) {
      lpWithdrawSigs.push(w.signature);
      console.log("treasury_liquidity_lp_withdraw", w.signature);
    } else if (w.ok && "skipped" in w) {
      // no-op
    } else {
      lpWithdrawErrors.push(w.error);
    }
  } else if (needsTopUp && !lpPoolId && rreserveMintStr) {
    lpWithdrawErrors.push(
      "TREASURY_CP_MM_POOL_ID unset — cannot Raydium LP-withdraw to refill treasury (set pool state address base58)",
    );
  }

  const rrttAfterLp = await readOwnerSplRaw(connection, treasury.publicKey, rrttMint);
  const resAfterLp = resMintPk ? await readOwnerSplRaw(connection, treasury.publicKey, resMintPk) : null;

  const rrttForMaint = rrttAfterLp ?? rrttInfo;
  const resForMaint = resAfterLp ?? resInfoInitial;
  const shortRrtt2 = rrttForMaint.raw >= rrttMinRaw ? 0n : rrttMinRaw - rrttForMaint.raw;
  const shortReserve2 =
    resForMaint && resMintPk ? (resForMaint.raw >= resMinRaw ? 0n : resMinRaw - resForMaint.raw) : 0n;

  const needsTopUp2 = shortRrtt2 > 0n || shortReserve2 > 0n;
  if (needsTopUp2 && maintenanceSource) {
    if (maintenanceSource.publicKey.equals(treasury.publicKey)) {
      topupErrors.push("maintenance source pubkey equals treasury — use a separate inventory wallet");
    } else {
      const tryLeg = async (
        label: string,
        mint: PublicKey,
        deficit: bigint,
        treasuryMeta: { decimals: number; tokenProgram: PublicKey },
      ) => {
        if (deficit <= 0n) return;
        const srcMeta = await readOwnerSplRaw(connection, maintenanceSource!.publicKey, mint);
        if (!srcMeta) {
          topupErrors.push(`${label}: cannot read source side for mint ${mint.toBase58()}`);
          return;
        }
        const sendAmt = deficit <= srcMeta.raw ? deficit : srcMeta.raw;
        if (sendAmt <= 0n) {
          topupErrors.push(`${label}: source ATA has 0 balance (need_raw=${deficit})`);
          return;
        }
        try {
          const sig = await topUpTreasuryFromSource(
            connection,
            maintenanceSource!,
            treasury.publicKey,
            mint,
            treasuryMeta.tokenProgram,
            treasuryMeta.decimals,
            sendAmt,
          );
          topupSignatures.push(sig);
          console.log("treasury_liquidity_topup", label, sig);
        } catch (e) {
          const m = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
          topupErrors.push(`${label}: ${m}`);
        }
      };

      await tryLeg("RRTT", rrttMint, shortRrtt2, rrttForMaint);
      if (resMintPk && resForMaint) {
        await tryLeg("RRESERVE", resMintPk, shortReserve2, resForMaint);
      }
    }
  }

  const rrttFinal = await readOwnerSplRaw(connection, treasury.publicKey, rrttMint);
  const resFinal = resMintPk ? await readOwnerSplRaw(connection, treasury.publicKey, resMintPk) : null;

  const rrttOkFinal = rrttFinal != null && rrttFinal.raw >= rrttMinRaw;
  const rreserveOkFinal: boolean | null = !rreserveMintStr
    ? null
    : Boolean(resFinal && resFinal.raw >= resMinRaw);

  const ok =
    rrttFinal != null &&
    rrttOkFinal &&
    (!rreserveMintStr || Boolean(resFinal && resFinal.raw >= resMinRaw));

  const discordAlerts: string[] = [];
  if (!rrttFinal) {
    discordAlerts.push(`Treasury liquidity check: cannot read RRTT mint ${rrttMintStr} after run.`);
  } else if (!rrttOkFinal) {
    discordAlerts.push(
      `Treasury **RRTT** below minimum: raw **${rrttFinal.raw}** (need **${rrttMinRaw}**). Treasury \`${treasury.publicKey.toBase58()}\``,
    );
    if (needsTopUp2 && !maintenanceSource) {
      discordAlerts.push(
        "Set `TREASURY_CP_MM_POOL_ID` (Raydium CPMM pool) so the treasury can burn LP, and/or wrangler secret `TREASURY_MAINTENANCE_SOURCE_SECRET_KEY_B58` for SPL top-up.",
      );
    }
  }
  if (rreserveMintStr) {
    if (!resInfoInitial) {
      discordAlerts.push(`Cannot read RRESERVE mint \`${rreserveMintStr}\`.`);
    } else if (!resFinal) {
      discordAlerts.push("Cannot read treasury RRESERVE ATA after run.");
    } else if (resFinal.raw < resMinRaw) {
      discordAlerts.push(
        `Treasury **RRESERVE** below minimum: raw **${resFinal.raw}** (need **${resMinRaw}**). Mint \`${rreserveMintStr}\``,
      );
      if (needsTopUp2 && !maintenanceSource) {
        discordAlerts.push(
          "Set `TREASURY_CP_MM_POOL_ID` and/or `TREASURY_MAINTENANCE_SOURCE_SECRET_KEY_B58` to refill RRESERVE.",
        );
      }
    }
  }
  if (topupErrors.length) {
    discordAlerts.push(`SPL top-up errors: ${topupErrors.join(" | ")}`);
  }
  if (lpWithdrawErrors.length) {
    discordAlerts.push(`LP withdraw errors: ${lpWithdrawErrors.join(" | ")}`);
  }

  const result: TreasuryLiquidityCheckResult = {
    ok,
    skipped: false,
    treasury_b58: treasury.publicKey.toBase58(),
    maintenance_source_b58: maintenanceSource ? maintenanceSource.publicKey.toBase58() : null,
    topup_signatures: topupSignatures.length ? topupSignatures : undefined,
    topup_errors: topupErrors.length ? topupErrors : undefined,
    lp_withdraw_signatures: lpWithdrawSigs.length ? lpWithdrawSigs : undefined,
    lp_withdraw_errors: lpWithdrawErrors.length ? lpWithdrawErrors : undefined,
    rpc_url_used: rpcUrl.slice(0, 96),
    rrtt_mint: rrttMintStr,
    rrtt_raw: rrttFinal ? rrttFinal.raw.toString() : undefined,
    rrtt_min_raw: rrttMinRaw.toString(),
    rrtt_ok: rrttOkFinal,
    rreserve_mint: rreserveMint,
    rreserve_raw: resFinal ? resFinal.raw.toString() : rreserveMintStr ? null : null,
    rreserve_min_raw: rreserveMintStr ? resMinRaw.toString() : null,
    rreserve_ok: rreserveOkFinal,
    alerts: discordAlerts,
  };

  console.log("treasury_liquidity_check", JSON.stringify(result));

  if (!ok || topupErrors.length || lpWithdrawErrors.length) {
    const body = discordAlerts.join("\n\n").trim();
    if (body) await notifySolanaToolsDiscord(env.DISCORD_WEBHOOK_SOLANA_TOOLS, body);
  }

  return result;
}

/** POST `/api/internal/run-treasury-liquidity-check` — same as primary cron `40 * * * *` (UTC :40); `X-RR-Push-Admin-Key` required. */
export async function handleRunTreasuryLiquidityCheckRoute(
  request: Request,
  env: SolanaTxEnv,
  sub: string,
  method: string,
): Promise<Response | null> {
  if (method !== "POST" || sub !== "/internal/run-treasury-liquidity-check") return null;
  const secret = (env.RR_PUSH_ADMIN_SECRET || "").trim();
  if (!secret) {
    return json({ ok: false, detail: "RR_PUSH_ADMIN_SECRET is not set on this Worker." }, 503);
  }
  const adminOk = await verifyWorkerOpsAdmin(request, env);
  if (!adminOk) {
    const has = Boolean(request.headers.get("X-RR-Push-Admin-Key"));
    return json({ ok: false, detail: has ? "Invalid admin key." : "Missing X-RR-Push-Admin-Key header." }, 401);
  }
  try {
    const result = await runTreasuryLiquidityReserveCheck(env);
    if (result.skipped) {
      return json({ ok: true, detail: "Skipped.", result }, 200);
    }
    return json(
      {
        ok: result.ok,
        detail: result.ok ? "Thresholds satisfied." : "Below minimum, mint read failed, or no working RPC — see `result`.",
        result,
      },
      200,
    );
  } catch (e) {
    const m = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error("run-treasury-liquidity-check", m);
    return json({ ok: false, detail: m }, 500);
  }
}
