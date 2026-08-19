/**
 * Reads host state straight from Ava's origin through the cloudflared tunnel.
 *
 * Reachability IS the signal: if the box is powered down the fetch fails, so
 * there is no separate heartbeat store to keep in sync. Returns null when the
 * host cannot be reached for any reason.
 */

export const AVA_ORIGIN =
  process.env.AVA_ORIGIN_URL || "https://ava-origin.rootmc.net";

export interface HostStatus {
  version: string;
  ts: string;
  uptime_s: number;
  host: string;
  cpu_pct: number;
  mem_pct: number;
  heartbeat_age_s: number | null;
  config?: Record<string, unknown>;
}

export async function getHostStatus(
  revalidateSeconds = 30
): Promise<HostStatus | null> {
  try {
    const res = await fetch(`${AVA_ORIGIN}/api/status`, {
      next: { revalidate: revalidateSeconds },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    return (await res.json()) as HostStatus;
  } catch {
    return null;
  }
}

export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
