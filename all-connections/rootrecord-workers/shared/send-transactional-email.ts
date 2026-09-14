// @ts-ignore Cloudflare runtime module; older @cloudflare/workers-types packages may not declare it.
import { EmailMessage } from "cloudflare:email";

type SendEmail = { send: (...args: any[]) => Promise<unknown> };

/** Worker env for outbound mail: Cloudflare Email Sending binding and/or Resend secrets. */
export type TransactionalEmailEnv = {
  EMAIL?: SendEmail;
  /** Default: `RootRecord <root@rootrecord.info>` (wrangler [vars] EMAIL_FROM). */
  EMAIL_FROM?: string;
  RESEND_API_KEY?: string;
  RESEND_FROM?: string;
  ZOHO_MAIL_ACCOUNT_ID?: string;
  ZOHO_MAIL_FROM?: string;
  ZOHO_MAIL_OAUTH_TOKEN?: string;
  ZOHO_MAIL_REFRESH_TOKEN?: string;
  ZOHO_MAIL_CLIENT_ID?: string;
  ZOHO_MAIL_CLIENT_SECRET?: string;
  ZOHO_ACCOUNTS_BASE_URL?: string;
  ZOHO_MAIL_API_BASE_URL?: string;
};

const DEFAULT_FROM = "RootRecord <root@rootrecord.info>";
const ROOT_FALLBACK_FROM = "RootRecord <root@rootrecord.info>";

function resolveFrom(env: TransactionalEmailEnv): string {
  return (env.ZOHO_MAIL_FROM || env.EMAIL_FROM || env.RESEND_FROM || "").trim() || DEFAULT_FROM;
}

function htmlToPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function headerValue(value: string): string {
  return String(value || "").replace(/[\r\n]+/g, " ").trim();
}

function emailAddressOnly(value: string): string {
  const m = String(value || "").match(/<([^<>@\s]+@[^<>\s]+)>/);
  return (m?.[1] || value).replace(/[<>\r\n]/g, "").trim();
}

function mimeMessage(from: string, to: string, subject: string, html: string, text: string): string {
  const boundary = `rr-${crypto.randomUUID()}`;
  const cleanFrom = headerValue(from);
  const cleanTo = headerValue(to);
  const cleanSubject = headerValue(subject);
  return [
    `From: ${cleanFrom}`,
    `To: ${cleanTo}`,
    `Subject: ${cleanSubject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

async function zohoAccessToken(env: TransactionalEmailEnv): Promise<string> {
  const direct = (env.ZOHO_MAIL_OAUTH_TOKEN || "").trim();
  if (direct) return direct;
  const refresh = (env.ZOHO_MAIL_REFRESH_TOKEN || "").trim();
  const clientId = (env.ZOHO_MAIL_CLIENT_ID || "").trim();
  const clientSecret = (env.ZOHO_MAIL_CLIENT_SECRET || "").trim();
  if (!refresh || !clientId || !clientSecret) return "";
  const base = (env.ZOHO_ACCOUNTS_BASE_URL || "https://accounts.zoho.com").replace(/\/+$/, "");
  const body = new URLSearchParams({
    refresh_token: refresh,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });
  const res = await fetch(`${base}/oauth/v2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error || `Zoho OAuth failed (HTTP ${res.status})`);
  }
  return data.access_token;
}

/** One OAuth refresh per bulk job — call once, then sendZohoTransactionalEmail for each message. */
export async function fetchZohoAccessToken(env: TransactionalEmailEnv): Promise<string> {
  return zohoAccessToken(env);
}

export async function sendZohoTransactionalEmail(
  env: TransactionalEmailEnv,
  accessToken: string,
  to: string,
  subject: string,
  html: string,
): Promise<boolean> {
  const accountId = (env.ZOHO_MAIL_ACCOUNT_ID || "").trim();
  const token = String(accessToken || "").trim();
  if (!accountId || !token) return false;
  const apiBase = (env.ZOHO_MAIL_API_BASE_URL || "https://mail.zoho.com").replace(/\/+$/, "");
  const fromAddress = emailAddressOnly(resolveFrom(env));
  const res = await fetch(`${apiBase}/api/accounts/${encodeURIComponent(accountId)}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Zoho-oauthtoken ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fromAddress,
      toAddress: emailAddressOnly(to),
      subject,
      content: html,
      mailFormat: "html",
    }),
  });
  if (res.ok) return true;
  const detail = await res.text().catch(() => "");
  console.error("ZOHO.send", res.status, detail.slice(0, 300));
  return false;
}

async function sendZohoEmail(
  env: TransactionalEmailEnv,
  from: string,
  to: string,
  subject: string,
  html: string,
): Promise<boolean> {
  const token = await zohoAccessToken(env);
  if (!token) return false;
  return sendZohoTransactionalEmail(env, token, to, subject, html);
}

async function sendResendEmail(
  env: TransactionalEmailEnv,
  from: string,
  to: string,
  subject: string,
  html: string,
): Promise<boolean> {
  const key = (env.RESEND_API_KEY || "").trim();
  if (!key.startsWith("re_")) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
  if (res.ok) return true;
  const detail = await res.text().catch(() => "");
  console.error("RESEND.send", res.status, detail.slice(0, 300));
  return false;
}

async function sendCloudflareBoundEmail(
  env: TransactionalEmailEnv,
  from: string,
  to: string,
  subject: string,
  html: string,
  plain: string,
): Promise<boolean> {
  if (!env.EMAIL) return false;
  try {
    const message = new EmailMessage(
      emailAddressOnly(from),
      emailAddressOnly(to),
      mimeMessage(from, to, subject, html, plain),
    );
    await env.EMAIL.send(message);
    return true;
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error("EMAIL.send", msg);
    if (from !== ROOT_FALLBACK_FROM && /sender|from|address|not.*verified|not.*allowed|unauthorized/i.test(msg)) {
      try {
        const message = new EmailMessage(
          emailAddressOnly(ROOT_FALLBACK_FROM),
          emailAddressOnly(to),
          mimeMessage(ROOT_FALLBACK_FROM, to, subject, html, plain),
        );
        await env.EMAIL.send(message);
        console.error("EMAIL.send fallback_from_root", from);
        return true;
      } catch (fallbackErr) {
        const fallbackMsg = String(
          fallbackErr && typeof fallbackErr === "object" && "message" in fallbackErr
            ? (fallbackErr as Error).message
            : fallbackErr,
        );
        console.error("EMAIL.send fallback", fallbackMsg);
      }
    }
  }
  return false;
}

/** Zoho first, then optional Resend fallback, then Cloudflare Email (routing destinations only). */
export async function sendTransactionalEmail(
  env: TransactionalEmailEnv,
  to: string,
  subject: string,
  html: string,
  text?: string,
): Promise<boolean> {
  const from = resolveFrom(env);
  const plain = (text ?? htmlToPlain(html)).trim() || subject;

  try {
    if (await sendZohoEmail(env, from, to, subject, html)) return true;
  } catch (e) {
    const msg = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error("ZOHO.send", msg);
  }

  if (await sendResendEmail(env, from, to, subject, html)) return true;

  return sendCloudflareBoundEmail(env, from, to, subject, html, plain);
}
