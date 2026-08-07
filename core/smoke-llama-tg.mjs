import { loadEnv } from "./src/config.mjs";
import {
  notifyLlamaTelegram,
  localRecommend,
  shouldUseLocalBrain,
  ollamaModel,
} from "./src/localBrain.mjs";

const env = await loadEnv();
const up = await shouldUseLocalBrain(env);
console.log("ollama_up", up, "model", ollamaModel(env));

const ping = await notifyLlamaTelegram({
  env,
  kind: "visibility online",
  surface: "ops",
  question: "Alex asked to see Llama Ava on Telegram",
  brain: "local",
  model: ollamaModel(env),
  detail:
    "Side-channel on. DM Ava on Telegram (or Slack) to watch organizer decisions. Discord stays dream-only by design; compress still pings here.",
  force: true,
});
console.log("ping", ping);

if (up) {
  const r = await localRecommend({
    question:
      "In one short sentence: who are you and what is Gold (G) used for on RootMC?",
    context: "",
    env,
    authorId: "6644482344",
    authorName: "Alex",
    surface: "telegram",
    deep: false,
  });
  console.log("localRecommend", {
    ok: r.ok,
    brain: r.brain,
    escalated: r.escalated,
    reason: r.reason,
    text: String(r.text || "").slice(0, 240),
  });
}
