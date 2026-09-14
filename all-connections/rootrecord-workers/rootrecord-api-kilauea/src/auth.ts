import { json } from "./cors";
import { extractAuthToken, sessionFromRequest, type AuthEnv } from "./primary-auth";

export async function resolveUserId(request: Request, env: AuthEnv): Promise<string | Response> {
  const guest = request.headers.get("X-Guest-Id") || "";
  const gid = guest.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);

  const sess = await sessionFromRequest(env, request);
  if (sess) {
    const email = String(sess.email || "")
      .trim()
      .toLowerCase();
    if (email) return `user:${email}`;
  }
  if (gid) return `guest:${gid}`;
  if (extractAuthToken(request)) {
    return json({ detail: "Invalid or expired session." }, 401);
  }
  return json({ detail: "Sign in or provide a guest id." }, 401);
}
