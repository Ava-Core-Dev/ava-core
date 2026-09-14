/**
 * Cloud-dark mode — dream dig (Grok) unavailable / unpaid.
 * Does NOT mute Ava when local Llama core can answer (true core survival).
 * Dig outage → digHealth.mjs / shouldUseLlamaCore(); replies stay on.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths, pushStatusEvent } from "./store.mjs";
import { shouldUseLlamaCore } from "./digHealth.mjs";

function cloudDarkPath() {
  return path.join(storePaths().dir, "cloud-dark.json");
}

function readCloudDark() {
  try {
    if (!fs.existsSync(cloudDarkPath())) return null;
    return JSON.parse(fs.readFileSync(cloudDarkPath(), "utf8"));
  } catch {
    return null;
  }
}

function writeCloudDark(value) {
  fs.mkdirSync(path.dirname(cloudDarkPath()), { recursive: true });
  fs.writeFileSync(cloudDarkPath(), JSON.stringify(value, null, 2), "utf8");
}

/**
 * True when dream digs are marked dark.
 * Returns false while llama core survival is active so surfaces never go silent.
 */
export function isCloudDark() {
  if (shouldUseLlamaCore()) return false;
  const v = String(process.env.AVA_CLOUD_DARK || "").trim();
  if (v === "1" || /^true$/i.test(v)) return true;
  if (v === "0" || /^false$/i.test(v)) return false;
  const s = readCloudDark();
  return Boolean(s?.dark);
}

export function setCloudDark({
  dark = true,
  reason = "cloud unreachable",
  by = "system",
} = {}) {
  const payload = {
    dark: Boolean(dark),
    reason: String(reason).slice(0, 300),
    by: String(by).slice(0, 80),
    updatedAt: Date.now(),
  };
  writeCloudDark(payload);
  pushStatusEvent(
    dark ? `cloud dark · ${payload.reason}` : `cloud restored · ${payload.reason}`,
  );
  return payload;
}

export function clearCloudDark(reason = "cleared") {
  return setCloudDark({ dark: false, reason, by: "clear" });
}

export function loadCloudDarkState() {
  return readCloudDark();
}

/** Public one-liner — unused; llama core answers instead of silence. */
export function cloudDarkSilentNote() {
  return null;
}
