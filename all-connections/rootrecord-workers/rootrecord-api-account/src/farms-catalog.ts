/** Mirrors Web/apps/root-farms-web/src/game/catalog.ts — keep CATALOG_HASH in sync. */
export const PLOT_COUNT = 65;
export const OFFLINE_CAP_MS = 8 * 60 * 60 * 1000;
export const FULL_FIELD_BONUS = 1.1;
export const ROWS_PER_PLOT = 10;
export const FIRST_PLOT_ATOMIC_PER_SEC = 1;
export const ROOTS_DAILY_PRODUCTION_CAP_ATOMIC = 100_000_000;
export const CATALOG_HASH = "root-farms-v11";
export const FARMS_APP_ID = "root_farms";
export const ROOT_CLUSTER_COUNT = 6;
export const ROOT_CLUSTER_SIZE = 10;
export const ROOT_CLUSTER_BONUS = 0.05;
export const ROOT_CLUSTER_COSTS_ATOMIC = [1_000_000, 5_000_000, 10_000_000, 15_000_000, 20_000_000, 25_000_000] as const;
/** Max Root Units credited via farms settle per UTC day: 1.0 ROOTS token at 8 decimals. */
export const FARMS_DAILY_CAP = ROOTS_DAILY_PRODUCTION_CAP_ATOMIC;

export type PlotProgress = {
  id: number;
  unlocked: boolean;
  rowCount: number;
  rowsActive: number;
  cycleProgress: number;
};

type PlotCatalogEntry = {
  id: number;
  maxRows: number;
  growTimeSec: number;
  baseRuPerRow: number;
  unlockLifetime: number;
};

const GROW_TIME_MIN_SEC = 1;
const GROW_TIME_MAX_SEC = 86_400;

function growTimeSecForLevel(id: number): number {
  if (id <= 1) return GROW_TIME_MIN_SEC;
  if (id >= PLOT_COUNT) return GROW_TIME_MAX_SEC;
  const exp = (id - 1) / (PLOT_COUNT - 1);
  const t = GROW_TIME_MIN_SEC * Math.pow(GROW_TIME_MAX_SEC / GROW_TIME_MIN_SEC, exp);
  return Math.round(t * 100) / 100;
}

function baseRuPerRowForLevel(id: number, growTimeSec: number): number {
  const ruPerSec = FIRST_PLOT_ATOMIC_PER_SEC * Math.pow(1.018, id - 1);
  return Math.max(1, Math.floor(ruPerSec * growTimeSec));
}

function buildPlot(id: number): PlotCatalogEntry {
  const i = id - 1;
  const maxRows = ROWS_PER_PLOT;
  const growTimeSec = growTimeSecForLevel(id);
  const baseRuPerRow = baseRuPerRowForLevel(id, growTimeSec);
  const unlockLifetime = 0;
  return { id, maxRows, growTimeSec, baseRuPerRow, unlockLifetime };
}

const PLOTS: PlotCatalogEntry[] = Array.from({ length: PLOT_COUNT }, (_, k) => buildPlot(k + 1));

export function getPlotCatalog(id: number): PlotCatalogEntry {
  return PLOTS[id - 1] ?? PLOTS[0];
}

export function plotUnlockCost(plotId: number): number {
  if (plotId <= 1) return 0;
  const tier = plotId - 1;
  return Math.floor(800 * Math.pow(1.72, tier - 1));
}

export function rootClusterRange(clusterId: number): { start: number; end: number } {
  const id = Math.min(ROOT_CLUSTER_COUNT, Math.max(1, Math.floor(clusterId) || 1));
  const start = (id - 1) * ROOT_CLUSTER_SIZE + 1;
  return { start, end: Math.min(PLOT_COUNT, start + ROOT_CLUSTER_SIZE - 1) };
}

export function rootClusterCost(clusterId: number): number | null {
  if (clusterId < 1 || clusterId > ROOT_CLUSTER_COUNT) return null;
  return ROOT_CLUSTER_COSTS_ATOMIC[clusterId - 1] ?? null;
}

export function rootClusterCompleted(plots: PlotProgress[], clusterId: number): boolean {
  const range = rootClusterRange(clusterId);
  for (let id = range.start; id <= range.end; id++) {
    const plot = plots.find((p) => p.id === id);
    const cat = getPlotCatalog(id);
    if (!plot?.unlocked || plot.rowCount < cat.maxRows) return false;
  }
  return true;
}

export function rowSlotCost(plotId: number, currentRows: number): number {
  const tier = plotId - 1;
  return Math.floor(90 * Math.pow(1.58, currentRows) * Math.pow(1.28, tier));
}

export function plotRuPerCycle(rowsActive: number, rowCount: number, cat: PlotCatalogEntry): number {
  if (rowsActive <= 0) return 0;
  const base = rowsActive * cat.baseRuPerRow;
  const full = rowCount > 1 && rowsActive >= rowCount;
  const bonus = full ? FULL_FIELD_BONUS : 1;
  return Math.floor(base * bonus);
}

export function createInitialPlots(): PlotProgress[] {
  return Array.from({ length: PLOT_COUNT }, (_, i) => {
    const id = i + 1;
    if (id === 1) {
      return { id, unlocked: true, rowCount: 1, rowsActive: 1, cycleProgress: 0 };
    }
    return { id, unlocked: false, rowCount: 0, rowsActive: 0, cycleProgress: 0 };
  });
}

function normalizePlotProgress(input: Partial<PlotProgress>, fallback: PlotProgress): PlotProgress {
  const id = Math.min(PLOT_COUNT, Math.max(1, Math.floor(Number(input.id ?? fallback.id) || fallback.id)));
  const cat = getPlotCatalog(id);
  const unlocked = Boolean(input.unlocked) || id === 1;
  if (!unlocked) return { id, unlocked: false, rowCount: 0, rowsActive: 0, cycleProgress: 0 };
  const minRows = id === 1 ? 1 : 0;
  const rowCount = Math.min(cat.maxRows, Math.max(minRows, Math.floor(Number(input.rowCount) || 0)));
  let rowsActive = Math.min(rowCount, Math.max(0, Math.floor(Number(input.rowsActive) || 0)));
  if (rowsActive <= 0 && rowCount > 0) rowsActive = rowCount;
  return {
    id,
    unlocked,
    rowCount,
    rowsActive,
    cycleProgress: Math.max(0, Math.min(Number(input.cycleProgress) || 0, 50)),
  };
}

export function simulateHarvests(
  plots: PlotProgress[],
  fromMs: number,
  toMs: number,
  incomeMultiplier = 1,
): { granted: number; plots: PlotProgress[] } {
  const endMs = Math.min(toMs, fromMs + OFFLINE_CAP_MS);
  const dtSec = Math.max(0, (endMs - fromMs) / 1000);
  if (dtSec <= 0) return { granted: 0, plots };

  const mult = Math.max(0, Number(incomeMultiplier) || 0);
  let granted = 0;
  const nextPlots = plots.map((p) => {
    if (!p.unlocked || p.rowsActive <= 0) return p;
    const cat = getPlotCatalog(p.id);
    let prog = p.cycleProgress + dtSec / cat.growTimeSec;
    let plotEarned = 0;
    const rows = p.rowsActive;
    while (prog >= 1) {
      prog -= 1;
      plotEarned += plotRuPerCycle(rows, p.rowCount, cat) * mult;
    }
    granted += plotEarned;
    return { ...p, cycleProgress: prog };
  });

  return { granted: Math.floor(granted), plots: nextPlots };
}

/** Unsettled earnings since last server settle (not yet credited to rr_earn_balance). */
export function pendingRuSince(
  plots: PlotProgress[],
  lastSettledMs: number,
  nowMs: number,
  incomeMultiplier = 1,
): number {
  const fromMs = Math.max(0, Math.floor(Number(lastSettledMs) || 0));
  return simulateHarvests(plots, fromMs, nowMs, incomeMultiplier).granted;
}

/**
 * Merge client cycle timers onto server-owned plot capacity (unlocks / rows).
 * Client cannot increase rowCount, rowsActive, or unlocks — only catch up cycleProgress within elapsed time.
 */
export function mergePlotsForSettle(
  serverPlots: PlotProgress[],
  clientPlots: PlotProgress[] | null,
  fromMs: number,
  toMs: number,
): PlotProgress[] {
  const clientById = new Map<number, PlotProgress>();
  if (clientPlots) {
    for (const p of clientPlots) clientById.set(p.id, p);
  }
  const elapsedMs = Math.max(0, Math.min(toMs - fromMs, OFFLINE_CAP_MS));
  const dtSec = elapsedMs / 1000;

  return serverPlots.map((server) => {
    if (!server.unlocked || server.rowsActive <= 0) {
      return { ...server, cycleProgress: 0 };
    }
    const client = clientById.get(server.id);
    const cat = getPlotCatalog(server.id);
    const maxProgGain = dtSec > 0 && cat.growTimeSec > 0 ? dtSec / cat.growTimeSec : 0;
    const ceiling = server.cycleProgress + maxProgGain + 0.05;
    let cycleProgress = server.cycleProgress;
    if (client) {
      const clientProg = Math.max(0, Number(client.cycleProgress) || 0);
      cycleProgress = Math.min(clientProg, ceiling);
    }
    return { ...server, cycleProgress: Math.max(0, Math.min(cycleProgress, 50)) };
  });
}

/** Client-submitted plot snapshot for settle (structural validation only). */
export function parseClientPlots(input: unknown): PlotProgress[] | null {
  if (!Array.isArray(input)) return null;
  const base = createInitialPlots();
  const byId = new Map<number, PlotProgress>();
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = Math.floor(Number(o.id) || 0);
    if (id < 1 || id > PLOT_COUNT) continue;
    const cat = getPlotCatalog(id);
    const unlocked = Boolean(o.unlocked) || id === 1;
    let rowCount = Math.max(0, Math.floor(Number(o.rowCount ?? o.row_count) || 0));
    let rowsActive = Math.max(0, Math.floor(Number(o.rowsActive ?? o.rows_active) || 0));
    let cycleProgress = Math.max(0, Number(o.cycleProgress ?? o.cycle_progress) || 0);
    if (!unlocked) {
      rowCount = 0;
      rowsActive = 0;
      cycleProgress = 0;
    } else {
      rowCount = Math.min(cat.maxRows, Math.max(id === 1 ? 1 : 0, rowCount));
      rowsActive = Math.min(rowCount, rowsActive);
      if (rowsActive <= 0 && rowCount > 0) rowsActive = rowCount;
      cycleProgress = Math.min(cycleProgress, 50);
    }
    byId.set(id, { id, unlocked, rowCount, rowsActive, cycleProgress });
  }
  const plots = base.map((p) => byId.get(p.id) ?? p);
  for (let id = 2; id <= PLOT_COUNT; id++) {
    const plot = plots.find((p) => p.id === id);
    const prev = plots.find((p) => p.id === id - 1);
    if (plot?.unlocked && !prev?.unlocked) return null;
  }
  return plots;
}

export function parsePlotsJson(raw: string | null | undefined): PlotProgress[] {
  const base = createInitialPlots();
  if (!raw) return base;
  try {
    const parsed = JSON.parse(raw) as { plots?: unknown[] };
    const list = Array.isArray(parsed?.plots) ? parsed.plots : Array.isArray(parsed) ? parsed : null;
    if (!list) return base;
    const byId = new Map<number, PlotProgress>();
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const id = Math.floor(Number(o.id) || 0);
      if (id < 1 || id > PLOT_COUNT) continue;
      byId.set(
        id,
        normalizePlotProgress(
          {
            id,
            unlocked: Boolean(o.unlocked),
            rowCount: Math.floor(Number(o.rowCount ?? o.row_count) || 0),
            rowsActive: Math.floor(Number(o.rowsActive ?? o.rows_active) || 0),
            cycleProgress: Number(o.cycleProgress ?? o.cycle_progress) || 0,
          },
          base[id - 1] ?? base[0],
        ),
      );
    }
    return base.map((p) => byId.get(p.id) ?? p);
  } catch {
    return base;
  }
}

export function plotsToJson(plots: PlotProgress[]): string {
  return JSON.stringify({ plots });
}

/** Root Units per second from active rows (matches client `totalRuPerSec`). */
export function totalRuPerSec(plots: PlotProgress[]): number {
  let sum = 0;
  for (const p of plots) {
    if (!p.unlocked || p.rowsActive <= 0) continue;
    const cat = getPlotCatalog(p.id);
    const per = plotRuPerCycle(p.rowsActive, p.rowCount, cat);
    sum += per / cat.growTimeSec;
  }
  return sum;
}

/** Unlocked plot count + total purchased row slots (sum of rowCount). */
export function summarizeFarmsPlots(plots: PlotProgress[]): {
  plots_unlocked: number;
  rows_accumulated: number;
  rows_active: number;
} {
  let plots_unlocked = 0;
  let rows_accumulated = 0;
  let rows_active = 0;
  for (const p of plots) {
    if (!p.unlocked) continue;
    plots_unlocked += 1;
    rows_accumulated += Math.max(0, Math.floor(p.rowCount) || 0);
    rows_active += Math.max(0, Math.floor(p.rowsActive) || 0);
  }
  return { plots_unlocked, rows_accumulated, rows_active };
}

export function summarizeFarmsPlotsJson(raw: string | null | undefined): ReturnType<typeof summarizeFarmsPlots> {
  return summarizeFarmsPlots(parsePlotsJson(raw));
}
