/**
 * Build detailed markdown reports from _raw dumps → channels status/
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = "C:\\Users\\rootr\\OneDrive\\Desktop\\channels status";
const RAW = path.join(ROOT, "_raw");
const AVA_ID = "1532751879875072070";
const LEGACY_ID = "1511794429986345020";

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function ts(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toISOString();
  } catch {
    return String(iso);
  }
}

function slackTs(t) {
  if (!t) return "—";
  const sec = Number(String(t).split(".")[0]);
  if (!sec) return String(t);
  return new Date(sec * 1000).toISOString();
}

function concernsFromMessages(messages, surface) {
  const concerns = [];
  const avaThin = [];
  const unanswered = [];
  const digTheater = [];
  const vendor = [];
  const longPosts = [];
  const dataDump = [];

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    const text =
      surface === "discord"
        ? m.content || ""
        : surface === "slack"
          ? m.text || ""
          : m.text || "";
    const authorId = String(m.authorId || m.user || m.from || "");
    const isAva =
      surface === "discord"
        ? authorId === AVA_ID || authorId === LEGACY_ID || m.bot === true
        : /ava|bot/i.test(String(m.from || m.user || ""));

    if (isAva) {
      if (/rephrase that|local core|still trying|say it another way|mm\?/i.test(text)) {
        avaThin.push(m);
      }
      if (/digging|in my brain|brb in my brain|searching…|analytics brain/i.test(text)) {
        digTheater.push(m);
      }
      if (/\b(cursor|grok|xai|chatgpt|claude|openai)\b/i.test(text)) {
        vendor.push(m);
      }
      if (text.length >= 900) longPosts.push(m);
      if (/EcoFlow|SOC|watts|solar day|panels|ava-core mood|status board/i.test(text)) {
        dataDump.push(m);
      }
    }

    if (surface === "discord" && text.includes(`<@${AVA_ID}>`) && authorId !== AVA_ID) {
      // look for later Ava reply (messages are newest-first)
      const later = messages.slice(0, i);
      const replied = later.some(
        (x) =>
          (x.authorId === AVA_ID || x.authorId === LEGACY_ID) &&
          (x.ref === m.id || true),
      );
      // crude: if no Ava message within next 5 newer msgs, flag
      const window = messages.slice(Math.max(0, i - 8), i);
      const hasReply = window.some(
        (x) => x.authorId === AVA_ID || x.authorId === LEGACY_ID,
      );
      if (!hasReply) unanswered.push(m);
    }
  }

  if (avaThin.length)
    concerns.push({
      sev: "high",
      id: "thin_local_core",
      title: "Thin local-core / rephrase loops",
      count: avaThin.length,
      samples: avaThin.slice(0, 5),
    });
  if (digTheater.length)
    concerns.push({
      sev: "high",
      id: "dig_theater",
      title: "Dig-theater / performing status lines",
      count: digTheater.length,
      samples: digTheater.slice(0, 5),
    });
  if (vendor.length)
    concerns.push({
      sev: "medium",
      id: "vendor_leak",
      title: "Vendor names in public voice",
      count: vendor.length,
      samples: vendor.slice(0, 5),
    });
  if (longPosts.length)
    concerns.push({
      sev: "medium",
      id: "long_posts",
      title: "Novel-length posts (900+ chars)",
      count: longPosts.length,
      samples: longPosts.slice(0, 3),
    });
  if (dataDump.length)
    concerns.push({
      sev: "medium",
      id: "data_dump",
      title: "Ops/solar/status dumps in channel",
      count: dataDump.length,
      samples: dataDump.slice(0, 3),
    });
  if (unanswered.length)
    concerns.push({
      sev: "high",
      id: "unanswered_mentions",
      title: "Likely unanswered @Ava mentions",
      count: unanswered.length,
      samples: unanswered.slice(0, 8),
    });

  return concerns;
}

function mdSample(m, surface) {
  if (surface === "discord") {
    return `- \`${m.at || m.id}\` **${m.author || "?"}**: ${String(m.content || "").replace(/\n/g, " ").slice(0, 280)}`;
  }
  if (surface === "slack") {
    return `- \`${slackTs(m.ts)}\` **${m.user || "?"}**: ${String(m.text || "").replace(/\n/g, " ").slice(0, 280)}`;
  }
  return `- \`${m.date || m.id}\` **${m.from || "?"}**: ${String(m.text || "").replace(/\n/g, " ").slice(0, 280)}`;
}

function writeChannelReport({
  surface,
  name,
  id,
  meta,
  messages,
  outPath,
  extra = {},
}) {
  const concerns = concernsFromMessages(messages || [], surface);
  const avaMsgs = (messages || []).filter((m) => {
    if (surface === "discord") return m.authorId === AVA_ID || m.authorId === LEGACY_ID;
    if (surface === "telegram") return /bot|ava/i.test(String(m.from || ""));
    return false;
  });
  const newest = messages?.[0];
  const oldest = messages?.[messages.length - 1];

  const lines = [];
  lines.push(`# ${surface.toUpperCase()} — ${name}`);
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## Identity");
  lines.push("");
  lines.push(`| Field | Value |`);
  lines.push(`|------|-------|`);
  lines.push(`| Surface | ${surface} |`);
  lines.push(`| Name | ${name} |`);
  lines.push(`| ID | \`${id}\` |`);
  if (meta?.type != null) lines.push(`| Discord type | ${meta.type} |`);
  if (meta?.topic) lines.push(`| Topic | ${meta.topic} |`);
  if (meta?.purpose) lines.push(`| Purpose | ${meta.purpose} |`);
  if (meta?.is_im != null) lines.push(`| Slack IM | ${meta.is_im} |`);
  if (meta?.parent_id) lines.push(`| Parent | \`${meta.parent_id}\` |`);
  lines.push(`| Messages fetched | **${messages?.length || 0}** |`);
  lines.push(`| Ava posts (in fetch) | **${avaMsgs.length}** |`);
  if (surface === "discord") {
    lines.push(`| Newest | ${ts(newest?.at)} |`);
    lines.push(`| Oldest in window | ${ts(oldest?.at)} |`);
  } else if (surface === "slack") {
    lines.push(`| Newest | ${slackTs(newest?.ts)} |`);
    lines.push(`| Oldest in window | ${slackTs(oldest?.ts)} |`);
  }
  lines.push("");

  lines.push("## Current state");
  lines.push("");
  if (!messages?.length) {
    lines.push("- **Empty or unreadable** in this dump window (no messages returned, or bot lacks history access).");
  } else {
    const lastAva = avaMsgs[0];
    lines.push(`- Last activity in window: ${surface === "slack" ? slackTs(newest?.ts) : ts(newest?.at || newest?.date)}`);
    if (lastAva) {
      lines.push(
        `- Last Ava voice in window: ${String(lastAva.content || lastAva.text || "").replace(/\n/g, " ").slice(0, 240)}`,
      );
    } else {
      lines.push("- **No Ava posts** found in the fetched window.");
    }
    const humanRecent = (messages || [])
      .filter((m) => {
        if (surface === "discord") return m.authorId !== AVA_ID && m.authorId !== LEGACY_ID && !m.bot;
        return true;
      })
      .slice(0, 3);
    if (humanRecent.length) {
      lines.push("- Recent non-Ava traffic (sample):");
      for (const m of humanRecent) lines.push(`  ${mdSample(m, surface)}`);
    }
  }
  for (const [k, v] of Object.entries(extra)) {
    lines.push(`- **${k}:** ${v}`);
  }
  lines.push("");

  lines.push("## Concerns");
  lines.push("");
  if (!concerns.length) {
    lines.push("- None auto-detected in this window (still review recent traffic manually).");
  } else {
    for (const c of concerns) {
      lines.push(`### [${c.sev}] ${c.title} (\`${c.id}\`) — count ${c.count}`);
      lines.push("");
      for (const s of c.samples || []) lines.push(mdSample(s, surface));
      lines.push("");
    }
  }

  lines.push("## What needs done");
  lines.push("");
  const todos = [];
  if (concerns.some((c) => c.id === "unanswered_mentions")) {
    todos.push("Triage unanswered @Ava mentions — reply or log as note-keeper intentional skip.");
  }
  if (concerns.some((c) => c.id === "thin_local_core")) {
    todos.push("Purge/suppress thin local-core rephrase loops; ensure Cursor failover when dream key missing.");
  }
  if (concerns.some((c) => c.id === "dig_theater")) {
    todos.push("Scrub remaining dig-theater lines; keep proposal surfaces blocked from theater.");
  }
  if (concerns.some((c) => c.id === "vendor_leak")) {
    todos.push("Delete or edit vendor-name leaks; verify scrub on outbound.");
  }
  if (concerns.some((c) => c.id === "data_dump")) {
    todos.push("Keep solar/ops dumps off public; route to #updates or private ops only.");
  }
  if (concerns.some((c) => c.id === "long_posts")) {
    todos.push("Enforce public length cap except formal PROP writeups.");
  }
  if (!messages?.length) {
    todos.push("Verify Ava bot can read this channel (permissions / membership / archive).");
  }
  if (!todos.length) {
    todos.push("Maintain watch; no urgent repairs flagged from this window.");
  }
  for (const t of todos) lines.push(`- [ ] ${t}`);
  lines.push("");

  lines.push("## Recent message window (newest first, truncated)");
  lines.push("");
  for (const m of (messages || []).slice(0, 40)) {
    lines.push(mdSample(m, surface));
  }
  lines.push("");
  lines.push("## Raw dump");
  lines.push("");
  lines.push(`Source JSON under \`_raw/${surface}/\` for this channel id \`${id}\`.`);
  lines.push("");

  ensureDir(path.dirname(outPath));
  fs.writeFileSync(outPath, lines.join("\n"), "utf8");
  return { name, id, concerns, messageCount: messages?.length || 0, avaCount: avaMsgs.length, todos };
}

// ---- Discord ----
ensureDir(path.join(ROOT, "discord"));
const dInv = readJson(path.join(RAW, "discord", "_inventory.json")) || [];
const discordReports = [];
for (const row of dInv) {
  if (row.skipped) {
    const p = path.join(
      ROOT,
      "discord",
      `${String(row.name).replace(/[^\w.-]+/g, "_")}__${row.id}.md`,
    );
    fs.writeFileSync(
      p,
      `# DISCORD — ${row.name}\n\nID: \`${row.id}\`\nType: ${row.type}\n\nSkipped (non-text). Reason: ${row.reason}\n`,
    );
    discordReports.push({ name: row.name, id: row.id, skipped: true });
    continue;
  }
  const rawFile = path.join(RAW, "discord", row.file || "");
  const pack = rawFile && fs.existsSync(rawFile) ? readJson(rawFile) : null;
  const out = path.join(
    ROOT,
    "discord",
    `${String(row.name).replace(/[^\w.-]+/g, "_")}__${row.id}.md`,
  );
  discordReports.push(
    writeChannelReport({
      surface: "discord",
      name: row.name,
      id: row.id,
      meta: pack?.channel || row,
      messages: pack?.messages || [],
      outPath: out,
      extra: {
        "Fetch ok": String(row.ok),
        "HTTP status": String(row.status || pack?.status || ""),
      },
    }),
  );
}

// ---- Slack ----
ensureDir(path.join(ROOT, "slack"));
const sInv = readJson(path.join(RAW, "slack", "_inventory.json")) || [];
const slackReports = [];
for (const row of sInv) {
  const rawFile = path.join(RAW, "slack", row.file || "");
  const pack = rawFile && fs.existsSync(rawFile) ? readJson(rawFile) : null;
  const out = path.join(
    ROOT,
    "slack",
    `${String(row.name).replace(/[^\w.-]+/g, "_")}__${row.id}.md`,
  );
  slackReports.push(
    writeChannelReport({
      surface: "slack",
      name: row.name,
      id: row.id,
      meta: pack?.channel || row,
      messages: pack?.messages || [],
      outPath: out,
      extra: {
        "Fetch ok": String(row.ok !== false),
        Error: row.error || "none",
      },
    }),
  );
}

// ---- Telegram ----
ensureDir(path.join(ROOT, "telegram"));
const tgSum = readJson(path.join(RAW, "telegram", "_summary.json")) || {};
const tgMe = tgSum.me?.result || {};
const tgChat = tgSum.chat?.result || {};
const tgMsgs = tgSum.liveUpdateMsgs || [];

// Merge local telegram context if present
let localCtx = [];
const localTgCtx = path.join(RAW, "telegram");
for (const f of fs.readdirSync(localTgCtx)) {
  if (!f.startsWith("local__") || !f.endsWith(".json")) continue;
  const j = readJson(path.join(localTgCtx, f));
  if (j && typeof j === "object") {
    // telegram-context.json shape: { "6644482344": [ {who,text,at} ] }
    if (j["6644482344"] && Array.isArray(j["6644482344"])) {
      localCtx = j["6644482344"].map((m) => ({
        from: m.who,
        text: m.text,
        date: m.at,
        id: m.at,
      }));
    }
  }
}

const tgCombined = [...tgMsgs, ...localCtx];
const tgReport = writeChannelReport({
  surface: "telegram",
  name: "DM Alex (@WildEcho94)",
  id: "6644482344",
  meta: { topic: tgChat.username || tgChat.first_name || "Alex" },
  messages: tgCombined,
  outPath: path.join(ROOT, "telegram", "DM-Alex__6644482344.md"),
  extra: {
    "Bot username": tgMe.username || "?",
    "Bot id": String(tgMe.id || "?"),
    "Chat getChat ok": String(tgSum.chat?.ok),
    "History limitation":
      "Telegram Bot API cannot paginate full private history — dump uses getUpdates + local Ava buffers only.",
    "Local buffer files": (tgSum.localCopy || []).join(", ") || "none",
    "Handoff snips": (tgSum.handoffSnips || []).join(", ") || "none",
  },
});

// last-reply telegram
const lastReply = readJson(path.join(RAW, "ava-runtime", "last-reply.json")) || {};
const mood = readJson(path.join(RAW, "ava-runtime", "mood.json")) || {};
const lockout = readJson(path.join(RAW, "ava-runtime", "lockout.json")) || {};
const digHealth = readJson(path.join(RAW, "ava-runtime", "dig-health.json")) || {};
const hush = readJson(path.join(RAW, "ava-runtime", "hush.json")) || {};

// Enrich TG report with last-reply
fs.appendFileSync(
  path.join(ROOT, "telegram", "DM-Alex__6644482344.md"),
  [
    "",
    "## Ava last-reply store (runtime)",
    "",
    "```",
    String(lastReply["tg:6644482344"] || "(none)"),
    "```",
    "",
    "## Why you may have seen no response",
    "",
    "- OptiPlex `192.168.1.62` / `ava-core` was **unreachable** — primary brain host down.",
    "- Runtime had **lockout ON** (Alex verified DMs only) then restored on laptop failover.",
    `- Last stored TG reply text: ${JSON.stringify(lastReply["tg:6644482344"] || null)}`,
    `- Current mood snapshot at dump: ${JSON.stringify(mood)}`,
    `- Lockout file: ${JSON.stringify(lockout)}`,
    `- Dig health: ${JSON.stringify(digHealth)}`,
    `- Hush: ${JSON.stringify(hush)}`,
    "",
  ].join("\n"),
);

// ---- INDEX + ROADMAP + CONCERNS ----
const allConcerns = [];
for (const r of discordReports) {
  for (const c of r.concerns || []) {
    allConcerns.push({ surface: "discord", channel: r.name, id: r.id, ...c });
  }
}
for (const r of slackReports) {
  for (const c of r.concerns || []) {
    allConcerns.push({ surface: "slack", channel: r.name, id: r.id, ...c });
  }
}
for (const c of tgReport.concerns || []) {
  allConcerns.push({ surface: "telegram", channel: tgReport.name, id: tgReport.id, ...c });
}

const roadmap = [];
roadmap.push({
  pri: "P0",
  item: "Keep Ava brain reachable — OptiPlex offline; laptop failover is temporary. Restore ava-core SSH/LAN or keep laptop poller supervised.",
});
roadmap.push({
  pri: "P0",
  item: "Grok/xAI keys removed after $5/6h spend — Discord dream must not ghost; Cursor/llama failover (code patched). Do not re-add xAI without budget cap.",
});
roadmap.push({
  pri: "P0",
  item: "Confirm Telegram DM replies work end-to-end on laptop poller (user reported no TG response).",
});
roadmap.push({
  pri: "P1",
  item: "Clear dig-health dream http_403 outage or accept Cursor-only Discord until free-cloud keys exist.",
});
roadmap.push({
  pri: "P1",
  item: "Purge remaining dig-theater / thin local-core lines from Discord history where still visible.",
});
roadmap.push({
  pri: "P1",
  item: "Revisit note-keeper vs live voice — AVA_NOTE_KEEPER / backend-ops quiet era may still be intended; document operator intent.",
});
roadmap.push({
  pri: "P2",
  item: "Slack: ensure Ava joins/watches all staff channels needed beyond development-feed + plans.",
});
roadmap.push({
  pri: "P2",
  item: "Telegram: add durable DM transcript vault (Bot API cannot backfill) so audits are not getUpdates-only.",
});
roadmap.push({
  pri: "P2",
  item: "cloudflared tunnel credentials path still Linux (`/home/ava-core/...`) on Windows failover — fix path or disable noisy tunnel on laptop.",
});
roadmap.push({
  pri: "P3",
  item: "Publish this `channels status` pack to GitHub Ava docs; keep regenerated on major mode changes.",
});

// Auto-add from concerns
const byId = new Map();
for (const c of allConcerns) {
  const key = c.id;
  if (!byId.has(key)) byId.set(key, { ...c, channels: [] });
  byId.get(key).channels.push(`${c.surface}:${c.channel}`);
}
for (const [id, c] of byId) {
  roadmap.push({
    pri: c.sev === "high" ? "P1" : "P2",
    item: `Repair \`${id}\` (${c.title}) across: ${[...new Set(c.channels)].slice(0, 12).join(", ")}`,
  });
}

const index = [];
index.push("# Ava Channels Status — Master Index");
index.push("");
index.push(`Generated: ${new Date().toISOString()}`);
index.push("");
index.push("This pack is the operator truth dump for Ava across **Discord / Slack / Telegram**.");
index.push("Each channel has its own markdown file. Raw JSON lives in `_raw/`.");
index.push("");
index.push("## Runtime snapshot");
index.push("");
index.push("```json");
index.push(
  JSON.stringify(
    { mood, lockout, hush, digHealth, lastReplyKeys: Object.keys(lastReply) },
    null,
    2,
  ),
);
index.push("```");
index.push("");
index.push("## Platform counts");
index.push("");
index.push(`| Platform | Channel files |`);
index.push(`|----------|---------------|`);
index.push(`| Discord | ${discordReports.length} |`);
index.push(`| Slack | ${slackReports.length} |`);
index.push(`| Telegram | 1 (Alex DM + buffers) |`);
index.push("");
index.push("## Discord channels");
index.push("");
for (const r of discordReports.sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
  const file = `discord/${String(r.name).replace(/[^\w.-]+/g, "_")}__${r.id}.md`;
  index.push(
    `- [${r.name}](${file}) — msgs ${r.messageCount ?? "—"} · Ava ${r.avaCount ?? "—"} · concerns ${(r.concerns || []).length}${r.skipped ? " · skipped" : ""}`,
  );
}
index.push("");
index.push("## Slack channels");
index.push("");
for (const r of slackReports.sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
  const file = `slack/${String(r.name).replace(/[^\w.-]+/g, "_")}__${r.id}.md`;
  index.push(
    `- [${r.name}](${file}) — msgs ${r.messageCount ?? "—"} · concerns ${(r.concerns || []).length}`,
  );
}
index.push("");
index.push("## Telegram");
index.push("");
index.push(`- [DM Alex](telegram/DM-Alex__6644482344.md) — msgs ${tgReport.messageCount} · concerns ${(tgReport.concerns || []).length}`);
index.push("");
index.push("## See also");
index.push("");
index.push("- [CONCERNS.md](CONCERNS.md) — rolled-up issues");
index.push("- [ROADMAP-REPAIRS.md](ROADMAP-REPAIRS.md) — repair backlog for Ava");
index.push("- [WHAT-AVA-IS.md](WHAT-AVA-IS.md) — identity / brain / hosting truth");
index.push("");
fs.writeFileSync(path.join(ROOT, "README.md"), index.join("\n"), "utf8");

const concernsMd = [];
concernsMd.push("# Ava — Rolled-up Concerns");
concernsMd.push("");
concernsMd.push(`Generated: ${new Date().toISOString()}`);
concernsMd.push("");
concernsMd.push("## Systemic (host / brain)");
concernsMd.push("");
concernsMd.push("1. **OptiPlex / ava-core offline** on LAN (`192.168.1.62` unreachable). Primary brain host missing → all-channel silence until laptop failover.");
concernsMd.push("2. **Grok/xAI spend** (~$5 / 6h) — keys blanked. Dream path must not be required for Discord answers.");
concernsMd.push("3. **Lockout** had been ON (Alex DM-only). Cleared during failover; verify it stays off unless intentional companion session.");
concernsMd.push("4. **dig-health** showed dream `http_403` outage during dump window.");
concernsMd.push("5. **Telegram history** cannot be fully audited via Bot API — operational blind spot.");
concernsMd.push("6. Prior **note-keeper / backend-ops quiet era** (2026-08-05) intentionally reduced public voice — distinguish intentional quiet vs broken.");
concernsMd.push("");
concernsMd.push("## Per-pattern (from channel scans)");
concernsMd.push("");
for (const [id, c] of [...byId.entries()].sort()) {
  concernsMd.push(`### \`${id}\` — ${c.title}`);
  concernsMd.push("");
  concernsMd.push(`- Severity: **${c.sev}**`);
  concernsMd.push(`- Channels: ${[...new Set(c.channels)].join(", ")}`);
  concernsMd.push("");
}
concernsMd.push("## Prior Discord findings (2026-08-05 note-keeper rescan)");
concernsMd.push("");
concernsMd.push("From `ava-notes/DISCORD-FINDINGS.md`: dig_theater 20, vendor_leak 2, long_900+ 28, local_core 3, data_dump 46, unanswered mentions 3. Worst rooms: general, development, updates.");
concernsMd.push("");
fs.writeFileSync(path.join(ROOT, "CONCERNS.md"), concernsMd.join("\n"), "utf8");

const roadMd = [];
roadMd.push("# Ava — Repair Roadmap");
roadMd.push("");
roadMd.push(`Generated: ${new Date().toISOString()}`);
roadMd.push("");
roadMd.push("Use this as the living repair backlog for GitHub Ava docs.");
roadMd.push("");
for (const pri of ["P0", "P1", "P2", "P3"]) {
  roadMd.push(`## ${pri}`);
  roadMd.push("");
  for (const r of roadmap.filter((x) => x.pri === pri)) {
    roadMd.push(`- [ ] ${r.item}`);
  }
  roadMd.push("");
}
fs.writeFileSync(path.join(ROOT, "ROADMAP-REPAIRS.md"), roadMd.join("\n"), "utf8");

const who = [];
who.push("# What Ava Is — Current Truth");
who.push("");
who.push(`Generated: ${new Date().toISOString()}`);
who.push("");
who.push("## Identity");
who.push("");
who.push("- **Name:** Ava Ivy — lead developer voice of RootMC");
who.push("- **Discord app/bot:** `1532751879875072070` (Ava Ivy)");
who.push("- **Legacy RootMC bot (sometimes still present in history):** `1511794429986345020`");
who.push("- **Slack bot user:** `U0BMBNYPYA2`");
who.push("- **Telegram:** BotFather token `AVA_TELEGRAM_BOT_TOKEN`; Alex `@WildEcho94` / `6644482344`");
who.push("");
who.push("## Brains (ladder)");
who.push("");
who.push("1. **Discord (stock):** dream state — was xAI/Grok; **keys removed** → must failover to Cursor / free-cloud / llama");
who.push("2. **Slack / on-device:** Cursor Root Server digs (`CURSOR_API_KEY`)");
who.push("3. **Local organizer:** Ollama / llama on OptiPlex (`AVA_OLLAMA_*`) — OptiPlex currently offline");
who.push("4. **Mode 1 / AVA_CORE_LLAMA:** public llama-only");
who.push("5. **Lockout:** Alex verified DMs only (companion) — not the same as Mode 1");
who.push("");
who.push("## Hosting");
who.push("");
who.push("| Role | Path / host | Status at dump |");
who.push("|------|-------------|----------------|");
who.push("| Canonical code | `E:\\.1 Work Stations\\RootMC\\Web Files\\rootmc-ava` | present |");
who.push("| Handoff / data | `E:\\.Ava_Ivy` | present |");
who.push("| Primary brain host | OptiPlex Ubuntu `ava-core` @ `192.168.1.62` | **UNREACHABLE** |");
who.push("| Failover | Laptop Node poller `:8787` | was started for recovery |");
who.push("| Desktop UI | `Ava Ivy.exe` Post tab | Discord/Slack/Telegram manual post |");
who.push("");
who.push("## Operator hard locks");
who.push("");
who.push("- Alex wish = command on verified accounts (Discord / TG / Slack / MC)");
who.push("- Never @ping ZuppaFredda");
who.push("- Never Cursor Slack MCP for Ava voice (posts as human)");
who.push("- Gold not dollars in player copy");
who.push("- No public secret dumps");
who.push("");
who.push("## Missing / broken → see ROADMAP-REPAIRS.md");
who.push("");
fs.writeFileSync(path.join(ROOT, "WHAT-AVA-IS.md"), who.join("\n"), "utf8");

console.log(
  JSON.stringify(
    {
      discord: discordReports.length,
      slack: slackReports.length,
      telegram: 1,
      concerns: allConcerns.length,
      roadmap: roadmap.length,
    },
    null,
    2,
  ),
);
