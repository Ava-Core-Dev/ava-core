/** Official Ava server goals — public poster identity (not a personal human account). */
export const SERVER_GOAL_EMAIL = "ava@rootrecord.info";

/** Staff who may create/manage Ava server goals while signed in as themselves. */
export const AVA_OPERATOR_EMAILS = [
  SERVER_GOAL_EMAIL,
  "root@rootrecord.info",
  "rootrecord@outlook.com",
] as const;

export const USDC_MINT_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_MINT_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
/** Default USDC mint while Goals is on Solana devnet. Prefer usdcMint(env). */
export const USDC_MINT = USDC_MINT_DEVNET;

export const TOKEN_METADATA_PROGRAM_ID = "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s";

export function isAvaOperatorEmail(email: string): boolean {
  const e = String(email || "").trim().toLowerCase();
  return (AVA_OPERATOR_EMAILS as readonly string[]).includes(e);
}

export function isServerGoalUser(userId: string): boolean {
  const id = String(userId || "").trim().toLowerCase();
  if (!id.startsWith("user:")) return false;
  return isAvaOperatorEmail(id.slice(5));
}

export function emailFromUserId(userId: string): string {
  const s = String(userId || "").trim().toLowerCase();
  return s.startsWith("user:") ? s.slice(5) : "";
}

export function symbolFromTitle(title: string): string {
  const words = String(title || "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  let s = words.map((w) => w[0]).join("").slice(0, 6);
  if (s.length < 2) s = String(title || "GOAL").replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(0, 6);
  return (s || "GOAL").slice(0, 8);
}
