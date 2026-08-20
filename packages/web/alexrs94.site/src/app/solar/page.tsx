export const metadata = {
  title: "Solar — alexrs94.site",
  description: "Solar-hosted operations and power-aware platform notes.",
};

export default function SolarPage() {
  return (
    <main className="panel">
      <p className="eyebrow">Solar</p>
      <h1 className="title">Power first, then everything else.</h1>
      <p className="lead">
        This page is the solar operations foundation for alexrs94.site. It is where live power
        realities, maintenance windows, and uptime strategy are explained in plain language.
      </p>
      <div className="grid">
        <section className="tile">
          <h2 className="sectionTitle">What belongs here</h2>
          <ul>
            <li>Live solar status summaries</li>
            <li>Battery behavior over day/night windows</li>
            <li>Service windows and power-based changes</li>
            <li>Public uptime notes and restoration updates</li>
          </ul>
        </section>
        <section className="tile">
          <h2 className="sectionTitle">Linked systems</h2>
          <ul>
            <li>Root Record live dashboard</li>
            <li>Ava runtime status</li>
            <li>RootMC gameplay effects from host power</li>
          </ul>
        </section>
      </div>
    </main>
  );
}

