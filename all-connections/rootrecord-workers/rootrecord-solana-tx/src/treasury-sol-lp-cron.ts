import { json } from "./cors";
import { notifySolanaToolsDiscord } from "./discord-solana-notify";
import { verifyWorkerOpsAdmin } from "./ops-auth";
import type { SolanaTxEnv } from "./env";
import { loadRootRecordGlobalUpdaterSigner } from "./root-record-global-updater";
import { pickWorkingConnection } from "./treasury-liquidity-cron";
import { raydiumClusterFromRpcUrl, withdrawTreasuryCpmmLpForWsolDeficit } from "./treasury-raydium-cpmm";

/** Minimum native SOL (human UI string, default `0.01`) → lamports. */
function minSolLamportsFromEnv(s: string | undefined): bigint {
  const t = String(s ?? "").trim() || "0.01";
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return 10_000_000n;
  return BigInt(Math.ceil(n * 1e9));
}

export type TreasurySolLpCheckResult = {
  ok: boolean;
  skipped: boolean;
  skip_reason?: string;
  treasury_b58?: string;
  rpc_url_used?: string;
  min_sol_lamports?: string;
  sol_balance_lamports_before?: string;
  sol_balance_lamports_after?: string;
  deficit_lamports?: string;
  lp_withdraw_signature?: string;
  lp_withdraw_errors?: string[];
  alerts: string[];
};

/**
 * Triggered on a schedule from rootrecord-primary (HTTP POST): ensure treasury native SOL ≥
 * `TREASURY_MIN_SOL_UI` (default 0.01) by burning LP from `TREASURY_SOL_CP_POOL_ID`
 * (RRESERVE / WSOL Raydium CPMM). Uses the Root Record Global Updater signer.
 * LP mint ref (docs): `3eEuJcKyUoLWUiY9WGjjpYBuVAqUaHsJL73aagonB7h4` for pool `HCzXKUajPqSjs4k3PhApZqmEwbSXj6gbp2s3o4Ve44Zk`.
 * Pools whose LP mint is listed in `treasury-raydium-cpmm` protection set are never withdrawn here.
 */
export async function runTreasurySolLpReserveCheck(env: SolanaTxEnv): Promise<TreasurySolLpCheckResult> {
  const alerts: string[] = [];
  const lpErrors: string[] = [];
  const poolId = String(env.TREASURY_SOL_CP_POOL_ID || "").trim();
  const rreserveMintStr = String(env.RRESERVE_MINT_BASE58 || "").trim();

  if (!poolId) {
    const r: TreasurySolLpCheckResult = { ok: true, skipped: true, skip_reason: "no TREASURY_SOL_CP_POOL_ID", alerts: [] };
    console.log("treasury_sol_lp_check", JSON.stringify(r));
    return r;
  }
  if (!rreserveMintStr) {
    const r: TreasurySolLpCheckResult = { ok: true, skipped: true, skip_reason: "no RRESERVE_MINT_BASE58", alerts: [] };
    console.log("treasury_sol_lp_check", JSON.stringify(r));
    return r;
  }

  const signer = loadRootRecordGlobalUpdaterSigner(env);
  if (!signer.ok) {
    const msg = `Treasury SOL check: ${signer.detail}`;
    const r: TreasurySolLpCheckResult = { ok: true, skipped: true, skip_reason: signer.detail, alerts: [] };
    console.error("treasury_sol_lp_check", JSON.stringify(r));
    await notifySolanaToolsDiscord(env.DISCORD_WEBHOOK_SOLANA_TOOLS, msg).catch(() => {});
    return r;
  }
  const treasury = signer.keypair;

  const picked = await pickWorkingConnection(String(env.SOLANA_RPC_URL || "").trim());
  if (!picked) {
    const msg =
      "Treasury SOL check: **no working Solana RPC**. Set `SOLANA_RPC_URL` to a provider that allows Cloudflare egress.";
    alerts.push(msg);
    const r: TreasurySolLpCheckResult = {
      ok: false,
      skipped: false,
      treasury_b58: treasury.publicKey.toBase58(),
      alerts,
    };
    console.error("treasury_sol_lp_check", JSON.stringify(r));
    await notifySolanaToolsDiscord(env.DISCORD_WEBHOOK_SOLANA_TOOLS, msg);
    return r;
  }

  const { connection, rpcUrl } = picked;
  const minLamports = minSolLamportsFromEnv(env.TREASURY_MIN_SOL_UI);
  let balanceBefore = 0n;
  try {
    balanceBefore = BigInt(await connection.getBalance(treasury.publicKey, "confirmed"));
  } catch (e) {
    const m = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    alerts.push(`Cannot read treasury SOL balance: ${m}`);
    const r: TreasurySolLpCheckResult = {
      ok: false,
      skipped: false,
      treasury_b58: treasury.publicKey.toBase58(),
      rpc_url_used: rpcUrl.slice(0, 96),
      alerts,
    };
    console.error("treasury_sol_lp_check", JSON.stringify(r));
    await notifySolanaToolsDiscord(env.DISCORD_WEBHOOK_SOLANA_TOOLS, alerts.join("\n"));
    return r;
  }

  const deficit = balanceBefore >= minLamports ? 0n : minLamports - balanceBefore;
  let lpSig: string | undefined;

  if (deficit > 0n) {
    const cluster = raydiumClusterFromRpcUrl(rpcUrl);
    const w = await withdrawTreasuryCpmmLpForWsolDeficit({
      connection,
      cluster,
      treasury,
      poolId,
      rreserveMintStr,
      deficitWsolRaw: deficit,
    });
    if (w.ok && "signature" in w) {
      lpSig = w.signature;
      console.log("treasury_sol_lp_withdraw", lpSig);
    } else if (w.ok && "skipped" in w) {
      // no-op
    } else {
      lpErrors.push(w.error);
    }
  }

  let balanceAfter = balanceBefore;
  try {
    balanceAfter = BigInt(await connection.getBalance(treasury.publicKey, "confirmed"));
  } catch {
    // keep balanceBefore for ok check
  }

  const ok = balanceAfter >= minLamports;
  if (!ok) {
    alerts.push(
      `Treasury **SOL** below minimum after run: **${balanceAfter}** lamports (need **${minLamports}**). ` +
        `Treasury \`${treasury.publicKey.toBase58()}\` · pool \`${poolId}\``,
    );
    if (lpErrors.length) alerts.push(`LP withdraw: ${lpErrors.join(" | ")}`);
    else if (deficit > 0n)
      alerts.push("LP withdraw did not run successfully or was insufficient — verify treasury holds LP for this pool.");
  }

  const result: TreasurySolLpCheckResult = {
    ok,
    skipped: false,
    treasury_b58: treasury.publicKey.toBase58(),
    rpc_url_used: rpcUrl.slice(0, 96),
    min_sol_lamports: minLamports.toString(),
    sol_balance_lamports_before: balanceBefore.toString(),
    sol_balance_lamports_after: balanceAfter.toString(),
    deficit_lamports: deficit > 0n ? deficit.toString() : undefined,
    lp_withdraw_signature: lpSig,
    lp_withdraw_errors: lpErrors.length ? lpErrors : undefined,
    alerts,
  };

  console.log("treasury_sol_lp_check", JSON.stringify(result));

  if (!ok && alerts.length) {
    await notifySolanaToolsDiscord(env.DISCORD_WEBHOOK_SOLANA_TOOLS, alerts.join("\n\n"));
  }

  return result;
}

/** POST `/api/internal/run-treasury-sol-lp-check` — on-demand (same logic as scheduled UTC :15); `X-RR-Push-Admin-Key` required. */
export async function handleRunTreasurySolLpCheckRoute(
  request: Request,
  env: SolanaTxEnv,
  sub: string,
  method: string,
): Promise<Response | null> {
  if (method !== "POST" || sub !== "/internal/run-treasury-sol-lp-check") return null;
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
    const result = await runTreasurySolLpReserveCheck(env);
    if (result.skipped) {
      return json({ ok: true, detail: "Skipped.", result }, 200);
    }
    return json(
      {
        ok: result.ok,
        detail: result.ok ? "SOL floor satisfied." : "Below minimum SOL — see `result`.",
        result,
      },
      200,
    );
  } catch (e) {
    const m = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error("run-treasury-sol-lp-check", m);
    return json({ ok: false, detail: m }, 500);
  }
}
