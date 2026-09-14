/**
 * Standalone: set Ava Ivy Discord Rich Presence on the local Discord client.
 *
 *   node scripts/rich-presence.mjs
 *
 * Requires Discord desktop running. Disable via AVA_RICH_PRESENCE=0.
 */
import { startDesktopRichPresence, buildSetActivity, AVA_RPC } from "../src/richPresence.mjs";

console.log("Ava Ivy RPC", {
  partyId: AVA_RPC.partyId,
  party: `${AVA_RPC.partySize}/${AVA_RPC.partyMax}`,
  details: AVA_RPC.details,
  state: AVA_RPC.state,
});

const handle = startDesktopRichPresence({
  activity: buildSetActivity(),
});

if (!handle) {
  process.exit(1);
}

process.on("SIGINT", () => {
  handle.stop();
  process.exit(0);
});

// Keep process alive so presence stays set
setInterval(() => {}, 1 << 30);
