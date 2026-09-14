"use client";

const ORIGIN_BOARD = "https://origin.avaivy.cloud/status";

export default function StatusBoard({ title }: { title: string }) {
  return (
    <iframe
      src={ORIGIN_BOARD}
      title={title}
      style={{
        display: "block",
        width: "100%",
        height: "100dvh",
        border: 0,
        background: "#0a0e14",
      }}
    />
  );
}
