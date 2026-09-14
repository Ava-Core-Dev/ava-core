/**
 * Dev workstation presence  -  local startup scripts heartbeat; cron reads stale window.
 */

import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import { discordBotFetch } from "./discord-rootmc-api";
import {
  closeWorkstationPresenceOnShutdown,
  closeWorkstationPresenceOnTimeout,
  touchWorkstationPresenceOnHeartbeat,
} from "./rootmc-host-presence";

export const DEV_WORKSTATION_STALE_MS = 15 * 60 * 1000;
export const DEV_WORKSTATION_ID = "primary";

export const DEV_WORKSTATION_LABELS: Record<string, string> = {
  primary: "Dev Workstation",
  laptop: "Dev Laptop",
};

export type DevWorkstationEnv = {
  DB: D1Database;
  ROOTMC_DEV_WORKSTATION_KEY?: string;
  DISCORD_ROOTMC_BOT_TOKEN?: string;
  DISCORD_ROOTMC_UPDATES_CHANNEL_ID?: string;
};

type DevWorkstationRecord = {
  last_seen_at: string | null;
  status_line: string | null;
  updated_at: string | null;
  timeout_notified_at: string | null;
};

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function nowIso(): string {
  return new Date().toISOString();
}

function unauthorized(): Response {
  return json({ detail: "Unauthorized." }, 401);
}

export function normalizeWorkstationId(raw: unknown): string {
  const id = str(raw) || DEV_WORKSTATION_ID;
  if (id in DEV_WORKSTATION_LABELS) return id;
  return DEV_WORKSTATION_ID;
}

export function workstationLabel(id: string): string {
  return DEV_WORKSTATION_LABELS[normalizeWorkstationId(id)] || "Dev Workstation";
}

export function validateDevWorkstationAuth(request: Request, env: DevWorkstationEnv): boolean {
  const expected = str(env.ROOTMC_DEV_WORKSTATION_KEY);
  if (!expected || expected.length < 16) return false;
  const auth = str(request.headers.get("Authorization"));
  if (/^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, "").trim() === expected;
  }
  return str(request.headers.get("X-RootMC-Dev-Key")) === expected;
}

export async function readDevWorkstationRecord(
  db: D1Database,
  workstationId = DEV_WORKSTATION_ID,
): Promise<DevWorkstationRecord | null> {
  const id = normalizeWorkstationId(workstationId);
  try {
    return await db
      .prepare(
        `SELECT last_seen_at, status_line, updated_at, timeout_notified_at
         FROM rootmc_dev_workstation
         WHERE id = ?
         LIMIT 1`,
      )
      .bind(id)
      .first<DevWorkstationRecord>();
  } catch {
    return null;
  }
}

export function isDevWorkstationOnline(
  record: { last_seen_at: string | null } | null,
  nowMs = Date.now(),
): boolean {
  const seen = Date.parse(str(record?.last_seen_at));
  return Number.isFinite(seen) && nowMs - seen <= DEV_WORKSTATION_STALE_MS;
}

export function devWorkstationDiscordLine(workstationId: string, online: boolean): string {
  return `\u2022 **${workstationLabel(workstationId)}:** ${online ? "Online" : "Offline"}`;
}

const HOST_PRESENCE_ORDER = ["laptop", "primary"] as const;

export async function readHostPresenceStatus(
  db: D1Database,
  serverId: string,
): Promise<{
  serverOnline: boolean;
  workstationOnline: boolean;
  laptopOnline: boolean;
}> {
  const serverRow = await db
    .prepare(`SELECT rootmc_last_seen_at FROM rootstat_servers WHERE server_id = ? LIMIT 1`)
    .bind(serverId)
    .first<{ rootmc_last_seen_at: string | null }>();
  const serverSeen = Date.parse(str(serverRow?.rootmc_last_seen_at));
  const serverOnline =
    Number.isFinite(serverSeen) && Date.now() - serverSeen <= DEV_WORKSTATION_STALE_MS;

  const primary = await readDevWorkstationRecord(db, "primary");
  const laptop = await readDevWorkstationRecord(db, "laptop");
  return {
    serverOnline,
    workstationOnline: isDevWorkstationOnline(primary),
    laptopOnline: isDevWorkstationOnline(laptop),
  };
}

export function allHostsConnected(presence: {
  serverOnline: boolean;
  workstationOnline: boolean;
  laptopOnline: boolean;
}): boolean {
  return presence.serverOnline && presence.workstationOnline && presence.laptopOnline;
}

export async function readDevWorkstationDiscordLines(db: D1Database): Promise<string[]> {
  const lines: string[] = [];
  for (const id of HOST_PRESENCE_ORDER) {
    const record = await readDevWorkstationRecord(db, id);
    lines.push(devWorkstationDiscordLine(id, isDevWorkstationOnline(record)));
  }
  return lines;
}

export async function upsertDevWorkstationHeartbeat(
  db: D1Database,
  workstationId = DEV_WORKSTATION_ID,
  statusLine?: string | null,
): Promise<void> {
  const id = normalizeWorkstationId(workstationId);
  const now = nowIso();
  const line = str(statusLine) || null;
  await db
    .prepare(
      `INSERT INTO rootmc_dev_workstation (id, last_seen_at, status_line, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         last_seen_at = excluded.last_seen_at,
         status_line = COALESCE(excluded.status_line, rootmc_dev_workstation.status_line),
         timeout_notified_at = NULL,
         updated_at = excluded.updated_at`,
    )
    .bind(id, now, line, now)
    .run();
  await touchWorkstationPresenceOnHeartbeat(db, id, now);
}

export async function markDevWorkstationOffline(
  db: D1Database,
  workstationId = DEV_WORKSTATION_ID,
): Promise<void> {
  const id = normalizeWorkstationId(workstationId);
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO rootmc_dev_workstation (id, last_seen_at, status_line, updated_at)
       VALUES (?, NULL, NULL, ?)
       ON CONFLICT(id) DO UPDATE SET
         last_seen_at = NULL,
         updated_at = excluded.updated_at`,
    )
    .bind(id, now)
    .run();
  await closeWorkstationPresenceOnShutdown(db, id, now);
}

export async function readDevWorkstationOnline(
  db: D1Database,
  workstationId = DEV_WORKSTATION_ID,
): Promise<boolean> {
  const record = await readDevWorkstationRecord(db, workstationId);
  return isDevWorkstationOnline(record);
}

function formatHst(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Honolulu",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(iso));
}

async function postTimeoutNotice(
  env: DevWorkstationEnv,
  workstationId: string,
  record: DevWorkstationRecord,
  now: Date,
): Promise<{ ok: boolean; detail: string }> {
  const token = str(env.DISCORD_ROOTMC_BOT_TOKEN);
  const channelId = str(env.DISCORD_ROOTMC_UPDATES_CHANNEL_ID);
  if (!token || !channelId) return { ok: false, detail: "missing Discord config" };

  const label = workstationLabel(workstationId);
  const content = [
    `**${label} heartbeat timed out - assuming powered off**`,
    `**Last heartbeat:** ${formatHst(record.last_seen_at!)}`,
    `**Detected:** ${formatHst(now.toISOString())}`,
    `**Reason:** No heartbeat for at least ${DEV_WORKSTATION_STALE_MS / 60_000} minutes.`,
  ].join("\n");
  const response = await discordBotFetch(
    token,
    `/channels/${encodeURIComponent(channelId)}/messages`,
    { method: "POST", body: JSON.stringify({ content }) },
  );
  if (!response.ok) {
    return {
      ok: false,
      detail: `Discord ${response.status}: ${(await response.text().catch(() => "")).slice(0, 200)}`,
    };
  }

  await closeWorkstationPresenceOnTimeout(env.DB, workstationId, record.last_seen_at!, now.toISOString());

  await env.DB.prepare(
    `UPDATE rootmc_dev_workstation
     SET timeout_notified_at = ?, updated_at = ?
     WHERE id = ? AND timeout_notified_at IS NULL`,
  )
    .bind(now.toISOString(), now.toISOString(), workstationId)
    .run();
  return { ok: true, detail: `${workstationId} timeout posted` };
}

export async function runDevWorkstationTimeoutCron(
  env: DevWorkstationEnv,
  now = new Date(),
): Promise<{ ok: boolean; detail: string }> {
  const details: string[] = [];
  let anyFail = false;

  for (const workstationId of Object.keys(DEV_WORKSTATION_LABELS)) {
    const record = await readDevWorkstationRecord(env.DB, workstationId);
    const lastSeenMs = Date.parse(str(record?.last_seen_at));
    if (!Number.isFinite(lastSeenMs)) {
      details.push(`${workstationId}:no session`);
      continue;
    }
    if (now.getTime() - lastSeenMs <= DEV_WORKSTATION_STALE_MS) {
      details.push(`${workstationId}:online`);
      continue;
    }
    if (record?.timeout_notified_at) {
      details.push(`${workstationId}:timeout already posted`);
      continue;
    }

    const result = await postTimeoutNotice(env, workstationId, record!, now);
    details.push(`${workstationId}:${result.detail}`);
    if (!result.ok) anyFail = true;
  }

  return { ok: !anyFail, detail: details.join("; ") || "idle" };
}

export async function handleDevWorkstationRoutes(
  request: Request,
  env: DevWorkstationEnv,
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (!subpath.startsWith("/rootmc/dev-workstation")) return null;
  const rest = subpath.slice("/rootmc/dev-workstation".length) || "/";

  if (method === "POST" && rest === "/heartbeat") {
    if (!validateDevWorkstationAuth(request, env)) return unauthorized();
    let body: { workstation_id?: string; status_line?: string } = {};
    try {
      const text = await request.text();
      if (text) body = JSON.parse(text) as typeof body;
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }
    const workstationId = normalizeWorkstationId(body.workstation_id);
    await upsertDevWorkstationHeartbeat(env.DB, workstationId, body.status_line);
    return json({ ok: true, workstation_id: workstationId, seen_at: nowIso() });
  }

  if (method === "POST" && rest === "/shutdown") {
    if (!validateDevWorkstationAuth(request, env)) return unauthorized();
    let body: { workstation_id?: string } = {};
    try {
      const text = await request.text();
      if (text) body = JSON.parse(text) as typeof body;
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }
    const workstationId = normalizeWorkstationId(body.workstation_id);
    await markDevWorkstationOffline(env.DB, workstationId);
    return json({ ok: true, workstation_id: workstationId, online: false });
  }

  if (method === "GET" && rest === "/status") {
    const url = new URL(request.url);
    const requested = str(url.searchParams.get("id"));
    if (requested) {
      const workstationId = normalizeWorkstationId(requested);
      const record = await readDevWorkstationRecord(env.DB, workstationId);
      const online = isDevWorkstationOnline(record);
      return json({
        workstation_id: workstationId,
        label: workstationLabel(workstationId),
        online,
        last_seen_at: record?.last_seen_at ?? null,
        status_line: record?.status_line ?? null,
      });
    }

    const statuses = await Promise.all(
      Object.keys(DEV_WORKSTATION_LABELS).map(async (workstationId) => {
        const record = await readDevWorkstationRecord(env.DB, workstationId);
        return {
          workstation_id: workstationId,
          label: workstationLabel(workstationId),
          online: isDevWorkstationOnline(record),
          last_seen_at: record?.last_seen_at ?? null,
          status_line: record?.status_line ?? null,
        };
      }),
    );
    return json({ workstations: statuses });
  }

  return json({ detail: "Not Found" }, 404);
}
