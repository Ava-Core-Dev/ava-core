/**
 * kilauea.cloud — volcano app only. Not the OmniBook desk. Not /ops.
 */
const APP = "https://rootrecord-kilauea-web.pages.dev";

export default {
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/ops" || path.startsWith("/ops/") || path.startsWith("/api/ops")) {
      return new Response(null, { status: 404 });
    }
    if (path === "/feedback" || path === "/feedback/") {
      return Response.redirect("https://rootrecord.cloud/feedback", 302);
    }
    const url = new URL(request.url);
    const target = new URL(path + url.search, APP);
    const headers = new Headers(request.headers);
    headers.set("Host", new URL(APP).host);
    return fetch(target.toString(), {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "follow",
    });
  },
};
