/**
 * GET /{solanaAddress}/goals/{slug} — single public goal (canonical on rootrecord.info).
 */
type Env = { ASSETS: { fetch: typeof fetch } };

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const assetUrl = new URL("/root-goals/public-goal.html", context.request.url);
  const asset = await context.env.ASSETS.fetch(assetUrl.toString());
  if (!asset.ok) {
    return new Response("Public goal template not found.", { status: 404 });
  }
  const html = await asset.text();
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
