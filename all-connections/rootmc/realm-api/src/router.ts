import type { ExecutionContext } from "@cloudflare/workers-types";

import { bindCorsRequest, cors, json } from "./cors";

/** Retired  -  RootMC runs on https://api.rootmc.info (rootmc-api worker). */
const MIGRATE_URL = "https://api.rootmc.info";

export interface Env {
  DB?: D1Database;
  SITE_URL?: string;
}

export async function handleRequest(
  request: Request,
  _env: Env,
  _ctx?: ExecutionContext,
): Promise<Response> {
  bindCorsRequest(request);
  try {
    if (request.method === "OPTIONS") {
      const h = new Headers();
      for (const [k, v] of Object.entries(cors())) {
        h.set(k, v);
      }
      return new Response(null, { status: 204, headers: h });
    }
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return json(
        {
          status: "retired",
          service: "rootmc-realm-api",
          migrate_to: MIGRATE_URL,
        },
        410,
      );
    }
    return json(
      {
        detail: "RootMC API moved to api.rootmc.net",
        migrate_to: MIGRATE_URL,
        retired: true,
      },
      410,
    );
  } finally {
    bindCorsRequest(undefined);
  }
}

interface D1Database {
  prepare(query: string): unknown;
}
