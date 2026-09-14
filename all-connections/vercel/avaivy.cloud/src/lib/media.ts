import { AVA_ORIGIN } from "@/lib/status";

export type PublicMediaFile = {
  path: string;
  name: string;
  size: number;
  mtime: string;
  download: string;
};

export type PublicMediaCatalog = {
  ok: boolean;
  generated: string;
  count: number;
  live: boolean;
  folders?: Record<string, number>;
  files: PublicMediaFile[];
};

export async function getPublicMediaCatalog(
  revalidateSeconds = 60
): Promise<PublicMediaCatalog> {
  try {
    const res = await fetch(`${AVA_ORIGIN}/api/media/public?limit=1500`, {
      next: { revalidate: revalidateSeconds },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = (await res.json()) as Omit<PublicMediaCatalog, "live">;
      if (Array.isArray(data.files)) {
        return { ...data, live: true, ok: true };
      }
    }
  } catch {
    /* host down */
  }
  return {
    ok: true,
    generated: "",
    count: 0,
    live: false,
    files: [],
  };
}

export function folderOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i === -1 ? "(root)" : path.slice(0, i);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function publicDownloadHref(file: PublicMediaFile): string {
  return `/api/media/public/file?path=${encodeURIComponent(file.path)}`;
}
