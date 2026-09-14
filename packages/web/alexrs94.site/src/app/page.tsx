import Link from "next/link";

export default function HomePage() {
  return (
    <main className="panel">
      <p className="eyebrow">Alex · official site</p>
      <h1 className="title">Building in public, one real system at a time.</h1>
      <p className="lead">
        This is the home base for Alex: site projects, solar-hosted runtime operations, drone and
        photography work, and connected platforms across Root Record, Ava, and RootMC.
      </p>

      <div className="grid">
        <section className="tile">
          <h2 className="sectionTitle">Solar operations</h2>
          <p className="lead">
            Live power context, energy constraints, and host reliability notes that shape every
            public service.
          </p>
          <Link href="/solar">Open Solar page</Link>
        </section>

        <section className="tile">
          <h2 className="sectionTitle">Media and flight work</h2>
          <p className="lead">
            A foundation for drone captures, still photography, and long-form media collections.
          </p>
          <Link href="/media">Open Media page</Link>
        </section>

        <section className="tile">
          <h2 className="sectionTitle">Blog</h2>
          <p className="lead">
            Dated personal notes — solar, media, and site work that stays off the brand changelogs.
          </p>
          <Link href="/blog">Open Blog</Link>
        </section>

        <section className="tile">
          <h2 className="sectionTitle">YouTube</h2>
          <p className="lead">
            HIqualityviews is the current public channel for footage, cuts, and field updates.
          </p>
          <a href="https://www.youtube.com/@HIqualityviews">Visit @HIqualityviews</a>
        </section>
      </div>
    </main>
  );
}

