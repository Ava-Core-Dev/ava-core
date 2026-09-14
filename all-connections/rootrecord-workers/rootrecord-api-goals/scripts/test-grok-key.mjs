import fs from "node:fs";

const env = {};
for (const line of fs.readFileSync("C:/Users/rrdeveloper/MonoRepo/credentials.env", "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const i = t.indexOf("=");
  if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
}

const token = env.GROK_X_BEARER_TOKEN || "";
const res = await fetch("https://api.x.ai/v1/chat/completions", {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "grok-3-latest",
    messages: [{ role: "user", content: 'Return JSON only: {"ok":true}' }],
    temperature: 0,
  }),
});
const j = await res.json().catch(() => ({}));
const content = j.choices?.[0]?.message?.content;
console.log("status", res.status);
console.log("error", JSON.stringify(j.error || j).slice(0, 300));
console.log("content_len", typeof content === "string" ? content.length : 0);
console.log("content_preview", typeof content === "string" ? content.slice(0, 120) : "none");
