import {
  accountApiBaseFromEnv,
  isAccountShardApiTail,
  isRootMcShardApiTail,
} from "../_lib/accountApiBase";

type Env = {
  ROOTRECORD_API_BASE?: string;
  ROOTRECORD_API_ACCOUNT_BASE?: string;
};

const DEFAULT_PRIMARY_API = "https://rootrecord-primary.rootrecord.workers.dev";

function tailFromParams(path: string | string[] | undefined): string {
  if (path === undefined) return "";
  return Array.isArray(path) ? path.join("/") : String(path);
}

/**
 * Same-origin proxy: /api/* on Pages → Worker upstream.
 * RootMC/Minecraft APIs moved to api.rootmc.net — return 410 here.
 */
export const onRequest = async (context: {
  request: Request;
  env: Env;
  params: Record<string, string | string[] | undefined>;
}): Promise<Response> => {
  const tail = tailFromParams(context.params.path);

  if (isRootMcShardApiTail(tail)) {
    return new Response(
      JSON.stringify({
        detail: "RootMC API moved to https://api.rootmc.net — update your client base URL.",
        migration: `https://api.rootmc.net/api/${tail.replace(/^\/+/, "")}`,
      }),
      {
        status: 410,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const useAccount = isAccountShardApiTail(tail);
  const base = useAccount
    ? accountApiBaseFromEnv(context.env)
    : (context.env.ROOTRECORD_API_BASE ?? "").trim().replace(/\/+$/, "") || DEFAULT_PRIMARY_API;
  const url = new URL(context.request.url);
  const upstreamPath = tail ? `/api/${tail}` : "/api";
  const target = `${base}${upstreamPath}${url.search}`;

  const incoming = context.request;
  const headers = new Headers(incoming.headers);
  headers.delete("Host");
  headers.delete("CF-Connecting-IP");

  const method = incoming.method;
  const hasBody = method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
  const bodyBuf = hasBody ? await incoming.arrayBuffer() : null;

  return fetch(target, {
    method,
    headers,
    body: hasBody ? bodyBuf : undefined,
    redirect: "manual",
  });
};
