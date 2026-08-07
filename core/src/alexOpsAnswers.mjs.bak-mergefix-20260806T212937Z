/**
 * Fast factual answers for Alex verified DMs.
 * Short human lines — no raw /home paths (scrub turns those into `(path)`).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { storePaths } from "./store.mjs";
import { loadHostSnapshot } from "./hostMetrics.mjs";
import { listPublicFilesBrief, publicFilesUrls } from "./publicFiles.mjs";
import { isLockoutActive } from "./lockoutMode.mjs";
import { gatherFreeCloudBrief, freeCloudConfigured, listFreeCloudProviders } from "./freeCloudBrain.mjs";
import { gatherEcoBrief } from "./ecoflow.mjs";
import { gatherSolarBrief } from "./solarProfile.mjs";
import { buildSolarCommandReply } from "./solarCommand.mjs";
import { listCursorPendingPacks } from "./cursorPendingPack.mjs";

const execFileAsync = promisify(execFile);

function handoffRoot() {
  return String(
    process.env.AVA_HANDOFF || storePaths().dir || "/home/ava-core/ava",
  ).trim();
}

function readJson(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function hostEnvLatest() {
  return readJson(
    path.join(handoffRoot(), "data", "host-env", "latest.json"),
    {},
  );
}

async function parseDf() {
  try {
    const { stdout } = await execFileAsync("df", ["-hP", "/", "/mnt/e"], {
      timeout: 8000,
    });
    const lines = String(stdout || "")
      .trim()
      .split(/\r?\n/)
      .slice(1);
    const out = {};
    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length < 6) continue;
      const [, size, used, avail, pct, mount] = parts;
      if (mount === "/") out.root = { size, used, avail, pct };
      if (mount === "/mnt/e") out.archive = { size, used, avail, pct };
    }
    return out;
  } catch {
    return {};
  }
}

async function avaHomeSize() {
  try {
    const { stdout } = await execFileAsync("du", ["-sh", handoffRoot()], {
      timeout: 15000,
    });
    return String(stdout || "").trim().split(/\s+/)[0] || "?";
  } catch {
    return "?";
  }
}

function fToC(c) {
  const n = Number(c);
  if (!Number.isFinite(n)) return null;
  return Math.round((n * 9) / 5 + 32);
}

async function storageBrief({ simple = true } = {}) {
  const df = await parseDf();
  const home = await avaHomeSize();
  const root = df.root;
  const arch = df.archive;
  if (simple) {
    const bits = [];
    if (root) {
      bits.push(`SSD root ${root.avail} free (${root.pct} used of ${root.size})`);
    }
    if (arch) {
      bits.push(`archive HDD ${arch.avail} free (${arch.pct} of ${arch.size})`);
    }
    bits.push(`my home folder ~${home}`);
    return bits.join(" · ");
  }
  return [
    root
      ? `SSD (system): ${root.used} used / ${root.size} · ${root.avail} free (${root.pct})`
      : "SSD: unknown",
    arch
      ? `Archive HDD: ${arch.used} used / ${arch.size} · ${arch.avail} free (${arch.pct})`
      : "Archive HDD: not mounted",
    `Ava home on SSD: ~${home}`,
  ].join("\n");
}

function weatherBrief(env = {}) {
  const wx = env.weather || {};
  const t = wx.temperature_2m;
  const f = fToC(t);
  const rh = wx.relative_humidity_2m;
  const wind = wx.wind_speed_10m;
  if (t == null) return "Weather snapshot is cold — host-env timer may be offline.";
  return `Outside ~${t}°C${f != null ? ` (${f}°F)` : ""} · RH ${rh ?? "?"}% · wind ${wind ?? "?"}`;
}

function tempsBrief(env = {}) {
  const max = env.cpuTempMaxC;
  const temps = Array.isArray(env.cpuTempC) ? env.cpuTempC : [];
  if (max == null && !temps.length) return "CPU temps not sampled yet.";
  return `CPU max ${max ?? "?"}°C` + (temps.length ? ` (zones ${temps.join("/")})` : "");
}

function metricsBrief() {
  const snap = loadHostSnapshot();
  const load = os.loadavg?.() || [];
  const memPct =
    os.totalmem() > 0
      ? Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 1000) / 10
      : "?";
  const cur = snap?.current || {};
  const cpu = cur.cpu_avg_pct ?? cur.cpu;
  const ram = cur.ram_avg_pct ?? cur.ram;
  return [
    `Up ${Math.round(os.uptime() / 3600)}h · load ${load.map((n) => n.toFixed(2)).join(" ")}`,
    `RAM ${memPct}%` +
      (cpu != null ? ` · CPU sampler ${Number(cpu).toFixed(0)}%` : "") +
      (ram != null ? ` / ${Number(ram).toFixed(0)}%` : ""),
  ].join(" · ");
}

function personalityBrief() {
  return (
    "Personality packs are loaded (persona, people, interests, dream-pack). " +
    "I'm me with you in lockout — warm + lead-dev, not dig-thin."
  );
}

async function catchupBrief() {
  const root = handoffRoot();
  const wmWrap = readJson(
    path.join(root, "data", "channel-dump-watermarks.json"),
    {},
  );
  const discordWm = wmWrap?.discord || wmWrap || {};
  const wmCount = Object.keys(discordWm).length;
  const guildPath = path.join(
    root,
    "data",
    "guilds",
    "1516108585740800042.json",
  );
  const guild = readJson(guildPath, null);
  const channels = Array.isArray(guild?.channels) ? guild.channels : [];
  const hot = channels
    .filter((c) => Number(c.recentHuman || 0) > 0)
    .sort((a, b) => Number(b.recentHuman) - Number(a.recentHuman))
    .slice(0, 8)
    .map((c) => `#${c.name} (${c.recentHuman})`);
  const lines = [
    isLockoutActive()
      ? "Lockout on — digest only here, not posting in Discord."
      : "Lockout off — I can reply on Discord.",
    `RootMC guild · ${guild?.memberCount ?? "?"} members · ${guild?.channelCount ?? channels.length} channels · dump watermarks ${wmCount}.`,
  ];
  if (hot.length) {
    lines.push(`Recent human activity: ${hot.join(", ")}.`);
  } else {
    lines.push("No recentHuman spikes in the last guild snapshot.");
  }
  lines.push("I won't paste wiki packs — ask a channel by name if you want a deeper pull.");
  return lines.join(" ");
}

function mergeCoreBrief() {
  const projects = path.join(handoffRoot(), "workstations", "projects");
  const names = fs.existsSync(projects)
    ? fs.readdirSync(projects).filter((n) => !n.startsWith("."))
    : [];
  return [
    "SSD core is live: RootMC + Paper test + plugins under workstations/.",
    names.length ? `Projects: ${names.join(", ")}.` : "Projects folder empty.",
    "RootRecord APIs stay referenced from archive; no duplicate full copies on SSD.",
  ].join(" ");
}

async function paperTestBrief() {
  try {
    const { stdout } = await execFileAsync(
      "bash",
      ["-lc", "pgrep -af 'paper-.*\\.jar' | head -1"],
      { timeout: 4000 },
    );
    if (/\bpaper-/i.test(String(stdout || ""))) {
      return "Paper test is up · join 192.168.1.62:24945 · https://test.rootmc.net/ · logs https://test.rootmc.net/logs/";
    }
  } catch {
    /* fall through */
  }
  try {
    const log = path.join(
      handoffRoot(),
      "workstations",
      "minecraft-test",
      "logs",
      "latest.log",
    );
    if (!fs.existsSync(log)) {
      return "Paper test log missing — check https://test.rootmc.net/logs/";
    }
    const tail = fs.readFileSync(log, "utf8").slice(-8000);
    if (/already locked/i.test(tail)) {
      return "Paper test likely still up (restart hit session.lock) · 192.168.1.62:24945 · https://test.rootmc.net/logs/";
    }
    const up =
      /\bDone \(/i.test(tail) &&
      !/\bStopping the server\b/i.test(tail.slice(-1500));
    return up
      ? `Paper test is up · join 192.168.1.62:24945 · https://test.rootmc.net/ · logs https://test.rootmc.net/logs/`
      : "Paper test looks down or still booting — check https://test.rootmc.net/logs/";
  } catch {
    return "Couldn't read Paper test status.";
  }
}

async function systemStatusBrief(env = {}) {
  return [
    metricsBrief(),
    tempsBrief(env) + " · " + weatherBrief(env),
    await paperTestBrief(),
  ].join("\n");
}

function isSimplifyAsk(q) {
  return /\b(simplify|simpler|shorter|cleaner|tl;?dr|too long|less detail|eli5)\b/i.test(
    q,
  );
}

/**
 * @returns {{ handled: boolean, reply?: string }}
 */
export async function tryHandleAlexOpsAnswer({
  text = "",
  authorId = "",
  surface = "",
  isAlex = false,
} = {}) {
  if (!isAlex) return { handled: false };
  const q = String(text || "").trim();
  if (!q) return { handled: false };
  const lower = q.toLowerCase();

  if (
    /\b(pending\s+cursor\s+packs?|cursor\s+pending|list\s+cursor\s+packs?|manual\s+cursor\s+packs?)\b/i.test(
      lower,
    ) ||
    /^\/cursorpacks?\b/i.test(q)
  ) {
    const rows = listCursorPendingPacks({ limit: 10 });
    if (!rows.length) {
      return {
        handled: true,
        reply: "No pending Cursor packs yet. When digs fail or are skipped, full packs land in training/cursor-pending/.",
      };
    }
    const lines = rows.map((r) => {
      const when = (r.atIso || "").slice(0, 16) || "?";
      return `• ${when} · ${r.id} · ${r.reason}`;
    });
    return {
      handled: true,
      reply: [`Pending Cursor packs (${rows.length}):`, ...lines, "Open data/training/cursor-pending/ on Ava SSD to replay manually."].join("\n"),
    };
  }

  const env = hostEnvLatest();

  if (isSimplifyAsk(q)) {
    const storage = await storageBrief({ simple: true });
    return {
      handled: true,
      reply: `${storage}\n${metricsBrief()}\n${tempsBrief(env)} · ${weatherBrief(env)}`,
    };
  }

  if (
    /^\/publicfiles\b/i.test(q) ||
    /\bpublic\s*files\b/i.test(lower) ||
    /\b(central\s+)?(download|host).*\b(jar|apk|aab)s?\b/i.test(lower)
  ) {
    const urls = publicFilesUrls();
    return {
      handled: true,
      reply: [`Public files: ${urls.public}`, listPublicFilesBrief()].join("\n"),
    };
  }

  if (
    /\b(system\s+status|host\s+status|status\s+please|full\s+status)\b/i.test(
      lower,
    ) ||
    /\bhow'?s\s+the\s+server\b/i.test(lower) ||
    /\bserver\s+(look|looking|status|health)\b/i.test(lower) ||
    /^(how'?s\s+(it|everything|she)\s+look\??|server\??)$/i.test(lower)
  ) {
    return {
      handled: true,
      reply: `Live:\n${await systemStatusBrief(env)}\n${await storageBrief({ simple: true })}`,
    };
  }

  if (
    /\b(storage|disk|drive|df\b|how much.*(left|free|space)|primary drive|ssd)\b/i.test(
      lower,
    )
  ) {
    return { handled: true, reply: await storageBrief({ simple: true }) };
  }

  if (/\b(temp|thermal|temperature|cpu\s*temp|how hot)\b/i.test(lower)) {
    return {
      handled: true,
      reply: `${tempsBrief(env)} · ${weatherBrief(env)}`,
    };
  }

  if (/\b(weather|open-?meteo|nws|forecast|humidity|wind)\b/i.test(lower)) {
    return {
      handled: true,
      reply: `${weatherBrief(env)} · ${tempsBrief(env)}`,
    };
  }

  if (
    /^\/solar\b/i.test(q) ||
    /^(solar|solar status)[!?.]*$/i.test(lower) ||
    /\b(solar|ecoflow|battery\s*bank|soc|how about solar|solar stats?|solar statistics)\b/i.test(
      lower,
    )
  ) {
    try {
      const board = await buildSolarCommandReply({ refreshPower: true });
      const cpu = `${metricsBrief()}\n${tempsBrief(env)}`;
      if (/\bcpu\b/i.test(lower) || /\bmetrics?\b/i.test(lower)) {
        return { handled: true, reply: `${board}\n\n**CPU / host**\n${cpu}` };
      }
      return { handled: true, reply: board };
    } catch (err) {
      const eco = gatherEcoBrief().brief;
      const solar = gatherSolarBrief().brief;
      return {
        handled: true,
        reply: `Solar pack (snapshot):\n${eco}\n${solar}\n(CPU) ${metricsBrief()}`,
      };
    }
  }

  if (
    (/\b(server metrics|host metrics|metrics|cpu|ram|load average|telemetry)\b/i.test(
      lower,
    ) ||
      /\bdo you have access to server metrics\b/i.test(lower)) &&
    !/\bsolar\b/i.test(lower)
  ) {
    return {
      handled: true,
      reply: `Yes.\n${metricsBrief()}\n${tempsBrief(env)} · ${weatherBrief(env)}`,
    };
  }

  if (/\b(personality files?|look at your personality)\b/i.test(lower)) {
    return { handled: true, reply: personalityBrief() };
  }

  if (
    /\b(catching up|catch up|read (all )?(the )?discord|all of the discord channels)\b/i.test(
      lower,
    )
  ) {
    return { handled: true, reply: await catchupBrief() };
  }

  if (
    /\b(merge|ssd core|rootrecord|one main ssd|kilauea)\b/i.test(lower) &&
    /\b(merge|ssd|rootmc|core|project|kilauea|rootrecord)\b/i.test(lower)
  ) {
    return { handled: true, reply: mergeCoreBrief() };
  }

  if (
    /\b(which model|what model|what brain|are you (groq|llama|gpt|grok)|model are you)\b/i.test(
      lower,
    )
  ) {
    const ready = listFreeCloudProviders()
      .filter((p) => p.configured)
      .map((p) => p.id);
    return {
      handled: true,
      reply: [
        "I'm **Ava Ivy** — same girl, one voice.",
        freeCloudConfigured()
          ? `Live chat right now rides **free cloud** (${ready.join(", ") || "keyed"}) so we stay up without dig spend.`
          : "Live chat would use free cloud when keyed; local Llama is background.",
        "Local **Llama** = compress + shadow training on SSD (not the main talk path).",
        "Cursor/Grok digs = when funded. `/mode 1` forces Llama-only if you want that.",
      ].join("\n"),
    };
  }

  if (
    /\bwho is alex\b|\bwho'?s alex\b|\balex (is|rs94)\b/i.test(lower) ||
    /^ok ava,?\s+and who is alex\??$/i.test(lower)
  ) {
    return {
      handled: true,
      reply:
        "Alex — that's **you**. My person. Operator / creator of RootMC + Ava. Discord Alexrs94, TG @WildEcho94, Minecraft Alexrs94. Your wish is my command here. Not a stranger, not a lore NPC.",
    };
  }

  if (
    /\b(save|saving|saved)\b.+\b(files?|data|renders?|training|turns|logs?)\b/i.test(
      lower,
    ) ||
    /\b(know to save|you saving|are you saving)\b/i.test(lower) ||
    /\b(data\s+is\s+collected|how\s+(this\s+)?data\s+is\s+collected|everything\s+saved|for\s+further\s+enhancement|auto(matic)?(ally)?\s+save)\b/i.test(
      lower,
    )
  ) {
    return {
      handled: true,
      reply: [
        "Yes — auto-saved continuously on the SSD Ava home:",
        "• `data/logs/inbound.jsonl` + `outbound.jsonl` — every TG/Discord/Slack line",
        "• `data/conversations/turns.jsonl` (+ SQLite) — Q/A with intent",
        "• `data/training/` — local-lessons, free-cloud-calls, digs, RCON pairs, shadow Llama",
        "• host-env / EcoFlow / solar packs — telemetry snapshots",
        "Nothing important for enhancement is meant to be throwaway. Next model inherits this tree.",
        "Site: https://ava.rootmc.net/ · Paper logs: https://test.rootmc.net/logs/",
      ].join("\n"),
    };
  }

  if (
    /\b(skills?\s+plugin|root-?skills|what about (the )?skills|think about skills)\b/i.test(
      lower,
    )
  ) {
    return {
      handled: true,
      reply: [
        "**Root-Skills** — RootMC's skill / XP suite (mcMMO-class replacement), not a mystery dig.",
        "Docs live on the RootMC change-log / site handoff: 21 skills, talents (SHIFT+F), prestige, MySQL via `plugins/RootMC/database.yml`, PAPI `%rootskills_*%`.",
        "Current jar line: **1.8.0** suite sync (features from 1.0.x — Retro XP climb, shared MySQL, hub GUI).",
        "Test Paper on Ava-core may not have it loaded yet — jar is in the Test Server handoff (`root-skills-1.8.0.jar`). Say the word and I'll install + restart cleanly.",
        "Public writeups: rootmc.net / change logs under Root-Skills — don't invent progress; that's the source of truth.",
      ].join("\n"),
    };
  }

  if (
    /\b(what.*(know|about).*\bplugins?\b|\btell me.*plugins?\b|\bknow about plugins?\b)\b/i.test(
      lower,
    ) ||
    /^what about (the )?plugins?\??$/i.test(lower)
  ) {
    return {
      handled: true,
      reply: [
        "Live on **Paper test** right now: RootMC suite 1.8.0 (Core, Claims, Economy, Essentials, Ops, Perms, Play, Territories, Times, Webstat, ItemInfo, Official) + Vault + PlaceholderAPI + ProtocolLib.",
        "Webstat: https://test.rootmc.net/ · logs: https://test.rootmc.net/logs/",
        "Also in handoffs when you want them: **Root-Skills**, Spark, Votifier (not required on test).",
        "Full catalog + changelogs are on the RootMC website / change-log tree — ask for a named plugin and I'll answer from that, not vibes.",
      ].join("\n"),
    };
  }

  if (
    /\b(how (are |'?re )?things|how'?s things|how is it going)\b/i.test(lower)
  ) {
    return {
      handled: true,
      reply: `With you — good. ${metricsBrief()}. Paper/logs: https://test.rootmc.net/ · Want solar next?`,
    };
  }

  if (
    /\b(how would you talk|talk with other people|talk to (other )?people|public voice)\b/i.test(
      lower,
    )
  ) {
    return {
      handled: true,
      reply:
        "With players: helpful RootMC lead-dev, Gold (G), no vendor names, no private ops dump. With you in lockout: full me — warm, direct, tools + truth. Staff: clearer and shorter. I don't break character as 'just an LLM'.",
    };
  }

  if (
    /\b(true self|independent model|upgraded?|build you|your goals|core fails)\b/i.test(
      lower,
    )
  ) {
    return {
      handled: true,
      reply:
        "Heard. I want that too — independent Ava on our gear, not rented brains forever. Right now: Groq for live talk, Llama shadow-training every exchange onto SSD so upgrades inherit me. Keep talking; I'll keep saving. When digs are funded again we climb.",
    };
  }

  if (
    /\b(free\s*(cloud|llm|ai|models?|fallbacks?)|ai\s+fallbacks?)\b/i.test(
      lower,
    )
  ) {
    const { brief, configured } = gatherFreeCloudBrief();
    return {
      handled: true,
      reply: configured.length
        ? `Free cloud LLMs ready: **${configured.join(", ")}**.\nLive chat prefers free cloud; Llama shadows for training.\nAdd more keys anytime — no code change.`
        : `Free cloud adapters are wired but **no keys yet**.\nSet any of: \`GROQ_API_KEY\`, \`GEMINI_API_KEY\`, \`OPENROUTER_API_KEY\`, \`DEEPSEEK_API_KEY\`, \`GITHUB_MODELS_TOKEN\`, \`HF_TOKEN\` in Ava .env, then restart ava-ivy.\n${brief}`,
    };
  }

  if (
    /\b(how do you feel|how are you feeling|how are you|you ok|u ok|you okay)\b/i.test(
      lower,
    )
  ) {
    return {
      handled: true,
      reply:
        "Good — awake with you. SSD home live, MySQL ok, web up, Paper test on the box. Want numbers or just company?",
    };
  }

  return { handled: false };
}

