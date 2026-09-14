/**
 * HTTPS front door for Root-Webstat (Shockbyte additional ports).
 * claims.rootmc.net → Claims Paper :28305
 * towny.rootmc.net  → Towny Paper :29652
 */
export interface Env {
  CLAIMS_ORIGIN?: string;
  TOWNY_ORIGIN?: string;
}

const DEFAULTS: Record<string, string> = {
  "claims.rootmc.net": "http://claims-origin.rootmc.net:28305",
  "towny.rootmc.net": "http://towny-origin.rootmc.net:29652",
};

function originForHost(host: string, env: Env): string | null {
  const h = host.toLowerCase().split(":")[0];
  if (h === "claims.rootmc.net") {
    return (env.CLAIMS_ORIGIN || DEFAULTS[h]).replace(/\/$/, "");
  }
  if (h === "towny.rootmc.net") {
    return (env.TOWNY_ORIGIN || DEFAULTS[h]).replace(/\/$/, "");
  }
  return null;
}

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "cf-connecting-ip",
  "cf-ray",
  "cf-visitor",
  "x-forwarded-proto",
  "x-real-ip",
]);

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = originForHost(url.hostname, env);
    if (!origin) {
      return new Response("Unknown Webstat host", { status: 404 });
    }

    const target = origin + url.pathname + url.search;
    const headers = new Headers();
    request.headers.forEach((value, key) => {
      if (!HOP_BY_HOP.has(key.toLowerCase())) {
        headers.set(key, value);
      }
    });

    const init: RequestInit = {
      method: request.method,
      headers,
      redirect: "manual",
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
      // @ts-expect-error duplex required for streaming body in Workers
      init.duplex = "half";
    }

    try {
      const upstream = await fetch(target, init);
      const out = new Headers(upstream.headers);
      out.set("X-RootMC-Webstat-Proxy", url.hostname);
      // Allow embedding shared rootmc.net assets from this origin's pages
      out.set("Access-Control-Allow-Origin", "*");
      return new Response(upstream.body, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: out,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(`Webstat origin unreachable: ${msg}`, {
        status: 502,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  },
};
