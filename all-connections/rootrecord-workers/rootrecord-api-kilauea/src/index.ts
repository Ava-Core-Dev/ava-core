import { json } from "./cors";
import { logHttpRequestJson, persistHttpErrorIfNeeded } from "./observability";
import type { Env } from "./router";
import { handleRequest } from "./router";
import { runNoaaAlertCron } from "./noaa-alert-cron";
import { runUsgsKilaueaDiscordCron } from "./usgs-discord-cron";
import { runKilaueaAiAnalysisCron } from "./kilauea-ai-analysis";
import { runKilaueaVolcanoNoticePushCron } from "./kilauea-volcano-notice-push-cron";
import { runD1RetentionCron } from "./d1-retention";

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
    // `*/5` (only registered on api-weather): NOAA push poller. No-op here unless this Worker is
    // deployed with WORKER_SHARD="weather", which it isn't.
    if (c === "*/5 * * * *" && shard === "weather") {
      await runNoaaAlertCron(env);
      return;
    }
    // `*/10` (only registered on api-kilauea): USGS Big Island quakes + AI analysis → Discord/app.
    if (c === "*/10 * * * *" && shard === "kilauea") {
      const results = await Promise.allSettled([
        runUsgsKilaueaDiscordCron(env),
        runKilaueaAiAnalysisCron(env),
        runKilaueaVolcanoNoticePushCron(env),
        // Shares the `root-record` D1 with the auth Workers, so a full database breaks sign-in too.
        runD1RetentionCron(env),
      ]);
      for (const r of results) {
        if (r.status === "rejected") console.warn("kilauea_cron_failed", String(r.reason));
      }
      return;
    }
  },
};
