import {
  accountApiBaseFromEnv,
  rootmcApiBaseFromEnv,
  rootmcApiG2BaseFromEnv,
  isAccountShardApiTail,
  isRootMcG2ApiTail,
  isRootMcShardApiTail,
  rewriteLegacyBlocknotesApiTail,
} from "../_lib/accountApiBase";

type Env = {
  ROOTMC_API_BASE?: string;
  ROOTMC_API_G2_BASE?: string;
  ROOTRECORD_API_ACCOUNT_BASE?: string;
  ROOTRECORD_API_BLOCKNOTES_BASE?: string;
};

function tailFromParams(path: string | string[] | undefined): string {
  if (path === undefined) return "";
  return Array.isArray(path) ? path.join("/") : String(path);
}

/** rootmc.net/api/* → api.rootmc.net, api2.rootmc.net (Gen 2), or account worker. */
export const onRequest = async (context: {
  request: Request;
  env: Env;
  params: Record<string, string | string[] | undefined>;
}): Promise<Response> => {
  const tail = rewriteLegacyBlocknotesApiTail(tailFromParams(context.params.path));
  const useG2 = isRootMcG2ApiTail(tail);
  const useRootMc = !useG2 && isRootMcShardApiTail(tail);
  const useAccount = !useG2 && !useRootMc && isAccountShardApiTail(tail);
  const base = useG2
    ? rootmcApiG2BaseFromEnv(context.env)
    : useRootMc
      ? rootmcApiBaseFromEnv(context.env)
      : useAccount
        ? accountApiBaseFromEnv(context.env)
        : rootmcApiBaseFromEnv(context.env);
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

  try {
    return await fetch(target, {
      method,
      headers,
      body: hasBody ? bodyBuf : undefined,
      redirect: "manual",
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ detail: `Upstream fetch failed: ${msg}` }), {
      status: 502,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
};
