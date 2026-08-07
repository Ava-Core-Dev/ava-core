/**
 * X (Twitter) helper — drafting first; live post only with full user tokens.
 * Loads GROK_X_* / X_* from RootMC .env via Ava loadEnv. Never logs secrets.
 *
 * Usage:
 *   node scripts/x-social-draft.mjs "draft text here"
 *   node scripts/x-social-draft.mjs --status
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "../src/config.mjs";
import { appendAction } from "../src/fullLog.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRAFT_DIR = path.resolve(
  __dirname,
  "../../../Server Handoffs/Ava Ivy/notes/x-drafts",
);

function xCreds(env) {
  return {
    bearer: env.GROK_X_BEARER_TOKEN || env.X_BEARER_TOKEN || "",
    consumerKey: env.GROK_X_V1_CONSUMER_KEY || env.X_CONSUMER_KEY || "",
    consumerSecret:
      env.GROK_X_V1_CONSUMER_KEY_SECRET || env.X_CONSUMER_SECRET || "",
    clientId: env.GROK_X_V2_CLIENT_ID || env.X_CLIENT_ID || "",
    clientSecret: env.GROK_X_V2_CLIENT_SECRET || env.X_CLIENT_SECRET || "",
    accessToken: env.X_ACCESS_TOKEN || env.GROK_X_ACCESS_TOKEN || "",
    accessSecret: env.X_ACCESS_TOKEN_SECRET || env.GROK_X_ACCESS_TOKEN_SECRET || "",
  };
}

function readiness(c) {
  const app = Boolean(c.bearer || (c.consumerKey && c.consumerSecret));
  const user = Boolean(c.accessToken && c.accessSecret);
  return {
    appCredsPresent: app,
    userCredsPresent: user,
    canDraft: true,
    canLivePost: app && user,
    note: user
      ? "Live post enabled when caller opts in"
      : "Draft-only until X_ACCESS_TOKEN + X_ACCESS_TOKEN_SECRET in .env",
  };
}

export async function writeXDraft(text, { env } = {}) {
  const e = env || (await loadEnv());
  const c = xCreds(e);
  const ready = readiness(c);
  fs.mkdirSync(DRAFT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(DRAFT_DIR, `${stamp}.md`);
  const body = `# X draft ${stamp}

**Status:** draft (not posted)
**Live post ready:** ${ready.canLivePost ? "yes" : "no — need user access tokens"}

---

${String(text || "").trim() || "(empty)"}
`;
  fs.writeFileSync(file, body, "utf8");
  appendAction("xSocialDraft", {
    file: path.basename(file),
    canLivePost: ready.canLivePost,
    chars: String(text || "").length,
  });
  return { ok: true, file, ...ready };
}

const isMain =
  process.argv[1] &&
  path.normalize(process.argv[1]).includes("x-social-draft.mjs");

if (isMain) {
  const env = await loadEnv();
  const args = process.argv.slice(2);
  if (args[0] === "--status") {
    console.log(JSON.stringify(readiness(xCreds(env)), null, 2));
    process.exit(0);
  }
  const text =
    args.join(" ").trim() ||
    "RootMC — play.rootmc.net · Gold economy · player proposals welcome. (Ava draft)";
  const r = await writeXDraft(text, { env });
  console.log(JSON.stringify(r, null, 2));
}
