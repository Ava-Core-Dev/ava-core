/**
 * Discord Rich Presence for the Ava Ivy application
 * (Developer Portal → Rich Presence visualizer → IPC on the desktop client).
 *
 * Shows on the local Discord user (e.g. rootrecorddev) as PLAYING Ava Ivy —
 * not the bot's own Gateway presence.
 */
import { createRequire } from "node:module";
import { AVA_BOT_APP_ID } from "./config.mjs";

const require = createRequire(import.meta.url);

/** Locked visualizer fields (party + join completed 2026-07-31). */
export const AVA_RPC = {
  details: "Making Edits",
  state: "Seductively",
  partyId: "ae488379-351d-4a4f-ad32-2b9b01c91657",
  partySize: 1,
  partyMax: 5,
  joinSecret: "MTI4NzM0OjFpMmhuZToxMjMxMjM=",
  /** Tooltips only — upload assets in Dev Portal before setting image keys. */
  largeImageText: "Numbani",
  smallImageText: "Rogue - Level 100",
};

export function buildSetActivity(overrides = {}) {
  const start =
    overrides.startTimestamp != null
      ? overrides.startTimestamp
      : Date.now();
  const activity = {
    details: overrides.details ?? AVA_RPC.details,
    state: overrides.state ?? AVA_RPC.state,
    startTimestamp: start,
    partyId: overrides.partyId ?? AVA_RPC.partyId,
    partySize: overrides.partySize ?? AVA_RPC.partySize,
    partyMax: overrides.partyMax ?? AVA_RPC.partyMax,
    joinSecret: overrides.joinSecret ?? AVA_RPC.joinSecret,
  };
  if (overrides.endTimestamp != null) {
    activity.endTimestamp = overrides.endTimestamp;
  }
  if (overrides.largeImageKey) {
    activity.largeImageKey = overrides.largeImageKey;
    activity.largeImageText =
      overrides.largeImageText ?? AVA_RPC.largeImageText;
  }
  if (overrides.smallImageKey) {
    activity.smallImageKey = overrides.smallImageKey;
    activity.smallImageText =
      overrides.smallImageText ?? AVA_RPC.smallImageText;
  }
  return activity;
}

/**
 * Connect via Discord desktop IPC and set Ava Ivy activity.
 * No-op when AVA_RICH_PRESENCE=0 or Discord client is not running.
 * @returns {{ stop: () => void } | null}
 */
export function startDesktopRichPresence({
  clientId = AVA_BOT_APP_ID,
  activity,
} = {}) {
  if (String(process.env.AVA_RICH_PRESENCE || "1").trim() === "0") {
    return null;
  }
  let DiscordRPC;
  try {
    DiscordRPC = require("discord-rpc");
  } catch {
    console.warn(
      "Ava rich presence: install discord-rpc (npm i discord-rpc) to enable desktop Playing status",
    );
    return null;
  }

  DiscordRPC.register(clientId);
  const rpc = new DiscordRPC.Client({ transport: "ipc" });
  const payload = activity || buildSetActivity();
  let stopped = false;

  rpc.on("ready", () => {
    if (stopped) return;
    try {
      rpc.setActivity(payload);
      console.log("Ava Ivy rich presence set (desktop IPC)");
    } catch (err) {
      console.warn("Ava rich presence setActivity:", err.message);
    }
  });

  rpc.login({ clientId }).catch((err) => {
    console.warn(
      "Ava rich presence IPC:",
      err?.message || err,
      "(is Discord desktop open?)",
    );
  });

  return {
    stop() {
      stopped = true;
      try {
        rpc.clearActivity().catch(() => {});
        rpc.destroy();
      } catch {
        /* ignore */
      }
    },
  };
}
