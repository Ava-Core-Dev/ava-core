import fs from "node:fs";
import path from "node:path";
import { storePaths } from "./store.mjs";
import { personByAuthorId } from "./people.mjs";

/**
 * Emergency stop — Alexrs94 + Melee can pause RCON / file-write jobs
 * without killing conversation (hush is separate).
 */

function stopPath() {
  return path.join(storePaths().dir, "emergency-stop.json");
}

export function isEmergencyStopped() {
  try {
    const s = JSON.parse(fs.readFileSync(stopPath(), "utf8"));
    return Boolean(s.active);
  } catch {
    return false;
  }
}

export function setEmergencyStop(active, { by, reason } = {}) {
  const rec = {
    active: Boolean(active),
    by: by || null,
    reason: reason || "",
    at: Date.now(),
  };
  fs.mkdirSync(path.dirname(stopPath()), { recursive: true });
  fs.writeFileSync(stopPath(), JSON.stringify(rec, null, 2), "utf8");
  return rec;
}

export function canEmergencyStop(authorId, authorName) {
  const p = personByAuthorId(authorId, authorName);
  if (!p) return false;
  return (
    p.id === "alexrs94" ||
    p.id === "melee" ||
    (p.roles || []).includes("emergency-stop") ||
    (p.roles || []).includes("owner")
  );
}

export function isEmergencyStopCommand(content) {
  const q = String(content || "").toLowerCase();
  return (
    /\b(emergency\s+stop|e-?stop|freeze\s+writes|pause\s+rcon)\b/.test(q) &&
    /\bava\b/.test(q)
  ) || /^emergency\s+stop\b/i.test(q.trim());
}

export function isEmergencyClearCommand(content) {
  const q = String(content || "").toLowerCase();
  return (
    /\b(clear\s+emergency|resume\s+writes|unfreeze|lift\s+stop)\b/.test(q) &&
    /\bava\b/.test(q)
  );
}
