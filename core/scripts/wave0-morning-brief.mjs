/**
 * Wave 0 — morning ops brief: Telegram (operator) + all Slack + Discord pointer.
 * Ava bot tokens only — never Slack MCP.
 */
import { postAvaTelegram, postAvaSlack, postAvaDiscord } from "../src/avaPost.mjs";
import { AVA_CHANNELS } from "../src/config.mjs";

const TG_OPS = "6644482344";

const SLACK_CHANNELS = [
  ["C0BLTNDJB4M", "plugins"],
  ["C0BLQ5C342F", "new-channel"],
  ["C0BM0N1MUJY", "work-log"],
  ["C0BLYV4SA6M", "decisions"],
  ["C0BLT3B9RQV", "social"],
  ["C0BLWBTUCR0", "all-rootmc"],
  ["C0BLV24TVP0", "ops-feed"],
  ["C0BM6KVFS0L", "automated-reports"],
  ["C0BMRPDUH0Q", "shockbyte-status"],
  ["C0BM4B4RT8S", "overview"],
  ["C0BLMGBVAMD", "feedback"],
  ["C0BMX0QKSTS", "server-logs"],
  ["C0BLZCVAC3X", "plugin-sales"],
  ["C0BLY49H13M", "server-reports"],
  ["C0BM6HN0WMA", "api-description"],
  ["C0BMDLAS5QS", "--general-chat--"],
  ["C0BM4QT5U0Z", "discord-channels"],
  ["C0BLMHKTCTH", "crons-automation"],
  ["C0BMCPMDDQR", "development-feed"],
  ["C0BM4P3GVDX", "new-plugin-development-plans"],
];

const telegramBrief = `Ava — full-day ops brief (Wave 0)
${new Date().toISOString()}

ORDERED CHECKLIST (me)
1. Slack all-channels detailed ops blast — now
2. Discord short pointer (#updates + #admins)
3. Manipulation gate (only you inject “I want…”)
4. Llama v1 student docs + Root-Ava-Core governance PROP (docs only; no jar)
5. RootMC Official parity inventory + checklist (do NOT kick Official)
6. Desktop Ava .exe MVP (rewrite-before-send, 42-msg context)
7. Token/Gold credits + per-server reserve isolation rules + hooks
8. Website ~$100 USD tools/marketing PROP
9. Boot morning log check + job/urgent hygiene
10. EOD Telegram status

YOUR HANDS (gates)
• Shockbyte restart / FileZilla — confirm 1.8.0 live if not already
• ava.rootmc.net — Cloudflare Tunnel + Access → :8787
• Root-Ava-Core — yes/no AFTER proposal lands (default today = docs only)
• OptiPlex — D→E Work Stations robocopy running now (keep E updated)
• Legacy RootMC bot — leave installed until parity checklist green

OPEN URGENCY REGISTRY
• ops-ava-tunnel (high)
• ops-ava-core-plugin (high) — awaiting your yes/no after PROP
• ops-optiplex-ubuntu (med) — sync in flight
• ops-legacy-bot (med) — hold
• ops-bond-reserve (med) — watch ledger after 1.8.0

I'll Telegram you EOD. No Discord spam beyond the pointer.`;

const slackBrief = `*Ava — RootMC full-day ops brief*
_${new Date().toISOString()}_

This is the detailed staff brief. Discord gets a short pointer only.

*Surface split*
• *Discord* — players, votes, proposals, public updates, Ava media
• *Slack* — staff dig, plugin plans, ops feed, crons, server logs
• *Telegram (Alex only)* — master ops, dumps, urgents, EOD
• *API* — api.rootmc.net (not RootRecord shards)
• *Currency* — Gold (G) in player copy; USD only for real-world tool budgets

*Plugin wave 1.8.0*
• Version scheme YEAR.MONTH.BUILD → August first sync = *1.8.0*
• All live plugins + rootrecord-common bumped; publishPlugins done; staged Claims / Towny / Test
• *Gate:* confirm Shockbyte restart / FileZilla so jars are live; clear waiting_restart jobs when verified

*Open urgents*
1. *ava.rootmc.net* — Cloudflare Tunnel + Access → host :8787 status UI (needs operator DNS/tunnel)
2. *Root-Ava-Core* — governance proposal + docs today; *no live jar* until Alex greenlights after PROP
3. *OptiPlex → Ubuntu* — D: → E: Work Stations mirror sync running; E is expanded storage / migration mirror — keep it updated
4. *Legacy RootMC Official bot* — *do not kick* until Ava parity checklist is green
5. *Bond / Server Reserve* — watch ledger (reports showed Reserve 0 Gold; payouts pause when ledger < 0); Claims vs Towny economies stay isolated

*Today's delivery (Ava / agent)*
• Manipulation gate — only Alex may inject “I want Ava to say/do X”
• Llama v1 student boundary docs (plans OK, code untrusted, shadow learn, isolate edits)
• Root-Ava-Core 7-day voting PROP draft
• Official-bot automation inventory + parity checklist
• Desktop Ava *.exe* MVP — Discord/Telegram panes, AI rewrite before send, last 42 msgs context
• Token cost board + soft rate limits + Gold-as-credits + per-server reserve rules
• Website PROP — Ava designs site; one-time ~$100 USD tools/marketing (not Gold); no spend until vote passes
• Boot morning log check + job/urgent hygiene
• EOD on Telegram only

*Parked (not finish-today)*
• Elite root-skills / full mcMMO replace
• Ban→vote-weight constitution change
• Full OptiPlex Ubuntu cutover
• Kicking Official before parity

*PROP / skills note*
• PROP-01 / skills items: advance only after 1.8.0 restart verified
• Towny through 26.3 stays on roadmap

Questions / decisions → Alex on Telegram. I'll keep Slack updated when status flips.`;

const discordPointer = `**Staff ops brief is on Slack** (all public channels) — Ava posted the full-day checklist there: 1.8.0 gate, tunnel, Ava-Core yes/no (docs today), OptiPlex D→E sync, Official-bot hold until parity, reserve watch, plus today's delivery list (manipulation gate, Llama docs, desktop MVP, token/Gold rules, ~$100 site PROP).

Discord stays light: this pointer only. Master status stays on Alex's Telegram.`;

async function main() {
  console.log("telegram…");
  await postAvaTelegram({
    chatId: TG_OPS,
    content: telegramBrief,
    kind: "wave0_morning_brief",
    source: "wave0-brief",
  });
  console.log("telegram ok");

  for (const [id, name] of SLACK_CHANNELS) {
    process.stdout.write(`slack #${name}… `);
    try {
      await postAvaSlack({
        channelId: id,
        content: slackBrief,
        kind: "wave0_ops_brief",
        source: "wave0-brief",
        ackReact: false,
      });
      console.log("ok");
    } catch (err) {
      console.log("FAIL", err.message);
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  for (const [label, channelId] of [
    ["updates", AVA_CHANNELS.updates],
    ["admins", AVA_CHANNELS.admins],
  ]) {
    process.stdout.write(`discord #${label}… `);
    try {
      await postAvaDiscord({
        channelId,
        content: discordPointer,
        kind: "wave0_pointer",
        source: "wave0-brief",
        ackReact: false,
      });
      console.log("ok");
    } catch (err) {
      console.log("FAIL", err.message);
    }
  }
  console.log("wave0 done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
