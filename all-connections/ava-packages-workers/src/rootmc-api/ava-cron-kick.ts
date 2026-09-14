import { runInactiveAccountCleanupCron } from "./inactive-account-cron";
import { pruneWorkerHttpErrorEvents } from "./observability";
import { runFarmsVarmintCron } from "./farms-varmint";
import { runDiscordDeveloperMessageSync } from "./discord-developer-sync";
import { runRootsCustodialDepositProcessor } from "./roots-custodial-deposits";
import { runRootsSolSwapPendingCreditProcessor } from "./roots-sol-swap";
import { runRootsOnchainBuyMonitor } from "./roots-onchain-buy-monitor";
import { reconcileStaleStripeSubscriptions } from "../../shared/stripe-reconcile";
import { runRrttCustodialPayoutCron } from "./solana-internal-wallet";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function adminOk(request: Request, env: { RR_PUSH_ADMIN_SECRET?: string }): boolean {
  const expected = String(env.RR_PUSH_ADMIN_SECRET || "").trim();
  if (!expected) return false;
  return request.headers.get("X-RR-Push-Admin-Key") === expected;
}

/** POST /api/internal/ava-cron/:job */
export async function handleAvaCronKick(
  request: Request,
  env: any,
  sub: string,
  method: string,
): Promise<Response | null> {
  if (method !== "POST") return null;
  if (!sub.startsWith("/internal/ava-cron/")) return null;
  if (!adminOk(request, env)) return json({ ok: false, detail: "forbidden" }, 403);
  const job = sub.slice("/internal/ava-cron/".length).replace(/\/$/, "");
  const when = new Date();
  try {
    if (job === "minute-suite" || job === "rr-minute-suite") {
      await runDiscordDeveloperMessageSync(env).catch(() => null);
      const vr = await runFarmsVarmintCron(env.DB).catch(() => ({ sampled: 0, processed: 0 }));
      const dr = await runRootsCustodialDepositProcessor(env, { limit: 6 }).catch((e) => ({ ok: false, error: String(e) }));
      const sr = await runRootsSolSwapPendingCreditProcessor(env, { limit: 8 }).catch((e) => ({ ok: false, error: String(e) }));
      const br = await runRootsOnchainBuyMonitor(env, { limit: 80 }).catch((e) => ({ ok: false, error: String(e) }));
      return json({ ok: true, job, vr, dr, sr, br });
    }
    if (job === "stripe-reconcile" || job === "rr-stripe-reconcile") {
      const sk = String(env.STRIPE_SECRET_KEY || "").trim();
      if (!sk.startsWith("sk_")) return json({ ok: false, detail: "no_stripe_key" }, 503);
      const r = await reconcileStaleStripeSubscriptions({ db: env.DB, stripeSecretKey: sk, staleAfterDays: 32, limit: 50 });
      return json({ ok: true, job, r });
    }
    if (job === "inactive-cleanup" || job === "rr-inactive-cleanup") {
      await runInactiveAccountCleanupCron(env);
      await pruneWorkerHttpErrorEvents(env.DB).catch(() => null);
      return json({ ok: true, job });
    }
    if (job === "rrtt" || job === "rrtt-custodial-payout") {
      const stats = await runRrttCustodialPayoutCron(env);
      return json({ ok: true, job, stats });
    }
    return json({ ok: false, detail: "unknown_job", job }, 404);
  } catch (e) {
    return json({ ok: false, job, error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
