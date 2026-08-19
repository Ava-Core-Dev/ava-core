/** Minecraft control stub — functionality now handled by Python RCON in apps/core. */
export async function runCommand(cmd) { return { ok: false, note: "use Python RCON" }; }
export async function getStatus() { return null; }
export async function paperStatus() { return null; }
export async function getPlayerList() { return []; }
export async function sendChat(msg) { return { ok: false }; }
