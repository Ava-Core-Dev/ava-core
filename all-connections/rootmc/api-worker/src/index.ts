import type { ExecutionContext } from "@cloudflare/workers-types";

import realmWorker from "../../rootmc-realm-api/src/realm-index";
import { rewriteRequestForRealmHandlers } from "./gateway";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return realmWorker.fetch(rewriteRequestForRealmHandlers(request), env, ctx);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    return realmWorker.scheduled(event, env, ctx);
  },
};

// Re-export Env for wrangler typecheck (same shape as realm worker).
export type { Env } from "../../rootmc-realm-api/src/realm-router";
