import type { D1Database } from "@cloudflare/workers-types";

/** Slow request threshold (ms) before we persist a row for operator review. */
const SLOW_MS = 25_000;
const PRUNE_DAYS = 30;
const DEFAULT_FETCH_LIMIT = 50;

/** Shorten paths for logs / D1 (strip noisy ids). */
export function redactPathname(pathname: string): string {
  let p = pathname.replace(/\/+/g, "/") || "/";
  if (p.length > 512) p = `${p.slice(0, 512)}…`;
  p = p.replace(
    /\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/gi,
    "/:uuid",
  );
  p = p.replace(/\/[1-9A-HJ-NP-Za-km-z]{32,48}(?=\/|$)/g, "/:b58");
  return p;
}

function cfPick(cf: unknown, k: string): string {
  if (!cf || typeof cf !== "object") return "";
  const v = (cf as Record<string, unknown>)[k];
  if (v == null) return "";
  return String(v);
}

function rayFromRequest(request: Request): string {
  return (
    request.headers.get("cf-ray") ||
    request.headers.get("CF-Ray") ||
    request.headers.get("Cf-Ray") ||
    ""
  ).trim();
}

export function logHttpRequestJson(request: Request, response: Response, durationMs: number): void {
  const url = new URL(request.url);
  const path = redactPathname(url.pathname);
  const cf = request.cf;
  const ray = rayFromRequest(request);
  const asn = (cf as Record<string, unknown> | undefined)?.asn;
  const line = {
    msg: "http_request",
    v: 1,
    method: request.method,
    path,
    status: response.status,
    ms: durationMs,
    ray: ray || undefined,
    colo: cfPick(cf, "colo") || undefined,
    country: cfPick(cf, "country") || undefined,
    asn: typeof asn === "number" ? asn : undefined,
    tls: cfPick(cf, "tlsVersion") || undefined,
    proto: cfPick(cf, "httpProtocol") || undefined,
  };
  console.log(JSON.stringify(line));
}

export async function persistHttpErrorIfNeeded(
  db: D1Database,
  request: Request,
  response: Response,
  durationMs: number,
  overrideMessage?: string | null,
): Promise<void> {
  const status = response.status;
  const slow = durationMs >= SLOW_MS;
  const bad = status >= 500;
  if (!bad && !slow && !overrideMessage) return;

  const url = new URL(request.url);
  const pathRedacted = redactPathname(url.pathname);
  const cf = request.cf;
  const ray = rayFromRequest(request) || null;
  const country = cfPick(cf, "country") || null;
  const colo = cfPick(cf, "colo") || null;
  const message = overrideMessage
    ? String(overrideMessage).slice(0, 2000)
    : slow && !bad
      ? `slow_request ms=${durationMs}`
      : `http_status_${status}`;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await db
      .prepare(
        `INSERT INTO worker_http_error_events (
           id, created_at, method, path_redacted, status, duration_ms, cf_ray, country, colo, message
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        now,
        request.method.slice(0, 16),
        pathRedacted.slice(0, 512),
        status,
        Math.min(8_600_000, Math.max(0, Math.floor(durationMs))),
        ray,
        country,
        colo,
        message.slice(0, 2000),
      )
      .run();
  } catch (e) {
    const m = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error(JSON.stringify({ msg: "observability_insert_failed", v: 1, err: m.slice(0, 400) }));
  }
}

export async function pruneWorkerHttpErrorEvents(db: D1Database): Promise<void> {
  const cutoff = new Date(Date.now() - PRUNE_DAYS * 86_400_000).toISOString();
  try {
    await db
      .prepare(`DELETE FROM worker_http_error_events WHERE created_at < ?`)
      .bind(cutoff)
      .run();
  } catch (e) {
    const m = String(e && typeof e === "object" && "message" in e ? (e as Error).message : e);
    console.error(JSON.stringify({ msg: "observability_prune_failed", v: 1, err: m.slice(0, 400) }));
  }
}

export type HttpErrorEventRow = {
  id: string;
  created_at: string;
  method: string;
  path_redacted: string;
  status: number;
  duration_ms: number;
  cf_ray: string | null;
  country: string | null;
  colo: string | null;
  message: string | null;
};

export async function readRecentHttpErrorEvents(db: D1Database, limit: number): Promise<HttpErrorEventRow[]> {
  const lim = Math.min(200, Math.max(1, Math.floor(limit || DEFAULT_FETCH_LIMIT)));
  const r = await db
    .prepare(
      `SELECT id, created_at, method, path_redacted, status, duration_ms, cf_ray, country, colo, message
       FROM worker_http_error_events
       ORDER BY datetime(created_at) DESC
       LIMIT ?`,
    )
    .bind(lim)
    .all<HttpErrorEventRow>();
  return r.results || [];
}
