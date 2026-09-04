/**
 * GET /{solanaAddress}/goals — public goals profile (canonical on rootrecord.info).
 */
type Env = { ASSETS: { fetch: typeof fetch } };

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  const assetUrl = new URL("/root-goals/public-profile.html", context.request.url);
  const asset = await context.env.ASSETS.fetch(assetUrl.toString());
  if (!asset.ok) {
    return new Response("Public goals profile template not found.", { status: 404 });
  }
  const html = await asset.text();
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
