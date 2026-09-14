import { json } from "./cors";

/** Optional Worker vars — bump min_* when you need users on newer builds. */
export interface MobileVersionEnv {
  MIN_APP_VERSION_WEATHER?: string;
  MIN_APP_VERSION_BM?: string;
  MIN_APP_VERSION_TOKEN_MANAGER?: string;
  MIN_APP_VERSION_ACCOUNT_HUB?: string;
  PLAY_STORE_URL_WEATHER?: string;
  PLAY_STORE_URL_BM?: string;
  PLAY_STORE_URL_TOKEN_MANAGER?: string;
  PLAY_STORE_URL_ACCOUNT_HUB?: string;
}

const DEF_MIN_WEATHER = "1.0.16";
/** Three-part semver only — `"1.06"` is parsed as 1.6.x and breaks `1.0.x` app builds. */
const DEF_MIN_BM = "1.0.0";
const DEF_MIN_TOKEN = "0.1.0";
const DEF_MIN_ACCOUNT_HUB = "0.1.1";
const DEF_PLAY_WEATHER = "https://play.google.com/store/apps/details?id=com.rootrecord.weathermanager";
const DEF_PLAY_BM = "https://play.google.com/store/apps/details?id=com.rootrecord.businessmanager";
const DEF_PLAY_TOKEN = "https://play.google.com/store/apps/details?id=com.rootrecord.tokenmanager";
const DEF_PLAY_ACCOUNT_HUB = "https://play.google.com/store/apps/details?id=com.rootrecord.accounthub";

type AppKind = "weather" | "bm" | "token" | "account_hub";

function appKind(appId: string): AppKind {
  const a = appId.toLowerCase();
  if (a.includes("business_manager")) return "bm";
  if (a.includes("token_manager")) return "token";
  if (a.includes("account_hub")) return "account_hub";
  return "weather";
}

/**
 * GET /api/mobile/version-policy?app_id=...
 * Unauthenticated. Native apps call this on the sign-in screen to compare against package version.
 */
export function handleMobileVersionPolicy(request: Request, env: MobileVersionEnv): Response {
  const url = new URL(request.url);
  const appId = (url.searchParams.get("app_id") || "").trim();
  const kind = appKind(appId);

  let min_version: string;
  let update_url: string;

  switch (kind) {
    case "bm":
      min_version = String(env.MIN_APP_VERSION_BM || "").trim() || DEF_MIN_BM;
      update_url = String(env.PLAY_STORE_URL_BM || "").trim() || DEF_PLAY_BM;
      break;
    case "token":
      min_version = String(env.MIN_APP_VERSION_TOKEN_MANAGER || "").trim() || DEF_MIN_TOKEN;
      update_url = String(env.PLAY_STORE_URL_TOKEN_MANAGER || "").trim() || DEF_PLAY_TOKEN;
      break;
    case "account_hub":
      min_version = String(env.MIN_APP_VERSION_ACCOUNT_HUB || "").trim() || DEF_MIN_ACCOUNT_HUB;
      update_url = String(env.PLAY_STORE_URL_ACCOUNT_HUB || "").trim() || DEF_PLAY_ACCOUNT_HUB;
      break;
    default:
      min_version = String(env.MIN_APP_VERSION_WEATHER || "").trim() || DEF_MIN_WEATHER;
      update_url = String(env.PLAY_STORE_URL_WEATHER || "").trim() || DEF_PLAY_WEATHER;
  }

  return json(
    {
      app_id: appId || null,
      min_version,
      update_url,
    },
    200,
  );
}
