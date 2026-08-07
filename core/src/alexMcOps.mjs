/**
 * Alex NL → Minecraft console (RCON) for the test / future prod host.
 * Tracked: live production + test ava-core only. Prefer RCON target "test" for local; production alias for live.
 *
 * Root-Ops aliases /worldborder to "reapply from root-admin.yml".
 * Size changes use minecraft:worldborder (vanilla diameter) and sync
 * world-border.radius in root-admin.yml so a later /worldborder won't undo it.
 */
import fs from "node:fs";
import path from "node:path";
import { guardedRcon, rconConfigured, rconTargets } from "./rconGuard.mjs";
import { appendAction } from "./fullLog.mjs";
import { pushStatusEvent } from "./store.mjs";

function defaultTarget() {
  const pref = String(process.env.AVA_RCON_DEFAULT_TARGET || "test")
    .trim()
    .toLowerCase();
  const ids = rconTargets().map((t) => t.id);
  if (ids.includes(pref)) return pref;
  if (ids.includes("test")) return "test";
  return ids[0] || "test";
}

function mcTestRoot() {
  return (
    String(process.env.AVA_MC_TEST_DIR || "").trim() ||
    path.join(
      String(process.env.AVA_HANDOFF || "/home/ava-core/ava").trim(),
      "workstations",
      "minecraft-test",
    )
  );
}

function rootAdminYml() {
  return path.join(mcTestRoot(), "plugins", "RootMC", "root-admin.yml");
}

/**
 * Upsert simple scalar keys under world-border: in root-admin.yml.
 * @param {Record<string, string|number|boolean>} patch
 */
function patchWorldBorderConfig(patch) {
  const file = rootAdminYml();
  if (!fs.existsSync(file)) {
    throw new Error(`root-admin.yml missing at ${file}`);
  }
  let text = fs.readFileSync(file, "utf8");
  const start = text.search(/^world-border:\s*$/m);
  if (start < 0) throw new Error("world-border block missing in root-admin.yml");
  // Next top-level key (column 0) after this block — skip the world-border: line itself.
  const rest = text.slice(start);
  const nl = rest.indexOf("\n");
  const bodySearch = nl < 0 ? "" : rest.slice(nl + 1);
  const nextRel = bodySearch.search(/^[A-Za-z0-9_-]+:/m);
  const end =
    nextRel < 0 ? text.length : start + nl + 1 + nextRel;
  let block = text.slice(start, end);
  for (const [key, val] of Object.entries(patch)) {
    const line = `  ${key}: ${val}`;
    const re = new RegExp(`^  ${key}:.*$`, "m");
    if (re.test(block)) block = block.replace(re, line);
    else {
      block = block.replace(/^(world-border:\s*\n)/m, `$1${line}\n`);
    }
  }
  text = text.slice(0, start) + block + text.slice(end);
  fs.writeFileSync(file, text, "utf8");
  const verify = fs.readFileSync(file, "utf8");
  for (const [key, val] of Object.entries(patch)) {
    const re = new RegExp(`^world-border:[\\s\\S]*?^  ${key}:\\s*${val}\\s*$`, "m");
    if (!re.test(verify)) {
      throw new Error(`failed to persist world-border.${key}=${val}`);
    }
  }
}

function readWorldBorderRadius() {
  const file = rootAdminYml();
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8");
  const m = text.match(/^world-border:[\s\S]*?^\s{2}radius:\s*(-?\d+(?:\.\d+)?)/m);
  return m ? Number(m[1]) : null;
}

/**
 * Map natural language to a safe console command, or null.
 * Spoken size = vanilla **diameter** (minecraft:worldborder set).
 * RootMC YAML stores ±radius — we sync radius = diameter/2.
 * @param {string} text
 * @returns {{ command: string, label: string, borderPatch?: Record<string, number> } | null}
 */
export function parseAlexMcOps(text = "") {
  const q = String(text || "")
    .toLowerCase()
    .replace(/<@!?\d+>/g, " ")
    .replace(/[“”"']/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!q) return null;

  // Explicit radius wording (RootMC ±N)
  let m = q.match(
    /\b(?:set\s+(?:the\s+)?(?:world\s*)?bord(?:er|ers)\s+(?:radius|to\s+radius)|(?:world\s*)?bord(?:er|ers)\s+radius)\s*(?:to\s+)?(\d{1,7})\b/,
  );
  if (m) {
    const radius = Number(m[1]);
    if (radius >= 1 && radius <= 14999992) {
      const diameter = radius * 2;
      return {
        command: `minecraft:worldborder set ${diameter}`,
        label: `world border radius → ±${radius} (diameter ${diameter})`,
        borderPatch: { radius },
      };
    }
  }

  // Default: "set the world border to 500" = vanilla diameter
  m = q.match(
    /\b(?:set\s+(?:the\s+)?(?:world\s*)?bord(?:er|ers)|world\s*bord(?:er|ers)\s*(?:to|set)|wb\s+set)\s*(?:to\s+)?(\d{1,7})(?:\s*(?:blocks?))?\b/,
  );
  if (m) {
    const diameter = Number(m[1]);
    if (diameter >= 1 && diameter <= 29999984) {
      const radius = Math.max(1, Math.floor(diameter / 2));
      return {
        command: `minecraft:worldborder set ${diameter}`,
        label: `world border → ${diameter} wide (±${radius})`,
        borderPatch: { radius },
      };
    }
  }
  m = q.match(
    /\b(?:world\s*)?bord(?:er|ers)\s+(?:center|to\s+center)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\b/,
  );
  if (m) {
    return {
      command: `minecraft:worldborder center ${m[1]} ${m[2]}`,
      label: `world border center → ${m[1]}, ${m[2]}`,
      borderPatch: {
        "center-x": Number(m[1]),
        "center-z": Number(m[2]),
      },
    };
  }
  if (
    /\b(?:get\s+)?(?:the\s+)?(?:world\s*)?bord(?:er|ers)\b/.test(q) &&
    /\b(get|what|how big|size|status)\b/.test(q)
  ) {
    return {
      command: "minecraft:worldborder get",
      label: "world border get",
    };
  }

  // time
  m = q.match(
    /\b(?:set\s+)?(?:the\s+)?time\s+(?:to\s+)?(day|night|noon|midnight|sunrise|sunset)\b/,
  );
  if (m) {
    return { command: `time set ${m[1]}`, label: `time → ${m[1]}` };
  }
  m = q.match(/\b(?:set\s+)?(?:the\s+)?time\s+(?:to\s+)?(\d{1,8})\b/);
  if (m) {
    return { command: `time set ${m[1]}`, label: `time → ${m[1]}` };
  }

  // weather
  m = q.match(
    /\b(?:set\s+)?(?:the\s+)?weather\s+(?:to\s+)?(clear|rain|thunder)\b/,
  );
  if (m) {
    return { command: `weather ${m[1]}`, label: `weather → ${m[1]}` };
  }

  // difficulty
  m = q.match(
    /\b(?:set\s+)?(?:the\s+)?difficulty\s+(?:to\s+)?(peaceful|easy|normal|hard)\b/,
  );
  if (m) {
    return { command: `difficulty ${m[1]}`, label: `difficulty → ${m[1]}` };
  }

  // gamerule keepInventory etc.
  m = q.match(
    /\b(?:set\s+)?(?:the\s+)?(?:game\s*)?rule\s+([a-zA-Z0-9_]+)\s+(?:to\s+)?(true|false|\d+)\b/,
  );
  if (m) {
    return {
      command: `gamerule ${m[1]} ${m[2]}`,
      label: `gamerule ${m[1]}=${m[2]}`,
    };
  }

  // say / broadcast as Ava — command-shaped only (never mid-sentence "when I say")
  if (
    !/\bwhen\s+i\s+say\b/.test(q) &&
    !/\bgood\s+responses?\b/.test(q) &&
    !/\breact\s+positively\b/.test(q)
  ) {
    m = q.match(
      /^(?:ava[,:]?\s+)?(?:please\s+)?(?:say|broadcast|announce)\s+(?:in\s+game\s+|ingame\s+|to\s+the\s+server\s+)?[:\-]?\s*(.+)$/i,
    );
    if (m && m[1].trim().length >= 2) {
      const msg = m[1].trim().slice(0, 200).replace(/"/g, "");
      return { command: `say ${msg}`, label: `say: ${msg.slice(0, 60)}` };
    }
  }

  // list players
  if (
    /^(?:ava[,:]?\s+)?(?:list|who(?:'?s)?\s+online|players\s+online)\s*[?.!]*$/.test(
      q,
    )
  ) {
    return { command: "list", label: "list players" };
  }

  // Paper process control is handled outside RCON in tryHandleAlexMcOps
  if (
    /^(?:ava[,:]?\s+)?(?:please\s+)?(?:restart|reboot)\s+(?:the\s+)?(?:paper\s+)?(?:test\s+)?(?:minecraft\s+)?server\b/.test(
      q,
    ) ||
    /^(?:ava[,:]?\s+)?(?:please\s+)?restart\s*$/.test(q)
  ) {
    return { command: "__paper_restart__", label: "Paper test restart" };
  }
  if (
    /^(?:ava[,:]?\s+)?(?:please\s+)?(?:shut\s*down|shutdown|turn\s*off|stop)\s+(?:the\s+)?(?:paper\s+)?(?:test\s+)?(?:minecraft\s+)?server\b/.test(
      q,
    ) ||
    /^(?:ava[,:]?\s+)?(?:please\s+)?(?:shut\s*down|shutdown|turn\s*off)\s*$/.test(q)
  ) {
    return { command: "__paper_stop__", label: "Paper test stop" };
  }

  // raw console (Alex only path) — "rcon: worldborder set 500" or "/console worldborder set 500"
  m = q.match(/^(?:rcon|console)\s*[: ]\s*(.+)$/i);
  if (m) {
    const cmd = m[1].trim();
    if (cmd.length >= 2 && cmd.length <= 200) {
      return { command: cmd, label: `console: ${cmd}` };
    }
  }

  return null;
}

async function runPaperProcess(action) {
  const home = mcTestRoot();
  const logFile = path.join(
    String(process.env.AVA_HANDOFF || "/home/ava-core/ava").trim(),
    "logs",
    "paper-test.log",
  );
  const jar =
    fs.readdirSync(home).find((f) => /^paper-.*\.jar$/i.test(f)) || null;
  if (!jar) throw new Error("paper jar missing");

  const { spawn } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const { execFile } = await import("node:child_process");
  const execFileAsync = promisify(execFile);

  async function killPaper() {
    try {
      await execFileAsync("pkill", ["-f", "workstations/minecraft-test.*\\.jar"], {
        timeout: 5000,
      });
    } catch {
      /* no process */
    }
    await new Promise((r) => setTimeout(r, 2500));
    try {
      await execFileAsync("pkill", ["-9", "-f", "workstations/minecraft-test.*\\.jar"], {
        timeout: 5000,
      });
    } catch {
      /* none */
    }
    // Wait until session.lock free or gone
    const lock = path.join(home, "world", "session.lock");
    for (let i = 0; i < 20; i++) {
      try {
        await execFileAsync("bash", ["-lc", `! fuser '${lock}' >/dev/null 2>&1`], {
          timeout: 2000,
        });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
  }

  if (action === "stop") {
    await killPaper();
    return "Paper test **stopped**.";
  }

  await killPaper();
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  const out = fs.openSync(logFile, "a");
  const child = spawn("java", ["-Xms1G", "-Xmx2G", "-jar", jar, "--nogui"], {
    cwd: home,
    detached: true,
    stdio: ["ignore", out, out],
  });
  child.unref();
  return `Paper test **restarting** (pid ${child.pid}) · logs https://test.rootmc.net/logs/ · join 192.168.1.62:24945`;
}

/**
 * @returns {Promise<{ handled: boolean, reply?: string }>}
 */
export async function tryHandleAlexMcOps({
  text = "",
  isAlex = false,
  target = "",
} = {}) {
  if (!isAlex) return { handled: false };
  const parsed = parseAlexMcOps(text);
  if (!parsed) return { handled: false };

  if (parsed.command === "__paper_restart__" || parsed.command === "__paper_stop__") {
    try {
      const reply = await runPaperProcess(
        parsed.command === "__paper_stop__" ? "stop" : "restart",
      );
      appendAction("alexMcOps", {
        command: parsed.command,
        label: parsed.label,
        ok: true,
      });
      pushStatusEvent(`mc ops · ${parsed.label}`);
      return { handled: true, reply };
    } catch (err) {
      return {
        handled: true,
        reply: `Couldn't ${parsed.label}: ${err.message || err}`,
      };
    }
  }

  if (!rconConfigured()) {
    return {
      handled: true,
      reply:
        "I heard that ops ask, but RCON isn't configured yet — enable test RCON and AVA_RCON_TEST_*.",
    };
  }

  const dest = String(target || defaultTarget());

  if (parsed.borderPatch) {
    try {
      patchWorldBorderConfig(parsed.borderPatch);
    } catch (err) {
      return {
        handled: true,
        reply: `Couldn't update border config: ${err.message || err}`,
      };
    }
  }

  const result = await guardedRcon(parsed.command, {
    allow: true,
    target: dest,
    operatorConsole: true,
  });

  appendAction("alexMcOps", {
    command: parsed.command,
    label: parsed.label,
    target: dest,
    borderPatch: parsed.borderPatch || null,
    ok: Boolean(result.ok),
    reason: result.reason || null,
  });
  pushStatusEvent(
    result.ok
      ? `mc ops · ${parsed.label} · ${dest}`
      : `mc ops fail · ${result.reason} · ${dest}`,
  );

  if (!result.ok) {
    return {
      handled: true,
      reply: `Couldn't run **${parsed.label}** on **${dest}**: ${result.reason || "error"}`,
    };
  }

  const out = String(result.output || "").trim();
  const radiusNow = parsed.borderPatch?.radius ?? readWorldBorderRadius();
  return {
    handled: true,
    reply: [
      `Done on **${result.target || dest}**: ${parsed.label}`,
      parsed.borderPatch?.radius != null
        ? `(synced RootMC config radius ±${radiusNow})`
        : null,
      out ? `\`\`\`\n${out.slice(0, 800)}\n\`\`\`` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
