import type { ExecutionContext } from "@cloudflare/workers-types";
import { json } from "./cors";
import type { Env } from "./realm-router";
import { validateDevWorkstationAuth } from "./rootmc-dev-workstation";
import { runRootMcCronBundle, type CronBundleJob } from "./rootmc-cron-bundle";

export async function handleAvaCronKickRoutes(
  request: Request,
  env: Env,
  sub: string,
  method: string,
  ctx?: ExecutionContext,
): Promise<Response | null> {
  if (method !== "POST") return null;
  const jobs: Record<string, CronBundleJob> = {
    "/rootmc/cron/ops-10m": "ops-10m",
    "/cron/ops-10m": "ops-10m",
    "/rootmc/cron/hourly": "hourly",
    "/cron/hourly": "hourly",
    "/rootmc/cron/weekly": "weekly",
    "/cron/weekly": "weekly",
    "/rootmc/cron/all-tick": "all-tick",
  };
  const job = jobs[sub];
  if (!job) return null;
  if (!validateDevWorkstationAuth(request, env)) {
    return json({ ok: false, detail: "forbidden" }, 403);
  }
  let body: { force?: boolean; reason?: string } = {};
  try { body = (await request.json()) as typeof body; } catch { /* empty */ }
  const result = await runRootMcCronBundle(env, ctx, {
    job,
    when: new Date(),
    force: Boolean(body.force),
    reason: String(body.reason || "ava-cron-kick"),
  });
  return json({ ok: true, job, ...result }, 200);
}
