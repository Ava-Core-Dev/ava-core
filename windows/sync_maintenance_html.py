"""Copy the canonical holding page into the Worker bundle and Sites/Holding.

Canonical HTML: apps/core/static/maintenance.html
Run this after editing that file, then redeploy the Workers.
"""

from pathlib import Path

root = Path(__file__).resolve().parents[1]
html = root / "apps" / "core" / "static" / "maintenance.html"
src = html.read_text(encoding="utf-8")

# The page ships with a null uptime block. The Worker swaps in real numbers.
PLACEHOLDER = '{"last_up_ms":null,"avg_recovery_s":null,"outages":0}'
if PLACEHOLDER not in src:
    raise SystemExit(
        "maintenance.html is missing the ava-uptime JSON placeholder:\n  " + PLACEHOLDER
    )

holding = root / "Sites" / "Holding" / "index.html"
holding.parent.mkdir(parents=True, exist_ok=True)
holding.write_text(src, encoding="utf-8", newline="\n")

esc = src.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
out = root / "packages" / "workers" / "src" / "shared" / "maintenancePage.ts"
out.write_text(
    """/**
 * Public offline / origin-down landing page.
 * Canonical HTML: apps/core/static/maintenance.html
 * Regenerate with: python windows/sync_maintenance_html.py
 * Do not show CF 1033, HOST OFFLINE, goals, donate wallets, Snapdragon, or 1 TB copy.
 */
import type { UptimeFacts } from "./uptime";

/** Null block baked into the canonical HTML, replaced when we have real numbers. */
const UPTIME_PLACEHOLDER = '{"last_up_ms":null,"avg_recovery_s":null,"outages":0}';

export function maintenanceHtml(facts?: UptimeFacts | null): string {
  const html = `"""
    + esc
    + """`;
  if (!facts || !facts.last_up_ms) return html;
  return html.replace(UPTIME_PLACEHOLDER, JSON.stringify(facts));
}

export function maintenancePage(facts?: UptimeFacts | null): Response {
  return new Response(maintenanceHtml(facts), {
    status: 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Retry-After": "120",
      "X-Ava-Fallback": "maintenance",
    },
  });
}

export function goalsHiddenPage(): Response {
  return new Response(maintenanceHtml(), {
    status: 404,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Ava-Goals": "hidden",
    },
  });
}
""",
    encoding="utf-8",
)
print("wrote", out)
print("wrote", holding)
