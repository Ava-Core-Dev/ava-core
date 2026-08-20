import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Ava Ivy — Solar Root Server",
  description:
    "Live solar desk, EcoFlow bank, host status, and graphs — HI Pacific Solar Root Server.",
};

/** Home is the solar/status desk (origin). Next chrome is skipped for this full-bleed board. */
export default function Home() {
  return (
    <iframe
      id="solar-desk"
      title="Ava Ivy solar status desk"
      src="/desk"
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        border: 0,
        background: "#0a0e14",
      }}
    />
  );
}
