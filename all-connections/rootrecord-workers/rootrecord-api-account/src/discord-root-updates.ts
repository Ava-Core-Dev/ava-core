import type { D1Database } from "@cloudflare/workers-types";

import {
  ROOT_UPDATE_CATEGORIES,
  broadcastRootUpdate,
  categoryLabel,
  getRootUpdatesGuildConfig,
  normalizeRootUpdateCategories,
  parseStoredCategories,
  setRootUpdatesGuildCategories,
  setRootUpdatesGuildChannel,
  type RootUpdatesDiscordEnv,
} from "../../shared/discord-root-updates";
import { json } from "./cors";
import { verifyWorkerOpsAdmin } from "./push";

export {
  ROOT_UPDATE_CATEGORIES,
  broadcastRootUpdate,
  guildReceivesCategory,
  listRootUpdatesGuildDestinations,
  postRootUpdateDiscordMessage,
} from "../../shared/discord-root-updates";

export type { RootUpdatesDiscordEnv };

const EPHEMERAL = 64;

function interactionJson(
  type: number,
  data?: { content?: string; flags?: number; embeds?: unknown[] },
): Response {
  const payload = data ? { type, data } : { type };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function ephemeral(content: string, embeds?: unknown[]): Response {
  return interactionJson(4, { content, flags: EPHEMERAL, embeds });
}

export function memberCanManageGuild(member: Record<string, unknown> | undefined): boolean {
  const raw = member?.permissions;
  try {
    const perms = BigInt(String(raw ?? "0"));
    return (perms & 0x8n) !== 0n || (perms & 0x20n) !== 0n;
  } catch {
    return false;
  }
}

type ParsedRootSlash = {
  group: string;
  sub: string;
  options: Array<Record<string, unknown>>;
};

function parseRootSlashCommand(data: Record<string, unknown> | undefined): ParsedRootSlash | null {
  const opts = Array.isArray(data?.options) ? (data!.options as Record<string, unknown>[]) : [];
  const direct = opts.find((o) => Number(o.type) === 1);
  if (direct && !opts.some((o) => Number(o.type) === 2)) {
    return {
      group: "",
      sub: String(direct.name || ""),
      options: Array.isArray(direct.options) ? (direct.options as Record<string, unknown>[]) : [],
    };
  }
  const group = opts.find((o) => Number(o.type) === 2);
  if (!group) return null;
  const groupName = String(group.name || "");
  const inner = Array.isArray(group.options) ? (group.options as Record<string, unknown>[]) : [];
  const sub = inner.find((o) => Number(o.type) === 1);
  if (!sub) return null;
  return {
    group: groupName,
    sub: String(sub.name || ""),
    options: Array.isArray(sub.options) ? (sub.options as Record<string, unknown>[]) : [],
  };
}

function optString(options: Array<Record<string, unknown>>, name: string): string {
  const opt = options.find((o) => String(o.name || "") === name);
  return String(opt?.value ?? "").trim();
}

function optChannel(options: Array<Record<string, unknown>>, name: string): string {
  return optString(options, name);
}

function formatCategoriesList(): string {
  return ROOT_UPDATE_CATEGORIES.filter((c) => c.id !== "all")
    .map((c) => `• **${c.id}** — ${c.label}`)
    .concat(["• **all** — " + categoryLabel("all")])
    .join("\n");
}

function helpContent(): string {
  return (
    "**Root Record Global Updater**\n\n" +
    "Subscribe this server to **per-product** release notes — pick only the apps you care about.\n\n" +
    "**Setup (Manage Server)**\n" +
    "1. **`/root channel set`** — pick a text channel\n" +
    "2. **`/root categories set`** — e.g. `weather,blocknotes` or `releases`\n" +
    "3. **`/root categories list`** — all category ids\n\n" +
    "**Other Root Record Discord bots**\n" +
    "• **Kīlauea Alerts** — USGS quakes + AI reports (`/config`, `/data`, `/kilauea`)\n" +
    "• **Root Economy** — ROOTS balance and transfers (`/bal`, `/send`, …)\n" +
    "• **RootMC** — Minecraft / Realm / Block Notes (`/server`, `/help`)\n\n" +
    "https://rootrecord.cloud/products"
  );
}

export async function handleRootUpdatesSlashCommand(
  body: Record<string, unknown>,
  _env: RootUpdatesDiscordEnv,
): Promise<Response> {
  const guildId = String(body.guild_id || "").trim();
  if (!guildId) {
    return ephemeral("Use **`/root`** in a server — not in DMs.");
  }

  const data = body.data as Record<string, unknown> | undefined;
  const parsed = parseRootSlashCommand(data);
  if (!parsed) {
    return ephemeral("Use **`/root help`**, **`/root channel …`**, or **`/root categories …`**. ");
  }

  const member = body.member as Record<string, unknown> | undefined;
  const user = member?.user as Record<string, unknown> | undefined;
  const uid = String(user?.id || "").trim();

  if (parsed.group === "" && parsed.sub === "help") {
    return ephemeral(helpContent());
  }

  if (parsed.group === "channel") {
    if (parsed.sub === "show") {
      const cfg = await getRootUpdatesGuildConfig(_env.DB, guildId);
      if (!cfg) {
        return ephemeral(
          "No channel configured yet. A server admin runs **`/root channel set`**, then **`/root categories set`**. ",
        );
      }
      const ids = parseStoredCategories(cfg.categories_json);
      const cats =
        ids.length > 0 ? ids.map((id) => categoryLabel(id)).join(", ") : "_none — run `/root categories set`_";
      return ephemeral(
        `**Updates channel:** <#${cfg.channel_id}>\n**Categories:** ${cats}\n_Last updated ${cfg.updated_at.replace("T", " ").replace(/\.\d{3}Z$/, " UTC")}_`,
      );
    }
    if (parsed.sub === "set") {
      if (!memberCanManageGuild(member)) {
        return ephemeral("You need **Manage Server** (or Administrator) to configure update channels.");
      }
      const channelId = optChannel(parsed.options, "channel");
      if (!/^\d{10,}$/.test(channelId)) {
        return ephemeral("Pick a **text channel** for **`channel`**.");
      }
      await setRootUpdatesGuildChannel(_env.DB, guildId, channelId, uid, []);
      return ephemeral(
        `Updates channel set to <#${channelId}>.\nNext: **/root categories set** with the product ids you want (see **/root categories list**). Nothing is sent until categories are set.`,
      );
    }
    return ephemeral("Use **`/root channel set`** or **`/root channel show`**. ");
  }

  if (parsed.group === "categories") {
    if (parsed.sub === "list") {
      return ephemeral(
        `**Update categories** (pick one or more; comma-separated in **set**)\n\n${formatCategoriesList()}\n\nExample: \`weather,blocknotes\` or \`all\` for every product line.`,
      );
    }
    if (parsed.sub === "show") {
      const cfg = await getRootUpdatesGuildConfig(_env.DB, guildId);
      if (!cfg) {
        return ephemeral("No subscription yet. Run **`/root channel set`** first.");
      }
      const ids = parseStoredCategories(cfg.categories_json);
      if (!ids.length) {
        return ephemeral("Channel is set but **no categories** yet. Run **`/root categories set`**. ");
      }
      const lines = ids.map((id) => `• **${id}** — ${categoryLabel(id)}`).join("\n");
      return ephemeral(`**Subscribed categories**\n${lines}`);
    }
    if (parsed.sub === "set") {
      if (!memberCanManageGuild(member)) {
        return ephemeral("You need **Manage Server** (or Administrator) to change categories.");
      }
      const pick = optString(parsed.options, "pick");
      if (!pick) {
        return ephemeral(
          "Provide **`pick`** — comma-separated category ids, or **`all`**. Run **`/root categories list`** for ids.",
        );
      }
      const categories = normalizeRootUpdateCategories(pick);
      if (!categories.length) {
        return ephemeral("No valid categories in **`pick`**. Run **`/root categories list`**. ");
      }
      try {
        await setRootUpdatesGuildCategories(_env.DB, guildId, categories, uid);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === "channel_not_configured") {
          return ephemeral("Run **`/root channel set`** before choosing categories.");
        }
        if (msg === "categories_required") {
          return ephemeral("Pick at least one category (or **`all`**).");
        }
        throw e;
      }
      const labels = categories.map((id) => categoryLabel(id)).join(", ");
      return ephemeral(`This server will receive updates for: **${labels}**`);
    }
    return ephemeral("Use **`/root categories list`**, **`show`**, or **`set`**. ");
  }

  return ephemeral("Use **`/root help`** for commands.");
}

/** POST /api/internal/discord-updates-broadcast — fan-out to subscribed guilds (X-RR-Push-Admin-Key). */
export async function handleRootUpdatesBroadcastPost(
  request: Request,
  env: RootUpdatesDiscordEnv & { RR_PUSH_ADMIN_SECRET?: string },
): Promise<Response> {
  if (!(await verifyWorkerOpsAdmin(request, env))) {
    const has = Boolean(request.headers.get("X-RR-Push-Admin-Key"));
    return json({ detail: has ? "Invalid admin key." : "Missing X-RR-Push-Admin-Key header." }, 401);
  }

  let body: { category?: string; content?: string; body?: string; embeds?: Record<string, unknown>[] };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json({ detail: "Invalid JSON." }, 400);
  }

  const category = String(body.category || "").trim().toLowerCase();
  const validIds = new Set<string>(ROOT_UPDATE_CATEGORIES.map((c) => c.id));
  if (!validIds.has(category)) {
    return json({ detail: `Invalid category. Use one of: ${[...validIds].join(", ")}` }, 400);
  }

  const content = String(body.content || body.body || "").trim();
  const embeds = Array.isArray(body.embeds) ? body.embeds : undefined;
  if (!content && (!embeds || embeds.length === 0)) {
    return json({ detail: "Provide content (or body) and/or embeds." }, 400);
  }

  const result = await broadcastRootUpdate(env, { category, content, embeds });
  if (!result.ok) {
    return json({ detail: result.blocked || "Broadcast failed." }, 400);
  }
  return json(result, 200);
}
