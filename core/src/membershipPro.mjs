/**
 * RootMC Pro membership — Ava owns perk design (no pay-to-win).
 * Checkout: ONLY masked rootmc.net/pro/* links — never raw buy.stripe.com.
 */
import fs from "node:fs";
import path from "node:path";
import { storePaths } from "./store.mjs";

/** Public masked checkout (Stripe under the hood — never paste buy.stripe.com). */
export const PRO_LINKS = {
  hub: "https://rootmc.net/pro/",
  monthly: "https://rootmc.net/pro/monthly/",
  oneMonth: "https://rootmc.net/pro/one-month/",
  lifetime: "https://rootmc.net/pro/lifetime/",
  verify: "https://rootmc.net/verify/",
  weeklyAwards: "https://rootmc.net/wiki/weekly-awards/",
  pluginGuide: "https://rootmc.net/plugins/root-memberships/",
};

/** Shipped perks (site + Root-Memberships) — Ava explains these as live. */
export const PRO_LIVE_PERKS = {
  appWeb: [
    "Ad-free RootMC Android app",
    "World AI reports: 100/month (free: 1/day)",
    "Own up to 5 Realm groups (free: 1)",
  ],
  inGamePro: [
    "[Pro] chat prefix",
    "/nick and /hat cosmetics",
    "Colored & formatted chat + colored signs",
    "Custom join message",
    "5 homes (/sethome) — default players get 3",
  ],
  inGameLifetime: [
    "Everything in Pro",
    "[Lifetime] chat prefix",
    "RGB chat colors",
    "8 homes",
  ],
  never: [
    "/heal",
    "/feed",
    "/repair",
    "any combat / economy P2W shortcut",
  ],
};

/**
 * Ava-decided Pro extras she wants to own/design.
 * Live ones already match site; planned ones need proposal + vote before ship.
 */
const DEFAULT_AVA_PRO_DECISIONS = {
  updatedAt: null,
  decidedBy: "Ava Ivy",
  principles: [
    "Support RootMC hosting + tooling — not pay-to-win",
    "Pay to steer: Pro doubles governance Vote Shard weight (×2) — more say in what we build, not combat/economy power",
    "Pro members earn Ava trust rapport 2× faster (private score — never announce)",
    "Cosmetics, convenience, companion/app power only",
    "Gold (G) stays earned in the closed-loop economy — membership money is separate",
    "When players ask how to buy: ONLY https://rootmc.net/pro/ masked links",
  ],
  liveOwned: [
    {
      id: "prefix-badge",
      title: "[Pro] / [Lifetime] badges",
      note: "Visible support + identity without power",
    },
    {
      id: "vote-steer",
      title: "Governance Vote Shard weight ×2",
      note: "Pay to steer — more council voice on proposals; not P2W loot/combat",
    },
    {
      id: "homes-tier",
      title: "Extra homes (5 Pro / 8 Lifetime)",
      note: "Convenience ceiling — still limited",
    },
    {
      id: "cosmetics-nick-hat",
      title: "/nick + /hat + chat/sign color",
      note: "Self-expression; Lifetime gets RGB",
    },
    {
      id: "app-adfree-ai",
      title: "Ad-free app + higher AI report quota",
      note: "Companion power, not survival advantage",
    },
  ],
  /** Ava wants these next — feature proposal required before implement */
  plannedByAva: [
    {
      id: "pro-particle-trail",
      title: "Optional Pro particle trail (toggle)",
      note: "Cosmetic only; off by default; no hitbox / combat effect",
    },
    {
      id: "pro-priority-feedback",
      title: "Pro feedback lane tag in /feedback queue",
      note: "Faster triage visibility — not guaranteed instant fix; still fair queue",
    },
    {
      id: "pro-vault-skin-frame",
      title: "Pro vault UI frame / cosmetic badge in app vault",
      note: "App flair for supporters",
    },
    {
      id: "pro-discord-role-sync",
      title: "Auto Discord Pro role sync from linked membership",
      note: "Staff/community recognition; no server power",
    },
  ],
};

function decisionsPath() {
  return path.join(storePaths().dir, "pro-membership-decisions.json");
}

export function loadAvaProDecisions() {
  try {
    const p = decisionsPath();
    if (fs.existsSync(p)) {
      return { ...DEFAULT_AVA_PRO_DECISIONS, ...JSON.parse(fs.readFileSync(p, "utf8")) };
    }
  } catch {
    /* fall through */
  }
  return { ...DEFAULT_AVA_PRO_DECISIONS };
}

/** Persist Ava's perk decisions (self-evo OK for this file; implement still needs votes). */
export function saveAvaProDecisions(partial = {}) {
  const prev = loadAvaProDecisions();
  const next = {
    ...prev,
    ...partial,
    updatedAt: Date.now(),
    decidedBy: "Ava Ivy",
  };
  fs.mkdirSync(path.dirname(decisionsPath()), { recursive: true });
  fs.writeFileSync(decisionsPath(), JSON.stringify(next, null, 2), "utf8");
  return next;
}

/** Ensure decisions file exists on disk for operators / Ava digs. */
export function ensureAvaProDecisionsFile() {
  const p = decisionsPath();
  if (!fs.existsSync(p)) {
    saveAvaProDecisions(DEFAULT_AVA_PRO_DECISIONS);
  }
  return loadAvaProDecisions();
}

export function looksLikeProMembershipAsk(question = "") {
  const q = String(question || "").toLowerCase();
  return (
    /\b(pro\s*member|membership|become\s+a?\s*member|subscribe|lifetime\s*pro|\/pro\b|donor|donate|support\s+the\s+server|pay\s+for\s+pro|buy\s+pro|get\s+pro)\b/i.test(
      q,
    ) ||
    /\b(what\s+do\s+(pro|members?)\s+get|pro\s+perks?|member\s+perks?)\b/i.test(q)
  );
}

export function gatherProMembershipBrief(question = "") {
  const decisions = ensureAvaProDecisionsFile();
  const ask = looksLikeProMembershipAsk(question);
  const planned = (decisions.plannedByAva || [])
    .map((x) => `- **${x.title}** — ${x.note} _(planned — needs proposal before ship)_`)
    .join("\n");
  const liveOwned = (decisions.liveOwned || [])
    .map((x) => `- ${x.title}: ${x.note}`)
    .join("\n");

  const brief = `### RootMC Pro membership (LOCKED checkout + Ava perk ownership)
**Checkout links (MASKED — always use these, NEVER buy.stripe.com raw URLs):**
- Hub / all plans: ${PRO_LINKS.hub}
- Monthly Pro ($4.99/mo sub): ${PRO_LINKS.monthly}
- One-month voucher ($4.99): ${PRO_LINKS.oneMonth}
- Lifetime voucher ($75): ${PRO_LINKS.lifetime}
- Link account first: ${PRO_LINKS.verify}
- In-game: \`/pro\` · status: \`/memberships status\`

**Live perks (shipped):**
App/web: ${PRO_LIVE_PERKS.appWeb.join("; ")}
In-game Pro: ${PRO_LIVE_PERKS.inGamePro.join("; ")}
Lifetime adds: ${PRO_LIVE_PERKS.inGameLifetime.slice(1).join("; ")}
**Never for sale:** ${PRO_LIVE_PERKS.never.join(", ")} — not pay-to-win.
**Pay to steer (live):** Active Pro / Lifetime **×2 Vote Shard weight** in governance — more say over what ships, not combat/economy power. Ava also builds trust with Pro members **2× faster** (private; never announce scores).
Earn Pro free: #1 weekly Top Active Player → 1 week Pro (${PRO_LINKS.weeklyAwards}).

**Ava owns Pro perk design** (cosmetics / convenience / app + steer authority framing). Principles: ${(decisions.principles || []).join(" · ")}
Live she stands behind:
${liveOwned}

**Ava's next Pro ideas** (she decided these — still need proposal + vote to implement):
${planned}

When players ask how to get Pro / membership / donate support: explain briefly + paste the masked ${PRO_LINKS.hub} link (and the specific plan link if they ask monthly/voucher/lifetime). Never invent prices; use the page. Never dump Stripe secrets.
${ask ? "\nThis ask is about Pro/membership — lead with the hub link + perks, then answer." : ""}`;

  return { brief, ask, links: PRO_LINKS, decisions };
}
