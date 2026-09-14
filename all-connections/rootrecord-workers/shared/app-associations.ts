export type AppAssocCore = {
  associated: boolean;
  /** Best-effort UTC ISO 8601 from D1 (workspace sync, locations, push tokens, earn totals, etc.). */
  last_connected_at: string | null;
};

export type AppUsageEntry = {
  app_id: string;
  associated: boolean;
  last_connected_at: string | null;
};

export type AppAssociationsPayload = {
  rootrecord_business_manager_windows: {
    associated: null;
    note: string;
    last_connected_at: null;
  };
  rootrecord_business_manager_android: AppAssocCore;
  rootrecord_weather_manager_windows: AppAssocCore;
  rootrecord_weather_manager_android: AppAssocCore;
  /** All app_ids with server-side activity (earn, farms, workspace, weather, etc.). */
  usage: AppUsageEntry[];
  signals: {
    mobile_push: boolean;
    saved_locations: boolean;
    weather_cache: boolean;
  };
};

/** Lexicographic max works for ISO 8601 / SQLite TEXT timestamps. */
function maxIsoTimestamps(values: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const raw of values) {
    if (typeof raw !== "string") continue;
    const t = raw.trim();
    if (!t) continue;
    if (!best || t > best) best = t;
  }
  return best;
}

function mergeUsage(
  map: Map<string, string | null>,
  appId: string,
  ts: string | null | undefined,
): void {
  const id = String(appId || "")
    .trim()
    .toLowerCase();
  if (!id) return;
  const next = maxIsoTimestamps([map.get(id), ts]);
  if (next) map.set(id, next);
  else if (!map.has(id)) map.set(id, null);
}

function heartbeatMsToIso(ms: unknown): string | null {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return null;
  try {
    return new Date(n).toISOString();
  } catch {
    return null;
  }
}

async function scalarString(
  db: { prepare: (sql: string) => { bind: (...args: unknown[]) => { first: <T>() => Promise<T | null> } } },
  sql: string,
  binds: unknown[],
  column: string,
): Promise<string | null> {
  try {
    const row = await db.prepare(sql).bind(...binds).first<Record<string, string | null>>();
    const v = row?.[column];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Best-effort signals from D1 for which RootRecord apps have used this account online.
 * `rootrecord_business_manager_windows` is a legacy JSON key for the account hub; cloud
 * activity for Business Manager is reflected in `rootrecord_business_manager_android`.
 */
/** Accepts a Cloudflare D1Database binding (typed in each Worker package). */
export async function getAppAssociationsForEmail(
  db: {
    prepare: (sql: string) => {
      bind: (...args: unknown[]) => {
        first: <T>() => Promise<T | null>;
        all: <T>() => Promise<{ results?: T[] }>;
      };
    };
  },
  email: string,
): Promise<AppAssociationsPayload> {
  const userId = `user:${email.trim().toLowerCase()}`;
  const appBm = "rootrecord_business_manager_android";
  const appWma = "rootrecord_weather_manager_android";
  const appWwx = "rootrecord_weather_manager_windows";
  const usageMap = new Map<string, string | null>();

  let bmRow: { ok: number } | null = null;
  try {
    bmRow = await db
      .prepare("SELECT 1 AS ok FROM bm_owned_row WHERE user_key = ? LIMIT 1")
      .bind(userId)
      .first<{ ok: number }>();
  } catch {
    bmRow = null;
  }

  const [
    pushRow,
    locRow,
    wxRow,
    bmUpdatedMax,
    earnBmAt,
    pushUpdatedMax,
    earnWmaAt,
    locCreatedMax,
    wxFetchedMax,
    earnWwxAt,
    earnTotals,
    earnStateRows,
    farmsUpdated,
  ] = await Promise.all([
    db.prepare("SELECT 1 AS ok FROM rrwm_push_tokens WHERE user_id = ? LIMIT 1").bind(userId).first<{ ok: number }>(),
    db.prepare("SELECT 1 AS ok FROM rrwm_locations WHERE user_id = ? LIMIT 1").bind(userId).first<{ ok: number }>(),
    db.prepare("SELECT 1 AS ok FROM weather_data WHERE user_id = ? LIMIT 1").bind(userId).first<{ ok: number }>(),
    scalarString(db, "SELECT MAX(updated_at) AS m FROM bm_owned_row WHERE user_key = ?", [userId], "m"),
    scalarString(db, "SELECT updated_at AS m FROM rr_earn_app_total WHERE user_id = ? AND app_id = ?", [userId, appBm], "m"),
    scalarString(db, "SELECT MAX(updated_at) AS m FROM rrwm_push_tokens WHERE user_id = ?", [userId], "m"),
    scalarString(db, "SELECT updated_at AS m FROM rr_earn_app_total WHERE user_id = ? AND app_id = ?", [userId, appWma], "m"),
    scalarString(db, "SELECT MAX(created_at) AS m FROM rrwm_locations WHERE user_id = ?", [userId], "m"),
    scalarString(db, "SELECT MAX(fetched_at) AS m FROM weather_data WHERE user_id = ?", [userId], "m"),
    scalarString(db, "SELECT updated_at AS m FROM rr_earn_app_total WHERE user_id = ? AND app_id = ?", [userId, appWwx], "m"),
    db
      .prepare("SELECT app_id, updated_at FROM rr_earn_app_total WHERE user_id = ?")
      .bind(userId)
      .all<{ app_id: string; updated_at: string | null }>()
      .catch(() => ({ results: [] as { app_id: string; updated_at: string | null }[] })),
    db
      .prepare("SELECT app_id, last_heartbeat_ms FROM rr_earn_state WHERE user_id = ?")
      .bind(userId)
      .all<{ app_id: string; last_heartbeat_ms: number | null }>()
      .catch(() => ({ results: [] as { app_id: string; last_heartbeat_ms: number | null }[] })),
    scalarString(db, "SELECT updated_at AS m FROM rr_farms_progress WHERE user_id = ?", [userId], "m"),
  ]);

  for (const row of earnTotals.results || []) {
    mergeUsage(usageMap, row.app_id, row.updated_at);
  }
  for (const row of earnStateRows.results || []) {
    mergeUsage(usageMap, row.app_id, heartbeatMsToIso(row.last_heartbeat_ms));
  }
  if (farmsUpdated) mergeUsage(usageMap, "root_farms", farmsUpdated);

  const mobilePush = Boolean(pushRow);
  const savedLocations = Boolean(locRow);
  const weatherCache = Boolean(wxRow);
  const businessMobile = Boolean(bmRow);

  const lastBm = maxIsoTimestamps([bmUpdatedMax, earnBmAt]);
  const lastWma = maxIsoTimestamps([pushUpdatedMax, earnWmaAt]);
  const lastWwx = maxIsoTimestamps([locCreatedMax, wxFetchedMax, earnWwxAt]);

  if (businessMobile) mergeUsage(usageMap, appBm, lastBm);
  if (mobilePush || earnWmaAt) mergeUsage(usageMap, appWma, lastWma);
  if (savedLocations || weatherCache) mergeUsage(usageMap, appWwx, lastWwx);

  const usage: AppUsageEntry[] = Array.from(usageMap.entries())
    .map(([app_id, last_connected_at]) => ({
      app_id,
      associated: true,
      last_connected_at,
    }))
    .sort((a, b) => {
      const ta = a.last_connected_at || "";
      const tb = b.last_connected_at || "";
      if (ta === tb) return a.app_id.localeCompare(b.app_id);
      if (!ta) return 1;
      if (!tb) return -1;
      return tb.localeCompare(ta);
    });

  return {
    rootrecord_business_manager_windows: {
      associated: null,
      note: "Legacy association slot (not inferred from D1). Android Business Manager usage is shown under the Android entry.",
      last_connected_at: null,
    },
    rootrecord_business_manager_android: {
      associated: businessMobile || usageMap.has(appBm),
      last_connected_at: businessMobile || usageMap.has(appBm) ? lastBm : null,
    },
    rootrecord_weather_manager_windows: {
      associated: savedLocations || weatherCache || usageMap.has(appWwx),
      last_connected_at:
        savedLocations || weatherCache || usageMap.has(appWwx) ? lastWwx : null,
    },
    rootrecord_weather_manager_android: {
      associated: mobilePush || usageMap.has(appWma),
      last_connected_at: mobilePush || usageMap.has(appWma) ? lastWma : null,
    },
    usage,
    signals: {
      mobile_push: mobilePush,
      saved_locations: savedLocations,
      weather_cache: weatherCache,
    },
  };
}
