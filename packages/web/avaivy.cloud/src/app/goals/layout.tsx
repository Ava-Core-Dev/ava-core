export const metadata = {
  title: "Not listed — Ava Ivy",
  robots: { index: false, follow: false },
};

export default function GoalsLayout() {
  return (
    <main style={{ maxWidth: "36rem", margin: "4rem auto", padding: "0 1.25rem", color: "#e8eef7" }}>
      <h1 style={{ fontFamily: "Georgia, serif", fontWeight: 500 }}>This page is not listed right now.</h1>
      <p style={{ color: "#8b9bb4", lineHeight: 1.6 }}>
        Money goals and donate addresses stay off the public site until we finish sorting the new home computer.
      </p>
      <p>
        <a href="https://kilauea.cloud" style={{ color: "#3ee0c6" }}>Kīlauea Alerts</a>
        {" · "}
        <a href="https://rootmc.net" style={{ color: "#3ee0c6" }}>RootMC</a>
      </p>
    </main>
  );
}
