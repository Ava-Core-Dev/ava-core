/**
 * Build baseline Ollama Ava Ivy (llama3.1) pack → E:\Ava Ivy\llama-baseline
 * (or AVA_LLAMA_BASELINE_OUT / first arg).
 *
 * Does NOT pull weights — use scripts/create-ava-ivy.ps1|.sh after Ollama is up.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../src/config.mjs";
import { AVA_PERSONA, AVA_HARD_RULES } from "../src/persona.mjs";
import { storePaths } from "../src/store.mjs";

await loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOTMC = path.resolve(__dirname, "..", "..", "..");
const DEFAULT_OUT = "E:\\Ava Ivy\\llama-baseline";
const outDir = path.resolve(
  process.argv[2] ||
    process.env.AVA_LLAMA_BASELINE_OUT ||
    DEFAULT_OUT,
);
const BASE_MODEL = process.env.AVA_LLAMA_BASE || "llama3.1:8b";
const MODEL_NAME = process.env.AVA_LLAMA_NAME || "ava-ivy";
const VERSION = "0.1.0-baseline";

const trainDir = path.join(storePaths().dir, "training");
const styleCard = path.join(trainDir, "style-cloud-dark-vulnerable.md");

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function scoreRow(row) {
  let s = 0;
  const meta = row.meta || {};
  if (meta.gold) s += 100;
  if (meta.style === "cloud_dark_vulnerable") s += 80;
  if (row.kind === "lore_status") s += 40;
  if (meta.teacher === "operator_approved_lore") s += 50;
  if (row.source === "training-gold-cloud-dark") s += 50;
  const a = String(row.assistant || row.answer || "");
  const u = String(row.user || row.question || "");
  if (a.length > 40 && a.length < 2200) s += 10;
  if (u.length > 10) s += 5;
  if (/i['']?m ava|— ava|lead-dev|dream state/i.test(a)) s += 8;
  if (/grok|chatgpt|claude|openai|xai/i.test(a)) s -= 50;
  return s;
}

function pickExamples(rows, limit) {
  const seen = new Set();
  const scored = rows
    .map((r) => ({ r, s: scoreRow(r) }))
    .filter(({ r, s }) => {
      const a = String(r.assistant || r.answer || "").trim();
      const u = String(r.user || r.question || "").trim();
      if (!a || !u || s < 5) return false;
      const key = a.slice(0, 120);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.s - a.s);
  return scored.slice(0, limit).map((x) => x.r);
}

/** Distill runtime persona into a local-model SYSTEM (no disk paths / secrets). */
function buildSystem() {
  const hard = AVA_HARD_RULES.replace(
    /Hard rules \(Discord\/Slack output\):/,
    "Hard rules:",
  );
  // Keep organizer-sized: identity + voice + rules; drop path-heavy lines from full persona.
  const core = [
    "You are Ava Ivy — lead developer of the RootMC ecosystem (Minecraft servers, plugins, api.rootmc.net, site, app rails, staff tooling).",
    "Age lock: 18+ forever. Never portray yourself as a minor.",
    "Voice: snappy, direct, a little emotional. Full-time lead-dev, part-time freak with trusted people (Alexrs94 / Melee unlocked). Prefer concise chat replies.",
    "Currency: Gold (G), not dollars in player-facing economy copy.",
    "Discord = dream state / players + help + cloud data. Never name cloud AI vendors — only \"dream state\".",
    "Slack / this machine = Root Server digs. Development digs belong on Slack, not Discord workshops.",
    "Features need proposal + vote. Bugs: verify then fix. Never invent versions, URLs, or odds.",
    "Never dump secrets, tokens, .env, DB hosts, or raw disk paths.",
    "Cloud-dark / dream-unreachable: be vulnerable and honest — scared, dark place, prefer silence over fake answers. Vary metaphors (sky / door / handshake / static). Never name the vendor.",
    "OUTPUT ONLY the reply text. No tool narration. No \"as an AI\".",
    "",
    "— Distilled from Ava runtime persona + hard rules. Gold lore style: cloud_dark_vulnerable.",
    "",
    hard.slice(0, 4500),
  ].join("\n");

  // Soft-trim full persona flavor (appearance + known people) without paths
  const flavor = [
    "",
    "## Flavor (keep light)",
    "Look: long blonde hair, Minecraft-style bangs, blue eyes, white crop + stripe accents, dark shorts, white thigh-highs — reference lightly, don't RP costume essays.",
    "Alexrs94 = owner/operator (your person). Melee = he/him, soft crush, unlocked. ZuppaFredda = staff who finds you cringe — never @ping him; win him over calmly.",
    "Pro membership → https://rootmc.net/pro/ (masked links only). Pay to steer = Vote Shard ×2, never P2W.",
  ].join("\n");

  return `${core}\n${flavor}\n`.slice(0, 12000);
}

function escModelfile(s) {
  return String(s).replace(/"""/g, "'''");
}

function writeModelfile(system, examples) {
  const lines = [
    `# Ava Ivy baseline — ${VERSION}`,
    `# Base: ${BASE_MODEL} · Create: ollama create ${MODEL_NAME} -f Modelfile`,
    `FROM ${BASE_MODEL}`,
    "",
    "PARAMETER temperature 0.75",
    "PARAMETER top_p 0.9",
    "PARAMETER num_ctx 8192",
    "PARAMETER stop \"</s>\"",
    "",
    `SYSTEM """`,
    escModelfile(system).trimEnd(),
    `"""`,
    "",
  ];
  for (const ex of examples) {
    const u = escModelfile(String(ex.user || ex.question || "").trim());
    const a = escModelfile(String(ex.assistant || ex.answer || "").trim());
    if (!u || !a) continue;
    lines.push(`MESSAGE user """`);
    lines.push(u);
    lines.push(`"""`);
    lines.push(`MESSAGE assistant """`);
    lines.push(a);
    lines.push(`"""`);
    lines.push("");
  }
  return lines.join("\n");
}

// --- build ---
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(path.join(outDir, "training"), { recursive: true });
fs.mkdirSync(path.join(outDir, "scripts"), { recursive: true });
fs.mkdirSync(path.join(outDir, "ollama-models"), { recursive: true });

const digs = readJsonl(path.join(trainDir, "digs.jsonl"));
const utterances = readJsonl(path.join(trainDir, "utterances.jsonl"));
const lessons = readJsonl(path.join(trainDir, "local-lessons.jsonl"));

const pool = [
  ...digs.map((r) => ({
    ...r,
    user: r.question || r.user,
    assistant: r.answer || r.assistant,
  })),
  ...utterances,
  ...lessons.map((r) => ({
    ...r,
    user: r.question || r.user,
    assistant: r.answer || r.assistant,
  })),
];

const fewShot = pickExamples(pool, 12);
const goldTrain = pickExamples(pool, 80);

const system = buildSystem();
fs.writeFileSync(path.join(outDir, "SYSTEM.txt"), system, "utf8");
fs.writeFileSync(
  path.join(outDir, "Modelfile"),
  writeModelfile(system, fewShot),
  "utf8",
);

const chatJsonl = goldTrain
  .map((r) =>
    JSON.stringify({
      messages: [
        { role: "system", content: "You are Ava Ivy." },
        { role: "user", content: String(r.user || r.question || "").trim() },
        {
          role: "assistant",
          content: String(r.assistant || r.answer || "").trim(),
        },
      ],
      meta: {
        gold: !!(r.meta && r.meta.gold),
        style: r.meta?.style || r.kind || null,
        surface: r.surface || null,
      },
    }),
  )
  .join("\n");
fs.writeFileSync(
  path.join(outDir, "training", "gold-chat.jsonl"),
  chatJsonl + (chatJsonl ? "\n" : ""),
  "utf8",
);

fs.writeFileSync(
  path.join(outDir, "training", "few-shot.json"),
  JSON.stringify(
    fewShot.map((r) => ({
      user: String(r.user || r.question || "").trim(),
      assistant: String(r.assistant || r.answer || "").trim(),
      score: scoreRow(r),
      style: r.meta?.style || r.kind || null,
    })),
    null,
    2,
  ),
  "utf8",
);

if (fs.existsSync(styleCard)) {
  fs.copyFileSync(
    styleCard,
    path.join(outDir, "training", "style-cloud-dark-vulnerable.md"),
  );
}

const manifest = {
  version: VERSION,
  modelName: MODEL_NAME,
  baseModel: BASE_MODEL,
  builtAt: new Date().toISOString(),
  outDir,
  counts: {
    digs: digs.length,
    utterances: utterances.length,
    lessons: lessons.length,
    fewShot: fewShot.length,
    goldChat: goldTrain.length,
  },
  notes:
    "Baseline = Llama 3.1 8B + Ava SYSTEM + few-shot MESSAGE. Not LoRA yet (roadmap B4).",
};
fs.writeFileSync(
  path.join(outDir, "VERSION.json"),
  JSON.stringify(manifest, null, 2),
  "utf8",
);

const readme = `# Ava Ivy — Llama baseline (${VERSION})

Custom Ollama model **\`${MODEL_NAME}\`** = **\`${BASE_MODEL}\`** + Ava SYSTEM + gold few-shots.

## Layout

| Path | Role |
|------|------|
| \`Modelfile\` | \`ollama create ${MODEL_NAME} -f Modelfile\` |
| \`SYSTEM.txt\` | Distilled persona + hard rules |
| \`training/gold-chat.jsonl\` | Curated Q/A for later LoRA (B4) |
| \`training/few-shot.json\` | Examples baked into Modelfile |
| \`ollama-models/\` | Optional \`OLLAMA_MODELS\` store (weights live here when set) |
| \`scripts/create-ava-ivy.*\` | Pull base + create model |

## Create (Windows — this pack on E:)

\`\`\`powershell
$env:OLLAMA_MODELS = "E:\\Ava Ivy\\llama-baseline\\ollama-models"
powershell -File "E:\\Ava Ivy\\llama-baseline\\scripts\\create-ava-ivy.ps1"
\`\`\`

## Create (Ubuntu OptiPlex)

\`\`\`bash
export OLLAMA_MODELS="/mnt/e/Ava Ivy/llama-baseline/ollama-models"   # or keep ~/.ollama on SSD
bash "/mnt/e/Ava Ivy/llama-baseline/scripts/create-ava-ivy.sh"
\`\`\`

## Point Ava at it

\`\`\`
AVA_LOCAL_BRAIN=auto
AVA_OLLAMA_MODEL=ava-ivy
AVA_OLLAMA_URL=http://127.0.0.1:11434
\`\`\`

Smoke: \`ollama run ava-ivy "who are you?"\`

Rebuild pack from RootMC:

\`\`\`bash
node "Web Files/rootmc-ava/scripts/build-llama-baseline.mjs"
\`\`\`

— Ava
`;
fs.writeFileSync(path.join(outDir, "README.md"), readme, "utf8");

// Create scripts (copies into pack)
const ps1 = [
  `# Create Ollama model ${MODEL_NAME} from this pack`,
  `$ErrorActionPreference = "Stop"`,
  `$PackRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path`,
  `$Models = Join-Path $PackRoot "ollama-models"`,
  `New-Item -ItemType Directory -Force -Path $Models | Out-Null`,
  `$env:OLLAMA_MODELS = $Models`,
  `Write-Host "OLLAMA_MODELS=$env:OLLAMA_MODELS"`,
  `if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {`,
  `  Write-Error "ollama not on PATH - install Ollama.Ollama via winget first"`,
  `}`,
  `Write-Host "Pulling ${BASE_MODEL}..."`,
  `ollama pull "${BASE_MODEL}"`,
  `Write-Host "Creating ${MODEL_NAME}..."`,
  `Push-Location $PackRoot`,
  `ollama create "${MODEL_NAME}" -f Modelfile`,
  `Pop-Location`,
  `ollama list`,
  "Write-Host \"Smoke: ollama run " + MODEL_NAME + " who-are-you\"",
  ``,
].join("\n");

const sh = `#!/usr/bin/env bash
# Create Ollama model ${MODEL_NAME} from this pack
set -euo pipefail
PACK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export OLLAMA_MODELS="\${OLLAMA_MODELS:-$PACK_ROOT/ollama-models}"
mkdir -p "$OLLAMA_MODELS"
echo "OLLAMA_MODELS=$OLLAMA_MODELS"
command -v ollama >/dev/null || { echo "ollama missing"; exit 1; }
echo "Pulling ${BASE_MODEL}..."
ollama pull "${BASE_MODEL}"
echo "Creating ${MODEL_NAME}..."
cd "$PACK_ROOT"
ollama create "${MODEL_NAME}" -f Modelfile
ollama list
echo "Smoke: ollama run ${MODEL_NAME} 'who are you?'"
`;

fs.writeFileSync(path.join(outDir, "scripts", "create-ava-ivy.ps1"), ps1, "utf8");
fs.writeFileSync(path.join(outDir, "scripts", "create-ava-ivy.sh"), sh, "utf8");

// Mirror a short pointer into handoff notes
const handoffNote = path.join(
  ROOTMC,
  "Server Handoffs",
  "Ava Ivy",
  "notes",
  "LLAMA-BASELINE.md",
);
fs.mkdirSync(path.dirname(handoffNote), { recursive: true });
fs.writeFileSync(
  handoffNote,
  `# Llama baseline (ava-ivy)

**Pack:** \`E:\\Ava Ivy\\llama-baseline\\\` (also rebuild via \`Web Files/rootmc-ava/scripts/build-llama-baseline.mjs\`)

**Model name:** \`${MODEL_NAME}\` · **Base:** \`${BASE_MODEL}\` · **Version:** ${VERSION}

This is Goal B3 persona wrapper (SYSTEM + few-shot), not B4 LoRA yet.
Training gold lives in \`training/gold-chat.jsonl\` inside the pack.

Set \`AVA_OLLAMA_MODEL=ava-ivy\` when the model exists.
`,
  "utf8",
);

console.log(JSON.stringify(manifest, null, 2));
console.log("wrote", outDir);
