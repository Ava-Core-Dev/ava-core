import { json } from "./cors";
import { logHttpRequestJson, persistHttpErrorIfNeeded, pruneWorkerHttpErrorEvents } from "./observability";
import type { Env } from "./router";
import { handleRequest } from "./router";
import { runInactiveAccountCleanupCron } from "./inactive-account-cron";
// NOAA alert cron lives only on rootrecord-api-weather (and api-kilauea if it ever needs alerts).
// This shard is wrangler `crons = []`, so even the shard gate below is belt-and-suspenders.

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
    // No `*/5` cron handler on this shard. NOAA alert cron is owned by rootrecord-api-weather.
  },
};
