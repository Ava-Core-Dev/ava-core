-- Per-user daily counter of "fresh" outside-data weather fetches (AccuWeather / Open-Meteo /
-- NWS network calls triggered by the dashboard endpoint). Used to enforce a 2/day cap for
-- free accounts; Pro and Lifetime users bypass the cap entirely. Cached reads from D1 do
-- NOT increment this counter — only external network fetches do.
CREATE TABLE IF NOT EXISTS weather_free_fresh_fetches (
  user_id  TEXT    NOT NULL,
  day_utc  TEXT    NOT NULL,
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day_utc)
);

CREATE INDEX IF NOT EXISTS idx_weather_free_fresh_fetches_day
  ON weather_free_fresh_fetches (day_utc);
