/**
 * Public holding only. No /ops. No origin proxy.
 *
 * Reads the same up/down log ava-api writes, so the last-seen time and the
 * return countdown match everywhere the holding page appears.
 */
import { maintenancePage } from "./src/shared/maintenancePage";
import { readUptime, type UptimeEnv } from "./src/shared/uptime";

export default {
  async fetch(request: Request, env: UptimeEnv): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/ops" || path.startsWith("/ops/") || path.startsWith("/api/ops") || path === "/api/business" || path.startsWith("/api/business/")) {
      return new Response(null, { status: 404 });
    }
    const page = maintenancePage(await readUptime(env));
    return new Response(page.body, {
      status: 200,
      headers: page.headers,
    });
  },
};
