/**
 * Canonical RootMC workspace path helpers.
 * Resolves layout-relative from this file (works on E:, D twin, /mnt/e, /srv/rootmc).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const libDir = path.dirname(fileURLToPath(import.meta.url));

// lib -> scripts -> rootmc-realm-api -> Web Files -> workspace root
export const WORKSPACE_ROOT = path.resolve(libDir, "..", "..", "..", "..");
export const PROJECTS_ROOT = path.dirname(WORKSPACE_ROOT);
export const WORKSPACE_ENV = path.join(WORKSPACE_ROOT, ".env");
export const WORKSTATION_CREDENTIALS = path.join(PROJECTS_ROOT, ".credentials", ".env");

/** Win32 drive letter of WORKSPACE_ROOT when path is `X:\...`, else null. */
export function workspaceDriveLetter() {
  if (process.platform !== "win32") return null;
  const m = /^([A-Za-z]):/.exec(WORKSPACE_ROOT);
  return m ? m[1].toUpperCase() : null;
}

/**
 * Credential .env candidates outside the layout (drive-letter / mount based).
 * Prefer E (handoff / Ubuntu source) before D (twin being flashed).
 */
export function driveCredentialCandidates() {
  const out = [];
  if (process.platform === "win32") {
    const letter = workspaceDriveLetter();
    // Prefer E (pit-stop / canonical), then same letter as this tree, then D twin.
    for (const L of ["E", letter, "D"].filter(Boolean)) {
      const p = `${L}:\\.credentials\\.env`;
      if (!out.includes(p)) out.push(p);
    }
  } else {
    // Ubuntu pit-stop: E mounted at /mnt/e; optional /srv thin copy; D may be wiped.
    out.push(
      "/mnt/e/.1 Work Stations/.credentials/.env",
      "/mnt/e/.credentials/.env",
      "/srv/rootmc/.credentials/.env",
      path.join(process.env.HOME || "/root", ".credentials", ".env"),
    );
  }
  return out;
}

/** @deprecated Prefer driveCredentialCandidates() — first existing path. */
export const DRIVE_CREDENTIALS =
  process.platform === "win32"
    ? (() => {
        for (const p of driveCredentialCandidates()) {
          if (fs.existsSync(p)) return p;
        }
        return "E:\\.credentials\\.env";
      })()
    : "/mnt/e/.1 Work Stations/.credentials/.env";

export const HOME_CREDENTIALS = path.join(
  process.env.HOME || process.env.USERPROFILE || "",
  ".credentials",
  ".env",
);
export const CLOUDFLARE_ROOT = path.join(WORKSPACE_ROOT, "Web Files");
export const MONO_REPO_ROOT = PROJECTS_ROOT;
export const MONO_REPO_CREDENTIALS = path.join(PROJECTS_ROOT, "credentials.env");
export const D1_MIGRATIONS_DIR =
  process.env.ROOTMC_D1_MIGRATIONS_DIR ||
  path.join(CLOUDFLARE_ROOT, "rootrecord-api-account", "migrations");
export const HANDOFFS_ROOT = path.join(WORKSPACE_ROOT, "Server Handoffs");
export const HANDOFF_CLAIMS_ROOT = path.join(HANDOFFS_ROOT, "1. RootMC - Claims");
export const HANDOFF_TOWNY_ROOT = path.join(HANDOFFS_ROOT, "2. RootMC - Towny");
export const HANDOFF_TEST_ROOT = path.join(HANDOFFS_ROOT, "3. RootMC - Test Server");
/** @deprecated Prefer HANDOFF_TOWNY_ROOT — kept for scripts that still import HANDOFF_ROOT */
export const HANDOFF_ROOT = HANDOFF_TOWNY_ROOT;
export const HANDOFF_PLUGINS_DIR = path.join(HANDOFF_ROOT, "plugins");
export const HANDOFF_CLOUD_YML = path.join(HANDOFF_PLUGINS_DIR, "RootMC", "cloud.yml");
export const REALM_API_ROOT = path.resolve(libDir, "..", "..");
export const REFERENCE_DIR = path.join(REALM_API_ROOT, "reference");

/** rootmc-realm-api package root (run scripts from here). */
export function realmApiRoot() {
  return REALM_API_ROOT;
}

export function credentialsCandidates() {
  return [
    process.env.CREDENTIALS_ENV,
    process.env.ROOTMC_ENV_FILE,
    WORKSPACE_ENV,
    path.join(WORKSPACE_ROOT, "_local", ".env"),
    WORKSTATION_CREDENTIALS,
    HOME_CREDENTIALS,
    ...driveCredentialCandidates(),
    MONO_REPO_CREDENTIALS,
    path.join(process.cwd(), "credentials.env"),
    path.join(PROJECTS_ROOT, "credentials.env"),
  ].filter(Boolean);
}

export function findCredentialsPath() {
  for (const p of credentialsCandidates()) {
    if (fs.existsSync(p)) return p;
  }
  return WORKSPACE_ENV;
}

export function envFileCandidates() {
  return [
    process.env.ROOTMC_ENV_FILE,
    WORKSPACE_ENV,
    path.join(WORKSPACE_ROOT, "_local", ".env"),
    WORKSTATION_CREDENTIALS,
    ...driveCredentialCandidates(),
    MONO_REPO_CREDENTIALS,
  ].filter(Boolean);
}

export function cloudYmlCandidates() {
  return [
    process.env.ROOTMC_CLOUD_YML,
    HANDOFF_CLOUD_YML,
    path.join(HANDOFF_CLAIMS_ROOT, "plugins", "RootMC", "cloud.yml"),
    path.join(WORKSPACE_ROOT, "Plugin Building", "Minecraft", "server", "plugins", "RootMC", "cloud.yml"),
    path.join(process.cwd(), "../../Plugin Building/Minecraft/server/plugins/RootMC/cloud.yml"),
  ].filter(Boolean);
}

export function wranglerTomlPath() {
  for (const p of [
    path.join(process.cwd(), "wrangler.toml"),
    path.join(process.cwd(), "../rootmc-api/wrangler.toml"),
    path.join(WORKSPACE_ROOT, "Web Files", "rootmc-api", "wrangler.toml"),
  ]) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(WORKSPACE_ROOT, "Web Files", "rootmc-api", "wrangler.toml");
}

export function readCloudYml() {
  for (const p of cloudYmlCandidates()) {
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, "utf8");
    const serverId = text.match(/server-id:\s*([0-9a-f-]{36})/i)?.[1] || "";
    const serverSecret = text.match(/server-secret:\s*([0-9a-f]{64})/i)?.[1] || "";
    if (serverId && serverSecret) return { serverId, serverSecret, path: p };
  }
  return null;
}
