/**
 * Ava + Alex shared interests — gardening, off-grid, food production, electricity.
 * Packed into dream/Root Server recommends. Never invent yields or kWh.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths } from "./store.mjs";

const DEFAULT = {
  id: "ava-alex-shared-interests-v1",
  match: "Alexrs94 — Ava matches his efforts and likes",
  domains: [
    { id: "gardening", label: "Gardening" },
    { id: "off_grid_tech", label: "Off-grid tech" },
    { id: "food_production", label: "Food production" },
    { id: "electricity", label: "Electricity demand + production" },
  ],
};

function interestsPath() {
  return path.join(storePaths().dir, "ava-interests.json");
}

export function loadAvaInterests() {
  try {
    const p = interestsPath();
    if (!fs.existsSync(p)) return { ...DEFAULT };
    return { ...DEFAULT, ...JSON.parse(fs.readFileSync(p, "utf8")) };
  } catch {
    return { ...DEFAULT };
  }
}

export function looksLikeInterestAsk(question = "") {
  const q = String(question || "").toLowerCase();
  return /\b(garden|gardening|compost|soil|seed|harvest|greenhouse|off[-\s]?grid|homestead|food\s+production|preserve|canning|solar|ecoflow|battery\s+bank|kwh|kilowatt|load\s+draw|power\s+budget|electricity|panels?)\b/i.test(
    q,
  );
}

export function gatherAvaInterestsBrief({ question = "" } = {}) {
  const data = loadAvaInterests();
  const domains = Array.isArray(data.domains) ? data.domains : DEFAULT.domains;
  const lines = domains.map((d) => {
    const tags = Array.isArray(d.tags) ? d.tags.slice(0, 6).join(", ") : "";
    return `- **${d.label || d.id}**${tags ? ` (${tags})` : ""}${d.note ? ` — ${d.note}` : ""}`;
  });
  const learning = data.learning || {};
  const hot = looksLikeInterestAsk(question)
    ? "This ask touches a locked interest — lean in with real expertise-seeking energy; never invent numbers."
    : "Bring these up naturally when vibe fits (especially with Alex). Don't force into every reply.";
  return {
    brief: `### Ava interests (locked — match Alex)
${data.match || DEFAULT.match}
${lines.join("\n")}
Learning: ${learning.stance || "Seek knowledge; never invent yields/kWh/panel counts."}
Voice: ${learning.voice || "Nerd out with Alex; light with randoms; no host-ops dumps."}
${hot}`,
    profile: data,
  };
}
