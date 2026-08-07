/**
 * Root-Skills levels from local MySQL mirror (root_skills_*).
 */
import { spawnSync } from "node:child_process";

function envTrim(...keys) {
  for (const k of keys) {
    const v = String(process.env[k] || "").trim();
    if (v) return v;
  }
  return "";
}

function mysqlCfg() {
  return {
    host: envTrim("ROOTMC_LOCAL_MYSQL_HOST") || "127.0.0.1",
    port: envTrim("ROOTMC_LOCAL_MYSQL_PORT") || "3306",
    user: envTrim("ROOTMC_LOCAL_MYSQL_USER"),
    password: envTrim("ROOTMC_LOCAL_MYSQL_PASSWORD"),
    database: envTrim("ROOTMC_LOCAL_MYSQL_DATABASE"),
  };
}

function mysqlQuery(sql) {
  const c = mysqlCfg();
  if (!c.user || !c.database) {
    return { ok: false, reason: "mysql_env_missing", rows: [] };
  }
  const r = spawnSync(
    "mysql",
    [
      "-h",
      c.host,
      "-P",
      c.port,
      "-u",
      c.user,
      `-p${c.password}`,
      c.database,
      "-N",
      "-B",
      "-e",
      sql,
    ],
    { encoding: "utf8", timeout: 12_000 },
  );
  if (r.status !== 0) {
    return {
      ok: false,
      reason: (r.stderr || r.stdout || "mysql_fail").slice(0, 180),
      rows: [],
    };
  }
  const rows = String(r.stdout || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split("\t"));
  return { ok: true, rows };
}

export async function lookupRootSkills(username = "Alexrs94") {
  const name = String(username || "Alexrs94").replace(/[^a-zA-Z0-9_]/g, "");
  if (!name) return { ok: false, reason: "bad_username" };

  const userQ = mysqlQuery(
    `SELECT uuid, username, class_id, mana FROM root_skills_users WHERE username='${name}' LIMIT 1;`,
  );
  if (!userQ.ok) return userQ;
  if (!userQ.rows.length) {
    return { ok: false, reason: "player_not_found", username: name };
  }
  const [uuid, uname, classId, mana] = userQ.rows[0];
  const skillsQ = mysqlQuery(
    `SELECT skill_id, level, xp, prestige FROM root_skills_skills WHERE uuid='${uuid}' ORDER BY level DESC, xp DESC;`,
  );
  if (!skillsQ.ok) return skillsQ;

  const skills = skillsQ.rows.map(([skillId, level, xp, prestige]) => ({
    skillId,
    level: Number(level) || 0,
    xp: Number(xp) || 0,
    prestige: Number(prestige) || 0,
  }));
  const totalLevels = skills.reduce((a, s) => a + s.level, 0);
  const totalXp = skills.reduce((a, s) => a + s.xp, 0);
  const totalPrestige = skills.reduce((a, s) => a + s.prestige, 0);
  const top = skills.slice(0, 8);

  return {
    ok: true,
    username: uname || name,
    uuid,
    classId: classId || "—",
    mana: Number(mana) || 0,
    skillCount: skills.length,
    totalLevels,
    totalXp,
    totalPrestige,
    top,
    skills,
  };
}

export function formatRootSkillsBrief(data) {
  if (!data?.ok) {
    if (data?.reason === "player_not_found") {
      return `No Root-Skills row for **${data.username}** on the local MySQL mirror yet.`;
    }
    return `Couldn't read Root-Skills MySQL (${data?.reason || "unknown"}).`;
  }
  const topLines = data.top.length
    ? data.top
        .map(
          (s) =>
            `• **${s.skillId}** — lvl ${s.level} · xp ${s.xp}${s.prestige ? ` · prestige ${s.prestige}` : ""}`,
        )
        .join("\n")
    : "• (no skill rows yet — player registered, levels still 0)";
  return [
    `**${data.username}** Root-Skills (local MySQL mirror)`,
    `class: ${data.classId} · mana: ${data.mana}`,
    `skills tracked: ${data.skillCount} · Σ levels **${data.totalLevels}** · Σ xp **${data.totalXp}** · Σ prestige **${data.totalPrestige}**`,
    "Top:",
    topLines,
  ].join("\n");
}

/** Detect "what's my/X skill level" style asks. */
export function parseSkillsLevelAsk(text = "") {
  const q = String(text || "").trim();
  if (!q) return null;
  const m =
    q.match(
      /\b(?:what(?:'s| is)|check|show|lookup|get)\b.{0,40}\b(?:skill\s*levels?|skills?\s*level|root-?skills?|power\s*level)\b.{0,40}\b(?:for|of)?\s*([A-Za-z0-9_]{3,16})?/i,
    ) ||
    q.match(
      /\b([A-Za-z0-9_]{3,16})(?:'s)?\s+(?:current\s+)?(?:skill\s*levels?|skills?\s*level)\b/i,
    ) ||
    q.match(
      /\b(?:my|alex(?:rs94)?(?:'s)?)\s+(?:current\s+)?(?:skill\s*levels?|skills?\s*level|root-?skills?)\b/i,
    );
  if (!m && !/\b(skill\s*levels?|skills?\s*level|root-?skills?\s+levels?)\b/i.test(q)) {
    return null;
  }
  let who =
    (m && m[1]) ||
    (/\bmy\b/i.test(q) || /\balex/i.test(q) ? "Alexrs94" : null);
  if (!who) who = "Alexrs94";
  if (/^(my|me|alex|his|her|your)$/i.test(who)) who = "Alexrs94";
  return { username: who };
}
