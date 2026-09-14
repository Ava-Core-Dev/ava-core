/**
 * /deep — operator Telegram command.
 * Full (or delta-since-last) dump of Discord + Slack + Telegram activity,
 * zip the report, send Alex the summary + zip on TG, save under handoff.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadEnv, botToken, slackBotToken, AVA_HANDOFF } from "./config.mjs";
import { storePaths, pushStatusEvent } from "./store.mjs";
import { appendAction } from "./fullLog.mjs";
import { postAvaTelegram, postAvaTelegramDocument } from "./avaPost.mjs";
import { isManipulationOperator } from "./recommend.mjs";

const AVA_ID = "1532751879875072070";
const LEGACY_ID = "1511794429986345020";
const GUILD = "1516108585740800042";
const ALEX_TG = "6644482344";
const ALEX_DISCORD = "1497037418979786823";

const DESKTOP_PACK =
  process.env.AVA_DEEP_DESKTOP_DIR ||
  "C:\\Users\\rootr\\OneDrive\\Desktop\\channels status";

/** Telegram Bot API document limit — stay under 50 MB. */
const TG_DOC_MAX_BYTES = 48 * 1024 * 1024;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function fileSizeMb(filePath) {
  return Math.round((fs.statSync(filePath).size / 1024 / 1024) * 10) / 10;
}

function zipDirectory(sourceDir, zipPath) {
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  if (process.platform === "win32") {
    const src = sourceDir.replace(/'/g, "''");
    const dest = zipPath.replace(/'/g, "''");
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${src}', '${dest}')`,
      ],
      { stdio: "pipe", timeout: 300_000 },
    );
  } else {
    try {
      execFileSync("zip", ["-r", "-q", zipPath, "."], {
        cwd: sourceDir,
        stdio: "pipe",
        timeout: 300_000,
      });
    } catch {
      const tgz = zipPath.replace(/\.zip$/i, ".tar.gz");
      if (fs.existsSync(tgz)) fs.unlinkSync(tgz);
      execFileSync("tar", ["-czf", tgz, "-C", sourceDir, "."], {
        stdio: "pipe",
        timeout: 300_000,
      });
      return tgz;
    }
  }
  return zipPath;
}

function listFilesRecursive(dir, base = dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listFilesRecursive(full, base));
    else out.push(path.relative(base, full));
  }
  return out;
}

/**
 * Build one or more archives for Telegram delivery.
 * @returns {Promise<Array<{ path: string, label: string }>>}
 */
export function buildDeepDumpArchives(reportDir, stamp) {
  const archives = [];
  const parent = path.dirname(reportDir);
  const fullZip = path.join(parent, `deep-${stamp}.zip`);
  const created = zipDirectory(reportDir, fullZip);
  if (fs.statSync(created).size <= TG_DOC_MAX_BYTES) {
    return [{ path: created, label: `deep ${stamp} · all` }];
  }
  if (fs.existsSync(fullZip)) fs.unlinkSync(fullZip);

  for (const sub of ["discord", "slack", "telegram"]) {
    const subDir = path.join(reportDir, sub);
    if (!fs.existsSync(subDir)) continue;
    const relFiles = listFilesRecursive(subDir);
    if (!relFiles.length) continue;
    const partZip = path.join(parent, `deep-${stamp}-${sub}.zip`);
    const made = zipDirectory(subDir, partZip);
    archives.push({ path: made, label: `deep ${stamp} · ${sub}` });
  }

  const summaryDir = path.join(reportDir, "_bundle");
  fs.mkdirSync(summaryDir, { recursive: true });
  for (const name of ["SUMMARY.md", "stats.json"]) {
    const src = path.join(reportDir, name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(summaryDir, name));
    }
  }
  const summaryZip = path.join(parent, `deep-${stamp}-summary.zip`);
  archives.push({
    path: zipDirectory(summaryDir, summaryZip),
    label: `deep ${stamp} · summary`,
  });
  try {
    fs.rmSync(summaryDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }

  return archives;
}

function mirrorDeepArchives(archives) {
  try {
    if (!fs.existsSync(path.dirname(DESKTOP_PACK))) return;
    fs.mkdirSync(DESKTOP_PACK, { recursive: true });
    for (let i = 0; i < archives.length; i++) {
      const a = archives[i];
      const dest =
        archives.length === 1
          ? path.join(DESKTOP_PACK, "DEEP-LATEST.zip")
          : path.join(
              DESKTOP_PACK,
              `DEEP-LATEST-${i + 1}-${path.basename(a.path)}`,
            );
      fs.copyFileSync(a.path, dest);
    }
  } catch {
    /* optional */
  }
}

/**
 * Send summary text + zip archive(s) to Alex on Telegram.
 */
export async function deliverDeepDumpToTelegram({
  chatId,
  summaryText,
  reportDir,
  stamp,
  mode = "delta",
} = {}) {
  const cid = String(chatId || "").replace(/^tg:/, "") || ALEX_TG;
  await postAvaTelegram({
    chatId: cid,
    content: summaryText,
    kind: "operator_directed",
    source: "deep-dump",
  });

  const archives = buildDeepDumpArchives(reportDir, stamp);
  mirrorDeepArchives(archives);

  for (let i = 0; i < archives.length; i++) {
    const a = archives[i];
    if (i > 0) await sleep(600);
    const mb = fileSizeMb(a.path);
    if (fs.statSync(a.path).size > TG_DOC_MAX_BYTES) {
      await postAvaTelegram({
        chatId: cid,
        content: `⚠️ **${a.label}** is ${mb} MB — over Telegram's 50 MB bot limit. Saved locally: \`${a.path}\``,
        kind: "operator_directed",
        source: "deep-dump-oversize",
      });
      continue;
    }
    await postAvaTelegramDocument({
      chatId: cid,
      filePath: a.path,
      caption: `${a.label} · ${mode} · ${mb} MB`,
      kind: "operator_directed",
      source: "deep-dump-zip",
    });
  }

  return { archives: archives.map((a) => a.path) };
}

function deepStatePath() {
  return path.join(storePaths().dir, "deep-dump.json");
}

function readDeepState() {
  try {
    if (!fs.existsSync(deepStatePath())) return {};
    return JSON.parse(fs.readFileSync(deepStatePath(), "utf8"));
  } catch {
    return {};
  }
}

function writeDeepState(s) {
  fs.mkdirSync(path.dirname(deepStatePath()), { recursive: true });
  fs.writeFileSync(deepStatePath(), JSON.stringify(s, null, 2), "utf8");
}

export function isDeepCommand(text = "") {
  const t = String(text || "")
    .replace(/^(\/[a-z0-9_]+)@[A-Za-z0-9_]+/i, "$1")
    .trim();
  return /^\/deep(?:\s+(full|delta|status|help))?\s*$/i.test(t);
}

export function parseDeepCommand(text = "") {
  const t = String(text || "")
    .replace(/^(\/[a-z0-9_]+)@[A-Za-z0-9_]+/i, "$1")
    .trim();
  const m = t.match(/^\/deep(?:\s+(full|delta|status|help))?\s*$/i);
  if (!m) return null;
  return { mode: (m[1] || "delta").toLowerCase() };
}

function reportsRoot() {
  const dir = path.join(AVA_HANDOFF, "reports", "deep-dumps");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function discordApi(token, pathname, opts = {}) {
  const res = await fetch(`https://discord.com/api/v10${pathname}`, {
    ...opts,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (res.status === 429) {
    await sleep((data.retry_after || 1) * 1000 + 250);
    return discordApi(token, pathname, opts);
  }
  return { ok: res.ok, status: res.status, data };
}

async function slackApi(token, method, body = null) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.json();
}

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

function snowflakeAfter(sinceMs) {
  // Discord snowflake ≈ (ms - Discord epoch) << 22
  const DISCORD_EPOCH = 1420070400000n;
  const ms = BigInt(Math.max(0, Number(sinceMs) || 0));
  return ((ms - DISCORD_EPOCH) << 22n).toString();
}

function classifyText(text = "") {
  const t = String(text || "");
  const tags = [];
  if (/rephrase that|say it another way|local core|still trying|mm\?/i.test(t))
    tags.push("thin_local_core");
  if (/digging|analytics brain|pulling it|brb in my brain|searching…/i.test(t))
    tags.push("dig_theater");
  if (/\b(cursor|grok|xai|chatgpt|claude|openai)\b/i.test(t)) tags.push("vendor_leak");
  if (t.length >= 900) tags.push("long_post");
  if (/EcoFlow|SOC|watts|solar day|status board|ava-core mood/i.test(t))
    tags.push("data_dump");
  if (/It appears that you have provided/i.test(t)) tags.push("pack_inventory");
  return tags;
}

/**
 * Run deep dump. mode: delta|full
 * @returns {Promise<{ ok: boolean, summaryText: string, reportDir: string, stats: object }>}
 */
export async function runDeepDump({
  mode = "delta",
  sinceMs = null,
  progress = null,
} = {}) {
  const env = await loadEnv();
  const dToken = botToken(env);
  const sToken = slackBotToken(env);
  if (!dToken) throw new Error("missing discord bot token");

  const state = readDeepState();
  const since =
    mode === "full"
      ? 0
      : Number(
          sinceMs != null
            ? sinceMs
            : state.lastDumpAt || Date.now() - 7 * 24 * 60 * 60_000,
        );
  const startedAt = Date.now();
  const stamp = new Date(startedAt).toISOString().replace(/[:.]/g, "-");
  const reportDir = path.join(reportsRoot(), stamp);
  fs.mkdirSync(reportDir, { recursive: true });
  fs.mkdirSync(path.join(reportDir, "discord"), { recursive: true });
  fs.mkdirSync(path.join(reportDir, "slack"), { recursive: true });
  fs.mkdirSync(path.join(reportDir, "telegram"), { recursive: true });

  const say = async (line) => {
    if (typeof progress === "function") {
      try {
        await progress(line);
      } catch {
        /* ignore */
      }
    }
  };

  await say(
    mode === "full"
      ? "deep · full scan starting…"
      : `deep · delta since ${new Date(since).toISOString()}…`,
  );

  const afterSnowflake = since > 0 ? snowflakeAfter(since) : null;
  const channelRows = [];
  const concernTally = {};

  // ---- Discord ----
  const listed = await discordApi(dToken, `/guilds/${GUILD}/channels`);
  if (!listed.ok) throw new Error(`discord list ${listed.status}`);
  const channels = (Array.isArray(listed.data) ? listed.data : []).filter((c) =>
    [0, 5].includes(c.type),
  );

  // include Alex DM
  const dm = await discordApi(dToken, `/users/@me/channels`, {
    method: "POST",
    body: JSON.stringify({ recipient_id: ALEX_DISCORD }),
  });
  if (dm.ok && dm.data?.id) {
    channels.push({ id: dm.data.id, name: "dm-alex", type: 1 });
  }

  let discordNew = 0;
  let discordAva = 0;
  for (const ch of channels) {
    const msgs = [];
    let before = null;
    let pages = mode === "full" ? 15 : 8;
    for (let page = 0; page < pages; page++) {
      const params = new URLSearchParams({ limit: "100" });
      if (before) {
        params.set("before", before);
      } else if (afterSnowflake && mode !== "full") {
        params.set("after", afterSnowflake);
      }
      const r = await discordApi(
        dToken,
        `/channels/${ch.id}/messages?${params}`,
      );
      if (!r.ok || !Array.isArray(r.data) || !r.data.length) break;
      let added = 0;
      for (const m of r.data) {
        const at = Date.parse(m.timestamp || 0);
        if (since && at && at < since) continue;
        msgs.push(m);
        added += 1;
      }
      before = r.data[r.data.length - 1].id;
      if (r.data.length < 100) break;
      const oldestAt = Date.parse(r.data[r.data.length - 1]?.timestamp || 0);
      if (since && oldestAt && oldestAt < since) break;
      if (!added && since) break;
      await sleep(280);
    }

    const compact = msgs.map((m) => ({
      id: m.id,
      at: m.timestamp,
      author: m.author?.username,
      authorId: m.author?.id,
      bot: Boolean(m.author?.bot),
      content: String(m.content || "").slice(0, 600),
    }));
    const ava = compact.filter(
      (m) => m.authorId === AVA_ID || m.authorId === LEGACY_ID,
    );
    discordNew += compact.length;
    discordAva += ava.length;
    for (const m of ava) {
      for (const tag of classifyText(m.content)) {
        concernTally[tag] = (concernTally[tag] || 0) + 1;
      }
    }
    const unanswered = compact.filter(
      (m) =>
        String(m.content || "").includes(`<@${AVA_ID}>`) &&
        m.authorId !== AVA_ID &&
        m.authorId !== LEGACY_ID,
    ).length;

    const file = path.join(
      reportDir,
      "discord",
      `${String(ch.name || ch.id).replace(/[^\w.-]+/g, "_")}__${ch.id}.json`,
    );
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          channel: { id: ch.id, name: ch.name, type: ch.type },
          since,
          fetched: compact.length,
          avaPosts: ava.length,
          unansweredMentions: unanswered,
          messages: compact,
        },
        null,
        2,
      ),
    );
    channelRows.push({
      surface: "discord",
      name: ch.name || ch.id,
      id: ch.id,
      fetched: compact.length,
      ava: ava.length,
      unanswered,
    });
  }
  await say(`deep · discord done · ${discordNew} msgs / ${discordAva} Ava`);

  // ---- Slack ----
  let slackNew = 0;
  if (sToken) {
    const channelsS = [];
    let cursor;
    do {
      const list = await slackApi(sToken, "conversations.list", {
        types: "public_channel,private_channel,im,mpim",
        limit: 200,
        cursor,
        exclude_archived: true,
      });
      if (!list.ok) break;
      channelsS.push(...(list.channels || []));
      cursor = list.response_metadata?.next_cursor || "";
    } while (cursor);

    const oldest = since > 0 ? String(since / 1000) : undefined;
    for (const ch of channelsS) {
      const msgs = [];
      let cursor2;
      for (let page = 0; page < (mode === "full" ? 10 : 4); page++) {
        const hist = await slackApi(sToken, "conversations.history", {
          channel: ch.id,
          limit: 200,
          cursor: cursor2 || undefined,
          oldest,
        });
        if (!hist.ok) break;
        msgs.push(...(hist.messages || []));
        cursor2 = hist.response_metadata?.next_cursor || "";
        if (!cursor2) break;
        await sleep(250);
      }
      slackNew += msgs.length;
      const name = ch.name || ch.user || ch.id;
      fs.writeFileSync(
        path.join(
          reportDir,
          "slack",
          `${String(name).replace(/[^\w.-]+/g, "_")}__${ch.id}.json`,
        ),
        JSON.stringify(
          {
            channel: { id: ch.id, name, is_im: ch.is_im },
            since,
            fetched: msgs.length,
            messages: msgs.map((m) => ({
              ts: m.ts,
              user: m.user || m.bot_id,
              text: String(m.text || "").slice(0, 500),
            })),
          },
          null,
          2,
        ),
      );
      channelRows.push({
        surface: "slack",
        name,
        id: ch.id,
        fetched: msgs.length,
        ava: 0,
        unanswered: 0,
      });
    }
    await say(`deep · slack done · ${slackNew} msgs`);
  } else {
    await say("deep · slack skipped (no token)");
  }

  // ---- Telegram (from Ava logs — Bot API can't backfill) ----
  const inbound = loadJsonl(path.join(storePaths().dir, "logs", "inbound.jsonl"));
  const outbound = loadJsonl(
    path.join(storePaths().dir, "logs", "outbound.jsonl"),
  );
  const tgIn = inbound.filter(
    (x) =>
      (String(x.channelId || "").includes(ALEX_TG) ||
        x.surface === "telegram") &&
      Number(x.at || 0) >= since,
  );
  const tgOut = outbound.filter(
    (x) =>
      (String(x.channelId || "").includes(ALEX_TG) ||
        x.surface === "telegram") &&
      Number(x.at || 0) >= since,
  );
  for (const m of tgOut) {
    for (const tag of classifyText(m.content)) {
      concernTally[tag] = (concernTally[tag] || 0) + 1;
    }
  }
  fs.writeFileSync(
    path.join(reportDir, "telegram", "alex-dm.json"),
    JSON.stringify({ since, inbound: tgIn, outbound: tgOut }, null, 2),
  );
  await say(`deep · telegram logs · in ${tgIn.length} / out ${tgOut.length}`);

  // ---- Summary ----
  const hotDiscord = channelRows
    .filter((r) => r.surface === "discord" && r.fetched > 0)
    .sort((a, b) => b.fetched - a.fetched)
    .slice(0, 12);
  const concernLines = Object.entries(concernTally)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `• ${k}: **${v}**`);

  const summaryMd = [
    `# Deep dump — ${mode}`,
    "",
    `Generated: ${new Date(startedAt).toISOString()}`,
    `Window: ${since ? new Date(since).toISOString() : "(full)"} → now`,
    "",
    "## Totals",
    "",
    `| Surface | New msgs | Notes |`,
    `|---------|----------|-------|`,
    `| Discord | ${discordNew} | Ava ${discordAva} |`,
    `| Slack | ${slackNew} | |`,
    `| Telegram Alex DM | in ${tgIn.length} / out ${tgOut.length} | from Ava logs |`,
    "",
    "## Hot Discord rooms (this window)",
    "",
    ...hotDiscord.map(
      (r) =>
        `- **#${r.name}** — ${r.fetched} msgs · Ava ${r.ava}${r.unanswered ? ` · unanswered @ ${r.unanswered}` : ""}`,
    ),
    "",
    "## Concern tags (Ava voice)",
    "",
    ...(concernLines.length ? concernLines : ["• none auto-tagged"]),
    "",
    "## Telegram sample (newest)",
    "",
    ...[...tgIn.map((m) => ({ ...m, _dir: "IN" })), ...tgOut.map((m) => ({ ...m, _dir: "OUT" }))]
      .sort((a, b) => Number(b.at) - Number(a.at))
      .slice(0, 8)
      .map((m) => {
        return `- ${m._dir} ${new Date(m.at).toISOString().slice(11, 19)} · ${String(m.content || "").replace(/\n/g, " ").slice(0, 140)}`;
      }),
    "",
    `Report dir: \`${reportDir}\``,
    "",
  ].join("\n");

  fs.writeFileSync(path.join(reportDir, "SUMMARY.md"), summaryMd, "utf8");
  fs.writeFileSync(
    path.join(reportDir, "stats.json"),
    JSON.stringify(
      {
        mode,
        since,
        startedAt,
        finishedAt: Date.now(),
        discordNew,
        discordAva,
        slackNew,
        tgIn: tgIn.length,
        tgOut: tgOut.length,
        concernTally,
        channels: channelRows,
      },
      null,
      2,
    ),
    "utf8",
  );

  // Mirror latest summary onto Desktop pack if present
  try {
    if (fs.existsSync(path.dirname(DESKTOP_PACK))) {
      fs.mkdirSync(DESKTOP_PACK, { recursive: true });
      fs.writeFileSync(
        path.join(DESKTOP_PACK, "DEEP-LATEST.md"),
        summaryMd,
        "utf8",
      );
      fs.writeFileSync(
        path.join(DESKTOP_PACK, "DEEP-LATEST-stats.json"),
        fs.readFileSync(path.join(reportDir, "stats.json")),
      );
    }
  } catch {
    /* optional */
  }

  const tgSummary = [
    `**deep ${mode}** · since ${since ? new Date(since).toISOString().slice(0, 16) : "full"}Z`,
    "",
    `Discord **${discordNew}** msgs (Ava **${discordAva}**)`,
    `Slack **${slackNew}** msgs`,
    `TG DM in **${tgIn.length}** / out **${tgOut.length}**`,
    "",
    concernLines.length
      ? `Concerns:\n${concernLines.slice(0, 8).join("\n")}`
      : "Concerns: none auto-tagged",
    "",
    "Hot Discord:",
    ...hotDiscord
      .slice(0, 8)
      .map((r) => `• #${r.name} ${r.fetched}/${r.ava}a`),
    "",
    `Files: \`reports/deep-dumps/${stamp}/\``,
    `Zip: \`deep-${stamp}.zip\` (sent here)`,
    `Desktop mirror: \`channels status/DEEP-LATEST.md\` + zip`,
  ].join("\n");

  writeDeepState({
    ...state,
    lastDumpAt: startedAt,
    lastFinishedAt: Date.now(),
    lastMode: mode,
    lastReportDir: reportDir,
    lastStats: {
      discordNew,
      discordAva,
      slackNew,
      tgIn: tgIn.length,
      tgOut: tgOut.length,
      concernTally,
    },
  });
  appendAction("deepDump.done", {
    mode,
    since,
    discordNew,
    slackNew,
    tgIn: tgIn.length,
    tgOut: tgOut.length,
  });
  pushStatusEvent(`deep ${mode} · d${discordNew} s${slackNew} tg${tgIn.length}/${tgOut.length}`);

  return {
    ok: true,
    summaryText: tgSummary,
    summaryMd,
    reportDir,
    stamp,
    stats: {
      discordNew,
      discordAva,
      slackNew,
      tgIn: tgIn.length,
      tgOut: tgOut.length,
      concernTally,
    },
  };
}

let deepRunning = false;

/**
 * Pipeline entry — Alex Telegram (or verified DM) only.
 */
export async function tryHandleDeepCommand({
  text,
  authorId,
  isDm = false,
  surface = "",
  channelId = "",
  reply,
} = {}) {
  if (!isDeepCommand(text)) return { handled: false };
  if (!isManipulationOperator(authorId)) {
    return {
      handled: true,
      reply: "**/deep** is Alex-only.",
    };
  }
  const privateOk =
    isDm ||
    String(surface).toLowerCase() === "telegram" ||
    String(channelId).includes(ALEX_TG);
  if (!privateOk) {
    return {
      handled: true,
      reply: "**/deep** is Telegram-private / DM only — ping me there.",
    };
  }

  const parsed = parseDeepCommand(text);
  const mode = parsed?.mode || "delta";
  if (mode === "help") {
    return {
      handled: true,
      reply: [
        "**`/deep`** — dump Discord + Slack + TG since last dump; summary + **zip** here.",
        "`/deep delta` — default · only what’s new since last `/deep`",
        "`/deep full` — broader backfill window",
        "`/deep status` — last dump watermark / stats",
      ].join("\n"),
    };
  }
  if (mode === "status") {
    const st = readDeepState();
    if (!st.lastDumpAt) {
      return {
        handled: true,
        reply: "No `/deep` dump recorded yet. Run `/deep` (delta) or `/deep full`.",
      };
    }
    return {
      handled: true,
      reply: [
        `Last deep: **${new Date(st.lastDumpAt).toISOString()}** (${st.lastMode || "?"})`,
        `Finished: ${st.lastFinishedAt ? new Date(st.lastFinishedAt).toISOString() : "—"}`,
        `Dir: \`${st.lastReportDir || "?"}\``,
        st.lastStats
          ? `Stats: d${st.lastStats.discordNew} s${st.lastStats.slackNew} tg ${st.lastStats.tgIn}/${st.lastStats.tgOut}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  if (deepRunning || readDeepState().running) {
    return {
      handled: true,
      reply: "A `/deep` dump is already running — summary + zip when it’s done.",
    };
  }

  deepRunning = true;
  writeDeepState({ ...readDeepState(), running: true, runningAt: Date.now() });

  const ack =
    mode === "full"
      ? "on it — **full** deep dump. Summary + zip landing here when done (a few minutes)."
      : "on it — **delta** deep dump since last one. Summary + zip landing here when done.";

  // Fire async so pipeline can return the ack immediately
  setTimeout(() => {
    (async () => {
      try {
        const chatId = String(channelId || "").replace(/^tg:/, "") || ALEX_TG;
        let lastProgress = 0;
        const result = await runDeepDump({
          mode: mode === "full" ? "full" : "delta",
          progress: async (line) => {
            const now = Date.now();
            if (now - lastProgress < 25_000) return;
            lastProgress = now;
            try {
              await postAvaTelegram({
                chatId,
                content: line,
                kind: "operator_directed",
                source: "deep-dump-progress",
              });
            } catch {
              /* ignore progress failures */
            }
          },
        });
        await deliverDeepDumpToTelegram({
          chatId,
          summaryText: result.summaryText,
          reportDir: result.reportDir,
          stamp: result.stamp,
          mode: mode === "full" ? "full" : "delta",
        });
      } catch (err) {
        try {
          await postAvaTelegram({
            chatId: ALEX_TG,
            content: `deep dump failed: ${err?.message || err}`,
            kind: "operator_directed",
            source: "deep-dump-error",
          });
        } catch {
          /* ignore */
        }
        appendAction("deepDump.error", { error: String(err?.message || err) });
      } finally {
        deepRunning = false;
        writeDeepState({ ...readDeepState(), running: false });
      }
    })();
  }, 50);

  return { handled: true, reply: ack, async: true };
}
