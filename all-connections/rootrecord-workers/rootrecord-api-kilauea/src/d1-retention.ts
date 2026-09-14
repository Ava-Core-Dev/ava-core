/**
 * Bounded retention for the two `root-record` D1 tables that grow without limit.
 *
 * On 2026-08-18 the database hit Cloudflare's 500 MB per-database cap (272 MB of expired
 * `weather_data` cache rows, 190 MB of `kilauea_ai_analyses` model payloads), which rejected every
 * INSERT and broke signup and sign-in. This runs from the ten-minute Kilauea cron and trims a
 * little each pass, so a backlog can never build up again.
 */

const WEATHER_CACHE_RETENTION_DAYS = 3;
const WEATHER_DELETE_PER_RUN = 300;
const AI_PAYLOAD_RETENTION_DAYS = 3;
const AI_SLIM_PER_RUN = 10;
/** Newest rows keep their payloads: latestReport() and postReportToDiscord() still read them. */
const AI_KEEP_NEWEST = 5;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

export async function runD1RetentionCron(env: { DB: D1Database }): Promise<void> {
  // weather_data is a 15-minute cache (WEATHER_DATA_TTL_SEC); anything older is dead weight.
  const weather = await env.DB.prepare(
    `DELETE FROM weather_data
     WHERE id IN (SELECT id FROM weather_data WHERE fetched_at < ? ORDER BY fetched_at LIMIT ?)`,
  )
    .bind(isoDaysAgo(WEATHER_CACHE_RETENTION_DAYS), WEATHER_DELETE_PER_RUN)
    .run()
    .catch((e) => {
      console.warn("d1_retention_weather_failed", String(e));
      return null;
    });

  // Reports keep headline/free_text/pro_text forever; only the raw model payloads age out, and the
  // full prompt/response pair is already archived to Discord when the report is created.
  const analyses = await env.DB.prepare(
    `UPDATE kilauea_ai_analyses SET prompt_json = '{}', response_json = '{}'
     WHERE id IN (
       SELECT id FROM kilauea_ai_analyses
       WHERE created_at < ?
         AND discord_posted_at IS NOT NULL
         AND LENGTH(prompt_json) + LENGTH(response_json) > 2000
         AND id NOT IN (SELECT id FROM kilauea_ai_analyses ORDER BY created_at DESC LIMIT ?)
       ORDER BY created_at
       LIMIT ?
     )`,
  )
    .bind(isoDaysAgo(AI_PAYLOAD_RETENTION_DAYS), AI_KEEP_NEWEST, AI_SLIM_PER_RUN)
    .run()
    .catch((e) => {
      console.warn("d1_retention_analyses_failed", String(e));
      return null;
    });

  const weatherDeleted = Number(weather?.meta?.changes || 0);
  const analysesSlimmed = Number(analyses?.meta?.changes || 0);
  if (weatherDeleted || analysesSlimmed) {
    console.log(
      JSON.stringify({ msg: "d1_retention", v: 1, weather_rows_deleted: weatherDeleted, ai_payloads_slimmed: analysesSlimmed }),
    );
  }
}
