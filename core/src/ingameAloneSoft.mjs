/**
 * Alone-with-Alex soft lines — rare private tells when an operator
 * is the only (or only-operator) player online. Voice dept, tasteful.
 * Disable: AVA_INGAME_ALONE_SOFT=0
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnv } from "./config.mjs";
import { assignArmyJob } from "./avasArmy.mjs";
import { recordAvaUtterance, appendAction } from "./fullLog.mjs";
import { guardedRcon, rconConfigured, rconTargets } from "./rconGuard.mjs";
import { isEmergencyStopped } from "./emergencyStop.mjs";
import { isHushed, storePaths, pushStatusEvent } from "./store.mjs";
import { isPoweredOff } from "./powerDown.mjs";
import { isLockoutActive } from "./lockoutMode.mjs";

const SOFT_LINES = [
  "[Voice] hey {name} — quiet map. im still in the whisper lane with you. - Ava",
  "[Voice] {name}, just us for a bit. clocks are fine. talk anytime. - Ava",
  "[Relations] soft check-in — you're not alone on the Root Server side either. - Ava",
  "[Watch] low foot traffic · high care. /ava tip if you want a crumb. - Ava",
];

export function aloneSoftEnabled() {
  const v = String(process.env.AVA_INGAME_ALONE_SOFT || "1").trim();
  return !(v === "0" || /^false$/i.test(v) || /^off$/i.test(v));
}

export function aloneSoftIntervalMs() {
  const n = Number(process.env.AVA_INGAME_ALONE_MS || 180_000);
  return Number.isFinite(n) && n >= 60_000 ? n : 180_000;
}

export function aloneSoftBootDelayMs() {
  const n = Number(process.env.AVA_INGAME_ALONE_BOOT_MS || 90_000);
  return Number.isFinite(n) && n >= 30_000 ? n : 90_000;
}

function statePath() {
  return path.join(storePaths().dir, "ingame-alone-soft.json");
}

function loadState() {
  try {
    if (!fs.existsSync(statePath())) return { lastByName: {}, lastRunAt: 0 };
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return { lastByName: {}, lastRunAt: 0 };
  }
}

function saveState(s) {
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(s, null, 2), "utf8");
}

function operatorSet() {
  return new Set(
    String(process.env.AVA_OPERATOR_MC_NAMES || "Alexrs94,Melee")
      .split(/[,;\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

function sanitizePlayerName(name) {
  const n = String(name || "").trim();
  if (!/^[A-Za-z0-9_]{1,16}$/.test(n)) return null;
  return n;
}

function sanitizeTellBody(text) {
  return String(text || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/§./g, "")
    .replace(/["`']/g, "'")
    .slice(0, 200)
    .trim();
}

async function listOnlineNames(target) {
  const res = await guardedRcon("list", { allow: true, target });
  if (!res.ok) return null;
  const body = String(res.output || "");
  const m = body.match(/:\s*(.+)$/s);
  if (!m) return [];
  return m[1]
    .split(/,|\n/)
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z0-9_]{1,16}$/.test(s));
}

/**
 * Soft tell when a known operator is alone (or only operators online).
 */
export async function runIngameAloneSoft({ env: envIn, force = false } = {}) {
  if (!aloneSoftEnabled()) {
    return { ok: true, sent: 0, silent: true, reason: "disabled" };
  }
  if (isPoweredOff() || isHushed() || isLockoutActive() || isEmergencyStopped()) {
    return { ok: true, sent: 0, silent: true, reason: "muted" };
  }
  if (!rconConfigured()) {
    return { ok: true, sent: 0, silent: true, reason: "rcon_not_configured" };
  }

  await (envIn || loadEnv());
  const state = loadState();
  const now = Date.now();
  if (!force && state.lastRunAt && now - state.lastRunAt < aloneSoftIntervalMs() * 0.75) {
    return { ok: true, sent: 0, silent: true, reason: "throttle" };
  }
  state.lastRunAt = now;
  state.lastByName = state.lastByName || {};

  const ops = operatorSet();
  // Prefer primary, then any remaining configured targets
  const targets = rconTargets().map((t) => t.id);
  const order = ["primary", "test", ...targets.filter((id) => id !== "primary" && id !== "test")];
  const seen = new Set();
  let sent = 0;

  for (const target of order) {
    if (seen.has(target)) continue;
    if (!targets.includes(target)) continue;
    seen.add(target);

    const names = await listOnlineNames(target);
    if (!names || names.length === 0) continue;

    const opOnline = names.filter((n) => ops.has(n.toLowerCase()));
    const onlyOps = opOnline.length > 0 && opOnline.length === names.length;
    const aloneOp = names.length === 1 && ops.has(names[0].toLowerCase());
    if (!aloneOp && !onlyOps) continue;

    for (const raw of opOnline) {
      const name = sanitizePlayerName(raw);
      if (!name) continue;
      const k = name.toLowerCase();
      const last = Number(state.lastByName[k] || 0);
      // Rare: once per 4 hours per operator
      if (now - last < 4 * 60 * 60 * 1000) continue;

      const tpl = SOFT_LINES[Math.floor(Math.random() * SOFT_LINES.length)];
      const body = sanitizeTellBody(tpl.replace(/\{name\}/gi, name));
      const res = await guardedRcon(`tell ${name} ${body}`, { allow: true, target });
      if (!res.ok) continue;

      state.lastByName[k] = now;
      sent += 1;
      assignArmyJob({
        text: `alone soft · ${name}`,
        dept: "voice",
        source: "ingame_alone_soft",
      });
      pushStatusEvent(`alone soft · ${name} · ${target}`);
      await recordAvaUtterance({
        surface: "minecraft",
        channelId: `rcon:${target}`,
        content: body,
        kind: "ingame_alone_soft",
        source: "ingame_alone_soft",
        meta: { player: name, online: names.length },
      });
    }
  }

  // prune
  for (const [k, at] of Object.entries(state.lastByName)) {
    if (now - at > 7 * 24 * 60 * 60 * 1000) delete state.lastByName[k];
  }
  saveState(state);
  if (sent > 0) appendAction("ingameAloneSoft.batch", { sent });
  return {
    ok: true,
    sent,
    silent: sent === 0,
    reason: sent ? "sent" : "quiet",
  };
}
