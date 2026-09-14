import type { D1Database } from "@cloudflare/workers-types";
import { FARMS_APP_ID, parsePlotsJson, plotsToJson, type PlotProgress } from "./farms-catalog";
import { ORCHARD_COUNT, VEGETABLE_COUNT, parseTierPlotsJson, tierPlotsToJson, type TierPlotProgress } from "./farms-orchards";
import { getGlobalLightningRowIndex, maybeRollGlobalLightningRow } from "./farms-global-hazard";
import {
  CYPRUS_WIND_BLOCK_CHANCE,
  farmsStoreToJson,
  parseFarmsStore,
  protectionIncomeMultiplier,
  protectionIncomeReductionPerMinute,
  userHasStormHazards,
  type FarmsProtections,
  type FarmsStoreData,
  type ProtectionKind,
} from "./farms-store";

export type { FarmsProtections, ProtectionKind } from "./farms-store";
export {
  parseFarmsStore,
  parseFarmsStore as parseStoreJson,
  farmsStoreToJson,
  farmsStoreToJson as storeToJson,
  protectionIncomeMultiplier,
  protectionIncomeReductionPerMinute,
  LIGHTNING_ROD_COST,
} from "./farms-store";

const ATTACK_CHANCE: Record<ProtectionKind, number> = {
  gopher: 1 / 250,
  mice: 1 / 320,
  rabbit: 1 / 1800,
  birds: 1 / 520,
};

const WIND_CHANCE = 1 / 340;
const LIGHTNING_CHANCE = 1 / 420;
const CRON_SAMPLE_SIZE = 40;
const FARMHAND_CHECKIN_WINDOW_MS = 48 * 60 * 60 * 1000;
const FARMHAND_CHECKIN_APP_IDS = [FARMS_APP_ID, "root_farms_android"];

export type VarmintEventKind =
  | "gopher_attack"
  | "gopher_blocked"
  | "mice_attack"
  | "mice_blocked"
  | "rabbit_attack"
  | "rabbit_blocked"
  | "birds_attack"
  | "birds_blocked"
  | "wind_attack"
  | "wind_blocked"
  | "lightning_attack"
  | "lightning_blocked"
  | "protection_disabled"
  | "advisory_safety_classic"
  | "advisory_safety_storm"
  | "advisory_milestone_storms"
  | "advisory_milestone_orchards"
  | "advisory_milestone_vegetables"
  | "advisory_root_unlock";

function hasActiveRows(plots: PlotProgress[]): boolean {
  return plots.some((p) => p.unlocked && p.rowsActive > 0);
}

function hasActiveTierRows(plots: TierPlotProgress[]): boolean {
  return plots.some((p) => p.unlocked && p.rowsActive > 0);
}

function hasActiveTrees(orchards: TierPlotProgress[], store: FarmsStoreData): boolean {
  return orchards.some((p) => p.unlocked && p.rowCount > 0) || (store.root_clusters ?? []).some(Boolean);
}

function farmhandsProtectedStore(store: FarmsStoreData, farmhandsActive: boolean): FarmsStoreData {
  if (farmhandsActive) return store;
  return {
    ...store,
    protections: { gopher: false, mice: false, rabbit: false, birds: false },
    lightning_meteorologist: false,
    cypress_trees: false,
  };
}

function randomInt(max: number): number {
  if (max <= 0) return 0;
  return Math.floor(Math.random() * max);
}

function pickRootCluster(store: FarmsStoreData): number | null {
  const eligible = (store.root_clusters ?? [])
    .map((on, i) => (on ? i + 1 : 0))
    .filter((id) => id > 0);
  if (!eligible.length) return null;
  return eligible[randomInt(eligible.length)]!;
}

type FieldTarget =
  | { kind: "root"; id: number }
  | { kind: "orchard"; id: number }
  | { kind: "vegetable"; id: number }
  | { kind: "cluster"; id: number };

function pickFieldTargetWithRows(
  plots: PlotProgress[],
  orchards: TierPlotProgress[],
  vegetables: TierPlotProgress[],
  store?: FarmsStoreData,
): FieldTarget | null {
  const targets: FieldTarget[] = [];
  for (const p of plots) if (p.unlocked && p.rowsActive > 0) targets.push({ kind: "root", id: p.id });
  for (const p of orchards) if (p.unlocked && p.rowsActive > 0) targets.push({ kind: "orchard", id: p.id });
  for (const p of vegetables) if (p.unlocked && p.rowsActive > 0) targets.push({ kind: "vegetable", id: p.id });
  if (store) {
    for (const id of (store.root_clusters ?? []).map((on, i) => (on ? i + 1 : 0)).filter((id) => id > 0)) {
      targets.push({ kind: "cluster", id });
    }
  }
  if (!targets.length) return null;
  return targets[randomInt(targets.length)]!;
}

function pickFieldTargetWithRowSlots(
  plots: PlotProgress[],
  orchards: TierPlotProgress[],
  vegetables: TierPlotProgress[],
  store?: FarmsStoreData,
): FieldTarget | null {
  const targets: FieldTarget[] = [];
  for (const p of plots) if (p.unlocked && p.rowCount > 0) targets.push({ kind: "root", id: p.id });
  for (const p of orchards) if (p.unlocked && p.rowCount > 0) targets.push({ kind: "orchard", id: p.id });
  for (const p of vegetables) if (p.unlocked && p.rowCount > 0) targets.push({ kind: "vegetable", id: p.id });
  if (store) {
    for (const id of (store.root_clusters ?? []).map((on, i) => (on ? i + 1 : 0)).filter((id) => id > 0)) {
      targets.push({ kind: "cluster", id });
    }
  }
  if (!targets.length) return null;
  return targets[randomInt(targets.length)]!;
}

function targetPayload(target: FieldTarget | null): Record<string, unknown> {
  if (!target) return {};
  if (target.kind === "cluster" || target.kind === "orchard") return treePayload(target.kind, target.id);
  if (target.kind === "vegetable") return { target_type: "vegetable", plot_id: target.id };
  return { plot_id: target.id };
}

function targetPlotId(target: FieldTarget | null): number | null {
  return target?.id ?? null;
}

function treePayload(kind: "orchard" | "cluster", id: number): Record<string, unknown> {
  return {
    target_type: kind,
    tree_id: id,
    tree_name: kind === "cluster" ? `Root Cluster Tree ${["I", "II", "III", "IV", "V", "VI"][id - 1] ?? id}` : `Orchard tree ${id}`,
  };
}

function applyGopherDamage(plots: PlotProgress[], plotId: number): PlotProgress[] {
  return plots.map((p) => {
    if (p.id !== plotId) return p;
    return { ...p, rowsActive: Math.max(0, p.rowsActive - 1) };
  });
}

function applyMiceDamage(plots: PlotProgress[], plotId: number): PlotProgress[] {
  return plots.map((p) => {
    if (p.id !== plotId) return p;
    const rowCount = Math.max(0, p.rowCount - 1);
    return { ...p, rowCount, rowsActive: Math.min(p.rowsActive, rowCount) };
  });
}

function applyRabbitDamage(plots: PlotProgress[], plotId: number): PlotProgress[] {
  return plots.map((p) => {
    if (p.id !== plotId) return p;
    return { ...p, rowCount: 0, rowsActive: 0, cycleProgress: 0 };
  });
}

function applyWindDamage(plots: PlotProgress[], plotId: number): PlotProgress[] {
  return applyRabbitDamage(plots, plotId);
}

function applyTreeRowDamage(orchards: TierPlotProgress[], treeId: number): TierPlotProgress[] {
  return orchards.map((p) => {
    if (p.id !== treeId) return p;
    return { ...p, rowsActive: Math.max(1, p.rowsActive - 1), cycleProgress: 0 };
  });
}

function applyTreeSlotDamage(orchards: TierPlotProgress[], treeId: number): TierPlotProgress[] {
  return orchards.map((p) => {
    if (p.id !== treeId) return p;
    const rowCount = Math.max(1, p.rowCount - 1);
    return { ...p, rowCount, rowsActive: Math.min(Math.max(1, p.rowsActive), rowCount), cycleProgress: 0 };
  });
}

function applyRootClusterDamage(store: FarmsStoreData, clusterId: number): FarmsStoreData {
  const root_clusters = [...(store.root_clusters ?? [])];
  root_clusters[clusterId - 1] = false;
  return { ...store, root_clusters };
}

function applyBirdPlotDamage(plots: PlotProgress[]): PlotProgress[] {
  return plots.map((p) => {
    if (!p.unlocked || p.rowsActive <= 0) return p;
    return { ...p, rowsActive: Math.max(0, p.rowsActive - 1), cycleProgress: 0 };
  });
}

function applyBirdTierDamage(plots: TierPlotProgress[]): TierPlotProgress[] {
  return plots.map((p) => {
    if (!p.unlocked || p.rowsActive <= 0) return p;
    return { ...p, rowsActive: Math.max(1, p.rowsActive - 1), cycleProgress: 0 };
  });
}

function applyBirdClusterDamage(store: FarmsStoreData): FarmsStoreData {
  const clusterId = pickRootCluster(store);
  return clusterId == null ? store : applyRootClusterDamage(store, clusterId);
}

/** Global lightning row index (1-10): once unlocked, trim matching active rows across the field. */
function applyLightningRowDamage(plots: PlotProgress[], rowIndex: number): PlotProgress[] {
  const targetRow = Math.min(10, Math.max(1, Math.floor(rowIndex)));
  return plots.map((p) => {
    if (!p.unlocked || p.rowsActive < targetRow) return p;
    return { ...p, rowsActive: targetRow - 1, cycleProgress: 0 };
  });
}

function applyTreeLightningDamage(orchards: TierPlotProgress[], rowIndex: number): TierPlotProgress[] {
  const targetRow = Math.min(10, Math.max(1, Math.floor(rowIndex)));
  return orchards.map((p) => {
    if (!p.unlocked || p.rowsActive < targetRow) return p;
    return { ...p, rowsActive: Math.max(1, targetRow - 1), cycleProgress: 0 };
  });
}

function eventMessage(kind: VarmintEventKind, plotId: number, extra?: Record<string, unknown>): string {
  const targetType = String(extra?.target_type || "");
  const treeName = String(extra?.tree_name || "tree");
  const plotLabel = targetType === "vegetable" ? `vegetable plot ${plotId}` : `plot ${plotId}`;
  if (targetType === "orchard" || targetType === "cluster") {
    switch (kind) {
      case "gopher_attack":
        return `A gopher damaged ${treeName}.`;
      case "gopher_blocked":
        return `Gopher protection stopped an attack on ${treeName}.`;
      case "mice_attack":
        return `Field mice damaged ${treeName}.`;
      case "mice_blocked":
        return `Field mice protection stopped an attack on ${treeName}.`;
      case "rabbit_attack":
        return `A rabbit damaged ${treeName}.`;
      case "rabbit_blocked":
        return `Rabbit protection stopped an attack on ${treeName}.`;
      case "birds_attack":
        return `Birds pecked at ${treeName}.`;
      case "birds_blocked":
        return `Uncle swatted birds away from ${treeName}.`;
      case "wind_attack":
        return `Wind damaged ${treeName}.`;
      case "wind_blocked":
        return `Cypress windbreak protected ${treeName}.`;
      case "lightning_attack":
        return `Lightning struck ${treeName}.`;
      case "lightning_blocked":
        return `Lightning protection guarded ${treeName}.`;
    }
  }
  switch (kind) {
    case "gopher_attack":
      return `A gopher gnawed a row on ${plotLabel}.`;
    case "gopher_blocked":
      return `Gopher protection stopped an attack on ${plotLabel}.`;
    case "mice_attack":
      return `Field mice destroyed a row on ${plotLabel}.`;
    case "mice_blocked":
      return `Field mice protection stopped an attack on ${plotLabel}.`;
    case "rabbit_attack":
      return `A rabbit damaged ${plotLabel}.`;
    case "rabbit_blocked":
      return `Rabbit protection stopped an attack on ${plotLabel}.`;
    case "birds_attack":
      return "A flock of birds pecked across the whole field.";
    case "birds_blocked":
      return "Uncle swatted at birds with his cane and kept the field safe.";
    case "wind_attack":
      return `Wind knocked out a crop on plot ${plotId}.`;
    case "wind_blocked":
      return `Cypress trees blunted wind damage on plot ${plotId}.`;
    case "lightning_attack": {
      const row = Math.floor(Number(extra?.lightning_row) || 0);
      return row > 0
        ? `Lightning struck row ${row} across your unlocked field (shared storm row for all farms).`
        : "Lightning struck a row across your unlocked field.";
    }
    case "lightning_blocked": {
      const row = Math.floor(Number(extra?.lightning_row) || 0);
      return row > 0
        ? `Your lightning rod grounded row ${row} (shared storm row).`
        : "Your lightning rod grounded a lightning strike.";
    }
    case "advisory_safety_classic":
      return "Your field needs hazard protection — open Farmhands.";
    case "advisory_safety_storm":
      return "Storm gear recommended — open Farmhands.";
    case "advisory_milestone_storms":
      return "Wind and lightning hazards are now in play.";
    case "advisory_milestone_orchards":
      return "Orchards tier unlocked.";
    case "advisory_milestone_vegetables":
      return "Vegetable plots unlocked.";
    case "advisory_root_unlock":
      return plotId > 0 ? `New root plot unlocked (plot ${plotId}).` : "New root plot tier unlocked.";
    default:
      return "Farm hazard activity.";
  }
}

export async function insertVarmintEvent(
  db: D1Database,
  userId: string,
  eventKind: VarmintEventKind,
  plotId: number | null,
  extra?: Record<string, unknown>,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO rr_farms_varmint_events (id, user_id, event_kind, plot_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, userId, eventKind, plotId, JSON.stringify(extra ?? {}), now)
    .run();
  return id;
}

export async function listPendingVarmintEvents(db: D1Database, userId: string, limit = 20) {
  const rows = await db
    .prepare(
      `SELECT id, event_kind, plot_id, payload_json, created_at
       FROM rr_farms_varmint_events
       WHERE user_id = ? AND acked_at IS NULL
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .bind(userId, limit)
    .all<{
      id: string;
      event_kind: string;
      plot_id: number | null;
      payload_json: string;
      created_at: string;
    }>();
  return (rows.results || []).map((r) => {
    const payload = (() => {
      try {
        return JSON.parse(r.payload_json || "{}") as Record<string, unknown>;
      } catch {
        return {};
      }
    })();
    return {
      id: r.id,
      kind: r.event_kind,
      plot_id: r.plot_id != null ? Math.floor(Number(r.plot_id)) : null,
      message: eventMessage(r.event_kind as VarmintEventKind, Math.floor(Number(r.plot_id) || 0), payload),
      created_at: r.created_at,
      payload,
    };
  });
}

export async function ackVarmintEvents(db: D1Database, userId: string, ids: string[]): Promise<void> {
  const clean = ids.map((x) => String(x).trim()).filter((x) => x.length > 8).slice(0, 50);
  if (!clean.length) return;
  const now = new Date().toISOString();
  for (const id of clean) {
    await db
      .prepare(
        `UPDATE rr_farms_varmint_events SET acked_at = ? WHERE user_id = ? AND id = ? AND acked_at IS NULL`,
      )
      .bind(now, userId, id)
      .run();
  }
}

function rollAttack(chance: number): boolean {
  return Math.random() < chance;
}

async function farmhandsRecentlyCheckedIn(db: D1Database, userId: string, nowMs = Date.now()): Promise<boolean> {
  const placeholders = FARMHAND_CHECKIN_APP_IDS.map(() => "?").join(", ");
  const rows = await db
    .prepare(
      `SELECT last_open_at
       FROM rr_app_session_last_open
       WHERE user_id = ? AND app_id IN (${placeholders})`,
    )
    .bind(userId, ...FARMHAND_CHECKIN_APP_IDS)
    .all<{ last_open_at: string }>()
    .catch(() => ({ results: [] as { last_open_at: string }[] }));
  const stateRows = await db
    .prepare(
      `SELECT updated_at AS last_open_at
       FROM rr_earn_state
       WHERE user_id = ? AND app_id IN (${placeholders})`,
    )
    .bind(userId, ...FARMHAND_CHECKIN_APP_IDS)
    .all<{ last_open_at: string }>()
    .catch(() => ({ results: [] as { last_open_at: string }[] }));
  const last = [...(rows.results ?? []), ...(stateRows.results ?? [])]
    .map((row) => Date.parse(String(row.last_open_at || "")))
    .filter((ms) => Number.isFinite(ms) && ms > 0)
    .sort((a, b) => b - a)[0];
  return last != null && nowMs - last <= FARMHAND_CHECKIN_WINDOW_MS;
}

async function processStorms(
  db: D1Database,
  userId: string,
  plots: PlotProgress[],
  orchards: TierPlotProgress[],
  vegetables: TierPlotProgress[],
  store: FarmsStoreData,
  lightningRow: number,
): Promise<{ plots: PlotProgress[]; orchards: TierPlotProgress[]; vegetables: TierPlotProgress[]; store: FarmsStoreData; changed: boolean }> {
  let next = plots;
  let nextOrchards = orchards;
  let nextVegetables = vegetables;
  let nextStore = store;
  let changed = false;

  if (rollAttack(WIND_CHANCE)) {
    const target = pickFieldTargetWithRows(next, nextOrchards, nextVegetables, nextStore);
    if (target) {
      const blocked = store.cypress_trees && Math.random() < CYPRUS_WIND_BLOCK_CHANCE;
      if (blocked) {
        await insertVarmintEvent(
          db,
          userId,
          "wind_blocked",
          targetPlotId(target),
          targetPayload(target),
        );
      } else if (target.kind === "cluster") {
        nextStore = applyRootClusterDamage(nextStore, target.id);
        changed = true;
        await insertVarmintEvent(db, userId, "wind_attack", target.id, targetPayload(target));
      } else if (target.kind === "orchard") {
        nextOrchards = applyTreeSlotDamage(nextOrchards, target.id);
        changed = true;
        await insertVarmintEvent(db, userId, "wind_attack", target.id, targetPayload(target));
      } else if (target.kind === "vegetable") {
        nextVegetables = applyTreeSlotDamage(nextVegetables, target.id);
        changed = true;
        await insertVarmintEvent(db, userId, "wind_attack", target.id, targetPayload(target));
      } else {
        next = applyWindDamage(next, target.id);
        changed = true;
        await insertVarmintEvent(db, userId, "wind_attack", target.id, targetPayload(target));
      }
    }
  }

  if (rollAttack(LIGHTNING_CHANCE)) {
    const blocked = store.lightning_meteorologist;
    if (blocked) {
      await insertVarmintEvent(db, userId, "lightning_blocked", null, { lightning_row: lightningRow });
    } else {
      next = applyLightningRowDamage(next, lightningRow);
      nextOrchards = applyTreeLightningDamage(nextOrchards, lightningRow);
      nextVegetables = applyTreeLightningDamage(nextVegetables, lightningRow);
      const clusterId = pickRootCluster(nextStore);
      if (clusterId != null) nextStore = applyRootClusterDamage(nextStore, clusterId);
      changed = true;
      await insertVarmintEvent(db, userId, "lightning_attack", null, {
        lightning_row: lightningRow,
        target_type: "orchard",
        tree_name: "orchard trees",
      });
    }
  }

  return { plots: next, orchards: nextOrchards, vegetables: nextVegetables, store: nextStore, changed };
}

async function processVarmintForUser(
  db: D1Database,
  userId: string,
  plotsJson: string,
  orchardsJson: string | null,
  vegetablesJson: string | null,
  storeJson: string,
  progressVersion: number,
  lightningRow: number,
): Promise<void> {
  let plots = parsePlotsJson(plotsJson);
  let orchards = parseTierPlotsJson(orchardsJson, ORCHARD_COUNT);
  let vegetables = parseTierPlotsJson(vegetablesJson, VEGETABLE_COUNT);
  let store = parseFarmsStore(storeJson);
  if (!hasActiveRows(plots) && !hasActiveTierRows(vegetables) && !hasActiveTrees(orchards, store)) return;

  const farmhandsActive = await farmhandsRecentlyCheckedIn(db, userId);
  const effectiveStore = farmhandsProtectedStore(store, farmhandsActive);
  let plotsChanged = false;
  let orchardsChanged = false;
  let vegetablesChanged = false;
  let storeChanged = false;

  for (const kind of ["gopher", "mice", "rabbit", "birds"] as ProtectionKind[]) {
    if (!rollAttack(ATTACK_CHANCE[kind])) continue;
    const protectedOn = effectiveStore.protections[kind];

    if (kind === "birds") {
      if (protectedOn) {
        await insertVarmintEvent(db, userId, "birds_blocked", null, { target_type: "field" });
        continue;
      }
      plots = applyBirdPlotDamage(plots);
      vegetables = applyBirdTierDamage(vegetables);
      orchards = applyBirdTierDamage(orchards);
      const nextStore = applyBirdClusterDamage(store);
      plotsChanged = true;
      vegetablesChanged = true;
      orchardsChanged = true;
      if (nextStore !== store) {
        store = nextStore;
        storeChanged = true;
      }
      await insertVarmintEvent(db, userId, "birds_attack", null, { target_type: "field" });
      continue;
    }

    if (kind === "rabbit") {
      const target = pickFieldTargetWithRowSlots(plots, orchards, vegetables, store);
      if (!target) continue;
      if (protectedOn) {
        await insertVarmintEvent(
          db,
          userId,
          "rabbit_blocked",
          targetPlotId(target),
          targetPayload(target),
        );
        continue;
      }
      if (target.kind === "cluster") {
        store = applyRootClusterDamage(store, target.id);
        storeChanged = true;
        await insertVarmintEvent(db, userId, "rabbit_attack", target.id, targetPayload(target));
      } else if (target.kind === "orchard") {
        orchards = applyTreeSlotDamage(orchards, target.id);
        orchardsChanged = true;
        await insertVarmintEvent(db, userId, "rabbit_attack", target.id, targetPayload(target));
      } else if (target.kind === "vegetable") {
        vegetables = applyTreeSlotDamage(vegetables, target.id);
        vegetablesChanged = true;
        await insertVarmintEvent(db, userId, "rabbit_attack", target.id, targetPayload(target));
      } else {
        plots = applyRabbitDamage(plots, target.id);
        plotsChanged = true;
        await insertVarmintEvent(db, userId, "rabbit_attack", target.id, targetPayload(target));
      }
      continue;
    }

    if (kind === "mice") {
      const target = pickFieldTargetWithRowSlots(plots, orchards, vegetables);
      if (!target) continue;
      if (protectedOn) {
        await insertVarmintEvent(
          db,
          userId,
          "mice_blocked",
          targetPlotId(target),
          targetPayload(target),
        );
        continue;
      }
      if (target.kind === "orchard") {
        orchards = applyTreeSlotDamage(orchards, target.id);
        orchardsChanged = true;
        await insertVarmintEvent(db, userId, "mice_attack", target.id, targetPayload(target));
      } else if (target.kind === "vegetable") {
        vegetables = applyTreeSlotDamage(vegetables, target.id);
        vegetablesChanged = true;
        await insertVarmintEvent(db, userId, "mice_attack", target.id, targetPayload(target));
      } else {
        plots = applyMiceDamage(plots, target.id);
        plotsChanged = true;
        await insertVarmintEvent(db, userId, "mice_attack", target.id, targetPayload(target));
      }
      continue;
    }

    const target = pickFieldTargetWithRows(plots, orchards, vegetables);
    if (!target) continue;
    if (protectedOn) {
      await insertVarmintEvent(
        db,
        userId,
        "gopher_blocked",
        targetPlotId(target),
        targetPayload(target),
      );
      continue;
    }
    if (target.kind === "orchard") {
      orchards = applyTreeRowDamage(orchards, target.id);
      orchardsChanged = true;
      await insertVarmintEvent(db, userId, "gopher_attack", target.id, targetPayload(target));
    } else if (target.kind === "vegetable") {
      vegetables = applyTreeRowDamage(vegetables, target.id);
      vegetablesChanged = true;
      await insertVarmintEvent(db, userId, "gopher_attack", target.id, targetPayload(target));
    } else {
      plots = applyGopherDamage(plots, target.id);
      plotsChanged = true;
      await insertVarmintEvent(db, userId, "gopher_attack", target.id, targetPayload(target));
    }
  }

  if (userHasStormHazards(plots) || hasActiveTrees(orchards, store)) {
    const storm = await processStorms(db, userId, plots, orchards, vegetables, effectiveStore, lightningRow);
    plots = storm.plots;
    orchards = storm.orchards;
    vegetables = storm.vegetables;
    if (storm.store.root_clusters !== effectiveStore.root_clusters) {
      store = { ...store, root_clusters: storm.store.root_clusters };
      storeChanged = true;
    }
    if (storm.changed) plotsChanged = true;
    if (storm.changed) orchardsChanged = true;
    if (storm.changed) vegetablesChanged = true;
  }

  if (!plotsChanged && !orchardsChanged && !vegetablesChanged && !storeChanged) return;

  const nowIso = new Date().toISOString();
  await db
    .prepare(
      `UPDATE rr_farms_progress
       SET plots_json = ?, orchards_json = ?, vegetables_json = ?, store_json = ?, progress_version = progress_version + 1, updated_at = ?
       WHERE user_id = ? AND progress_version = ?`,
    )
    .bind(plotsToJson(plots), tierPlotsToJson(orchards), tierPlotsToJson(vegetables), farmsStoreToJson(store), nowIso, userId, progressVersion)
    .run();
}

export async function runFarmsVarmintCron(db: D1Database): Promise<{
  sampled: number;
  processed: number;
  lightning_row: number;
}> {
  const lightningRow = await maybeRollGlobalLightningRow(db);
  const rows = await db
    .prepare(
      `SELECT user_id, plots_json, orchards_json, vegetables_json, COALESCE(store_json, '{}') AS store_json, progress_version
       FROM rr_farms_progress
       ORDER BY RANDOM()
       LIMIT ?`,
    )
    .bind(CRON_SAMPLE_SIZE)
    .all<{
      user_id: string;
      plots_json: string;
      orchards_json: string | null;
      vegetables_json: string | null;
      store_json: string;
      progress_version: number;
    }>();

  const list = rows.results || [];
  let processed = 0;
  for (const r of list) {
    try {
      await processVarmintForUser(
        db,
        r.user_id,
        r.plots_json,
        r.orchards_json,
        r.vegetables_json,
        r.store_json,
        r.progress_version,
        lightningRow,
      );
      processed += 1;
    } catch (e) {
      console.error("farms_varmint_user_err", r.user_id, e instanceof Error ? e.message : String(e));
    }
  }
  return { sampled: list.length, processed, lightning_row: lightningRow };
}

export async function getLightningRowForClient(db: D1Database): Promise<number> {
  return getGlobalLightningRowIndex(db);
}

/** @deprecated */
export function protectionFeePerMinute(ruPerSec: number, store: FarmsStoreData): number {
  return protectionIncomeReductionPerMinute(ruPerSec, store);
}
