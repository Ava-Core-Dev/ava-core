/**
 * One policy for what the public web may reach on the origin.
 *
 * The origin mounts operator routes on the same `/api` prefix as public ones
 * (`apps/core/routes/desktop.py` is `APIRouter(prefix="/api")`), so a Worker
 * that forwards all of `/api/*` also hands out `/api/finance` and `/api/biz`.
 * Whitelist reads by name instead, and never forward a write.
 *
 * Adding a public endpoint means adding it here on purpose.
 */

/** Read-only endpoints the public boards actually call. */
const PUBLIC_EXACT = new Set([
  "/health",
  "/api/status",
  "/api/live",
  "/api/solar",
  "/api/solar/history",
  "/api/solar/rollups",
  "/api/desk/notifications",
  "/api/disruption-banner",
  "/api/ops-schedule-banner",
  "/api/kilauea",
  "/api/weather",
  "/api/dashboard",
  "/api/air-quality/current",
  "/api/photos/gallery",
  "/api/mobile/kilauea-live-streams",
  "/api/mobile/kilauea-situation",
  "/api/mobile/kilauea-ai-analyses",
  "/api/earthquakes/global",
  "/api/news/global",
  "/api/site-config",
  "/api/site-config.json",
]);

/** Read-only families. Writes under these are still refused by method. */
const PUBLIC_PREFIX = [
  "/api/site-backgrounds/",
  "/api/obs/",
  "/api/mobile/",
  "/api/photos/file/",
  "/api/geography/",
  "/earthquakes/",
  "/weather/",
  "/news/",
  "/states/",
  "/charts/",
  "/wiki/",
  "/css/",
  "/js/",
  "/assets/",
];

/** Public pages, after the Worker has normalised the path. */
const PUBLIC_PAGES = new Set([
  "/status",
  "/kilauea",
  "/weather",
  "/rootmc",
  "/feedback",
  "/chat",
  "/products",
  "/pricing",
  "/about",
  "/faq",
  "/contact",
  "/account",
  "/account-signup",
  "/billing",
  "/products.html",
  "/pricing.html",
  "/about.html",
  "/faq.html",
  "/contact.html",
  "/account.html",
  "/account-signup.html",
  "/billing.html",
  "/discord-verify",
  "/discord-verify.html",
  "/discord-verify.js",
  "/account.js",
  "/site-nav.js",
  "/kilauea-alerts.html",
  "/rootrecord-weather-manager.html",
  "/rootrecord-business-manager.html",
  "/styles.css",
  "/favicon.ico",
  "/favicon-32.png",
  "/favicon-16.png",
  "/favicon-180.png",
  "/site.webmanifest",
]);

/** Never public, on any surface, whatever else changes. */
const PRIVATE_PREFIX = [
  "/ops",
  "/api/ops",
  "/api/business",
  "/business",
  "/api/finance",
  "/finance",
  "/api/biz",
  "/api/local",
  "/api/crons",
  "/api/cron",
  "/api/brain",
  "/api/media",
  "/api/reports",
  "/api/minecraft",
  "/identities",
  "/media",
  "/system",
  "/host",
  "/ecoflow",
  "/minecraft",
];

/** Hidden until the operator un-hides them: shown as the holding page. */
const HIDDEN_PREFIX = ["/goals", "/wallets", "/api/goals", "/status/goals"];

function hits(path: string, prefixes: string[]): boolean {
  return prefixes.some((p) => path === p || path.startsWith(p + "/") || path.startsWith(p + "?"));
}

export function isPrivatePath(path: string): boolean {
  return hits(path, PRIVATE_PREFIX);
}

export function isHiddenPath(path: string): boolean {
  return hits(path, HIDDEN_PREFIX);
}

export function isPublicPage(path: string): boolean {
  if (PUBLIC_PAGES.has(path)) return true;
  return ["/earthquakes", "/news", "/states", "/charts", "/wiki", "/products.html"].some(
    (p) => path === p || path.startsWith(p + "/"),
  );
}

export function isPublicData(path: string): boolean {
  if (PUBLIC_EXACT.has(path)) return true;
  return PUBLIC_PREFIX.some((p) => path.startsWith(p));
}

/** Reads only. One check kills every POST route sharing the `/api` prefix. */
export function isReadMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

/** Visitor writes allowed when the origin is dark (offline inbox). */
export function isPublicWrite(method: string, path: string): boolean {
  if (method !== "POST") return false;
  return path === "/feedback" || path === "/api/feedback" || path === "/api/chat";
}

/** Trailing slash off, so `/status/` and `/status` are one page. */
export function normalisePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) return path.replace(/\/+$/, "") || "/";
  return path;
}
