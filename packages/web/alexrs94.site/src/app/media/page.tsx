export const metadata = {
  title: "Media — alexrs94.site",
  description: "Photography, drone footage, and media project index.",
};

export default function MediaPage() {
  return (
    <main className="panel">
      <p className="eyebrow">Media</p>
      <h1 className="title">Photo and drone library foundation.</h1>
      <p className="lead">
        This is the start of the public media index for Alex. As collections grow, this page can
        split into albums, project pages, and release notes.
      </p>

      <div className="grid">
        <section className="tile">
          <h2 className="sectionTitle">Photography</h2>
          <p className="lead">
            Portfolio, location sets, and high-resolution stills can be listed here by date and
            theme.
          </p>
        </section>
        <section className="tile">
          <h2 className="sectionTitle">Drone captures</h2>
          <p className="lead">
            Flight clips, stitched views, and time-lapse work can be organized by mission and
            region.
          </p>
        </section>
        <section className="tile">
          <h2 className="sectionTitle">YouTube channel</h2>
          <p className="lead">Primary public video stream for releases and updates.</p>
          <a href="https://www.youtube.com/@HIqualityviews">Open @HIqualityviews</a>
        </section>
      </div>
    </main>
  );
}

