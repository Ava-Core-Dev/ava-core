import type { ExecutionContext } from "@cloudflare/workers-types";
import { json } from "./cors";
import { sessionFromRequest, type AuthEnv } from "./primary-auth";
import {
  notifyDiscordAppSessionForAccount,
  notifyDiscordGuestAppSession,
  parseAppIdFromAuthRequest,
  type AppSessionDiscordEnv,
} from "../../shared/discord-app-session-notify";
import { grantFirstAppOpenBonus } from "../../shared/earn-app-first-open";

export {
  APP_SESSION_LABELS,
  parseAppIdFromAuthRequest,
  scheduleAuthLoginDiscordSessionNotify,
  scheduleDiscordAppSessionForAccount,
} from "../../shared/discord-app-session-notify";

export type AppSessionNotifyEnv = AuthEnv & AppSessionDiscordEnv;

/**
 * POST /api/app-session/start — notify Discord when a client begins a play session.
 * Body: `{ app_id, mode?: "beta_tester" | "signed_in" }`. Optional Bearer; optional `X-Guest-Id`.
 */
export async function handleAppSessionStartRoute(
  request: Request,
  env: AppSessionNotifyEnv,
  sub: string,
  method: string,
): Promise<Response | null> {
  if (sub !== "/app-session/start" || method !== "POST") return null;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ detail: "Invalid JSON." }, 400);
  }
  const b = raw as Record<string, unknown>;
  const appId = parseAppIdFromAuthRequest(request, b);
  const modeRaw = String(b.mode || "").trim().toLowerCase();
  const guestId = String(request.headers.get("X-Guest-Id") || request.headers.get("x-guest-id") || "").trim();
  const sess = await sessionFromRequest(env, request);
  const betaTester = modeRaw === "beta_tester" || (!sess && modeRaw !== "signed_in");

  let firstOpenGranted = false;
  let firstOpenUnits = 0;
  if (sess) {
    const email = String(sess.email || "")
      .trim()
      .toLowerCase();
    if (email) {
      const userId = "user:" + email;
      const nowIso = new Date().toISOString();
      try {
        await env.DB
          .prepare(
            `INSERT INTO rr_app_session_last_open (user_id, app_id, last_open_at)
             VALUES (?, ?, ?)
             ON CONFLICT(user_id, app_id) DO UPDATE SET last_open_at = excluded.last_open_at`,
          )
          .bind(userId, appId, nowIso)
          .run();
      } catch (e) {
        const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
        console.error(JSON.stringify({ msg: "app_session_last_open_failed", err: msg.slice(0, 200) }));
      }
      try {
        const fo = await grantFirstAppOpenBonus(env.DB, userId, appId, nowIso);
        firstOpenGranted = fo.granted;
        firstOpenUnits = fo.units;
      } catch (e) {
        const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
        console.error(JSON.stringify({ msg: "app_session_first_open_bonus_failed", err: msg.slice(0, 200) }));
      }
    }
  }

  if (sess) {
    try {
      const { touchRootEconomy } = await import("../../shared/root-economy-snapshot");
      await touchRootEconomy(env.DB, "session").catch(() => {});
    } catch {
      /* ignore */
    }
  }

  let notified = false;
  if (sess) {
    notified = await notifyDiscordAppSessionForAccount(env, {
      accountId: sess.accountId,
      email: sess.email,
      appId,
      mode: "signed_in",
      guestId: guestId || undefined,
    });
  } else {
    notified = await notifyDiscordGuestAppSession(env, {
      appId,
      mode: betaTester ? "beta_tester" : "anonymous",
      guestId: guestId || undefined,
    });
  }

  return json(
    {
      ok: true,
      notified,
      first_open_granted: firstOpenGranted,
      first_open_units: firstOpenUnits,
    },
    notified ? 201 : 200,
  );
}
