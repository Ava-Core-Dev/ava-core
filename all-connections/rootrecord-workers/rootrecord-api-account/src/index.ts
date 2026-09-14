import { json } from "./cors";
import { logHttpRequestJson, persistHttpErrorIfNeeded, pruneWorkerHttpErrorEvents } from "./observability";
import type { Env } from "./router";
import { handleRequest } from "./router";
import { runInactiveAccountCleanupCron } from "./inactive-account-cron";
import { runDiscordDeveloperMessageSync } from "./discord-developer-sync";
import { reconcileStaleStripeSubscriptions } from "../../shared/stripe-reconcile";
import { runFarmsVarmintCron } from "./farms-varmint";
import { runRootEconomyDiscordCron } from "./discord-root-economy-cron";
import { runRootsCustodialDepositProcessor } from "./roots-custodial-deposits";
import { runRootsSolSwapPendingCreditProcessor } from "./roots-sol-swap";
import { runRootsOnchainBuyMonitor } from "./roots-onchain-buy-monitor";
// NOAA alert cron lives only on rootrecord-api-weather (and api-kilauea if it ever needs alerts).
// This Worker: `* * * * *` Discord dev sync + farms/deposit crons; Root Economy Discord ping disabled (manual only).
// `45 8` inactive-account cleanup.

type WorkerShard = "primary" | "weather" | "business" | "account" | "token" | "kilauea";

function workerShard(env: Env): WorkerShard {
  const s = String(env.WORKER_SHARD || "").trim().toLowerCase();
  if (s === "weather" || s === "business" || s === "account" || s === "token" || s === "kilauea") return s;
  return "primary";
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const t0 = Date.now();
    try {
      const res = await handleRequest(request, env, ctx);
      const ms = Date.now() - t0;
      logHttpRequestJson(request, res, ms);
      ctx.waitUntil(
        persistHttpErrorIfNeeded(env.DB, request, res, ms, null).catch((e) =>
          console.error("observability persist", String(e)),
        ),
      );
      return res;
    } catch (e) {
      const ms = Date.now() - t0;
      const detail = e instanceof Error ? e.message : String(e);
      console.error(
        JSON.stringify({
          msg: "http_request_uncaught",
          v: 1,
          method: request.method,
          path: new URL(request.url).pathname,
          ms,
          err: detail.slice(0, 800),
        }),
      );
      const res = json({ detail: "Internal Server Error" }, 500);
      ctx.waitUntil(
        persistHttpErrorIfNeeded(env.DB, request, res, ms, detail).catch(() => {}),
      );
      return res;
    }
  },
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    const c = event.cron || "";
    const shard = workerShard(env);

    if (c === "45 8 * * *") {
      if (shard === "primary" || shard === "account") {
        await runInactiveAccountCleanupCron(env);
        await pruneWorkerHttpErrorEvents(env.DB).catch((e) => console.error("observability prune", String(e)));
      }
      return;
    }
    if (c === "* * * * *" && shard === "account") {
      const when = new Date(event.scheduledTime || Date.now());
      if (when.getUTCHours() === 9 && when.getUTCMinutes() === 17) {
        const sk = String(env.STRIPE_SECRET_KEY || "").trim();
        if (sk.startsWith("sk_")) {
          const r = await reconcileStaleStripeSubscriptions({
            db: env.DB,
            stripeSecretKey: sk,
            staleAfterDays: 32,
            limit: 50,
          });
          console.log("stripe reconcile", JSON.stringify(r));
        }
      }
      // Root Economy "Internal circulation" Discord webhook disabled (was every :00/:45 UTC).
      // Re-enable: call runRootEconomyDiscordCron when utcMin is 0 or 45, or set ROOT_ECONOMY_DISCORD_CRON_ENABLED=1.
      const economyCronEnabled =
        String((env as { ROOT_ECONOMY_DISCORD_CRON_ENABLED?: string }).ROOT_ECONOMY_DISCORD_CRON_ENABLED || "")
          .trim() === "1";
      if (economyCronEnabled) {
        const utcMin = new Date(event.scheduledTime || Date.now()).getUTCMinutes();
        if (utcMin === 0 || utcMin === 45) {
          const er = await runRootEconomyDiscordCron(env).catch((e) => ({
            ok: false,
            skipped: e instanceof Error ? e.message : String(e),
          }));
          console.log("root_economy_discord_cron", JSON.stringify(er));
        }
      }
      await runDiscordDeveloperMessageSync(env).catch((e) =>
        console.error("discord_developer_sync_err", e instanceof Error ? e.message : String(e)),
      );
      const vr = await runFarmsVarmintCron(env.DB).catch((e) => {
        console.error("farms_varmint_cron_err", e instanceof Error ? e.message : String(e));
        return { sampled: 0, processed: 0 };
      });
      if (vr.sampled > 0) {
        console.log("farms_varmint_cron", JSON.stringify(vr));
      }
      const dr = await runRootsCustodialDepositProcessor(env, { limit: 6 }).catch((e) => ({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      }));
      if ("deposits_found" in dr && dr.deposits_found > 0) {
        console.log("roots_custodial_deposit_processor", JSON.stringify(dr));
      } else if (!dr.ok) {
        console.error("roots_custodial_deposit_processor_err", JSON.stringify(dr));
      }
      const sr = await runRootsSolSwapPendingCreditProcessor(env, { limit: 8 }).catch((e) => ({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      }));
      if ("credited" in sr && (sr.credited > 0 || sr.pending > 0 || sr.errors.length > 0)) {
        console.log("roots_sol_swap_pending_processor", JSON.stringify(sr));
      } else if (!sr.ok) {
        console.error("roots_sol_swap_pending_processor_err", JSON.stringify(sr));
      }
      const br = await runRootsOnchainBuyMonitor(env, { limit: 80 }).catch((e) => ({
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      }));
      if ("notified" in br && (br.notified > 0 || br.errors.length > 0 || br.bootstrapped)) {
        console.log("roots_onchain_buy_monitor", JSON.stringify(br));
      } else if (!br.ok) {
        console.error("roots_onchain_buy_monitor_err", JSON.stringify(br));
      }
    }
  },
};
