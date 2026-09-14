-- Sampled / error HTTP observability for rootrecord-primary (5xx, very slow requests, uncaught).
CREATE TABLE IF NOT EXISTS worker_http_error_events (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  method TEXT NOT NULL,
  path_redacted TEXT NOT NULL,
  status INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  cf_ray TEXT,
  country TEXT,
  colo TEXT,
  message TEXT
);

CREATE INDEX IF NOT EXISTS idx_worker_http_err_created ON worker_http_error_events (created_at);
