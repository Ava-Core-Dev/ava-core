import type { ExecutionContext } from "@cloudflare/workers-types";

import { json } from "./cors";
import type { Env } from "./router";
import { handleRequest } from "./router";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handleRequest(request, env, ctx);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error("http_request_uncaught", detail.slice(0, 800));
      return json({ detail: "Internal Server Error" }, 500);
    }
  },

  async scheduled(_event: ScheduledEvent, _env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log("rootmc-realm-api cron retired  -  use rootmc-api on api.rootmc.net");
  },
};
