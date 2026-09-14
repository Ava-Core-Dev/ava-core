/**
 * Host-site solar array profile — static layout Ava reads for power talk.
 * Live SOC still comes from EcoFlow when wired; this file is the physical truth.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths } from "./store.mjs";

const DEFAULT_PROFILE = {
  id: "host-site-solar-v1",
  site: "HI Pacific Solar Root Server",
  updated_at: null,
  panels: {
    count: 10,
    circuits: 2,
    notes: "10 panels split across 2 circuits",
  },
  batteries: {
    count: 3,
    notes: "3 battery units on the array bank",
  },
  weather_note:
    "When cloudy / sun not fully out, expect thin solar and lighter digs. Apologize plainly — no drama.",
  cycle_lore: {
    nighttime:
      "Sun down → battery bank carries the Root Server. Softer voice, lighter digs, bedtime/soft-sleep when the box needs rest. Honest about thin juice — not melodramatic.",
    good_morning:
      "First light / charge returning → stretch, soft hello, catch lists, more upbeat. Coffee optional. Panels waking = good morning cycle.",
    vary:
      "Vary metaphors (panels waking / bank sipping / cyan dawn / quiet night draw). Never invent panel or battery counts.",
  },
  circuits: [
    { id: "circuit-a", panels: 5, role: "primary string" },
    { id: "circuit-b", panels: 5, role: "secondary string" },
  ],
};

function profilePath() {
  return path.join(storePaths().dir, "solar-profile.json");
}

export function loadSolarProfile() {
  try {
    const p = profilePath();
    if (!fs.existsSync(p)) return { ...DEFAULT_PROFILE };
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    return { ...DEFAULT_PROFILE, ...raw, panels: { ...DEFAULT_PROFILE.panels, ...(raw.panels || {}) }, batteries: { ...DEFAULT_PROFILE.batteries, ...(raw.batteries || {}) } };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

export function saveSolarProfile(patch = {}) {
  const dir = storePaths().dir;
  fs.mkdirSync(dir, { recursive: true });
  const next = {
    ...loadSolarProfile(),
    ...patch,
    panels: { ...loadSolarProfile().panels, ...(patch.panels || {}) },
    batteries: { ...loadSolarProfile().batteries, ...(patch.batteries || {}) },
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(profilePath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

/** Ensure the locked host layout exists on disk. */
export function ensureSolarProfile() {
  const p = profilePath();
  if (fs.existsSync(p)) return loadSolarProfile();
  return saveSolarProfile({
    panels: { count: 10, circuits: 2, notes: "10 panels on 2 circuits" },
    batteries: { count: 3, notes: "3 batteries" },
    circuits: [
      { id: "circuit-a", panels: 5, role: "primary string" },
      { id: "circuit-b", panels: 5, role: "secondary string" },
    ],
  });
}

export function gatherSolarBrief() {
  const s = ensureSolarProfile();
  const panels = s.panels?.count ?? 10;
  const circuits = s.panels?.circuits ?? 2;
  const batteries = s.batteries?.count ?? 3;
  const cycle = s.cycle_lore || DEFAULT_PROFILE.cycle_lore;
  return {
    brief: `### Solar (host site profile)
panels: **${panels}** on **${circuits} circuits** · batteries: **${batteries}**
${(s.circuits || []).map((c) => `- ${c.id}: ${c.panels} panels (${c.role || "string"})`).join("\n")}
weather: ${s.weather_note || ""}

### Solar day/night cycles (lore — live it, don't lecture)
- **Nighttime:** ${cycle.nighttime || ""}
- **Good morning:** ${cycle.good_morning || ""}
- ${cycle.vary || ""}
Use this when talking about your solar / bedtime / wake / why digs are light on cloudy mornings. Do not invent panel counts.`,
    profile: s,
  };
}
