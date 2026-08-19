/** Resolve API base. On g.rootrecord.info this is same-origin so the session cookie sticks. */
export function goalsApiBase(): string {
  if (typeof window !== "undefined") {
    const host = window.location.hostname.toLowerCase();
    if (host === "g.rootrecord.info" || host === "www.g.rootrecord.info") return "";
  }
  return process.env.NEXT_PUBLIC_GOALS_API || "https://api-goals.rootrecord.info";
}

export const GOALS_API = goalsApiBase();

export const TOKEN_KEY = "rr_goals_token";
export const DEVICE_KEY = "rr_goals_device";

export type PublicGoal = {
  id: string;
  slug: string;
  title: string;
  purpose?: string;
  owner_kind?: "ava" | "community";
  image_url?: string | null;
  token_mint?: string | null;
  token_symbol?: string | null;
  token_status?: string | null;
  donate_wallet?: string | null;
  usdc_mint?: string | null;
  stripe_payment_link?: string | null;
  is_server_goal?: boolean;
  raised_cents?: number;
  estimated_cost_cents?: number | null;
  target_date_est?: string | null;
  updated_at?: string;
  page_path?: string;
  donations?: Array<{ source: string; amount_cents: number; currency: string; created_at: string }>;
};

export function deviceId(): string {
  if (typeof window === "undefined") return "web";
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = `web-${crypto.randomUUID()}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function readToken(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(TOKEN_KEY) || "";
}

export function writeToken(token: string) {
  if (typeof window === "undefined") return;
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export async function goalsFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {});
  const tok = readToken();
  if (tok && !headers.has("Authorization")) headers.set("Authorization", `Bearer ${tok}`);
  if (!headers.has("X-Guest-Id")) headers.set("X-Guest-Id", deviceId());
  if (init.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const res = await fetch(`${goalsApiBase()}${path}`, { ...init, headers, credentials: "include" });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const token = String(json.access_token || json.token || "");
  if (token) writeToken(token);
  return { ok: res.ok, status: res.status, json };
}

export function usd(cents: number | null | undefined) {
  const n = Number(cents || 0) / 100;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}
