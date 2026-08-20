import { AVA_ORIGIN } from "./status";

export interface LiveStatus {
  ok: boolean;
  live: boolean;
  streaming: boolean;
  scene?: string | null;
  duration_ms?: number | null;
  watch_url: string;
  embed_url: string;
  channel_id: string;
  channel_handle: string;
  page_url?: string;
  embed_page_url?: string;
}

export const FALLBACK_LIVE: LiveStatus = {
  ok: false,
  live: false,
  streaming: false,
  watch_url: "https://www.youtube.com/@AvaIvyRootMC/live",
  embed_url:
    "https://www.youtube-nocookie.com/embed/live_stream?channel=UC6M7U4fXAWuVYhgm_veKecA&autoplay=1&modestbranding=1&rel=0&playsinline=1",
  channel_id: "UC6M7U4fXAWuVYhgm_veKecA",
  channel_handle: "@AvaIvyRootMC",
  page_url: "https://avaivy.cloud/live",
  embed_page_url: "https://avaivy.cloud/live/embed",
};

export async function getLiveStatus(revalidateSeconds = 10): Promise<LiveStatus> {
  try {
    const res = await fetch(`${AVA_ORIGIN}/api/live`, {
      next: { revalidate: revalidateSeconds },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return FALLBACK_LIVE;
    const data = (await res.json()) as LiveStatus;
    return { ...FALLBACK_LIVE, ...data, live: !!(data.live || data.streaming) };
  } catch {
    return FALLBACK_LIVE;
  }
}
