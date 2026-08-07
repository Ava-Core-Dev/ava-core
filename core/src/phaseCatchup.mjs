/**
 * End-of-phase catch-up — force follow-up scan + soft ack reacts on recent Ava-addressed mail.
 * Agents running daily plans MUST call this after every phase/update.
 *
 *   import { runPhaseCatchup } from "./phaseCatchup.mjs";
 *   await runPhaseCatchup({ label: "phase-1" });
 *   await runPhaseCatchup({ label: "channel-scan-all", allChannels: true });
 *
 * CLI: node scripts/phase-catchup.mjs [label] [--all]
 */
import {
  loadEnv,
  botToken,
  AVA_BOT_APP_ID,
  AVA_CHANNELS,
  watchChannels,
  slackBotToken,
} from "./config.mjs";
import { makeFetchJson } from "./discordApi.mjs";
import { runFollowupScan } from "./followupScan.mjs";
import { createAckReactor } from "./ackReact.mjs";
import {
  looksLikeAvaTrigger,
  refersToAva,
  looksLikeTalkingAboutAva,
} from "./recommend.mjs";
import { isReactOnlyAck } from "./classify.mjs";
import { processPendingProposalIdeas } from "./proposalIdeas.mjs";
import { processPendingFeedback } from "./feedbackInbox.mjs";
import { listGuildWatchChannelIds } from "./guildChannelWatch.mjs";
import { pushStatusEvent, storePaths } from "./store.mjs";

const PRIORITY_CHANNELS = () =>
  [
    AVA_CHANNELS.updates,
    AVA_CHANNELS.development,
    AVA_CHANNELS.voting,
    AVA_CHANNELS.proposals,
    AVA_CHANNELS.admins,
    AVA_CHANNELS.avaHome,
    AVA_CHANNELS.ingameChat,
    AVA_CHANNELS.memesMedia,
  ].filter(Boolean);

function addressesAva(msg, avaId) {
  const c = String(msg.content || "");
  if (msg.mentions?.some((u) => u.id === avaId)) return true;
  if (new RegExp(`<@!?${avaId}>`).test(c)) return true;
  if (looksLikeAvaTrigger(c) || refersToAva(c) || looksLikeTalkingAboutAva(c)) {
    return true;
  }
  return false;
}

/**
 * Soft-ack recent human messages that address Ava (⏱️) so she never ghosts mid-plan.
 * Skips bots and messages that already have a ⏱️ reaction from anyone (cheap signal).
 */
async function softAckRecent(fetchJson, { avaId, channelIds, limit = 12 } = {}) {
  const reactor = createAckReactor({ fetchJson });
  let reacted = 0;
  let scannedChannels = 0;
  for (const channelId of channelIds) {
    let msgs = [];
    try {
      msgs = await fetchJson(
        `/channels/${channelId}/messages?limit=${Math.min(100, Math.max(5, limit))}`,
      );
      scannedChannels += 1;
    } catch (err) {
      console.warn("phaseCatchup list", channelId, err.message);
      continue;
    }
    for (const m of msgs) {
      if (!m?.id || m.author?.bot || m.author?.id === avaId) continue;
      if (!addressesAva(m, avaId) && !isReactOnlyAck(m.content || "", m.content || "")) {
        continue;
      }
      const hasTimer = (m.reactions || []).some(
        (r) => r.emoji?.name === "⏱️" || r.emoji?.name === "⏰",
      );
      if (hasTimer) continue;
      try {
        await reactor.reactStored(channelId, m.id);
        reacted++;
        await new Promise((r) => setTimeout(r, 250));
      } catch {
        /* ignore */
      }
    }
  }
  return { reacted, scannedChannels };
}

/**
 * @param {{
 *   label?: string,
 *   force?: boolean,
 *   maxPerPass?: number,
 *   queues?: boolean,
 *   allChannels?: boolean,
 *   softAckLimit?: number,
 *   discordLookback?: number,
 *   slackLookback?: number,
 * }} opts
 */
export async function runPhaseCatchup(opts = {}) {
  const label = String(opts.label || "phase").slice(0, 80);
  const allChannels =
    opts.allChannels === true ||
    /^channel-scan-all$/i.test(label) ||
    /\b--all\b/i.test(label);

  storePaths();
  const env = await loadEnv();
  const token = botToken(env);
  if (!token) {
    return { ok: false, reason: "no_discord_token", label };
  }
  const fetchJson = makeFetchJson(token);
  const avaId = AVA_BOT_APP_ID;
  const watch = watchChannels(env).filter((id) => !/^[CGD][A-Z0-9]+$/i.test(id));
  const priority = [...new Set([...PRIORITY_CHANNELS(), ...watch])];

  let channelIds = allChannels ? priority : priority.slice(0, 12);
  if (allChannels) {
    try {
      const all = await listGuildWatchChannelIds(fetchJson);
      if (Array.isArray(all) && all.length) {
        channelIds = [...new Set([...priority, ...all])];
      }
    } catch (err) {
      console.warn("phaseCatchup guild expand:", err.message);
    }
  }
  const softLimit = allChannels
    ? Number(opts.softAckLimit || 25) || 25
    : Number(opts.softAckLimit || 15) || 15;
  const maxPerPass = allChannels
    ? Number(opts.maxPerPass || 20) || 20
    : Number(opts.maxPerPass || 12) || 12;
  const discordLookback = allChannels
    ? Number(opts.discordLookback || 60) || 60
    : opts.discordLookback;
  const slackLookback = allChannels
    ? Number(opts.slackLookback || 60) || 60
    : opts.slackLookback;

  const soft = await softAckRecent(fetchJson, {
    avaId,
    channelIds,
    limit: softLimit,
  });

  const followup = await runFollowupScan({
    env,
    fetchJson,
    force: opts.force !== false,
    maxPerPass,
    discordChannelIds: channelIds,
    discordLookback,
    slackLookback,
    slackToken: slackBotToken(env),
    allChannels,
  });

  let proposals = null;
  let feedback = null;
  if (opts.queues !== false) {
    try {
      proposals = await processPendingProposalIdeas({
        reason: `phase-catchup:${label}`,
      });
    } catch (err) {
      console.warn("phaseCatchup proposals:", err.message);
    }
    try {
      feedback = await processPendingFeedback({
        reason: `phase-catchup:${label}`,
      });
    } catch (err) {
      console.warn("phaseCatchup feedback:", err.message);
    }
  }

  const summary = {
    ok: true,
    label,
    allChannels,
    channelCount: channelIds.length,
    softAckChannels: soft.scannedChannels,
    reacted: soft.reacted,
    followup: {
      scanned: followup?.scanned,
      reason: followup?.reason,
      open: followup?.open ?? followup?.unique,
      replied: followup?.replied,
      held: followup?.held,
    },
    proposals,
    feedback,
  };
  pushStatusEvent(
    `phase catchup · ${label} · ch ${channelIds.length} · react ${soft.reacted} · replied ${followup?.replied ?? 0}`,
  );
  console.log("phaseCatchup", JSON.stringify(summary));
  return summary;
}
