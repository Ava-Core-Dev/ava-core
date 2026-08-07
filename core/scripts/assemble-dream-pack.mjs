/**
 * Assemble dream-pack bundle for cloud fallback upload (no secrets).
 * Output: Server Handoffs/Ava Ivy/dream-pack/bundle/
 *
 *   node scripts/assemble-dream-pack.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../..");
const HANDOFF = path.join(ROOT, "Server Handoffs", "Ava Ivy");
const OUT = path.join(HANDOFF, "dream-pack", "bundle");

const FILES = [
  ["00-SYSTEM.md", path.join(HANDOFF, "dream-pack", "SYSTEM.md")],
  ["01-MANIFEST.md", path.join(HANDOFF, "dream-pack", "MANIFEST.md")],
  ["10-locked-spec.md", path.join(HANDOFF, "rootmc-lead-dev-bot-notes.md")],
  ["11-persona-snapshot.md", path.join(HANDOFF, "docs", "persona.md")],
  ["12-slack-copy.md", path.join(HANDOFF, "docs", "slack-app-copy.md")],
  ["13-people-alex.md", path.join(HANDOFF, "docs", "known-people-alexrs94.md")],
  ["14-people-zuppa.md", path.join(HANDOFF, "docs", "known-people-zuppafredda.md")],
  ["15-people.mjs", path.join(ROOT, "Web Files", "rootmc-ava", "src", "people.mjs")],
  ["16-persona.mjs", path.join(ROOT, "Web Files", "rootmc-ava", "src", "persona.mjs")],
  ["17-appearance-README.md", path.join(HANDOFF, "appearance", "README.md")],
  ["20-ECOSYSTEM.md", path.join(ROOT, "emergent-repo", "ECOSYSTEM.md")],
  ["21-AGENTS.md", path.join(ROOT, "emergent-repo", "AGENTS.md")],
  ["22-workspace-rule.mdc", path.join(ROOT, ".cursor", "rules", "rootmc-workspace.mdc")],
  ["23-PATHS.md", path.join(HANDOFF, "docs", "PATHS.md")],
  ["24-handoff-README.md", path.join(HANDOFF, "README.md")],
  ["25-independence-roadmap.md", path.join(HANDOFF, "plans", "ava-independence-roadmap.md")],
  ["26-lead-dev-build-plan.md", path.join(HANDOFF, "plans", "ava-ivy-lead-dev-build-plan.md")],
  ["27-proposal-foundation.md", path.join(HANDOFF, "docs", "discord-proposal-foundation.md")],
  ["28-incident-spaz.md", path.join(HANDOFF, "docs", "incident-2026-07-31-general-spaz.md")],
  ["30-PROP-01.md", path.join(HANDOFF, "plans", "PROP-01.md")],
  ["31-skills-cutover.md", path.join(ROOT, "Plugin Building", "Minecraft", "plugins", "root-skills", "CUTOVER.md")],
  ["32-plugin-manifest.json", path.join(ROOT, "Web Files", "rootmc-web", "public", "plugins", "manifest.json")],
  ["40-config.mjs", path.join(ROOT, "Web Files", "rootmc-ava", "src", "config.mjs")],
  ["41-slack-manifest.json", path.join(ROOT, "Web Files", "rootmc-ava", "slack-app-manifest.json")],
  ["42-slack-app-meta.json", path.join(HANDOFF, "data", "slack-app.json")],
  ["50-conversations-index.json", path.join(HANDOFF, "data", "conversations", "index.json")],
  ["51-reactions-summary.json", path.join(HANDOFF, "data", "reactions", "summary.json")],
];

const WIKI = [
  "index.html",
  "economy/index.html",
  "player/index.html",
  "claims/index.html",
  "territories/index.html",
  "constitution/index.html",
  "plugins/index.html",
  "plugins/api/index.html",
  "plugins/network-setup/index.html",
  "versioning/index.html",
  "weekly-awards/index.html",
  "map-26-2/index.html",
];

function copyOne(destName, src) {
  if (!src || !fs.existsSync(src)) {
    console.warn("skip missing:", destName, src);
    return false;
  }
  const dest = path.join(OUT, destName);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log("ok", destName);
  return true;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let n = 0;
for (const [name, src] of FILES) {
  if (copyOne(name, src)) n += 1;
}

const wikiRoot = path.join(ROOT, "Web Files", "rootmc-web", "public", "wiki");
for (const rel of WIKI) {
  const src = path.join(wikiRoot, rel);
  const destName = path.join("wiki", rel).replace(/\\/g, "/");
  if (copyOne(destName, src)) n += 1;
}

// changelogs
const clDir = path.join(ROOT, "Change Logs", "plugins");
if (fs.existsSync(clDir)) {
  for (const name of fs.readdirSync(clDir)) {
    if (!name.endsWith(".md")) continue;
    if (copyOne(path.join("changelogs", name), path.join(clDir, name))) n += 1;
  }
}
const skillsPlan = path.join(ROOT, "Change Logs", "root-skills-plan.md");
if (copyOne("changelogs/root-skills-plan.md", skillsPlan)) n += 1;

// appearance images
const appDir = path.join(HANDOFF, "appearance");
if (fs.existsSync(appDir)) {
  for (const name of fs.readdirSync(appDir)) {
    if (!/\.(png|jpg|jpeg|webp)$/i.test(name)) continue;
    if (copyOne(path.join("appearance", name), path.join(appDir, name))) n += 1;
  }
}

// jobs + plans (fresh)
const jobsDir = path.join(HANDOFF, "data", "jobs");
if (fs.existsSync(jobsDir)) {
  for (const name of fs.readdirSync(jobsDir)) {
    if (!name.endsWith(".json")) continue;
    if (copyOne(path.join("jobs", name), path.join(jobsDir, name))) n += 1;
  }
}
const plansDir = path.join(HANDOFF, "plans");
if (fs.existsSync(plansDir)) {
  for (const name of fs.readdirSync(plansDir)) {
    if (!name.endsWith(".md")) continue;
    if (copyOne(path.join("plans", name), path.join(plansDir, name))) n += 1;
  }
}

// tail of turns.jsonl (last ~400 lines)
const turns = path.join(HANDOFF, "data", "conversations", "turns.jsonl");
if (fs.existsSync(turns)) {
  const lines = fs.readFileSync(turns, "utf8").split(/\n/).filter(Boolean);
  const tail = lines.slice(-400).join("\n") + "\n";
  fs.writeFileSync(path.join(OUT, "52-turns-tail.jsonl"), tail, "utf8");
  console.log("ok 52-turns-tail.jsonl", lines.slice(-400).length, "lines");
  n += 1;
}

fs.writeFileSync(
  path.join(OUT, "README.txt"),
  [
    "Ava dream-pack bundle — upload this folder to the cloud fallback worker.",
    "SYSTEM.md / 00-SYSTEM.md first. Never include .env or tokens.",
    `Assembled: ${new Date().toISOString()} · files≈${n}`,
    "",
  ].join("\n"),
);

console.log("\nbundle →", OUT, "· files≈", n);
