from pathlib import Path

root = Path(__file__).resolve().parents[1]
html = root / "apps" / "core" / "static" / "maintenance.html"
src = html.read_text(encoding="utf-8")
holding = root / "Sites" / "Holding" / "index.html"
holding.parent.mkdir(parents=True, exist_ok=True)
holding.write_text(src, encoding="utf-8", newline="\n")
esc = src.replace("\\", "\\\\").replace("`", "\\`").replace("${", "\\${")
out = Path(__file__).resolve().parents[1] / "packages" / "workers" / "src" / "shared" / "maintenancePage.ts"
out.write_text(
    """/**
 * Public offline / origin-down landing page.
 * Canonical HTML: apps/core/static/maintenance.html
 * Do not show CF 1033, HOST OFFLINE, goals, donate wallets, Snapdragon, or 1 TB copy.
 */
export function maintenanceHtml(): string {
  return `"""
    + esc
    + """`;
}

export function maintenancePage(): Response {
  return new Response(maintenanceHtml(), {
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
