/**
 * Ava Ivy desktop — Electron main.
 */
import { app, BrowserWindow, ipcMain, shell, dialog } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadDesktopEnv,
  fetchDiscordHistory,
  fetchTelegramHistory,
  fetchSlackHistory,
  listDiscordTextChannels,
  listDiscordPrivateChannels,
  listSlackChannels,
  listTelegramChats,
  listPostPresets,
  listAllPostTargets,
  postToAllPages,
  postAsAva,
  rewriteDraft,
  summarizeChannel,
  fetchRewriteProviders,
  fetchCronStatus,
  fetchReportsStatus,
  fetchFinanceSuite,
  postFinanceSuite,
  fetchBiz,
  postBiz,
  tickEarlyLoginDesktop,
  runCronJob,
  configureCron,
  fetchCoreChatStatus,
  coreChat,
  coreChatEnhance,
  coreChatGold,
  editDiscordMessage,
  deleteDiscordMessage,
  listFeedbackQueue,
  processFeedbackNext,
  ackFeedbackItem,
  dualPostFeedback,
  feedbackTemplates,
  FEEDBACK_TARGETS,
  deleteSlackMessage,
  clearDiscordOwnMessages,
  clearSlackOwnMessages,
  clearAllFeedbackAndStamp,
} from "./lib/avaBridge.mjs";
import {
  ensureMediaDirs,
  listMediaFiles,
  importMediaFiles,
} from "./lib/avaMedia.mjs";
import { listOpsCatalog, opsCommandById } from "./lib/opsCommands.mjs";
import { listAvaLinks } from "./lib/avaLinks.mjs";
import {
  loadConnectionConfig,
  connectionFormPayload,
  saveConnectionConfig,
  testConnection,
  brainOrigin,
  operatorHeaders,
  isRemoteCompute,
} from "./lib/connectionConfig.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTEXT_LIMIT = 150;
const AVA_HOME = process.env.AVA_HANDOFF || "/home/ava-core/ava";
const AVA_CORE = process.env.AVA_CORE || path.join(AVA_HOME, "core");

function brainFetchHeaders(extra = {}) {
  return { ...operatorHeaders(loadConnectionConfig()), ...extra };
}

async function brainJson(pathname, { method = "GET", body, timeoutMs = 20000 } = {}) {
  const url = `${brainOrigin()}${pathname}`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        ...brainFetchHeaders(body ? { "content-type": "application/json" } : {}),
      },
      body: body != null ? JSON.stringify(body) : undefined,
      signal: ac.signal,
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return {
        ok: false,
        detail: json.detail || json.reason || `http_${res.status}`,
        status: res.status,
        ...json,
      };
    }
    return json && typeof json === "object" ? json : { ok: true, data: json };
  } catch (err) {
    return {
      ok: false,
      detail: err?.name === "AbortError" ? "timeout" : err?.message || String(err),
    };
  } finally {
    clearTimeout(t);
  }
}

let mainWindow = null;
/** @type {import('node:child_process').ChildProcess | null} */
let runningOps = null;
let runningOpsId = null;

function nodeBin() {
  const home = os.homedir();
  const candidates = [
    process.env.AVA_NODE_BIN,
    path.join(home, ".local", "bin", "node"),
    "/usr/local/bin/node",
    "/usr/bin/node",
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (c && fs.existsSync(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return "node";
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    title: "Ava Ivy",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  // Fire startup voice clip when GUI finishes loading
  mainWindow.webContents.once("did-finish-load", () => {
    fetch("http://127.0.0.1:8787/api/voice/play", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clip: "phrase_device_startup" }),
    }).catch(() => {}); // silent if core not up yet
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function sendOps(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function appendLine(line) {
  sendOps("ava:ops-line", { line: String(line).replace(/\r?\n$/, "") });
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  loadDesktopEnv()
    .then((env) => tickEarlyLoginDesktop(env))
    .catch(() => {});
});

app.on("window-all-closed", () => {
  if (runningOps) {
    try {
      runningOps.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("ava:env-status", async () => {
  const env = await loadDesktopEnv();
  const conn = loadConnectionConfig();
  return {
    ok: true,
    hasDiscord: Boolean(env.discordToken),
    hasSlack: Boolean(env.slackToken),
    hasTelegram: Boolean(env.telegramToken),
    rewriteUrl: env.rewriteUrl,
    operatorChatId: env.operatorChatId,
    brainUrl: env.brainUrl,
    mode: conn.mode,
    via: conn.via,
    computeRemote: Boolean(env.computeRemote),
    hasOperatorKey: Boolean(env.operatorKey),
  };
});

ipcMain.handle("ava:connection-get", async () => connectionFormPayload());

ipcMain.handle("ava:connection-save", async (_e, patch = {}) => {
  try {
    return saveConnectionConfig(patch || {});
  } catch (err) {
    return { ok: false, detail: err?.message || String(err) };
  }
});

ipcMain.handle("ava:connection-test", async (_e, patch = {}) => {
  const conn = patch && Object.keys(patch).length
    ? { ...loadConnectionConfig(), ...patch }
    : loadConnectionConfig();
  return testConnection(conn);
});

ipcMain.handle("ava:list-discord-channels", async () => {
  const env = await loadDesktopEnv();
  return listDiscordTextChannels(env);
});

ipcMain.handle("ava:list-discord-private", async () => {
  const env = await loadDesktopEnv();
  return listDiscordPrivateChannels(env);
});

ipcMain.handle("ava:list-slack-channels", async () => {
  const env = await loadDesktopEnv();
  return listSlackChannels(env);
});

ipcMain.handle("ava:list-telegram-chats", async () => {
  const env = await loadDesktopEnv();
  return listTelegramChats(env);
});

ipcMain.handle("ava:list-presets", async () => listPostPresets());

ipcMain.handle("ava:history", async (_e, { surface, channelId, limit }) => {
  const env = await loadDesktopEnv();
  const n = Math.min(200, Math.max(1, Number(limit) || CONTEXT_LIMIT));
  if (surface === "telegram") {
    return fetchTelegramHistory(env, channelId || env.operatorChatId, n);
  }
  if (surface === "slack") {
    return fetchSlackHistory(env, channelId, n);
  }
  return fetchDiscordHistory(env, channelId, n);
});

ipcMain.handle("ava:send", async (_e, opts) => {
  const env = await loadDesktopEnv();
  return postAsAva(env, {
    ...opts,
    rewrite: opts.rewrite !== false && String(opts.provider || "") !== "exact",
  });
});

ipcMain.handle("ava:post", async (_e, opts) => {
  const env = await loadDesktopEnv();
  return postAsAva(env, {
    ...opts,
    rewrite: Boolean(opts.rewrite) && String(opts.provider || "") !== "exact",
  });
});

ipcMain.handle("ava:list-all-post-targets", async () => {
  try {
    const env = await loadDesktopEnv();
    return await listAllPostTargets(env);
  } catch (err) {
    return { ok: false, detail: err?.message || String(err), targets: [], counts: { total: 0 } };
  }
});

ipcMain.handle("ava:post-all", async (_e, opts) => {
  try {
    const env = await loadDesktopEnv();
    return await postToAllPages(
      env,
      {
        ...opts,
        rewrite: Boolean(opts?.rewrite) && String(opts?.provider || "") !== "exact",
      },
      (progress) => sendOps("ava:post-all-progress", progress),
    );
  } catch (err) {
    return { ok: false, detail: err?.message || String(err), posted: 0, failed: 0, results: [] };
  }
});

ipcMain.handle("ava:media-root", async () => {
  const root = ensureMediaDirs();
  return { ok: true, root, media: root };
});

ipcMain.handle("ava:media-list", async (_e, opts) => {
  try {
    return listMediaFiles(opts || {});
  } catch (err) {
    return { ok: false, detail: err?.message || String(err), files: [] };
  }
});

ipcMain.handle("ava:media-pick", async (_e, opts) => {
  try {
    const root = ensureMediaDirs();
    const defaultPath =
      opts?.defaultPath && fs.existsSync(opts.defaultPath)
        ? opts.defaultPath
        : path.join(root, "library");
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const result = await dialog.showOpenDialog(win, {
      title: opts?.title || "Attach images",
      defaultPath,
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Images & video",
          extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "mp4", "webm", "mov"],
        },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (result.canceled || !result.filePaths?.length) {
      return { ok: true, canceled: true, files: [] };
    }
    const importAlso = opts?.import !== false;
    let files = result.filePaths.map((p) => ({
      path: p,
      name: path.basename(p),
    }));
    if (importAlso) {
      const imported = importMediaFiles(result.filePaths);
      if (imported.imported?.length) files = imported.imported;
    }
    return { ok: true, canceled: false, files, root };
  } catch (err) {
    return { ok: false, detail: err?.message || String(err), files: [] };
  }
});

ipcMain.handle("ava:media-import", async (_e, opts) => {
  try {
    return importMediaFiles(opts?.filePaths || []);
  } catch (err) {
    return { ok: false, detail: err?.message || String(err), imported: [] };
  }
});

ipcMain.handle("ava:media-open", async () => {
  const root = ensureMediaDirs();
  await shell.openPath(root);
  return { ok: true, root };
});

ipcMain.handle("ava:rewrite-preview", async (_e, opts) => {
  const env = await loadDesktopEnv();
  let context = [];
  try {
    if (opts.surface === "discord" && opts.channelId) {
      context = (await fetchDiscordHistory(env, opts.channelId, 20)).messages || [];
    } else if (opts.surface === "slack" && opts.channelId) {
      context = (await fetchSlackHistory(env, opts.channelId, 20)).messages || [];
    } else if (opts.surface === "telegram" && opts.channelId) {
      context = (await fetchTelegramHistory(env, opts.channelId, 20)).messages || [];
    }
  } catch {
    context = [];
  }
  return rewriteDraft(env, {
    text: opts.text,
    surface: opts.surface,
    context,
    provider: opts.provider || "dream",
    compare: Boolean(opts.compare),
  });
});

ipcMain.handle("ava:summarize", async (_e, opts) => {
  const env = await loadDesktopEnv();
  return summarizeChannel(env, opts);
});

ipcMain.handle("ava:rewrite-providers", async () => {
  const env = await loadDesktopEnv();
  return fetchRewriteProviders(env);
});

ipcMain.handle("ava:core-status", async () => {
  try {
    const env = await loadDesktopEnv();
    return await fetchCoreChatStatus(env);
  } catch (err) {
    return { ok: false, detail: err?.message || String(err) };
  }
});

/** @type {AbortController | null} */
let coreChatAbort = null;

ipcMain.handle("ava:core-chat", async (_e, opts) => {
  try {
    if (coreChatAbort) {
      try {
        coreChatAbort.abort();
      } catch {
        /* ignore */
      }
    }
    coreChatAbort = new AbortController();
    const env = await loadDesktopEnv();
    const result = await coreChat(env, {
      ...(opts || {}),
      signal: coreChatAbort.signal,
    });
    coreChatAbort = null;
    return result;
  } catch (err) {
    coreChatAbort = null;
    return { ok: false, detail: err?.message || String(err) };
  }
});

ipcMain.handle("ava:core-cancel", async () => {
  if (coreChatAbort) {
    try {
      coreChatAbort.abort();
    } catch {
      /* ignore */
    }
    coreChatAbort = null;
    return { ok: true, cancelled: true };
  }
  return { ok: true, cancelled: false };
});

ipcMain.handle("ava:core-enhance", async (_e, opts) => {
  try {
    const env = await loadDesktopEnv();
    return await coreChatEnhance(env, opts || {});
  } catch (err) {
    return { ok: false, detail: err?.message || String(err) };
  }
});

ipcMain.handle("ava:core-gold", async (_e, opts) => {
  try {
    const env = await loadDesktopEnv();
    return await coreChatGold(env, opts || {});
  } catch (err) {
    return { ok: false, detail: err?.message || String(err) };
  }
});

ipcMain.handle("ava:discord-edit", async (_e, opts) => {
  try {
    const env = await loadDesktopEnv();
    return await editDiscordMessage(
      env,
      opts?.channelId,
      opts?.messageId,
      opts?.text,
    );
  } catch (err) {
    return { ok: false, detail: err?.message || String(err) };
  }
});

ipcMain.handle("ava:discord-delete", async (_e, opts) => {
  try {
    const env = await loadDesktopEnv();
    return await deleteDiscordMessage(env, opts?.channelId, opts?.messageId);
  } catch (err) {
    return { ok: false, detail: err?.message || String(err) };
  }
});

ipcMain.handle("ava:feedback-targets", async () => ({
  ok: true,
  targets: FEEDBACK_TARGETS,
  templates: feedbackTemplates(),
}));

ipcMain.handle("ava:feedback-list", async (_e, opts) => {
  try {
    const env = await loadDesktopEnv();
    return await listFeedbackQueue(env, opts || {});
  } catch (err) {
    return { ok: false, detail: err?.message || String(err), feedback: [] };
  }
});

ipcMain.handle("ava:feedback-process-next", async () => {
  try {
    const env = await loadDesktopEnv();
    return await processFeedbackNext(env);
  } catch (err) {
    return { ok: false, detail: err?.message || String(err) };
  }
});

ipcMain.handle("ava:feedback-ack", async (_e, opts) => {
  try {
    const env = await loadDesktopEnv();
    return await ackFeedbackItem(env, opts?.id || opts?.feedbackId, opts?.note || "");
  } catch (err) {
    return { ok: false, detail: err?.message || String(err) };
  }
});

ipcMain.handle("ava:feedback-dual-post", async (_e, opts) => {
  try {
    const env = await loadDesktopEnv();
    return await dualPostFeedback(env, opts || {});
  } catch (err) {
    return { ok: false, detail: err?.message || String(err) };
  }
});

ipcMain.handle("ava:feedback-delete-discord", async (_e, opts) => {
  try {
    const env = await loadDesktopEnv();
    return await deleteDiscordMessage(
      env,
      opts?.channelId || FEEDBACK_TARGETS.discordDevelopment.id,
      opts?.messageId,
    );
  } catch (err) {
    return { ok: false, detail: err?.message || String(err) };
  }
});

ipcMain.handle("ava:feedback-delete-slack", async (_e, opts) => {
  try {
    const env = await loadDesktopEnv();
    return await deleteSlackMessage(
      env,
      opts?.channelId || FEEDBACK_TARGETS.slackFeedback.id,
      opts?.messageTs || opts?.messageId,
    );
  } catch (err) {
    return { ok: false, detail: err?.message || String(err) };
  }
});

ipcMain.handle("ava:feedback-clear-discord", async (_e, opts) => {
  try {
    const env = await loadDesktopEnv();
    return await clearDiscordOwnMessages(
      env,
      opts?.channelId || FEEDBACK_TARGETS.discordDevelopment.id,
      opts || {},
    );
  } catch (err) {
    return { ok: false, detail: err?.message || String(err), deleted: 0 };
  }
});

ipcMain.handle("ava:feedback-clear-slack", async (_e, opts) => {
  try {
    const env = await loadDesktopEnv();
    return await clearSlackOwnMessages(
      env,
      opts?.channelId || FEEDBACK_TARGETS.slackFeedback.id,
      opts || {},
    );
  } catch (err) {
    return { ok: false, detail: err?.message || String(err), deleted: 0 };
  }
});

ipcMain.handle("ava:feedback-clear-all", async (_e, opts) => {
  try {
    const env = await loadDesktopEnv();
    return await clearAllFeedbackAndStamp(env, opts || {});
  } catch (err) {
    return { ok: false, detail: err?.message || String(err) };
  }
});

ipcMain.handle("ava:cron-status", async () => {
  try {
    const env = await loadDesktopEnv();
    return await fetchCronStatus(env);
  } catch (err) {
    return { ok: false, detail: err?.message || String(err), jobs: [] };
  }
});

ipcMain.handle("ava:cron-run", async (_e, { id }) => {
  try {
    const env = await loadDesktopEnv();
    return await runCronJob(env, id);
  } catch (err) {
    return { ok: false, detail: err?.message || String(err) };
  }
});

ipcMain.handle("ava:cron-config", async (_e, body) => {
  try {
    const env = await loadDesktopEnv();
    return await configureCron(env, body);
  } catch (err) {
    return { ok: false, detail: err?.message || String(err) };
  }
});

ipcMain.handle("ava:reports-status", async () => {
  try {
    const env = await loadDesktopEnv();
    return await fetchReportsStatus(env);
  } catch (err) {
    return { ok: false, detail: err?.message || String(err) };
  }
});

ipcMain.handle("ava:finance", async (_e, opts = {}) => {
  try {
    const env = await loadDesktopEnv();
    return await fetchFinanceSuite(env, opts || {});
  } catch (err) {
    return { ok: false, detail: err?.message || String(err) };
  }
});

ipcMain.handle("ava:finance-action", async (_e, body = {}) => {
  try {
    const env = await loadDesktopEnv();
    return await postFinanceSuite(env, body || {});
  } catch (err) {
    return { ok: false, detail: err?.message || String(err) };
  }
});

ipcMain.handle("ava:biz", async () => {
  try {
    const env = await loadDesktopEnv();
    return await fetchBiz(env);
  } catch (err) {
    return { ok: false, detail: err?.message || String(err) };
  }
});

ipcMain.handle("ava:biz-action", async (_e, body = {}) => {
  try {
    const env = await loadDesktopEnv();
    return await postBiz(env, body || {});
  } catch (err) {
    return { ok: false, detail: err?.message || String(err) };
  }
});

ipcMain.handle("ava:early-login", async () => {
  try {
    const env = await loadDesktopEnv();
    return await tickEarlyLoginDesktop(env);
  } catch (err) {
    return { ok: false, detail: err?.message || String(err) };
  }
});

ipcMain.handle("ava:finance-receipt", async (_e, opts = {}) => {
  try {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const picked = await dialog.showOpenDialog(win, {
      title: "Attach receipt (image or PDF)",
      properties: ["openFile"],
      filters: [
        { name: "Receipts", extensions: ["png", "jpg", "jpeg", "gif", "webp", "pdf"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (picked.canceled || !picked.filePaths?.[0]) {
      return { ok: true, canceled: true };
    }
    const filePath = picked.filePaths[0];
    const buf = fs.readFileSync(filePath);
    if (buf.length > 8 * 1024 * 1024) {
      return { ok: false, detail: "file_too_large" };
    }
    const ext = path.extname(filePath).toLowerCase().replace(".", "");
    const mime =
      ext === "pdf"
        ? "application/pdf"
        : `image/${ext === "jpg" ? "jpeg" : ext || "png"}`;
    const env = await loadDesktopEnv();
    return await postFinanceSuite(env, {
      action: "attach-receipt",
      projectId: opts.projectId,
      account: opts.account,
      lineId: opts.lineId,
      filename: path.basename(filePath),
      mime,
      dataBase64: buf.toString("base64"),
    });
  } catch (err) {
    return { ok: false, detail: err?.message || String(err) };
  }
});

function safeAvaPath(target) {
  const folders = {
    reports: path.join(AVA_HOME, "reports"),
    dumps: path.join(AVA_HOME, "reports", "channel-dumps", "incremental"),
    solarDays: path.join(AVA_HOME, "data", "ecoflow", "days"),
    data: path.join(AVA_HOME, "data"),
    weatherGifs: path.join(AVA_HOME, "media", "weather", "gifs"),
    weatherGifsCollector:
      "/home/ava-core/Desktop/ava-weather-gif-collector-hawaii-pacific-v7./ava-weather-gif-collector",
    claimPlans: path.join(AVA_HOME, "data", "ava-claim-plans"),
    root: AVA_HOME,
  };
  if (target && folders[target]) return folders[target];
  const abs = path.resolve(String(target || ""));
  const root = path.resolve(AVA_HOME);
  if (abs === root || abs.startsWith(root + path.sep)) return abs;
  return null;
}

ipcMain.handle("ava:open-folder", async (_e, { target } = {}) => {
  const dir = safeAvaPath(target || "reports");
  if (!dir) return { ok: false, detail: "path_not_allowed" };
  fs.mkdirSync(dir, { recursive: true });
  const err = await shell.openPath(dir);
  return err ? { ok: false, detail: err, path: dir } : { ok: true, path: dir };
});

ipcMain.handle("ava:open-path", async (_e, { target } = {}) => {
  const abs = safeAvaPath(target);
  if (!abs) return { ok: false, detail: "path_not_allowed" };
  if (!fs.existsSync(abs)) return { ok: false, detail: "missing", path: abs };
  const err = await shell.openPath(abs);
  return err ? { ok: false, detail: err, path: abs } : { ok: true, path: abs };
});

ipcMain.handle("ava:reveal-path", async (_e, { target } = {}) => {
  const abs = safeAvaPath(target);
  if (!abs || !fs.existsSync(abs)) return { ok: false, detail: "missing" };
  shell.showItemInFolder(abs);
  return { ok: true, path: abs };
});

ipcMain.handle("ava:ops-catalog", async () => ({
  ok: true,
  groups: listOpsCatalog(),
  core: AVA_CORE,
  running: runningOpsId,
}));

ipcMain.handle("ava:activity", async (_e, opts = {}) => {
  const limit = Number(opts.limit) || 220;
  const brain = await brainJson(`/api/activity?limit=${limit}`, { timeoutMs: 12000 });
  if (brain?.ok) {
    return { ...brain, runningOps: runningOpsId };
  }
  try {
    const { buildActivityLive } = await import("../core/src/activityLive.mjs");
    const desk = await loadDesktopEnv();
    const local = await buildActivityLive({
      env: {
        AVA_OLLAMA_URL: desk.ollamaUrl,
        AVA_OLLAMA_MODEL: desk.ollamaModel,
      },
      limit,
    });
    return { ...local, runningOps: runningOpsId, detail: brain?.detail || null };
  } catch (err) {
    return {
      ok: false,
      detail: brain?.detail || err?.message || "activity_fail",
      runningOps: runningOpsId,
      logs: [],
      processes: [],
      inflight: [],
    };
  }
});

ipcMain.handle("ava:list-links", async () => listAvaLinks());

ipcMain.handle("ava:release-status", async (_e, { kind } = {}) => {
  const k = kind === "apps" ? "apps" : "plugins";
  return brainJson(`/api/${k}/status`);
});

ipcMain.handle("ava:release-action", async (_e, { kind, action, targets } = {}) => {
  const k = kind === "apps" ? "apps" : "plugins";
  const act = String(action || "").toLowerCase();
  if (!["bump", "build", "release"].includes(act)) {
    return { ok: false, detail: "bad_action" };
  }
  return brainJson(`/api/${k}/${act}`, {
    method: "POST",
    body: { targets: Array.isArray(targets) ? targets : [] },
    timeoutMs: 180000,
  });
});

ipcMain.handle("ava:open-link", async (_e, { url } = {}) => {
  const href = String(url || "").trim();
  if (!/^https?:\/\//i.test(href)) {
    return { ok: false, detail: "invalid_url" };
  }
  try {
    await shell.openExternal(href);
    return { ok: true };
  } catch (err) {
    return { ok: false, detail: err?.message || String(err) };
  }
});

ipcMain.handle("ava:ops-cancel", async () => {
  if (!runningOps) return { ok: true, detail: "idle" };
  try {
    runningOps.kill("SIGTERM");
  } catch (err) {
    return { ok: false, detail: err?.message || String(err) };
  }
  return { ok: true, detail: "signaled" };
});

ipcMain.handle("ava:ops-run", async (_e, { id }) => {
  const cmd = opsCommandById(String(id || ""));
  if (!cmd) return { ok: false, detail: "unknown_command" };
  if (runningOps) return { ok: false, detail: `busy:${runningOpsId}` };

  // New-style: endpoint + body (POST to Python core)
  if (cmd.endpoint) {
    const url = `${brainOrigin()}${cmd.endpoint}`;
    runningOpsId = cmd.id;
    sendOps("ava:ops-start", { id: cmd.id, label: cmd.label, detail: `POST ${url}` });
    appendLine(`$ POST ${url}`);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...brainFetchHeaders({}) },
        body: JSON.stringify(cmd.body || {}),
      });
      const text = await res.text();
      appendLine(`← ${res.status} ${text.slice(0, 200)}`);
      sendOps("ava:ops-done", { id: cmd.id, code: res.ok ? 0 : res.status });
      runningOpsId = null;
      return { ok: res.ok, detail: `http_${res.status}` };
    } catch (err) {
      appendLine(`error: ${err?.message || err}`);
      sendOps("ava:ops-done", { id: cmd.id, code: 1 });
      runningOpsId = null;
      return { ok: false, detail: err?.message || String(err) };
    }
  }

  if (cmd.kind === "http") {
    const url = `${brainOrigin()}${cmd.path}`;
    runningOpsId = cmd.id;
    sendOps("ava:ops-start", { id: cmd.id, label: cmd.label, detail: `${cmd.method} ${url}` });
    appendLine(`$ ${cmd.method} ${url}`);
    try {
      const res = await fetch(url, {
        method: cmd.method || "GET",
        headers: brainFetchHeaders(
          cmd.method && cmd.method !== "GET" ? { "content-type": "application/json" } : {},
        ),
      });
      const text = await res.text();
      appendLine(`← ${res.status}`);
      const clipped = text.length > 8000 ? `${text.slice(0, 8000)}\n…(truncated)` : text;
      for (const line of clipped.split(/\r?\n/)) appendLine(line);
      sendOps("ava:ops-done", { id: cmd.id, code: res.ok ? 0 : res.status });
      runningOpsId = null;
      return { ok: res.ok, detail: `http_${res.status}` };
    } catch (err) {
      appendLine(`error: ${err?.message || err}`);
      sendOps("ava:ops-done", { id: cmd.id, code: 1 });
      runningOpsId = null;
      return { ok: false, detail: err?.message || String(err) };
    }
  }

  const scriptPath = path.join(AVA_CORE, "scripts", cmd.script);
  if (!fs.existsSync(scriptPath)) {
    return { ok: false, detail: `missing_script:${cmd.script}` };
  }

  const bin = nodeBin();
  const args = [scriptPath, ...(cmd.args || [])];
  const childEnv = {
    ...process.env,
    PATH: `${path.join(os.homedir(), ".local", "bin")}:${process.env.PATH || ""}`,
    AVA_HANDOFF: AVA_HOME,
    ROOTMC_ENV_FILE: process.env.ROOTMC_ENV_FILE || path.join(AVA_HOME, ".env"),
    AVA_ENV_FILE: process.env.AVA_ENV_FILE || path.join(AVA_HOME, ".env"),
  };

  runningOpsId = cmd.id;
  sendOps("ava:ops-start", {
    id: cmd.id,
    label: cmd.label,
    detail: `${bin} scripts/${cmd.script} ${(cmd.args || []).join(" ")}`.trim(),
  });
  appendLine(
    `$ node scripts/${cmd.script}${(cmd.args || []).length ? ` ${cmd.args.join(" ")}` : ""}`,
  );

  return await new Promise((resolve) => {
    const child = spawn(bin, args, {
      cwd: AVA_CORE,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
    runningOps = child;
    const onChunk = (buf) => {
      for (const line of buf.toString("utf8").split(/\r?\n/)) {
        if (line.length) appendLine(line);
      }
    };
    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);
    child.on("error", (err) => {
      appendLine(`spawn error: ${err.message}`);
      runningOps = null;
      runningOpsId = null;
      sendOps("ava:ops-done", { id: cmd.id, code: 1 });
      resolve({ ok: false, detail: err.message });
    });
    child.on("close", (code, signal) => {
      appendLine(signal ? `← signal ${signal}` : `← exit ${code ?? "?"}`);
      runningOps = null;
      runningOpsId = null;
      sendOps("ava:ops-done", { id: cmd.id, code: code ?? 1, signal });
      resolve({
        ok: (code ?? 1) === 0,
        detail: signal ? `signal_${signal}` : `exit_${code}`,
      });
    });
  });
});

async function loadMinecraftControl() {
  return import(path.join(AVA_CORE, "src", "minecraftControl.mjs"));
}

async function loadRconGuard() {
  return import(path.join(AVA_CORE, "src", "rconGuard.mjs"));
}

ipcMain.handle("ava:mc-status", async () => {
  if (isRemoteCompute()) {
    return brainJson("/api/minecraft/status");
  }
  const { paperStatus } = await loadMinecraftControl();
  return paperStatus();
});

ipcMain.handle("ava:mc-log", async (_e, opts = {}) => {
  if (isRemoteCompute()) {
    const q = new URLSearchParams({
      bytes: String(Number(opts.bytes) || 200_000),
      lines: String(Number(opts.lines) || 220),
    });
    return brainJson(`/api/minecraft/log?${q}`);
  }
  const { paperLogTail } = await loadMinecraftControl();
  return paperLogTail({
    bytes: Number(opts.bytes) || 200_000,
    lines: Number(opts.lines) || 220,
  });
});

ipcMain.handle("ava:mc-control", async (_e, { action } = {}) => {
  const a = String(action || "").trim().toLowerCase();
  if (!["start", "stop", "restart"].includes(a)) {
    return { ok: false, detail: "action must be start|stop|restart" };
  }
  if (isRemoteCompute()) {
    return brainJson("/api/minecraft/control", {
      method: "POST",
      body: { action: a },
      timeoutMs: 120000,
    });
  }
  const { runPaperProcess } = await loadMinecraftControl();
  return runPaperProcess(a);
});

ipcMain.handle("ava:mc-rcon", async (_e, { command, target } = {}) => {
  const cmd = String(command || "").trim();
  if (!cmd) return { ok: false, reason: "empty" };
  if (isRemoteCompute()) {
    return brainJson("/api/minecraft/rcon", {
      method: "POST",
      body: { command: cmd, target: String(target || "test").trim() || "test" },
      timeoutMs: 30000,
    });
  }
  const { guardedRcon } = await loadRconGuard();
  return guardedRcon(cmd, {
    allow: true,
    target: String(target || "test").trim() || "test",
    operatorConsole: true,
  });
});

ipcMain.handle("ava:stream-status", async () => {
  const [status, watch, eta] = await Promise.all([
    brainJson("/api/obs/status"),
    brainJson("/api/obs/volcano-watch"),
    brainJson("/api/obs/eruption-eta"),
  ]);
  return {
    ok: status?.ok !== false && !status?.detail,
    status,
    watch: watch?.watch || null,
    eta: eta && typeof eta === "object" ? eta : null,
    detail: status?.detail || watch?.detail || eta?.detail || null,
  };
});

ipcMain.handle("ava:stream-action", async (_e, opts = {}) => {
  const action = String(opts.action || "").trim();
  const title = opts.title != null ? String(opts.title) : undefined;
  const description = opts.description != null ? String(opts.description) : undefined;
  const scene = opts.scene != null ? String(opts.scene) : undefined;
  if (action === "start" || action === "stop") {
    return {
      ok: false,
      detail: "obs_stream_control_disabled",
      hint: "Start/stop streaming in OBS. Ava does not launch OBS or control the stream transport.",
    };
  }
  if (action === "scene") {
    return brainJson("/api/obs/scene", {
      method: "POST",
      body: { scene: scene || "Be right back" },
    });
  }
  if (action === "metadata" || action === "metadata-restart") {
    return brainJson("/api/obs/metadata", {
      method: "POST",
      body: {
        title,
        description,
        restart: action === "metadata-restart",
        scene: scene || "Be right back",
      },
      timeoutMs: 90000,
    });
  }
  if (action === "watch-enter") {
    return brainJson("/api/obs/volcano-watch", {
      method: "POST",
      body: { action: "enter", title, description },
      timeoutMs: 90000,
    });
  }
  if (action === "watch-exit") {
    return brainJson("/api/obs/volcano-watch", {
      method: "POST",
      body: { action: "exit" },
      timeoutMs: 60000,
    });
  }
  if (action === "toast") {
    return brainJson("/api/obs/toast", {
      method: "POST",
      body: {
        title: title || "Test toast",
        body: description || "Desktop Streaming Ops",
      },
    });
  }
  if (action === "repair") {
    return brainJson("/api/obs/repair-kit", {
      method: "POST",
      body: {},
      timeoutMs: 60000,
    });
  }
  if (action === "reaction") {
    const reactionId = String(opts.reactionId || opts.id || "").trim();
    if (!reactionId) return { ok: false, detail: "reactionId_required" };
    return brainJson("/api/obs/reaction", {
      method: "POST",
      body: {
        reactionId,
        title: title || undefined,
        body: description || opts.body || "Manual Desktop trigger",
        url: opts.url || undefined,
        force: true,
        comment: opts.comment === true,
      },
      timeoutMs: 30000,
    });
  }
  return { ok: false, detail: "unknown_action" };
});
