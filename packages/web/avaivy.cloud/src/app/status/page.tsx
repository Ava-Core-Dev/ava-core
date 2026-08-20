import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Status — Ava Ivy",
  description: "Full solar desk and host status for the HI Pacific Solar Root Server.",
};

/** Fallback when the edge cannot proxy origin /status (same board as /solar). */
export default function StatusPage() {
  return (
    <iframe
      src="https://avaivy.cloud/solar"
      title="Ava Ivy status desk"
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
