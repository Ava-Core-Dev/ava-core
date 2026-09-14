import { json } from "./cors";
import { discordBotFetch } from "./discord-rootmc-api";
import { record, str } from "./realm-lib";
import { resolveDiscordChannel } from "./rootmc-discord-channels";
import type { RootStatEnv } from "./rootstat-minecraft";
import { validateServerAuth } from "./rootstat-minecraft";

type ChatEnv = RootStatEnv & {
  DISCORD_ROOTMC_BOT_TOKEN?: string;
  DISCORD_ROOTMC_INGAME_CHAT_CHANNEL_ID?: string;
};

function ingameChatChannelId(env: ChatEnv): string {
  return resolveDiscordChannel(env, "ingameChat", { allowBlank: true });
}

function botToken(env: ChatEnv): string {
  return String(env.DISCORD_ROOTMC_BOT_TOKEN || "").replace(/^bot\s+/i, "").trim();
}

function stripMcColors(text: string): string {
  return text.replace(/§[0-9a-fk-or]/gi, "").replace(/&[0-9a-fk-or]/gi, "").trim();
}

function formatDiscordLine(username: string, message: string, kind: string): string {
  switch (kind) {
    case "join":
      return `**${username}** joined the server`;
    case "leave":
      return message.toLowerCase().includes("left the server") ? `**${username}** left the server` : `**${username}** ${message}`;
    case "death":
      return `**${username}** ${message}`;
    case "reachout":
    case "economy":
    case "grant":
    case "broadcast":
    case "vote_milestone":
    case "system":
      return message.startsWith("**") ? message : `**${username}** ${message}`;
    default:
      return `**${username}**: ${message}`;
  }
}

async function postDiscordChatMessage(env: ChatEnv, content: string): Promise<boolean> {
  const token = botToken(env);
  const channelId = ingameChatChannelId(env);
  if (!token || !channelId) {
    console.warn("ingame_chat_discord_skip", "bot token or channel not configured");
    return false;
  }
  const res = await discordBotFetch(token, `/channels/${encodeURIComponent(channelId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: content.slice(0, 1900) }),
  });
  if (!res.ok) {
    console.warn("ingame_chat_discord_post_failed", res.status, await res.text().catch(() => ""));
    return false;
  }
  return true;
}

export async function handleRootMcIngameChat(
  request: Request,
  env: ChatEnv,
  subpath: string,
  method: string,
): Promise<Response | null> {
  if (!subpath.startsWith("/rootmc/ingame-chat")) return null;

  if (method === "POST" && subpath === "/rootmc/ingame-chat") {
    const server = await validateServerAuth(env, request);
    if (server instanceof Response) return server;

    let body: Record<string, unknown>;
    try {
      body = record(JSON.parse(await request.text()));
    } catch {
      return json({ detail: "Invalid JSON body." }, 400);
    }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    let posted = 0;
    for (const raw of messages) {
      const row = record(raw);
      const username = stripMcColors(str(row.username));
      const message = stripMcColors(str(row.message));
      const kind = str(row.kind).toLowerCase() || "chat";
      if (!username || !message) continue;
      const line = formatDiscordLine(username, message, kind);
      if (await postDiscordChatMessage(env, line)) {
        posted++;
      }
    }

    return json({ ok: true, posted, channel_id: ingameChatChannelId(env) || null });
  }

  if (method === "GET" && subpath === "/rootmc/ingame-chat/poll") {
    try {
      const server = await validateServerAuth(env, request);
      if (server instanceof Response) return server;

      const token = botToken(env);
      const channelId = ingameChatChannelId(env);
      if (!token || !channelId) {
        return json({ ok: false, detail: "Discord chat bridge not configured on API." }, 503);
      }

      const url = new URL(request.url);
      const after = str(url.searchParams.get("after"));
      const query = new URLSearchParams({ limit: "25" });
      if (after) query.set("after", after);

      const res = await discordBotFetch(
        token,
        `/channels/${encodeURIComponent(channelId)}/messages?${query.toString()}`,
      );
      if (!res.ok) {
        const errText = await res.text().catch(() => "");
        console.warn("ingame_chat_discord_fetch_failed", res.status, errText.slice(0, 200));
        return json(
          { ok: false, detail: "Discord fetch failed", status: res.status },
          502,
        );
      }

      let rows: Array<{
        id?: string;
        content?: string;
        author?: { id?: string; username?: string; global_name?: string; bot?: boolean };
      }> = [];
      try {
        rows = (await res.json()) as typeof rows;
      } catch (parseErr) {
        console.warn("ingame_chat_discord_json_failed", parseErr);
        return json({ ok: false, detail: "Discord response was not JSON" }, 502);
      }

      const messages: Array<{ id: string; username: string; message: string }> = [];
      for (const row of rows) {
        const id = str(row.id);
        const author = row.author || {};
        if (!id || author.bot) continue;
        const username = stripMcColors(str(author.global_name) || str(author.username));
        const message = stripMcColors(str(row.content));
        if (!username || !message) continue;
        messages.push({ id, username, message });
      }

      messages.reverse();

      const newestId =
        rows.length > 0
          ? rows.reduce((best, row) => {
              const id = str(row.id);
              if (!id) return best;
              if (!best) return id;
              try {
                return BigInt(id) > BigInt(best) ? id : best;
              } catch {
                return best;
              }
            }, "")
          : after || null;

      return json({
        ok: true,
        messages,
        newest_id: newestId || null,
        channel_id: channelId,
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.error("ingame_chat_poll_error", detail.slice(0, 500));
      return json({ ok: false, detail: "In-game chat poll failed" }, 500);
    }
  }

  return json({ detail: "Not Found" }, 404);
}
