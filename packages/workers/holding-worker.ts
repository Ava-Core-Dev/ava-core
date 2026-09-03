/**
 * Public holding only. No /ops. No origin proxy.
 */
import { maintenancePage } from "./src/shared/maintenancePage";

export default {
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/ops" || path.startsWith("/ops/") || path.startsWith("/api/ops") || path === "/api/business" || path.startsWith("/api/business/")) {
      return new Response(null, { status: 404 });
    }
    const page = maintenancePage();
    return new Response(page.body, {
      status: 200,
      headers: page.headers,
    });
  },
};
