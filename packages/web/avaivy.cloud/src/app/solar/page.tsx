import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Solar — Ava Ivy",
  description: "Ground-mounted PV and EcoFlow bank on the HI Pacific Solar Root Server.",
};

/** Fallback when origin /solar is unreachable — same desk as /status. */
export default function SolarPage() {
  return (
    <iframe
      src="https://avaivy.cloud/status"
      title="Ava Ivy solar desk"
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        border: 0,
        background: "#0a0e14",
        zIndex: 9999,
      }}
    />
  );
}
