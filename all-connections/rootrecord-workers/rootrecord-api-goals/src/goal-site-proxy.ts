const DEFAULT_ORIGIN = "https://rootrecord-online-fpag6xxlb-root-record.vercel.app";

export function isGoalsSiteHost(host: string): boolean {
  const h = host.split(":")[0]?.toLowerCase() || "";
  return h === "g.rootrecord.info" || h === "www.g.rootrecord.info";
}

export async function proxyGoalsSite(request: Request, origin: string | undefined): Promise<Response> {
  const src = new URL(request.url);
  if (src.pathname === "/" || src.pathname === "") {
    src.pathname = "/goals";
    return Response.redirect(src.toString(), 302);
  }
  const base = (origin || DEFAULT_ORIGIN).replace(/\/+$/, "");
  const dest = new URL(src.pathname + src.search, base);
  const headers = new Headers();
  const skip = new Set(["host", "cf-connecting-ip", "cf-ray", "cf-visitor", "cdn-loop", "connection", "content-length"]);
  request.headers.forEach((value, key) => {
    if (!skip.has(key.toLowerCase())) headers.set(key, value);
  });
  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body;
    (init as { duplex?: string }).duplex = "half";
  }
  const res = await fetch(dest.toString(), init);
  const out = new Headers(res.headers);
  const loc = out.get("Location");
  if (loc) {
    try {
      const locUrl = new URL(loc, dest);
      if (locUrl.host === dest.host) {
        locUrl.protocol = src.protocol;
        locUrl.host = src.host;
        out.set("Location", locUrl.toString());
      }
    } catch {
      /* keep original */
    }
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
}
