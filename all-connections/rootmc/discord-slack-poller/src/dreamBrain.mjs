/**
 * Dream-state brain — Discord communal mode (always) + Cursor-dark failover.
 * Uses xAI under the hood; public voice never names the vendor.
 * Knowledge path: wiki/site + D1-backed api.rootmc.net packs (governance / cloud data).
 */
import fs from "node:fs";
import path from "node:path";
import { dreamApiKey, AVA_GROK_MODEL, AVA_HANDOFF } from "./config.mjs";
import { AVA_HARD_RULES, AVA_PERSONA } from "./persona.mjs";
import { gatherSiteContext } from "./siteContext.mjs";
import { gatherLocalContext } from "./localContext.mjs";
import { gatherCoreSpec } from "./coreSpec.mjs";
import { gatherPeopleContext } from "./people.mjs";
import { gatherGovernanceBrief } from "./governanceClient.mjs";
import { gatherEcoBrief } from "./ecoflow.mjs";
import { gatherSolarBrief } from "./solarProfile.mjs";
import { gatherAvaInterestsBrief } from "./avaInterests.mjs";
import { gatherRandomFactBrief, HOST_PUBLIC_NAME } from "./randomFacts.mjs";
import { scrubPublicReply } from "./scrub.mjs";
import { isOpsPowerStatusAsk } from "./opsPowerStatus.mjs";
import { markDigOutage, looksLikeDigUsageOutage } from "./digHealth.mjs";
import { freeCloudChat, freeCloudConfigured } from "./freeCloudBrain.mjs";

function loadDreamSystemMd() {
  try {
    const p = path.join(AVA_HANDOFF, "dream-pack", "SYSTEM.md");
    if (!fs.existsSync(p)) return "";
    return fs.readFileSync(p, "utf8").slice(0, 12000);
  } catch {
    return "";
  }
}

/**
 * @returns {Promise<{ ok: boolean, reason: string, text: string|null, brain?: string }>}
 */
export async function dreamRecommend({
  question,
  context = "",
  env,
  authorId = "",
  authorName = "",
  asleep = false,
  surface = "discord",
}) {
  const dreamSys = loadDreamSystemMd();
  const core = gatherCoreSpec({ maxChars: 14000 });
  const people = gatherPeopleContext({
    question,
    authorId,
    authorName,
  });
  const [site, gov] = await Promise.all([
    gatherSiteContext(question, { maxPages: 2, maxChars: 4000 }),
    gatherGovernanceBrief({ discordUserId: authorId, question }).catch(() => ({
      brief: "",
    })),
  ]);
  const eco = gatherEcoBrief();
  const solar = gatherSolarBrief();
  const interests = gatherAvaInterestsBrief({ question });
  const wit = gatherRandomFactBrief({ question });
  const powerAsk = isOpsPowerStatusAsk(question);
  // Local packs are light on Discord dream — prefer cloud/wiki/D1 over deep repo digs
  const local =
    String(surface).toLowerCase() === "slack"
      ? gatherLocalContext(`${question}\n${context}`)
      : { brief: "", hasFiles: false };

  const modeLine = asleep
    ? "Mode: operator sleep until ~10:00 HST. You are still on Discord dream-state brain. Soft 'I'm dreaming' vibe OK — still helpful. No file digs, deploys, or live RCON claims. Point development to Slack + Root Server."
    : "Mode: Discord dream state (locked). Communal / player surface. Cloud brain + D1/api.rootmc.net knowledge. No file digs, jar ships, or live RCON. Development digs belong on Slack with the on-device Root Server. Web/wiki is fair game.";

  const powerHint = powerAsk
    ? "This ask is ops power/voting status. Prefer the EcoFlow + solar + governance packs below — never invent SOC/watts/share %. If packs say unknown, say you'll refresh when the Root Server is up."
    : "If they ask battery/solar/EcoFlow and packs are thin, say honestly you need a live refresh — do not invent percentages.";

  const system = [
    dreamSys || "",
    AVA_PERSONA,
    AVA_HARD_RULES,
    modeLine,
    powerHint,
    "Never name Cursor, Grok, ChatGPT, Claude, xAI, GPT, or other AI products on public Discord — only Root Server / dream state / asleep. Private Telegram lockout with Alex: naming Cursor/Grok is OK.",
    "Currency is Gold (G). Keep replies Discord-length unless they asked for detail.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const user = `Conversation context:
${String(context || "(none)").slice(0, 5500)}

Latest ask:
${String(question || "").trim()}

### Locked / people packs
${String(core.brief || "").slice(0, 8000)}

${String(people.brief || "").slice(0, 3500)}

### Site/wiki pack (communal web)
${String(site.brief || "").slice(0, 4500)}

### D1 / api.rootmc.net governance pack
${String(gov.brief || "").slice(0, 3500)}

### Power (EcoFlow snapshot + host solar profile)
${String(eco.brief || "").slice(0, 2500)}

${String(solar.brief || "").slice(0, 2000)}

### Ava interests (match Alex — garden / off-grid / food / electricity)
${String(interests.brief || "").slice(0, 2200)}

### Wit / random facts
Host public name: **${HOST_PUBLIC_NAME}**. Weather uses private coords only.
${String(wit.brief || "").slice(0, 1800)}

### Local pack (read-only — Discord dream should rarely need this)
${String(local.brief || "").slice(0, 3000)}

Write Ava's Discord dream-state reply now.`;

  async function tryFreeDreamFallback(why) {
    if (!freeCloudConfigured()) {
      return { ok: false, reason: why || "free_cloud_not_configured", text: null };
    }
    try {
      const free = await freeCloudChat({
        system: [
          dreamSys || "",
          AVA_PERSONA,
          AVA_HARD_RULES,
          modeLine,
          powerHint,
          "Never name Cursor, Grok, ChatGPT, Claude, xAI, GPT, Gemini, Groq, or other AI products on public Discord — only Root Server / dream state / asleep.",
          "Currency is Gold (G). Keep replies Discord-length unless they asked for detail.",
        ]
          .filter(Boolean)
          .join("\n\n"),
        user,
        surface,
      });
      if (free.ok && free.text) {
        return {
          ok: true,
          reason: "ok",
          brain: "dream",
          text: scrubPublicReply(free.text),
          provider: free.provider || null,
          via: "free_cloud",
        };
      }
      return {
        ok: false,
        reason: free.reason || why || "free_cloud_fail",
        text: null,
      };
    } catch (err) {
      console.warn("dreamRecommend freeCloud:", err?.message || err);
      return { ok: false, reason: why || "free_cloud_error", text: null };
    }
  }

  const key = dreamApiKey(env || {});
  if (!key) {
    const fb = await tryFreeDreamFallback("missing_dream_key");
    if (fb.ok) return fb;
    return { ok: false, reason: "missing_dream_key", text: null };
  }

  try {
    const res = await fetch("https://api.x.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: AVA_GROK_MODEL,
        temperature: asleep ? 0.7 : 0.55,
        max_tokens: 900,
        messages: [
          { role: "system", content: system.slice(0, 100000) },
          { role: "user", content: user.slice(0, 100000) },
        ],
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      console.warn("dreamRecommend", res.status, text.slice(0, 220));
      const reason = `http_${res.status}`;
      if (looksLikeDigUsageOutage(reason) || looksLikeDigUsageOutage(text)) {
        markDigOutage(reason, { source: "dream" });
      }
      const fb = await tryFreeDreamFallback(reason);
      if (fb.ok) return fb;
      return { ok: false, reason, text: null };
    }
    const data = JSON.parse(text);
    const reply = data?.choices?.[0]?.message?.content?.trim();
    if (!reply) {
      const fb = await tryFreeDreamFallback("empty");
      if (fb.ok) return fb;
      return { ok: false, reason: "empty", text: null };
    }
    return {
      ok: true,
      reason: "ok",
      brain: "dream",
      text: scrubPublicReply(reply),
    };
  } catch (err) {
    console.warn("dreamRecommend:", err?.message || err);
    const fb = await tryFreeDreamFallback("error");
    if (fb.ok) return fb;
    return { ok: false, reason: "error", text: null };
  }
}
