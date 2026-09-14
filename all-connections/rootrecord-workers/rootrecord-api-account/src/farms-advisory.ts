import type { D1Database } from "@cloudflare/workers-types";
import type { PlotProgress } from "./farms-catalog";
import type { TierPlotProgress } from "./farms-orchards";
import { insertVarmintEvent } from "./farms-varmint";
import {
  horseradishComplete,
  parseFarmsStore,
  type FarmsStoreData,
  userHasStormHazards,
  vegetablesUnlocked,
  farmsStoreToJson,
  PLOT_GINGER,
  PLOT_HORSERADISH,
  ROOT_LEVEL_VEGETABLES,
} from "./farms-store";

const SAFETY_NUDGE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

type SafetyNudgeAt = { classic?: string; storm?: string };

function parseSafetyNudge(raw: FarmsStoreData): SafetyNudgeAt {
  const n = raw.last_safety_nudge_at;
  if (!n || typeof n !== "object") return {};
  const o = n as SafetyNudgeAt;
  return { classic: o.classic, storm: o.storm };
}

function canNudgeCategory(nudge: SafetyNudgeAt, key: "classic" | "storm"): boolean {
  const at = nudge[key];
  if (!at) return true;
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) return true;
  return Date.now() - ms >= SAFETY_NUDGE_COOLDOWN_MS;
}

function hasClassicExposure(plots: PlotProgress[]): boolean {
  return plots.some((p) => p.unlocked && p.rowsActive > 0);
}

function classicSafetiesOff(store: FarmsStoreData): string[] {
  const missing: string[] = [];
  if (!store.protections.gopher) missing.push("gopher protection");
  if (!store.protections.mice) missing.push("field mice protection");
  if (!store.protections.rabbit) missing.push("rabbit protection");
  if (!store.protections.birds) missing.push("Uncle for birds");
  return missing;
}

function stormSafetiesOff(store: FarmsStoreData): string[] {
  const missing: string[] = [];
  if (!store.lightning_meteorologist) {
    missing.push("lightning meteorologist with a lightning rod");
  }
  if (!store.cypress_trees) missing.push("cypress windbreak");
  return missing;
}

async function pushAdvisory(
  db: D1Database,
  userId: string,
  kind: string,
  message: string,
): Promise<void> {
  await insertVarmintEvent(db, userId, kind as never, null, { message });
}

/** Milestone + safety popups (stored as pending varmint events for the client modal). */
export async function syncFarmAdvisories(
  db: D1Database,
  userId: string,
  plots: PlotProgress[],
  storeJson: string,
): Promise<string> {
  const store = parseFarmsStore(storeJson);
  const seen = new Set(store.milestones_seen ?? []);
  const nudge = parseSafetyNudge(store);
  let nudgeChanged = false;

  const milestones: { key: string; kind: string; message: string }[] = [];

  if (userHasStormHazards(plots) && !seen.has("danger_storms")) {
    milestones.push({
      key: "danger_storms",
      kind: "advisory_milestone_storms",
      message:
        "Wind and lightning are now active and can sweep across your unlocked field. Visit Farmhands for cypress windbreak, a lightning rod, or a meteorologist.",
    });
  }
  if (horseradishComplete(plots) && !seen.has("tier_orchards")) {
    milestones.push({
      key: "tier_orchards",
      kind: "advisory_milestone_orchards",
      message: "Horseradish is complete — you can formulate orchards from the Orchards tab. Harvests are slow but high value.",
    });
  }
  if (vegetablesUnlocked(plots) && !seen.has("tier_vegetables")) {
    milestones.push({
      key: "tier_vegetables",
      kind: "advisory_milestone_vegetables",
      message: `Farm level ${ROOT_LEVEL_VEGETABLES} reached — vegetable plots are unlocked on the Vegetables tab.`,
    });
  }

  const ginger = plots.find((p) => p.id === PLOT_GINGER);
  if (ginger?.unlocked && !seen.has(`root_unlock_${PLOT_GINGER}`)) {
    milestones.push({
      key: `root_unlock_${PLOT_GINGER}`,
      kind: "advisory_root_unlock",
      message: "Ginger plot unlocked — your field can face wind and lightning once you have 2+ rows.",
    });
  }
  const horseradish = plots.find((p) => p.id === PLOT_HORSERADISH);
  if (horseradish?.unlocked && !seen.has(`root_unlock_${PLOT_HORSERADISH}`)) {
    milestones.push({
      key: `root_unlock_${PLOT_HORSERADISH}`,
      kind: "advisory_root_unlock",
      message: "Horseradish unlocked — finish 10 rows here to open the orchard tier.",
    });
  }
  for (const m of milestones) {
    await pushAdvisory(db, userId, m.kind, m.message);
    seen.add(m.key);
  }

  if (hasClassicExposure(plots)) {
    const missing = classicSafetiesOff(store);
    if (missing.length > 0 && canNudgeCategory(nudge, "classic")) {
      await pushAdvisory(
        db,
        userId,
        "advisory_safety_classic",
        `Your unlocked field is exposed. Buy the needed tool, then turn on ${missing.join(", ")} under Farmhands (−1–10% income each).`,
      );
      nudge.classic = new Date().toISOString();
      nudgeChanged = true;
    }
  }

  if (userHasStormHazards(plots)) {
    const missing = stormSafetiesOff(store);
    if (missing.length > 0 && canNudgeCategory(nudge, "storm")) {
      await pushAdvisory(
        db,
        userId,
        "advisory_safety_storm",
        `Storm hazards are active. Consider buying the needed tool and turning on ${missing.join(" and ")} on the Farmhands tab.`,
      );
      nudge.storm = new Date().toISOString();
      nudgeChanged = true;
    }
  }

  const next: FarmsStoreData = {
    ...store,
    milestones_seen: [...seen],
    ...(nudgeChanged || milestones.length ? { last_safety_nudge_at: nudge } : {}),
  };
  return farmsStoreToJson(next);
}
