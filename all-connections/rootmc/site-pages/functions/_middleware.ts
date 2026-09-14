import { rootmcApiBaseFromEnv } from "./_lib/accountApiBase";

type Env = {
  ROOTMC_API_BASE?: string;
};

const UUID_RE =
  /^\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

/**
 * https://rootmc.net/{server-id} → 302 to that server's registered webstat_url.
 * Non-UUID paths fall through to static Pages assets.
 */
const SLACK_WORKSPACE_URL = "https://rootmcworkspace.slack.com/";

export const onRequest = async (context: {
  request: Request;
  env: Env;
  next: () => Promise<Response>;
}): Promise<Response> => {
  const url = new URL(context.request.url);
  const host = url.hostname.toLowerCase();
  if (host === "slack.rootmc.net") {
    return Response.redirect(SLACK_WORKSPACE_URL, 302);
  }

  const m = url.pathname.match(UUID_RE);
  if (!m) {
    return context.next();
  }

  const serverId = m[1];
  const apiBase = rootmcApiBaseFromEnv(context.env).replace(/\/$/, "");
  try {
    const live = await fetch(`${apiBase}/api/rootmc/server/${encodeURIComponent(serverId)}/live`, {
      headers: { Accept: "application/json" },
    });
    if (!live.ok) {
      return context.next();
    }
    const body = (await live.json()) as { webstat_url?: string };
    const target = String(body.webstat_url || "").replace(/\/$/, "");
    if (!target || !/^https?:\/\//i.test(target)) {
      return context.next();
    }
    return Response.redirect(target + "/", 302);
  } catch {
    return context.next();
  }
};
