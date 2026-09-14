import { loadEnv, botToken, DISCORD_API, AVA_BOT_APP_ID } from "../src/config.mjs";

const env = await loadEnv();
const token = botToken(env);
const headers = { Authorization: `Bot ${token}` };

const ids = [
  ["1497037418979786823", "Alex (rootrecorddev)"],
  ["154446475789729792", "Melee (melee5490)"],
  ["1413961145521410082", "lodge_0xcc7"],
  ["788153722198294618", "zuppafredda"],
];

for (const [id, label] of ids) {
  const dmRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient_id: id }),
  });
  const dm = await dmRes.json();
  if (!dm.id) {
    console.log(label, "NO_DM", dm.message || dm.code || JSON.stringify(dm).slice(0, 120));
    continue;
  }
  const msgs = await fetch(`${DISCORD_API}/channels/${dm.id}/messages?limit=100`, {
    headers,
  }).then((r) => r.json());
  const list = Array.isArray(msgs) ? msgs : [];
  const fromUser = list.filter((m) => m.author?.id === id).length;
  const fromAva = list.filter(
    (m) => m.author?.id === AVA_BOT_APP_ID || m.author?.bot,
  ).length;
  const last = list[0];
  const lastWhen = last
    ? new Date(Number((BigInt(last.id) >> 22n) + 1420070400000n)).toISOString()
    : "-";
  console.log(
    `\n${label}\n  dm=${dm.id} total=${list.length} fromThem=${fromUser} fromAva=${fromAva} last=${lastWhen}`,
  );
  for (const m of [...list].reverse().slice(-10)) {
    const when = new Date(
      Number((BigInt(m.id) >> 22n) + 1420070400000n),
    ).toISOString();
    const who = m.author?.bot ? "[Ava]" : m.author?.username;
    console.log(
      `  ${when} ${who}: ${String(m.content || "").slice(0, 160).replace(/\n/g, " ")}`,
    );
  }
  await new Promise((r) => setTimeout(r, 300));
}

console.log("\nTelegram operator: 6644482344 (@WildEcho94 / Alex) — private chat configured; history not listable via Bot API while poller owns getUpdates.");
