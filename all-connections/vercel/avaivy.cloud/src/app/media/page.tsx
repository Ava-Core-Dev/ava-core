import idx from "./media.module.css";
import {
  folderOf,
  formatBytes,
  getPublicMediaCatalog,
  publicDownloadHref,
} from "@/lib/media";

export const revalidate = 60;
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Public media index — Ava Ivy",
  description:
    "Downloadable public Ava Ivy media: reports, audio, video, and brand. Private 1:1 files are not listed.",
};

export default async function PublicMediaPage() {
  const catalog = await getPublicMediaCatalog();
  const groups = new Map<string, typeof catalog.files>();
  for (const f of catalog.files) {
    const key = folderOf(f.path);
    const list = groups.get(key) || [];
    list.push(f);
    groups.set(key, list);
  }
  const folders = [...groups.keys()].sort();

  return (
    <section className={idx.wrap}>
        <p className={idx.eyebrow}>Public index</p>
        <h1 className={idx.title}>Media library</h1>
        <p className={idx.lead}>
          Everything Ava publishes for download: ops reports, voice clips, video, and brand.
          1:1 DMs, life story, and account profiling stay on the host and are not in this list.
        </p>
        <p className={idx.note}>
          Downloads go through the live origin when the solar host is up. If a link 404s at night,
          the file is still named here for transparency.
        </p>
        <p className={idx.meta}>
          {catalog.count} files listed
          {catalog.live ? " · live catalog" : " · host unreachable — list empty until sunrise"}
          {catalog.generated ? ` · ${catalog.generated}` : ""}
        </p>
        {catalog.files.length === 0 ? (
          <p className={idx.note}>No public files in this response. When the host is up, this page lists reports, audio, video, and brand assets.</p>
        ) : null}
        {folders.map((folder) => (
          <div key={folder} className={idx.group}>
            <h2>{folder} · {groups.get(folder)?.length}</h2>
            <table className={idx.table}>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Size</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(groups.get(folder) || []).map((f) => (
                  <tr key={f.path}>
                    <td className={idx.path}>{f.name}</td>
                    <td className={idx.size}>{formatBytes(f.size)}</td>
                    <td>
                      <a href={publicDownloadHref(f)}>Download</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>
  );
}
