import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Solar — Ava Ivy",
  description: "Ground-mounted PV and EcoFlow bank on the HI Pacific Solar Root Server.",
};

export default function SolarPage() {
  // Served when origin is down; live avaivy.cloud/solar is proxied to origin HTML.
  return (
    <div style={{ padding: 24, maxWidth: 720, margin: "40px auto", color: "#e5e7eb" }}>
      <h1 style={{ color: "#f59e0b" }}>Ava Ivy · Solar</h1>
      <p>Live desk is on the solar host. Retry this page when she is awake.</p>
      <p>
        <a href="/solar">Retry</a>
        {" · "}
        <a href="/status">Status</a>
      </p>
    </div>
  );
}
