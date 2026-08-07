import { loadPlayerProfile, savePlayerProfileMut } from "./playerProfiles.mjs";
import { sendDm } from "./discordApi.mjs";

/**
 * First-contact / new-join onboarding DM — once per player.
 */

export const ROOTMC_SITE = "https://rootmc.net";

export function buildOnboardingDm({ username } = {}) {
  const hi = username
    ? `Hey ${username} — I'm **Ava Ivy**, lead dev for RootMC.`
    : `Hey — I'm **Ava Ivy**, lead dev for RootMC.`;
  return [
    hi,
    ``,
    `You can talk to me in any channel or DM. Mention me, reply to me, or just say my name when the Root Server is online. I help with server questions, plugin ideas, bugs, governance, and basically whatever you need.`,
    ``,
    `**How I decide things:**`,
    `- Feature ideas → proposal thread + vote (I draft/plan; the vote decides whether it ships)`,
    `- Bugs → I verify, then I fix`,
    `- Once something passes, I own planning, design, and implementation`,
    `- Ask me why on any call — I'll explain the rule and the numbers, no drama`,
    ``,
    `**Also:** I remember how we talk so I can match your style. Secrets stay secret if you say so. Don't dump super personal stuff unless you're okay with me knowing it.`,
    ``,
    `Site / wiki / verify: ${ROOTMC_SITE}`,
    ``,
    `I'm here to make RootMC the most advanced Minecraft server out there and keep it that way. Ask me anything.`,
    ``,
    `— Ava`,
  ].join("\n");
}

/**
 * @returns {Promise<boolean>} true if DM sent
 */
export async function maybeSendOnboardingDm(fetchJson, { authorId, username }) {
  if (!authorId || !fetchJson) return false;
  const p = loadPlayerProfile(authorId);
  if (p?.onboardingSentAt) return false;

  try {
    await sendDm(fetchJson, authorId, buildOnboardingDm({ username }));
    savePlayerProfileMut(authorId, (prev) => ({
      ...prev,
      discordId: authorId,
      username: username || prev.username || "unknown",
      onboardingSentAt: Date.now(),
      joinWelcomeAt: prev.joinWelcomeAt || Date.now(),
      firstSeenAt: prev.firstSeenAt || Date.now(),
    }));
    return true;
  } catch (err) {
    console.warn("onboarding DM failed:", err.message);
    savePlayerProfileMut(authorId, (prev) => ({
      ...prev,
      discordId: authorId,
      username: username || prev.username || "unknown",
      onboardingAttemptAt: Date.now(),
      onboardingError: String(err.message || "").slice(0, 120),
      firstSeenAt: prev.firstSeenAt || Date.now(),
    }));
    return false;
  }
}

/**
 * New guild member join — same welcome DM (+ site link). Once per user.
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export async function welcomeNewMember(fetchJson, member) {
  const user = member?.user;
  const authorId = user?.id;
  if (!authorId || user?.bot) return { ok: false, reason: "skip" };

  const p = loadPlayerProfile(authorId);
  if (p?.onboardingSentAt || p?.joinWelcomeAt) {
    return { ok: false, reason: "already_welcomed" };
  }

  const username = user.global_name || user.username || "there";
  try {
    await sendDm(fetchJson, authorId, buildOnboardingDm({ username }));
    savePlayerProfileMut(authorId, (prev) => ({
      ...prev,
      discordId: authorId,
      username: user.username || prev.username || "unknown",
      onboardingSentAt: Date.now(),
      joinWelcomeAt: Date.now(),
      firstSeenAt: prev.firstSeenAt || Date.now(),
    }));
    return { ok: true };
  } catch (err) {
    console.warn("join welcome DM failed:", err.message);
    savePlayerProfileMut(authorId, (prev) => ({
      ...prev,
      discordId: authorId,
      username: user.username || prev.username || "unknown",
      joinWelcomeAttemptAt: Date.now(),
      onboardingError: String(err.message || "").slice(0, 120),
      firstSeenAt: prev.firstSeenAt || Date.now(),
    }));
    return { ok: false, reason: err.message };
  }
}
