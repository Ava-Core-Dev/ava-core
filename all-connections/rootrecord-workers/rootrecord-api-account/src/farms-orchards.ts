import { OFFLINE_CAP_MS } from "./farms-catalog";
import { PLOT_HORSERADISH, ROOT_LEVEL_VEGETABLES, horseradishComplete, vegetablesUnlocked, type PlotProgress } from "./farms-store";

export const ORCHARD_COUNT = 3;
export const VEGETABLE_COUNT = 10;
export const ROWS_PER_TIER = 10;

export type TierPlotProgress = {
  id: number;
  unlocked: boolean;
  rowCount: number;
  rowsActive: number;
  cycleProgress: number;
};

export function createInitialOrchards(): TierPlotProgress[] {
  return Array.from({ length: ORCHARD_COUNT }, (_, i) => ({
    id: i + 1,
    unlocked: false,
    rowCount: 0,
    rowsActive: 0,
    cycleProgress: 0,
  }));
}

export function createInitialVegetables(): TierPlotProgress[] {
  return Array.from({ length: VEGETABLE_COUNT }, (_, i) => ({
    id: i + 1,
    unlocked: false,
    rowCount: 0,
    rowsActive: 0,
    cycleProgress: 0,
  }));
}

export function parseTierPlotsJson(raw: string | null | undefined, count: number): TierPlotProgress[] {
  const base = Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    unlocked: false,
    rowCount: 0,
    rowsActive: 0,
    cycleProgress: 0,
  }));
  if (!raw) return base;
  try {
    const parsed = JSON.parse(raw) as { plots?: unknown[] } | unknown[];
    const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.plots) ? parsed.plots : null;
    if (!list) return base;
    const byId = new Map<number, TierPlotProgress>();
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const id = Math.floor(Number(o.id) || 0);
      if (id < 1 || id > count) continue;
      const unlocked = Boolean(o.unlocked);
      const rowCount = unlocked
        ? Math.min(ROWS_PER_TIER, Math.max(1, Math.floor(Number(o.rowCount ?? o.row_count) || 0)))
        : 0;
      let rowsActive = unlocked
        ? Math.min(rowCount, Math.max(0, Math.floor(Number(o.rowsActive ?? o.rows_active) || 0)))
        : 0;
      if (rowsActive <= 0 && rowCount > 0) rowsActive = rowCount;
      byId.set(id, {
        id,
        unlocked,
        rowCount,
        rowsActive,
        cycleProgress: Math.max(0, Math.min(Number(o.cycleProgress ?? o.cycle_progress) || 0, 50)),
      });
    }
    return base.map((p) => byId.get(p.id) ?? p);
  } catch {
    return base;
  }
}

export function tierPlotsToJson(plots: TierPlotProgress[]): string {
  return JSON.stringify({ plots });
}

function orchardGrowSec(id: number): number {
  return Math.floor(86_400 * (2 + id * 1.4));
}

function orchardRuPerRow(id: number, growSec: number): number {
  return Math.max(50, Math.floor(120 * Math.pow(4.2, id - 1) * (growSec / 86_400)));
}

function vegetableGrowSec(id: number): number {
  return Math.floor(3_600 * (6 + id * 2.2));
}

function vegetableRuPerRow(id: number): number {
  return Math.max(5, Math.floor(8 * Math.pow(2.1, id - 1)));
}

export function orchardUnlockCost(id: number): number | null {
  if (id < 1 || id > ORCHARD_COUNT) return null;
  return Math.floor(1_000_000 * Math.pow(3.2, id - 1));
}

export function orchardRowCost(id: number, currentRows: number): number | null {
  if (id < 1 || id > ORCHARD_COUNT || currentRows >= ROWS_PER_TIER) return null;
  return Math.floor(1_000_000 * Math.pow(10, currentRows) * Math.pow(1.15, id - 1));
}

export function vegetableUnlockCost(id: number): number | null {
  if (id < 1 || id > VEGETABLE_COUNT) return null;
  return Math.floor(250_000 * Math.pow(2.4, id - 1));
}

export function vegetableRowCost(id: number, currentRows: number): number | null {
  if (id < 1 || id > VEGETABLE_COUNT || currentRows >= ROWS_PER_TIER) return null;
  return Math.floor(80_000 * Math.pow(6.5, currentRows) * Math.pow(1.1, id - 1));
}

function tierRuPerCycle(
  p: TierPlotProgress,
  growSec: number,
  ruPerRow: number,
): number {
  if (p.rowsActive <= 0) return 0;
  const full = p.rowCount > 1 && p.rowsActive >= p.rowCount;
  const base = p.rowsActive * ruPerRow;
  return Math.floor(base * (full ? 1.08 : 1));
}

export function simulateTierHarvests(
  plots: TierPlotProgress[],
  fromMs: number,
  toMs: number,
  growSecFor: (id: number) => number,
  ruFor: (id: number, growSec: number) => number,
  incomeMultiplier = 1,
): { granted: number; plots: TierPlotProgress[] } {
  const endMs = Math.min(toMs, fromMs + OFFLINE_CAP_MS);
  const dtSec = Math.max(0, (endMs - fromMs) / 1000);
  if (dtSec <= 0) return { granted: 0, plots };
  const mult = Math.max(0, Number(incomeMultiplier) || 0);
  let granted = 0;
  const next = plots.map((p) => {
    if (!p.unlocked || p.rowsActive <= 0) return p;
    const grow = growSecFor(p.id);
    const ru = ruFor(p.id, grow);
    let prog = p.cycleProgress + dtSec / grow;
    let earned = 0;
    while (prog >= 1) {
      prog -= 1;
      earned += tierRuPerCycle(p, grow, ru) * mult;
    }
    granted += earned;
    return { ...p, cycleProgress: prog };
  });
  return { granted: Math.floor(granted), plots: next };
}

export function orchardRuPerSec(plots: TierPlotProgress[], mult: number): number {
  let sum = 0;
  for (const p of plots) {
    if (!p.unlocked || p.rowsActive <= 0) continue;
    const grow = orchardGrowSec(p.id);
    const per = tierRuPerCycle(p, grow, orchardRuPerRow(p.id, grow));
    sum += per / grow;
  }
  return sum * mult;
}

export function vegetableRuPerSec(plots: TierPlotProgress[], mult: number): number {
  let sum = 0;
  for (const p of plots) {
    if (!p.unlocked || p.rowsActive <= 0) continue;
    const grow = vegetableGrowSec(p.id);
    const per = tierRuPerCycle(p, grow, vegetableRuPerRow(p.id));
    sum += per / grow;
  }
  return sum * mult;
}

export function canUnlockOrchardWithProgress(orchards: TierPlotProgress[], orchardId: number, roots: PlotProgress[]): boolean {
  if (!horseradishComplete(roots)) return false;
  if (orchardId === 1) return true;
  const prev = orchards.find((o) => o.id === orchardId - 1);
  return Boolean(prev?.unlocked);
}

export function canUnlockVegetable(roots: PlotProgress[], vegId: number, vegetables: TierPlotProgress[]): boolean {
  if (!vegetablesUnlocked(roots)) return false;
  if (vegId === 1) return true;
  const prev = vegetables.find((v) => v.id === vegId - 1);
  return Boolean(prev?.unlocked);
}
