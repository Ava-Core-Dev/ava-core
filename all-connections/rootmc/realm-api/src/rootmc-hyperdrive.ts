import type { Connection } from "mysql2/promise";
import mysql from "mysql2/promise";

export type RootMcMysqlBinding = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

export type RootMcMysqlBindingName = "ROOTMC_MYSQL" | "ROOTMC_MYSQL_CLAIMS";

export type RootMcHyperdriveEnv = {
  ROOTMC_MYSQL?: RootMcMysqlBinding;
  ROOTMC_MYSQL_CLAIMS?: RootMcMysqlBinding;
  ROOTMC_MYSQL_TABLE_PREFIX?: string;
  LIVE_DB?: D1Database;
};

export function rootMcMysqlTablePrefix(env: RootMcHyperdriveEnv): string {
  const raw = String(env.ROOTMC_MYSQL_TABLE_PREFIX ?? "").trim();
  const prefix = raw || "root_";
  if (!/^[a-zA-Z0-9_]+$/.test(prefix)) {
    throw new Error("Invalid ROOTMC_MYSQL_TABLE_PREFIX");
  }
  return prefix;
}

/** Race a promise against a deadline; resolves `fallback` on timeout (does not cancel work). */
export function withDeadline<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  const budget = Math.max(1, Math.floor(ms));
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, budget);
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

async function openMysqlBinding(
  binding: RootMcMysqlBinding | undefined,
  label: string,
): Promise<Connection | null> {
  if (!binding?.host || !binding.user || !binding.database) {
    return null;
  }
  try {
    return await withDeadline(
      mysql.createConnection({
        host: binding.host,
        port: binding.port || 3306,
        user: binding.user,
        password: binding.password,
        database: binding.database,
        disableEval: true,
        connectTimeout: 2500,
      }),
      3000,
      null,
    );
  } catch (error) {
    console.warn("rootmc_hyperdrive_connect_fallback", label, String(error).slice(0, 300));
    return null;
  }
}

/** Towny / primary Hyperdrive (backward compatible). */
export async function openRootMcMysql(env: RootMcHyperdriveEnv): Promise<Connection | null> {
  return openMysqlBinding(env.ROOTMC_MYSQL, "ROOTMC_MYSQL");
}

/** Open a named Hyperdrive binding (`ROOTMC_MYSQL` or `ROOTMC_MYSQL_CLAIMS`). */
export async function openRootMcMysqlBinding(
  env: RootMcHyperdriveEnv,
  bindingName: RootMcMysqlBindingName | string,
): Promise<Connection | null> {
  const name = String(bindingName || "ROOTMC_MYSQL").trim() as RootMcMysqlBindingName;
  if (name === "ROOTMC_MYSQL_CLAIMS") {
    return openMysqlBinding(env.ROOTMC_MYSQL_CLAIMS, name);
  }
  return openMysqlBinding(env.ROOTMC_MYSQL, "ROOTMC_MYSQL");
}

export function withShortPublicCache(response: Response, seconds = 30): Response {
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", `public, max-age=10, s-maxage=${Math.max(10, seconds)}`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
