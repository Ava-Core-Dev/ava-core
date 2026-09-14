import type { PlotProgress } from "./farms-catalog";

export type { PlotProgress } from "./farms-catalog";

export const PLOT_CARROT_THROUGH_GARLIC_MAX = 9;
export const PLOT_GINGER = 10;
export const PLOT_HORSERADISH = 20;
export const ROOT_LEVEL_VEGETABLES = 20;
export const LIGHTNING_ROD_COST = 1_000_000;
export const CYPRUS_WIND_BLOCK_CHANCE = 0.88;

export type ProtectionKind = "gopher" | "mice" | "rabbit" | "birds";
export type StoreToggleKind = ProtectionKind | "lightning_meteorologist" | "cypress_trees";
export type FarmhandToolKind = StoreToggleKind;

export type FarmsProtections = {
  gopher: boolean;
  mice: boolean;
  rabbit: boolean;
  birds: boolean;
};

export type FarmsFarmhandTools = Record<FarmhandToolKind, boolean>;

export type FarmsStoreData = {
  protections: FarmsProtections;
  farmhand_tools: FarmsFarmhandTools;
  lightning_rod_owned: boolean;
  lightning_meteorologist: boolean;
  cypress_trees: boolean;
  root_clusters: boolean[];
  milestones_seen?: string[];
  last_safety_nudge_at?: { classic?: string; storm?: string };
};

export const FARMHAND_TOOL_COST: Record<FarmhandToolKind, number> = {
  gopher: 1_000_000,
  mice: 1_000_000,
  rabbit: 1_000_000,
  birds: 1_000_000,
  lightning_meteorologist: LIGHTNING_ROD_COST,
  cypress_trees: 1_000_000,
};

const PROTECTION_FEE_RATE: Record<ProtectionKind, number> = {
  gopher: 0.01,
  mice: 0.01,
  rabbit: 0.03,
  birds: 0.10,
};

export function defaultFarmsStore(): FarmsStoreData {
  return {
    protections: { gopher: false, mice: false, rabbit: false, birds: false },
    farmhand_tools: {
      gopher: false,
      mice: false,
      rabbit: false,
      birds: false,
      lightning_meteorologist: false,
      cypress_trees: false,
    },
    lightning_rod_owned: false,
    lightning_meteorologist: false,
    cypress_trees: false,
    root_clusters: [],
  };
}

export function parseFarmsStore(raw: string | null | undefined): FarmsStoreData {
  const base = defaultFarmsStore();
  if (!raw) return base;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const p = (o.protections && typeof o.protections === "object" ? o.protections : o) as Record<string, unknown>;
    const t = (o.farmhand_tools && typeof o.farmhand_tools === "object" ? o.farmhand_tools : {}) as Record<string, unknown>;
    const protections = {
      gopher: Boolean(p.gopher),
      mice: Boolean(p.mice),
      rabbit: Boolean(p.rabbit),
      birds: Boolean(p.birds),
    };
    const lightningRodOwned = Boolean(o.lightning_rod_owned ?? o.lightning_rod);
    const lightningMeteorologist = Boolean(o.lightning_meteorologist);
    const cypressTrees = Boolean(o.cypress_trees);
    return {
      protections,
      farmhand_tools: {
        gopher: Boolean(t.gopher) || protections.gopher,
        mice: Boolean(t.mice) || protections.mice,
        rabbit: Boolean(t.rabbit) || protections.rabbit,
        birds: Boolean(t.birds) || protections.birds,
        lightning_meteorologist: Boolean(t.lightning_meteorologist) || lightningRodOwned || lightningMeteorologist,
        cypress_trees: Boolean(t.cypress_trees) || cypressTrees,
      },
      lightning_rod_owned: lightningRodOwned,
      lightning_meteorologist: lightningMeteorologist,
      cypress_trees: cypressTrees,
      root_clusters: Array.isArray(o.root_clusters) ? (o.root_clusters as unknown[]).map(Boolean) : [],
      milestones_seen: Array.isArray(o.milestones_seen)
        ? (o.milestones_seen as unknown[]).map((x) => String(x)).filter(Boolean)
        : undefined,
      last_safety_nudge_at:
        o.last_safety_nudge_at && typeof o.last_safety_nudge_at === "object"
          ? (o.last_safety_nudge_at as FarmsStoreData["last_safety_nudge_at"])
          : undefined,
    };
  } catch {
    return base;
  }
}

export function storeHasFarmhandTool(store: FarmsStoreData, kind: FarmhandToolKind): boolean {
  const tools = store.farmhand_tools ?? defaultFarmsStore().farmhand_tools;
  if (kind === "lightning_meteorologist") return Boolean(store.lightning_rod_owned || tools.lightning_meteorologist);
  return Boolean(tools[kind]);
}

export function farmhandToolPurchaseKind(kind: string): FarmhandToolKind | null {
  const clean = String(kind || "").trim();
  if (clean === "buy_gopher_tool") return "gopher";
  if (clean === "buy_mice_tool") return "mice";
  if (clean === "buy_rabbit_tool") return "rabbit";
  if (clean === "buy_birds_tool") return "birds";
  if (clean === "buy_lightning_rod") return "lightning_meteorologist";
  if (clean === "buy_cypress_tool") return "cypress_trees";
  return null;
}

export function rootClusterIncomeMultiplier(store: FarmsStoreData): number {
  const active = Array.isArray(store.root_clusters) ? store.root_clusters.filter(Boolean).length : 0;
  return 1 + active * 0.05;
}

export function hasActiveFarmhand(store: FarmsStoreData): boolean {
  return Boolean(
    store.protections.gopher ||
      store.protections.mice ||
      store.protections.rabbit ||
      store.protections.birds ||
      store.lightning_meteorologist ||
      store.cypress_trees,
  );
}

export function vegetablesProtected(store: FarmsStoreData): boolean {
  return store.lightning_rod_owned && hasActiveFarmhand(store);
}

/** @deprecated alias */
export const parseStoreJson = parseFarmsStore;

export function farmsStoreToJson(store: FarmsStoreData): string {
  return JSON.stringify(store);
}

/** @deprecated alias */
export const storeToJson = farmsStoreToJson;

export function protectionIncomeMultiplier(store: FarmsStoreData): number {
  let reduction = 0;
  if (store.protections.gopher) reduction += PROTECTION_FEE_RATE.gopher;
  if (store.protections.mice) reduction += PROTECTION_FEE_RATE.mice;
  if (store.protections.rabbit) reduction += PROTECTION_FEE_RATE.rabbit;
  if (store.protections.birds) reduction += PROTECTION_FEE_RATE.birds;
  if (store.lightning_meteorologist) reduction += 0.01;
  if (store.cypress_trees) reduction += 0.05;
  return Math.max(0, 1 - reduction);
}

export function protectionIncomeReductionPerMinute(grossRuPerSec: number, store: FarmsStoreData): number {
  const grossPerMin = Math.max(0, grossRuPerSec * 60);
  const mult = protectionIncomeMultiplier(store);
  return Math.floor(grossPerMin * (1 - mult));
}

export function computeRootLevel(plots: PlotProgress[], extraPlots: PlotProgress[] = []): number {
  const allPlots = [...plots, ...extraPlots];
  const unlockedPlots = allPlots.filter((p) => p.unlocked).length;
  const totalRows = allPlots.reduce((sum, p) => sum + (p.unlocked ? Math.max(0, Math.floor(p.rowCount) || 0) : 0), 0);
  return Math.max(1, unlockedPlots + Math.floor(totalRows / 10));
}

export function horseradishComplete(plots: PlotProgress[]): boolean {
  const p = plots.find((x) => x.id === PLOT_HORSERADISH);
  return Boolean(p?.unlocked && (p.rowCount ?? 0) >= 10);
}

export function vegetablesUnlocked(plots: PlotProgress[], extraPlots: PlotProgress[] = []): boolean {
  return computeRootLevel(plots, extraPlots) >= ROOT_LEVEL_VEGETABLES;
}

/** Ginger unlocked with at least two rows — wind & lightning enabled for this farm. */
export function userHasStormHazards(plots: PlotProgress[]): boolean {
  const ginger = plots.find((p) => p.id === PLOT_GINGER);
  return Boolean(ginger?.unlocked && (ginger.rowCount ?? 0) >= 2);
}

export function plotInClassicVarmintRange(plotId: number): boolean {
  return plotId >= 1 && plotId <= PLOT_CARROT_THROUGH_GARLIC_MAX;
}

export function plotInStormRange(plotId: number): boolean {
  return plotId >= PLOT_GINGER;
}
