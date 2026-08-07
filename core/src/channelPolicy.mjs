/**
 * Channel policy — #admins is for humans + replies when addressed.
 * Unsolicited Ava digests / audits / pending checks do not go there.
 */

import { AVA_CHANNELS } from "./config.mjs";

/** Discord channels where Ava must not post unsolicited status. */
export function noUnsolicitedChannelIds() {
  const ids = new Set([
    AVA_CHANNELS.admins,
    "1516121832493678612",
  ]);
  const extra = String(process.env.AVA_NO_UNSOLICITED_CHANNELS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const id of extra) ids.add(id);
  return ids;
}

export function allowsUnsolicitedPost(channelId) {
  const id = String(channelId || "").trim();
  if (!id) return false;
  return !noUnsolicitedChannelIds().has(id);
}
