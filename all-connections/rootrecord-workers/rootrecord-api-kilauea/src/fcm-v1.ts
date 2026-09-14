/** Firebase Cloud Messaging HTTP v1 (OAuth2 service account) for Workers. */
import * as jose from "jose";

const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

export async function getFcmAccessToken(creds: { clientEmail: string; privateKey: string }): Promise<string> {
  const email = creds.clientEmail.trim();
  const pkRaw = creds.privateKey.trim();
  if (!email || !pkRaw) throw new Error("Missing FCM client email or private key.");

  const pem = pkRaw.includes("BEGIN") ? pkRaw.replace(/\\n/g, "\n") : pkRaw;
  const key = await jose.importPKCS8(pem, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new jose.SignJWT({ scope: FCM_SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(email)
    .setSubject(email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: jwt,
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error || `OAuth token failed (HTTP ${res.status})`);
  }
  return data.access_token;
}

export type FcmSendOneResult = { ok: true } | { ok: false; error: string };

/** Data-only message — onMessageReceived runs even when the app is backgrounded (Android). */
export async function sendFcmDataNotification(
  projectId: string,
  accessToken: string,
  token: string,
  data: Record<string, string>,
): Promise<FcmSendOneResult> {
  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        token,
        data,
        android: { priority: "HIGH" },
      },
    }),
  });
  if (res.ok) return { ok: true };
  let msg = `HTTP ${res.status}`;
  try {
    const j = (await res.json()) as { error?: { message?: string } };
    if (j?.error?.message) msg = j.error.message;
  } catch {
    /* ignore */
  }
  return { ok: false, error: msg };
}

export async function sendFcmNotification(
  projectId: string,
  accessToken: string,
  token: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): Promise<FcmSendOneResult> {
  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        ...(data && Object.keys(data).length ? { data } : {}),
        android: {
          priority: "HIGH",
          notification: { sound: "default", channel_id: "kilauea_volcano" },
        },
      },
    }),
  });
  if (res.ok) return { ok: true };
  let msg = `HTTP ${res.status}`;
  try {
    const j = (await res.json()) as { error?: { message?: string } };
    if (j?.error?.message) msg = j.error.message;
  } catch {
    /* ignore */
  }
  return { ok: false, error: msg };
}
