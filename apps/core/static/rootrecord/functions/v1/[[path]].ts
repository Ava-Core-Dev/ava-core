import { accountApiBaseFromEnv, isAccountShardV1Tail } from "../_lib/accountApiBase";

type Env = {
  ROOTRECORD_API_BASE?: string;
  ROOTRECORD_API_ACCOUNT_BASE?: string;
};

/** Used when Preview deployments have no `ROOTRECORD_API_BASE` in the dashboard (Production usually does). */
const DEFAULT_PRIMARY_API = "https://rootrecord-primary.rootrecord.workers.dev";

/** Join multipath `[[path]]` param from Pages routing (string or string[]). */
function tailFromParams(path: string | string[] | undefined): string {
  if (path === undefined) return "";
  return Array.isArray(path) ? path.join("/") : String(path);
}

/**
 * Same-origin proxy: browser calls https://&lt;pages&gt;/v1/... → Worker upstream.
 * Account portal routes (`/v1/auth/*`, `/v1/discord/*`, `/v1/me/*`, …) always use **rootrecord-api-account**
 * so Discord OAuth and `discord_linked` on `/v1/me` work even when `ROOTRECORD_API_BASE` still points at primary.
 */
export const onRequest = async (context: {
  request: Request;
  env: Env;
  params: Record<string, string | string[] | undefined>;
}): Promise<Response> => {
  const tail = tailFromParams(context.params.path);
  const useAccount = isAccountShardV1Tail(tail);
  const base = useAccount
    ? accountApiBaseFromEnv(context.env)
    : (context.env.ROOTRECORD_API_BASE ?? "").trim().replace(/\/+$/, "") || DEFAULT_PRIMARY_API;

  const url = new URL(context.request.url);
  const upstreamPath = tail ? `/v1/${tail}` : "/v1";
  const target = `${base}${upstreamPath}${url.search}`;

  const incoming = context.request;
  const headers = new Headers(incoming.headers);
  headers.delete("Host");
  headers.delete("CF-Connecting-IP");

  const method = incoming.method;
  // ReadableStream bodies are not reliably forwarded to another origin in this fetch() pattern;
  // buffering fixes empty POST bodies (login/signup silently failing verification).
  const hasBody = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  const bodyBuf = hasBody ? await incoming.arrayBuffer() : null;

  return fetch(target, {
    method,
    headers,
    body: hasBody ? bodyBuf : undefined,
    redirect: "manual",
  });
};
