import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Status — alexrs94.site",
  description: "Full solar desk and host status for the HI Pacific Solar Root Server.",
};

export default function StatusPage() {
  return (
    <iframe
      src="https://avaivy.cloud/status"
      title="Host status desk"
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
