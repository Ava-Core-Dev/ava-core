/**
 * Shared env loading for custodial ops scripts. Reads existing files only (never writes).
 * Walks from `workerRoot` up toward the filesystem root; at each level loads, if present:
 *   credentials.env, .env, then Web/credentials.env and Web/.env when ./Web is a directory.
 * Fills only missing or blank process.env keys (same rule as older scripts).
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

function loadEnvFile(path) {
  const text = readFileSync(path, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (!(k in process.env) || !String(process.env[k]).trim()) process.env[k] = v;
  }
}

function loadEnvFileIf(path) {
  if (existsSync(path)) loadEnvFile(path);
}

/**
 * @param {string} workerRoot - e.g. dirname of scripts/ (Cloudflare worker package root)
 * @param {{ requireInternalWalletKey?: boolean }} [opts]
 */
export function loadCustodialScriptEnv(workerRoot, opts = {}) {
  const requireEnc = opts.requireInternalWalletKey !== false;
  let probe = workerRoot;
  for (let i = 0; i < 16; i++) {
    loadEnvFileIf(join(probe, "credentials.env"));
    loadEnvFileIf(join(probe, ".env"));
    const webDir = join(probe, "Web");
    if (existsSync(webDir)) {
      loadEnvFileIf(join(webDir, "credentials.env"));
      loadEnvFileIf(join(webDir, ".env"));
    }
    const parent = dirname(probe);
    if (!parent || parent === probe) break;
    probe = parent;
  }
  if (requireEnc && !String(process.env.INTERNAL_WALLET_ENC_KEY_B64 || "").trim()) {
    throw new Error("INTERNAL_WALLET_ENC_KEY_B64 missing (expected in an existing credentials.env or .env on the walk)");
  }
}
