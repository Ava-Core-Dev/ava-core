import fs from "node:fs";
import path from "node:path";

const ROOT = "C:\\Users\\rootr\\OneDrive\\Desktop\\channels status";
const data = "E:\\.Ava_Ivy\\data\\logs";

function loadJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split(/\n/)
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

const inbound = loadJsonl(path.join(data, "inbound.jsonl"));
const outbound = loadJsonl(path.join(data, "outbound.jsonl"));
const tgIn = inbound.filter(
  (x) => String(x.channelId || "").includes("6644482344") || x.surface === "telegram",
);
const tgOut = outbound.filter(
  (x) => String(x.channelId || "").includes("6644482344") || x.surface === "telegram",
);

const lines = [];
lines.push("# TELEGRAM — Full recoverable transcript (Alex DM)");
lines.push("");
lines.push(
  "Source: Ava `data/logs/inbound.jsonl` + `outbound.jsonl` (Bot API cannot backfill full private history).",
);
lines.push("");
lines.push("## Why “no response” felt real");
lines.push("");
lines.push(
  "- Several of your pings got **thin local-core** replies (“rephrase that”, “say it another way”) — not silence, but not a real companion answer.",
);
lines.push(
  "- OptiPlex was down; lockout was on for a stretch (Telegram-only companion), then brain quality degraded without Grok + weak/missing llama.",
);
lines.push("- Laptop failover later sent an operator note (outbound msg `1599`).");
lines.push("");
lines.push("## Chronological (merged)");
lines.push("");

const events = [];
for (const m of tgIn) {
  events.push({
    at: m.at,
    dir: "IN",
    id: m.messageId,
    text: m.content,
    author: m.authorName,
  });
}
for (const m of tgOut) {
  events.push({
    at: m.at,
    dir: "OUT",
    id: m.messageId,
    text: m.content,
    author: "Ava",
    kind: m.kind,
    ok: m.ok,
  });
}
events.sort((a, b) => a.at - b.at);

for (const e of events) {
  const iso = new Date(e.at).toISOString();
  lines.push(
    `### ${iso} · ${e.dir} · id ${e.id}${e.kind ? " · " + e.kind : ""}`,
  );
  lines.push("");
  lines.push(String(e.text || ""));
  lines.push("");
}

fs.mkdirSync(path.join(ROOT, "telegram"), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, "telegram", "DM-Alex-TRANSCRIPT.md"),
  lines.join("\n"),
  "utf8",
);
fs.writeFileSync(
  path.join(ROOT, "_raw", "telegram", "transcript-from-logs.json"),
  JSON.stringify({ inbound: tgIn, outbound: tgOut }, null, 2),
  "utf8",
);
console.log("tg events", events.length, "in", tgIn.length, "out", tgOut.length);
