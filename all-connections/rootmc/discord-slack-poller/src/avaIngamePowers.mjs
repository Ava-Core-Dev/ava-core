/**
 * Ava in-game help powers — console RCON build/assist (Alex 2026-08-03).
 * No Mojang account "AvaIvy" yet → powers run as server console via RCON.
 * WorldEdit / Litematica printer (server-side) plug in when jars land.
 */
import { guardedRcon, rconConfigured, rconTargets } from "./rconGuard.mjs";
import { pushStatusEvent } from "./store.mjs";

/**
 * Run a build/assist command on Claims and/or Towny.
 * @param {string} command
 * @param {{ targets?: string[] }} [opts]
 */
export async function avaBuildRcon(command, { targets = ["claims", "towny"] } = {}) {
  if (!rconConfigured()) {
    return { ok: false, reason: "rcon_not_configured", results: [] };
  }
  const results = [];
  for (const t of targets) {
    if (!rconTargets().some((x) => x.id === t)) continue;
    const r = await guardedRcon(command, {
      allow: true,
      target: t,
      avaBuildAssist: true,
    });
    results.push({ target: t, ...r });
  }
  return {
    ok: results.some((r) => r.ok),
    results,
  };
}

/**
 * Probe + announce powers online. Safe no-op say on each host.
 */
export async function enableAvaIngamePowers({ announce = true } = {}) {
  const hosts = rconTargets().map((t) => t.id);
  const probes = [];

  for (const t of hosts) {
    const list = await guardedRcon("list", { allow: true, target: t });
    probes.push({ target: t, list: list.ok ? list.output : list.reason });

    // Confirm build-assist path works (harmless particle at world spawn)
    const build = await guardedRcon(
      "execute in minecraft:overworld run particle minecraft:end_rod 0 80 0 0.2 0.2 0.2 0 8 force",
      { allow: true, target: t, avaBuildAssist: true },
    );
    probes.push({
      target: t,
      buildProbe: build.ok ? "ok" : build.reason,
      buildOut: build.output || "",
    });

    // Detect WorldEdit / FAWE presence
    const plug = await guardedRcon("plugins", { allow: true, target: t });
    const text = String(plug.output || "");
    const hasWe = /worldedit|fastasyncworldedit|fawe/i.test(text);
    const hasLite = /litematic/i.test(text);
    probes.push({
      target: t,
      worldedit: hasWe,
      litematica: hasLite,
      pluginsOk: plug.ok,
    });
  }

  if (announce) {
    for (const t of hosts) {
      await avaBuildRcon(
        'say Ava Ivy in-game help powers online — console RCON build assist armed (setblock/fill/execute). Drop WorldEdit/FAWE for schematics + Litematica place workflow.',
        { targets: [t] },
      );
    }
  }

  pushStatusEvent("ava ingame powers · RCON build assist armed");
  return {
    ok: true,
    hosts,
    probes,
    note: "AvaIvy Mojang profile missing — powers are console RCON, not a player op. Group rootperms 'ava' exists for when a real account joins.",
  };
}
