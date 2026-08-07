/**
 * Discord Gateway transport — Message Content + DMs + guild messages.
 * Prefer over REST poller for latency; poller remains emergency fallback.
 */
import WebSocket from "ws";
import { DISCORD_API, watchChannels, ROOTMC_GUILD_ID } from "./config.mjs";
import { authHeaders } from "./discordApi.mjs";

const INTENT_BASE =
  (1 << 0) | // GUILDS
  (1 << 9) | // GUILD_MESSAGES
  (1 << 10) | // GUILD_MESSAGE_REACTIONS
  (1 << 12) | // DIRECT_MESSAGES
  (1 << 15); // MESSAGE_CONTENT
const INTENT_MEMBERS = 1 << 1; // GUILD_MEMBERS (privileged — Server Members Intent in Dev Portal)

/**
 * @param {{ token, onMessage, onReady, onMemberJoin, onReaction?, onInteraction?, watchIds? }} opts
 */
export function startGateway({
  token,
  onMessage,
  onReady,
  onMemberJoin,
  onReaction,
  onInteraction,
  watchIds,
}) {
  let ws = null;
  let hb = null;
  let seq = null;
  let sessionId = null;
  let resumeUrl = null;
  let alive = true;
  /** Prefer members intent for join welcomes; drop after Discord 4014. */
  let useMembersIntent = true;
  let joinWelcomeArmed = false;
  let reconnectCount = 0;
  let connected = false;
  let lastCloseCode = null;
  let lastReadyUsername = null;

  const watch = new Set(
    (watchIds || watchChannels({}) || []).map(String).filter(Boolean),
  );

  async function gatewayUrl() {
    const res = await fetch(`${DISCORD_API}/gateway/bot`, {
      headers: authHeaders(token),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`gateway/bot ${res.status}`);
    return data.url;
  }

  function currentIntents() {
    return useMembersIntent ? INTENT_BASE | INTENT_MEMBERS : INTENT_BASE;
  }

  function identify() {
    ws.send(
      JSON.stringify({
        op: 2,
        d: {
          token,
          intents: currentIntents(),
          properties: { os: "windows", browser: "ava-ivy", device: "ava-ivy" },
        },
      }),
    );
  }

  function startHeartbeat(ms) {
    if (hb) clearInterval(hb);
    hb = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ op: 1, d: seq }));
      }
    }, ms);
  }

  async function connect() {
    const base = resumeUrl || (await gatewayUrl());
    const url = `${base}?v=10&encoding=json`;
    ws = new WebSocket(url);

    ws.on("open", () => {
      connected = true;
      console.log("Ava gateway open");
    });

    ws.on("message", (raw) => {
      let pkt;
      try {
        pkt = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (pkt.s != null) seq = pkt.s;

      if (pkt.op === 10) {
        startHeartbeat(pkt.d.heartbeat_interval);
        if (sessionId && resumeUrl) {
          ws.send(
            JSON.stringify({
              op: 6,
              d: { token, session_id: sessionId, seq },
            }),
          );
        } else {
          identify();
        }
        return;
      }

      if (pkt.op === 0) {
        const t = pkt.t;
        const d = pkt.d;
        if (t === "READY") {
          sessionId = d.session_id;
          resumeUrl = d.resume_gateway_url || resumeUrl;
          joinWelcomeArmed = useMembersIntent;
          lastReadyUsername = d.user?.username || lastReadyUsername;
          connected = true;
          console.log(
            "Ava gateway READY as",
            d.user?.username,
            joinWelcomeArmed ? "(join welcomes on)" : "(join welcomes off — enable Server Members Intent)",
          );
          onReady?.(d);
          return;
        }
        if (t === "MESSAGE_CREATE" && d) {
          // Guild: only allowlisted channels (+ DMs always)
          const isDm = !d.guild_id;
          const inGuild = String(d.guild_id || "") === String(ROOTMC_GUILD_ID);
          if (!isDm && !inGuild) return;
          // /solar is a global utility — any RootMC channel (slash already bypasses watch)
          const content = String(d.content || "").trim();
          const isSolarCmd =
            /^\/solar(?:\s|$)/i.test(content) ||
            /^solar(?:\s+status)?$/i.test(content);
          if (
            !isDm &&
            watch.size &&
            !watch.has(String(d.channel_id)) &&
            !isSolarCmd
          ) {
            // Still allow if channel later added to watch via home channel
            // — skip non-watch guild channels
            return;
          }
          onMessage?.(d, { isDm });
          return;
        }
        // Slash / buttons — always for our app (no channel watch gate; Discord already scoped)
        if (t === "INTERACTION_CREATE" && d) {
          try {
            onInteraction?.(d);
          } catch (err) {
            console.warn("gateway interaction:", err?.message || err);
          }
          return;
        }
        if (
          (t === "MESSAGE_REACTION_ADD" || t === "MESSAGE_REACTION_REMOVE") &&
          d
        ) {
          const isDm = !d.guild_id;
          const inGuild = String(d.guild_id || "") === String(ROOTMC_GUILD_ID);
          if (!isDm && !inGuild) return;
          if (!isDm && watch.size && !watch.has(String(d.channel_id))) return;
          onReaction?.(d, { added: t === "MESSAGE_REACTION_ADD", isDm });
          return;
        }
        if (t === "GUILD_MEMBER_ADD" && d) {
          if (String(d.guild_id || "") !== String(ROOTMC_GUILD_ID)) return;
          onMemberJoin?.(d);
        }
      }
    });

    ws.on("close", (code) => {
      connected = false;
      lastCloseCode = code;
      reconnectCount += 1;
      console.warn("Ava gateway closed", code);
      if (hb) clearInterval(hb);
      if (!alive) return;
      // 4014 = privileged intent not enabled in Dev Portal
      if (code === 4014 && useMembersIntent) {
        useMembersIntent = false;
        joinWelcomeArmed = false;
        sessionId = null;
        resumeUrl = null;
        seq = null;
        console.warn(
          "Ava: Server Members Intent missing — reconnecting without join events. Enable it at Discord Developer Portal → Bot → Privileged Gateway Intents.",
        );
        setTimeout(() => {
          connect().catch((err) => console.warn("gateway reconnect:", err.message));
        }, 1500);
        return;
      }
      setTimeout(() => {
        connect().catch((err) => console.warn("gateway reconnect:", err.message));
      }, 5000);
    });

    ws.on("error", (err) => {
      console.warn("Ava gateway error:", err.message);
    });
  }

  connect().catch((err) => {
    console.error("Ava gateway failed to start:", err.message);
  });

  return {
    addWatch(id) {
      if (id) watch.add(String(id));
    },
    joinWelcomesEnabled() {
      return joinWelcomeArmed;
    },
    stats() {
      return {
        connected,
        reconnectCount,
        lastCloseCode,
        joinWelcomes: joinWelcomeArmed,
        membersIntent: useMembersIntent,
        username: lastReadyUsername,
      };
    },
    stop() {
      alive = false;
      if (hb) clearInterval(hb);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    },
  };
}
