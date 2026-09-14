import { loadEnv, botToken, DISCORD_API, AVA_CHANNELS } from "../src/config.mjs";
import { authHeaders } from "../src/discordApi.mjs";
import fs from "node:fs";

const env = await loadEnv();
const headers = authHeaders(botToken(env));
const NEW_IVY = "1533223535311327322";

const del = await fetch(`${DISCORD_API}/channels/${NEW_IVY}`, {
  method: "DELETE",
  headers,
});
console.log("delete", del.status, await del.text());

const guildPath =
  "E:\\.Ava_Ivy\\data\\guilds\\1516108585740800042.json";
const profile = JSON.parse(fs.readFileSync(guildPath, "utf8"));
profile.avaChannelId = AVA_CHANNELS.admins;
profile.avaChannelName = "admins";
profile.avaChannelCreated = false;
profile.avaChannelError = "ava-ivy retired; home=#admins";
profile.introducedAt = profile.introducedAt || Date.now();
profile.firstJoinProtocol = 1;
fs.writeFileSync(guildPath, JSON.stringify(profile, null, 2), "utf8");
console.log("guild home →", profile.avaChannelId);
