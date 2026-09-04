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

/**
 * Pretty paths for HTML files under apps/core/static/rootrecord.
 * Files stay `*.html` on disk; the Worker 301s `/name.html` → `/name` and
 * fetches `/name.html` from origin. Do not add photos-admin here.
 */
const HTML_PAGES = new Set([
  "/about",
  "/account",
  "/account-signup",
  "/android-closed-testing",
  "/app-build-request",
  "/beta-tester-rewards",
  "/billing",
  "/contact",
  "/data-deletion",
  "/development-notice",
  "/discord-verify",
  "/faq",
  "/join-tester-group",
  "/kilauea-alerts",
  "/my-apps",
  "/partnership-signup",
  "/pricing",
  "/privacy",
  "/products",
  "/root-goals",
  "/root-goals/public-goal",
  "/root-goals/public-profile",
  "/root-units",
  "/rootrecord-business-manager",
  "/rootrecord-weather-manager",
  "/terms",
  "/visiting-hawaii",
  "/visiting-hawaii-sponsor",
  "/weather-developer",
]);

/** Public pages, after the Worker has normalised the path. */
const PUBLIC_PAGES = new Set([
  "/status",
  "/kilauea",
  "/weather",
  "/rootmc",
  "/feedback",
  "/chat",
  "/roadmap",
  "/account/emails",
  "/products/rootunits",
  "/discord-verify.js",
  "/account.js",
  "/site-nav.js",
  "/styles.css",
  "/favicon.ico",
  "/favicon-32.png",
  "/favicon-16.png",
  "/favicon-180.png",
  "/site.webmanifest",
]);

/** `/about.html` → `/about`. `/index.html` → `/`. Null if this is not an HTML URL. */
export function withoutHtmlExtension(path: string): string | null {
  if (!path.toLowerCase().endsWith(".html")) return null;
  const stem = path.slice(0, -5);
  if (stem === "" || stem === "/") return "/";
  return stem;
}

/** Visitor asked for `*.html` — send them to the pretty path (one Worker pattern). */
export function htmlRedirectTarget(path: string): string | null {
  const pretty = withoutHtmlExtension(path);
  if (pretty == null) return null;
  if (pretty === "/") return "/";
  if (HTML_PAGES.has(pretty)) return pretty;
  return null;
}

/** Origin still stores the file as `name.html`. Null means leave the path alone. */
export function originHtmlPath(path: string): string | null {
  if (HTML_PAGES.has(path)) return `${path}.html`;
  return null;
}

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
  const pretty = withoutHtmlExtension(path);
  if (pretty && HTML_PAGES.has(pretty)) return true;
  if (HTML_PAGES.has(path) || PUBLIC_PAGES.has(path)) return true;
  return ["/earthquakes", "/news", "/states", "/charts", "/wiki", "/products", "/roadmap"].some(
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
