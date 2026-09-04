import { accountApiBaseFromEnv } from "../../_lib/accountApiBase";

type Env = {
  ROOTRECORD_API_ACCOUNT_BASE?: string;
};

function tailFromParams(path: string | string[] | undefined): string {
  if (path === undefined) return "";
  return Array.isArray(path) ? path.join("/") : String(path);
}

/** Always proxy `/api/earn/*` to rootrecord-api-account (Discord `/bal` DB). */
export const onRequest = async (context: {
  request: Request;
  env: Env;
  params: Record<string, string | string[] | undefined>;
}): Promise<Response> => {
  const tail = tailFromParams(context.params.path);
  const base = accountApiBaseFromEnv(context.env);
  const url = new URL(context.request.url);
  const upstreamPath = tail ? `/api/earn/${tail.replace(/^\/+/, "")}` : "/api/earn";
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
