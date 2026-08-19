import styles from "./page.module.css";
import DashboardClient from "@/components/DashboardClient";

export const revalidate = 30;

async function fetchAll() {
  const origin = process.env.AVA_ORIGIN_URL || "https://ava-origin.rootmc.net";
  const opts = { next: { revalidate: 30 }, signal: AbortSignal.timeout(5000) } as RequestInit;
  const safe = async (url: string) => {
    try { const r = await fetch(url, opts); if (r.ok) return r.json(); } catch {}
    return null;
  };
  const [status, solar, mc, kilauea, weather] = await Promise.all([
    safe(`${origin}/api/status`),
    safe(`${origin}/api/solar`),
    safe(`${origin}/api/minecraft/status`),
    safe(`${origin}/api/kilauea`),
    safe(`${origin}/api/weather`),
  ]);
  return { status, solar, mc, kilauea, weather };
}

export default async function Dashboard() {
  const data = await fetchAll();
  return <DashboardClient initial={data as any} />;
}
