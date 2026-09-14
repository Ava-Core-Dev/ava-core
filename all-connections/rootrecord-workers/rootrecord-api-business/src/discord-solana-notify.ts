/** Best-effort Discord Incoming Webhook posts for Solana-related tooling (never throws). */

function chunkDiscordContent(text: string, max = 1900): string[] {
  const out: string[] = [];
  let s = text.replace(/\r\n/g, "\n");
  while (s.length > 0) {
    if (s.length <= max) {
      out.push(s);
      break;
    }
    let cut = s.lastIndexOf("\n", max);
    if (cut < 200) cut = max;
    out.push(s.slice(0, cut).trimEnd());
    s = s.slice(cut).trimStart();
  }
  return out;
}

export function isDiscordWebhookUrl(url: string): boolean {
  return /(?:discord\.com|discordapp\.com)\/api\/webhooks\//i.test(url.trim());
}

export async function notifySolanaToolsDiscord(webhookUrl: string | undefined, markdownBody: string): Promise<void> {
  const url = String(webhookUrl || "").trim();
  if (!url || !isDiscordWebhookUrl(url)) return;
  try {
    const chunks = chunkDiscordContent(markdownBody, 1900);
    for (const chunk of chunks) {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: chunk }),
      });
      if (!r.ok) break;
    }
  } catch {
    // ignore — API must not depend on Discord
  }
}
