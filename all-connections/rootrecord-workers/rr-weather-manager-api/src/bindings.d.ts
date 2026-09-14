export interface PushWorkerEnv {
  USER_DATA_DB: D1Database;
  /** Base URL for license/auth Worker (no trailing slash). Used to validate Bearer for /me/push-token. Defaults to request origin if unset (same Worker). */
  PRIMARY_API_BASE?: string;
  /** Plaintext ops secret; compared like FastAPI (SHA-256 of header vs SHA-256 of secret). */
  RR_PUSH_ADMIN_SECRET?: string;
  FCM_PROJECT_ID?: string;
  FCM_CLIENT_EMAIL?: string;
  /** PEM private key; use \\n for newlines when stored in Wrangler secret. */
  FCM_PRIVATE_KEY?: string;
}
