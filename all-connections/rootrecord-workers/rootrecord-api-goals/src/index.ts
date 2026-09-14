import { json } from "./cors";
import { serveGoalsSitePage } from "./goal-site-pages";
import { isGoalsSiteHost, proxyGoalsSite } from "./goal-site-proxy";
import type { Env } from "./router";
import { handleRequest } from "./router";

function isApiPath(pathname: string): boolean {
  return (
    pathname === "/health" ||
    pathname.startsWith("/api/") ||
    pathname === "/api" ||
    pathname.startsWith("/v1/") ||
    pathname === "/v1" ||
    pathname.startsWith("/public/") ||
    pathname === "/public"
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (isGoalsSiteHost(url.hostname)) {
        if (request.method === "GET" || request.method === "HEAD") {
          const page = serveGoalsSitePage(url.pathname, url.searchParams);
          if (page) return page;
        }
        if (!isApiPath(url.pathname)) {
          return await proxyGoalsSite(request, env.GOALS_SITE_ORIGIN);
        }
      }
      return await handleRequest(request, env, ctx);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error("http_request_uncaught", detail.slice(0, 800));
      return json({ detail: "Internal Server Error" }, 500);
    }
  },
};
