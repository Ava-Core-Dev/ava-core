/**
 * Transfer mesh for Root-Core /goto — official hosts + opted-in My Servers.
 */

import type { D1Database } from "@cloudflare/workers-types";

import { json } from "./cors";
import { validateServerAuth, type RootStatEnv } from "./rootstat-minecraft";

export type TransferMeshEnv = RootStatEnv & {
  ROOTMC_TRANSFER_TOWNY?: string;
  ROOTMC_TRANSFER_CLAIMS?: string;
  ROOTMC_TRANSFER_TEST?: string;
};

type MeshPeer = {
  slug: string;
  label: string;
  host: string;
  port: number;
  kind: "official" | "myserver";
  server_id?: string;
  online?: boolean | null;
  aliases?: string[];
};

function str(v: unknown): string {
  return String(v ?? "").trim();
}

function parseAddress(raw: string): { host: string; port: number } | null {
  const s = str(raw);
  if (!s) return null;
  // host:port or [ipv6]:port
  let host = s;
  let port = 25565;
  if (s.startsWith("[")) {
    const end = s.indexOf("]");
    if (end > 0) {
      host = s.slice(1, end);
      const rest = s.slice(end + 1);
      if (rest.startsWith(":")) {
        const p = Number(rest.slice(1));
        if (Number.isFinite(p) && p > 0 && p <= 65535) port = Math.floor(p);
      }
      return host ? { host, port } : null;
    }
  }
  const colon = s.lastIndexOf(":");
  if (colon > 0 && s.indexOf(":") === colon) {
    host = s.slice(0, colon).trim();
    const p = Number(s.slice(colon + 1));
    if (Number.isFinite(p) && p > 0 && p <= 65535) port = Math.floor(p);
  }
  return host ? { host, port } : null;
}

function sanitizeSlugBase(raw: string): string {
  let s = str(raw)
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24);
  if (!s) s = "server";
  if (/^[0-9]/.test(s)) s = "s_" + s;
  const reserved = new Set([
    "towny",
    "claims",
    "test",
    "gen1",
    "gen2",
    "dev",
    "devportal",
    "goto",
    "rootmc",
    "rootcore",
  ]);
  if (reserved.has(s)) s = "u_" + s;
  return s;
}

function officialPeers(env: TransferMeshEnv): MeshPeer[] {
  const towny = parseAddress(str(env.ROOTMC_TRANSFER_TOWNY) || "play.rootmc.net:25565");
  const claims = parseAddress(str(env.ROOTMC_TRANSFER_CLAIMS) || "play.rootmc.net:25565");
  const test = parseAddress(str(env.ROOTMC_TRANSFER_TEST) || "play.avaivy.cloud:25565");
  const out: MeshPeer[] = [];
  if (towny) {
    out.push({
      slug: "towny",
      label: "Towny",
      host: towny.host,
      port: towny.port,
      kind: "official",
      online: null,
      aliases: ["gen1", "t"],
    });
  }
  if (claims) {
    out.push({
      slug: "claims",
      label: "Claims",
      host: claims.host,
      port: claims.port,
      kind: "official",
      online: null,
      aliases: ["gen2", "c", "play"],
    });
  }
  if (test) {
    out.push({
      slug: "test",
      label: "Ava",
      host: test.host,
      port: test.port,
      kind: "official",
      online: null,
      aliases: ["dev", "devportal", "ava", "world"],
    });
  }
  return out;
}

/** Discord username → slug base for My Servers (alice, alice2, …). */
export async function discordSlugBaseForAccount(
  db: D1Database,
  accountId: string,
): Promise<string> {
  const row = await db
    .prepare(
      `SELECT discord_username, discord_global_name
       FROM discord_account_links WHERE account_id = ? LIMIT 1`,
    )
    .bind(accountId)
    .first<{ discord_username: string | null; discord_global_name: string | null }>();
  return sanitizeSlugBase(str(row?.discord_username) || str(row?.discord_global_name) || "server");
}

export async function recomputeTransferSlugsForOwner(
  db: D1Database,
  accountId: string,
): Promise<void> {
  const base = await discordSlugBaseForAccount(db, accountId);
  const { results } = await db
    .prepare(
      `SELECT server_id FROM rootstat_servers
       WHERE owner_account_id = ?
       ORDER BY created_at ASC, server_id ASC`,
    )
    .bind(accountId)
    .all<{ server_id: string }>();
  const rows = results || [];
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i++) {
    const index = i + 1;
    const slug = index === 1 ? base : `${base}${index}`;
    await db
      .prepare(
        `UPDATE rootstat_servers
         SET transfer_slug = ?, transfer_slug_index = ?, updated_at = ?
         WHERE server_id = ?`,
      )
      .bind(slug, index, now, rows[i]!.server_id)
      .run();
  }
}

export async function setOwnedServerMesh(
  db: D1Database,
  accountId: string,
  serverId: string,
  enabled: boolean,
  address?: string,
): Promise<
  | {
      ok: true;
      server_id: string;
      mesh_enabled: boolean;
      server_address: string | null;
      transfer_slug: string | null;
    }
  | { error: string; status: number }
> {
  const id = str(serverId);
  if (!id) return { error: "server_id required", status: 400 };

  const owned = await db
    .prepare(
      `SELECT server_id, server_address FROM rootstat_servers
       WHERE server_id = ? AND owner_account_id = ? LIMIT 1`,
    )
    .bind(id, accountId)
    .first<{ server_id: string; server_address: string | null }>();
  if (!owned?.server_id) return { error: "Server not found.", status: 404 };

  let nextAddress = owned.server_address;
  if (address !== undefined) {
    const trimmed = str(address);
    if (trimmed && !parseAddress(trimmed)) {
      return { error: "address must be host:port (e.g. play.example.com:25565).", status: 400 };
    }
    nextAddress = trimmed || null;
  }

  if (enabled && !parseAddress(String(nextAddress || ""))) {
    return {
      error: "Set a reachable host:port before enabling the transfer mesh.",
      status: 400,
    };
  }

  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE rootstat_servers
       SET mesh_enabled = ?, server_address = COALESCE(?, server_address), updated_at = ?
       WHERE server_id = ? AND owner_account_id = ?`,
    )
    .bind(enabled ? 1 : 0, nextAddress, now, id, accountId)
    .run();

  await recomputeTransferSlugsForOwner(db, accountId);

  const row = await db
    .prepare(
      `SELECT server_address, mesh_enabled, transfer_slug FROM rootstat_servers
       WHERE server_id = ? LIMIT 1`,
    )
    .bind(id)
    .first<{
      server_address: string | null;
      mesh_enabled: number | null;
      transfer_slug: string | null;
    }>();

  return {
    ok: true,
    server_id: id,
    mesh_enabled: Boolean(row?.mesh_enabled),
    server_address: row?.server_address ?? null,
    transfer_slug: row?.transfer_slug ?? null,
  };
}

async function listMeshedMyServers(db: D1Database): Promise<MeshPeer[]> {
  type Row = {
    server_id: string;
    server_name: string | null;
    server_address: string | null;
    transfer_slug: string | null;
    rootmc_last_seen_at: string | null;
    owner_account_id: string | null;
  };
  let rows: Row[] = [];
  try {
    const { results } = await db
      .prepare(
        `SELECT server_id, server_name, server_address, transfer_slug, rootmc_last_seen_at, owner_account_id
         FROM rootstat_servers
         WHERE mesh_enabled = 1
           AND server_address IS NOT NULL
           AND TRIM(server_address) != ''`,
      )
      .all<Row>();
    rows = results || [];
  } catch {
    return [];
  }

  const out: MeshPeer[] = [];
  const usedSlugs = new Set<string>(["towny", "claims", "test", "gen1", "gen2"]);

  for (const r of rows) {
    const addr = parseAddress(String(r.server_address || ""));
    if (!addr) continue;
    let slug = str(r.transfer_slug);
    if (!slug && r.owner_account_id) {
      await recomputeTransferSlugsForOwner(db, r.owner_account_id);
      const refreshed = await db
        .prepare(`SELECT transfer_slug FROM rootstat_servers WHERE server_id = ? LIMIT 1`)
        .bind(r.server_id)
        .first<{ transfer_slug: string | null }>();
      slug = str(refreshed?.transfer_slug);
    }
    if (!slug) slug = sanitizeSlugBase(str(r.server_name) || r.server_id);
    let unique = slug;
    let n = 2;
    while (usedSlugs.has(unique)) {
      unique = `${slug}${n++}`;
    }
    usedSlugs.add(unique);

    let online: boolean | null = null;
    if (r.rootmc_last_seen_at) {
      const age = Date.now() - Date.parse(r.rootmc_last_seen_at);
      if (Number.isFinite(age)) online = age <= 10 * 60 * 1000;
    }

    out.push({
      slug: unique,
      label: str(r.server_name) || unique,
      host: addr.host,
      port: addr.port,
      kind: "myserver",
      server_id: r.server_id,
      online,
    });
  }
  return out;
}

function normalizeAlias(slug: string): string {
  const k = str(slug).toLowerCase();
  if (k === "gen1" || k === "g1" || k === "t") return "towny";
  if (k === "gen2" || k === "g2" || k === "c") return "claims";
  if (k === "dev" || k === "devportal" || k === "rootmctest" || k === "portal") return "test";
  return k;
}

export async function handleTransferMeshRoutes(
  request: Request,
  env: TransferMeshEnv,
  sub: string,
  method: string,
): Promise<Response | null> {
  if (!sub.startsWith("/rootmc/transfer-mesh")) return null;
  const rest = sub.slice("/rootmc/transfer-mesh".length) || "/";

  /** Public catalog for rootmc.net/mesh — no server auth. */
  if (method === "GET" && (rest === "/public" || rest === "/public/")) {
    const peers = [...officialPeers(env), ...(await listMeshedMyServers(env.DB))];
    return json({
      ok: true,
      schema: "rootmc-transfer-mesh/public/v1",
      computed_at: new Date().toISOString(),
      peers: peers.map((p) => ({
        slug: p.slug,
        label: p.label,
        host: p.host,
        port: p.port,
        kind: p.kind,
        server_id: p.server_id ?? null,
        online: p.online ?? null,
        aliases: p.aliases ?? [],
        join: `${p.host}:${p.port}`,
      })),
      player_commands: ["/goto <slug>", "/totowny", "/toclaims", "/gen1", "/gen2"],
      normalize_hint: "Aliases map gen1→towny, gen2→claims, dev→test",
    });
  }

  if (method === "GET" && (rest === "/" || rest === "")) {
    const auth = await validateServerAuth(env, request);
    if (auth instanceof Response) return auth;

    const peers = [...officialPeers(env), ...(await listMeshedMyServers(env.DB))];
    const filtered = peers.filter((p) => p.server_id !== auth.serverId);

    return json({
      ok: true,
      self_server_id: auth.serverId,
      peers: filtered.map((p) => ({
        slug: p.slug,
        label: p.label,
        host: p.host,
        port: p.port,
        kind: p.kind,
        server_id: p.server_id ?? null,
        online: p.online ?? null,
        aliases: p.aliases ?? [],
      })),
      normalize_hint: "Aliases map gen1→towny, gen2→claims, dev→test",
    });
  }

  return json({ detail: "Not found." }, 404);
}

export { normalizeAlias, parseAddress, sanitizeSlugBase };
