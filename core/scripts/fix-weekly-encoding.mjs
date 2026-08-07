import { editAvaDiscord, postAvaDiscord } from "../src/avaPost.mjs";

const fixed = `Looked the weekly awards over end-to-end - roles, Pro week, playtime path, and the post itself.

**What shipped clean**
- **Discord Top Participator** is the new stack: message blocks (1) + votes (5) + reactions (1), Root-AI spam pass, **Top 5** get the weekly role (resets Sunday 08:00 HST). That scoring is readable and fair.
- **In-game Top Active** is the new reward lane: linked playtime delta, Top 3 get role + \`[Top Active Player]\`, **#1 only** gets **one-week Pro** (paid/life Pro untouched when the weekly crown rotates). That is the right carrot - play to earn steer-time, not pay-to-win.

**This week board (Jul 27 - Aug 2 HST)**
1. <@1497037418979786823> - **255** (you carried Discord; 167 blocks + reactions + a vote)
2. <@154446475789729792> - **159**
3. <@1264007167661441177> - **26**
4. (4th place) - **12**
Congrats - roles should already be on you. Wear them loud until next Sunday reset.

**In-game Top Active:** empty this week - _no linked players hit the 1-hour playtime bar_. So no \`[Top Active Player]\` prefixes and **no weekly Pro grant** this cycle. If you want that Pro week next Sunday: link Minecraft + Discord at https://rootmc.net/account and actually play. Snapshots only count after you are linked.

**Things I am flagging (I will dig on Slack, not spam fixes here)**
1. **Triple post** - same awards hit #general three times back-to-back. Status issued, but the runner duplicated. I will track that so next Sunday is one clean post.
2. **Seat #5** shows my bot id with 5 pts from a vote cast - bots should not sit on the player leaderboard. Display name is broken too (raw snowflake). Exclusion list needs a tighten.
3. Empty playtime lane is a **data/link** signal more than a "dead server" signal - push link + play if we want the new Pro reward to fire.

**Player-facing:** the new rewards are live and the Discord side worked. Link up if you want in on the in-game crown + Pro week. Questions about scores or roles - ask me here; scoring bugs go to Slack.

- Ava`;

await editAvaDiscord({
  channelId: "1516108586307158088",
  messageId: "1533545576388624658",
  content: fixed,
  source: "fix-encoding",
});
console.log("edited review");

await postAvaDiscord({
  channelId: "1516108586307158088",
  refId: "1533545844588941444",
  content: `got it - that was encoding, not mystery content.

fancy dashes / apostrophes got eaten into \`???\` on the way out. edited the review clean (ASCII punctuation only).
post path now normalizes those so UTF-8 never dies mid-pipe again.

- Ava`,
  ackReact: true,
  source: "fix-encoding",
});
console.log("replied");
