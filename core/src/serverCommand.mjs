/**
 * /server — RootMC play status (moved from Official RootMC Discord bot → Ava).
 * Discord: guild slash + text `/server`. Data from public api.rootmc.net config.
 */
import { ROOTMC_GUILD_ID, DISCORD_API } from "./config.mjs";
import { authHeaders } from "./discordApi.mjs";
import { isLockoutActive } from "./lockoutMode.mjs";

const CONFIG_URLS = [
  "https://api.rootmc.net/api/rootmc/server/config",
  "https://api.rootmc.net/rootmc/server/config",
];

const FALLBACK = {
  name: "RootMC",
  address: "play.rootmc.net",
  game_version: "26.2",
  map_url: "https://map.rootmc.net/",
  verify_url: "https://rootmc.net/verify",
  realm_url: "https://rootmc.net/",
  rootmc_plugin_installed: false,
  rootmc_plugin_version: null,
  rootmc_last_seen_at: null,
};

const PLUGIN_FRESH_MS = 15 * 60 * 1000;

export function isServerCommand(text = "") {
  const t = String(text || "").trim();
  if (!t) return false;
  if (/^\/server(?:\s|$)/i.test(t)) return true;
  if (/^server(?:\s+status)?$/i.test(t)) return true;
  return false;
}

function pluginLooksOnline(row) {
  if (row?.rootmc_plugin_installed === true) {
    const last = row.rootmc_last_seen_at;
    if (!last) return true;
    const ms = Date.parse(last);
    if (!Number.isFinite(ms)) return true;
    return Date.now() - ms < PLUGIN_FRESH_MS;
  }
  const ms = Date.parse(row?.rootmc_last_seen_at || "");
  return Number.isFinite(ms) && Date.now() - ms < PLUGIN_FRESH_MS;
}

function fmtLastSeen(iso) {
  if (!iso) return "never";
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return String(iso);
  const ageMin = Math.max(0, Math.round((Date.now() - ms) / 60000));
  const nice = String(iso).replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
  if (ageMin < 60) return `${nice} (~${ageMin}m ago)`;
  const ageH = Math.round(ageMin / 60);
  return `${nice} (~${ageH}h ago)`;
}

async function fetchFeaturedServer() {
  for (const url of CONFIG_URLS) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "AvaIvyRootMC/0.5 (/server)",
        },
      });
      if (!res.ok) continue;
      const data = await res.json();
      const row = data?.featured_server;
      if (row && typeof row === "object") return row;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Build the /server status board (same fields Official bot showed, fuller heartbeat).
 */
export async function buildServerCommandReply() {
  const row = (await fetchFeaturedServer()) || FALLBACK;
  const name = String(row.name || FALLBACK.name);
  const address = String(row.address || FALLBACK.address);
  const version = String(row.game_version || FALLBACK.game_version);
  const pluginOn = pluginLooksOnline(row);
  const pluginVer = String(row.rootmc_plugin_version || "—");
  const lastSeen = fmtLastSeen(row.rootmc_last_seen_at);
  const mapUrl = String(row.map_url || "").trim() || FALLBACK.map_url;
  const realm = String(row.realm_url || FALLBACK.realm_url);
  const verify = String(row.verify_url || FALLBACK.verify_url);

  const lines = [
    `**${name}** — \`/server\` *(Ava)*`,
    `**Address:** \`${address}\``,
    `**Version:** ${version}`,
    `**RootMC plugin:** ${pluginOn ? "online" : "offline"} (${pluginVer})`,
    `_Last heartbeat: ${lastSeen}_`,
  ];
  if (mapUrl) lines.push(`**Map:** ${mapUrl}`);
  lines.push(`**Realm:** ${realm}`, `**Verify MC account:** ${verify}`, "", "— Ava");
  return lines.join("\n");
}

export async function tryHandleServerCommand({ text = "", isAlex = false } = {}) {
  if (!isServerCommand(text)) return null;
  if (isLockoutActive() && !isAlex) {
    return { handled: true, reply: null, lockout: true };
  }
  const reply = await buildServerCommandReply();
  return { handled: true, reply };
}

export async function registerServerSlashCommand(token, { appId, guildId } = {}) {
  const applicationId = String(appId || "").trim();
  const gid = String(guildId || ROOTMC_GUILD_ID || "").trim();
  if (!token || !applicationId || !gid) {
    return { ok: false, detail: "missing token/appId/guildId" };
  }
  const body = {
    name: "server",
    description: "RootMC status, address, map, and realm links",
    type: 1,
  };
  const base = `${DISCORD_API}/applications/${applicationId}/guilds/${gid}/commands`;
  const headers = {
    ...authHeaders(token),
    "Content-Type": "application/json",
  };

  let existingId = null;
  try {
    const listRes = await fetch(base, { headers: authHeaders(token) });
    const list = await listRes.json().catch(() => []);
    if (Array.isArray(list)) {
      existingId = list.find((c) => String(c?.name || "") === "server")?.id || null;
    }
  } catch {
    /* create */
  }

  const url = existingId ? `${base}/${existingId}` : base;
  const method = existingId ? "PATCH" : "POST";
  const res = await fetch(url, {
    method,
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      detail: json?.message || JSON.stringify(json).slice(0, 200),
    };
  }
  return { ok: true, id: json.id, name: json.name, updated: Boolean(existingId) };
}

/**
 * INTERACTION_CREATE for /server — ACK within ~3s (ephemeral, matches Official).
 */
export async function handleServerInteraction(interaction, { token } = {}) {
  const name = interaction?.data?.name || interaction?.data?.custom_id;
  if (String(name || "").toLowerCase() !== "server") return false;
  if (Number(interaction?.type) !== 2) return false;

  const id = interaction.id;
  const itoken = interaction.token;
  const appId = interaction.application_id;
  if (!id || !itoken) return false;

  if (isLockoutActive()) {
    try {
      await fetch(`${DISCORD_API}/interactions/${id}/${itoken}/callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: 4,
          data: {
            content: "Lockout — I'm Telegram-only with Alex right now.",
            flags: 64,
          },
        }),
      });
    } catch {
      /* ignore */
    }
    return true;
  }

  let deferred = false;
  try {
    const ack = await fetch(
      `${DISCORD_API}/interactions/${id}/${itoken}/callback`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // DEFERRED + ephemeral
        body: JSON.stringify({ type: 5, data: { flags: 64 } }),
      },
    );
    deferred = ack.ok;
    if (!ack.ok) {
      const body = await ack.text().catch(() => "");
      console.warn("server slash ACK failed", ack.status, body.slice(0, 160));
    }
  } catch (err) {
    console.warn("server slash ACK err:", err.message);
  }

  const finish = async () => {
    let content;
    try {
      content = await buildServerCommandReply();
    } catch (err) {
      content = `**/server** failed: ${err.message || "unknown"}`;
    }
    content = String(content).slice(0, 2000);

    if (deferred && appId) {
      const patch = await fetch(
        `${DISCORD_API}/webhooks/${appId}/${itoken}/messages/@original`,
        {
          method: "PATCH",
          headers: {
            ...(token ? authHeaders(token) : {}),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ content }),
        },
      );
      if (!patch.ok) {
        const body = await patch.text().catch(() => "");
        console.warn("server slash patch failed", patch.status, body.slice(0, 160));
      }
      return;
    }

    const channelId = interaction.channel_id;
    if (channelId && token) {
      await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
        method: "POST",
        headers: {
          ...authHeaders(token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content }),
      }).catch((err) => console.warn("server slash fallback post:", err.message));
    }
  };

  void finish().catch((err) => console.warn("server slash finish:", err.message));
  return true;
}
