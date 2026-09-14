/**
 * Goals Solana cluster.
 *
 * SOLANA_CLUSTER=devnet pins testing.
 * Otherwise (auto / mainnet / unset): issue on mainnet when the treasury has
 * at least 0.01 SOL there. Below that, fall back to devnet so minting and
 * seeds still work without burning the last of mainnet SOL.
 *
 * A goal that already has token_cluster stays on that cluster.
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";

export const USDC_MINT_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
/** Circle's official USDC on Solana devnet. */
export const USDC_MINT_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const DEFAULT_SOLANA_CLUSTER = "devnet";
export const DEVNET_RPC = "https://api.devnet.solana.com";
export const MAINNET_RPC = "https://api.mainnet-beta.solana.com";
/** 0.01 SOL — enough to seed a poster wallet and pay mint rent / ATA / fees. */
export const TREASURY_ISSUE_MIN_LAMPORTS = 10_000_000;

export type ClusterEnv = {
  SOLANA_CLUSTER?: string;
  SOLANA_CLUSTER_OVERRIDE?: string;
  GOAL_TOKEN_CLUSTER?: string;
  GOAL_TOKEN_RPC_URL?: string;
  SOLANA_RPC_URL?: string;
  RRTT_TREASURY_SECRET_KEY_B58?: string;
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export type SolanaCluster = "devnet" | "mainnet-beta";

export function parseSolanaCluster(raw: unknown): SolanaCluster | null {
  const c = str(raw).toLowerCase();
  if (c === "mainnet" || c === "mainnet-beta") return "mainnet-beta";
  if (c === "devnet") return "devnet";
  return null;
}

/** Explicit testing pin. Anything else uses the treasury fallback. */
export function pinnedCluster(env: ClusterEnv = {}): SolanaCluster | null {
  const c = str(env.SOLANA_CLUSTER).toLowerCase();
  if (c === "devnet") return "devnet";
  return null;
}

export function withCluster<T extends ClusterEnv>(env: T, cluster: string): T {
  return { ...env, SOLANA_CLUSTER_OVERRIDE: cluster, SOLANA_CLUSTER: cluster, GOAL_TOKEN_CLUSTER: cluster };
}

export type IssueClusterState = {
  cluster: SolanaCluster;
  pinned: boolean;
  treasury_lamports: number;
  treasury_sol: number;
  using_devnet_fallback: boolean;
};

let issueCache: { state: IssueClusterState; at: number } | null = null;
const ISSUE_CACHE_MS = 20_000;

export function solanaCluster(env: ClusterEnv = {}): SolanaCluster {
  return (
    parseSolanaCluster(env.SOLANA_CLUSTER_OVERRIDE) ||
    pinnedCluster(env) ||
    issueCache?.state.cluster ||
    DEFAULT_SOLANA_CLUSTER
  );
}

export function isDevnet(env: ClusterEnv = {}): boolean {
  return solanaCluster(env) === "devnet";
}

export function usdcMint(env: ClusterEnv = {}): string {
  return solanaCluster(env) === "devnet" ? USDC_MINT_DEVNET : USDC_MINT_MAINNET;
}

export function clusterRpcCandidates(env: ClusterEnv = {}): string[] {
  const cluster = solanaCluster(env);
  const secret = str(env.SOLANA_RPC_URL);
  const dedicated = str(env.GOAL_TOKEN_RPC_URL);
  const out: string[] = [];
  const push = (u: string) => {
    if (u && !out.includes(u)) out.push(u);
  };
  if (cluster === "devnet") {
    push(dedicated);
    if (/devnet/i.test(secret)) push(secret);
    push(DEVNET_RPC);
    return out;
  }
  push(secret);
  push("https://solana-rpc.publicnode.com");
  push(MAINNET_RPC);
  return out;
}

export async function pickClusterConnection(env: ClusterEnv = {}, cluster?: string): Promise<Connection | null> {
  const scoped = withCluster(env, parseSolanaCluster(cluster) || solanaCluster(env));
  for (const url of clusterRpcCandidates(scoped)) {
    if (!url) continue;
    try {
      const c = new Connection(url, "confirmed");
      await c.getLatestBlockhash("confirmed");
      return c;
    } catch {
      /* next */
    }
  }
  return null;
}

function treasuryPublicKey(env: ClusterEnv): PublicKey | null {
  const raw = str(env.RRTT_TREASURY_SECRET_KEY_B58);
  if (!raw) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(raw)).publicKey;
  } catch {
    return null;
  }
}

export async function mainnetTreasuryLamports(env: ClusterEnv = {}): Promise<number> {
  const pk = treasuryPublicKey(env);
  if (!pk) return 0;
  const conn = await pickClusterConnection(env, "mainnet-beta");
  if (!conn) return 0;
  const n = await conn.getBalance(pk, "confirmed").catch(() => 0);
  return Math.max(0, Math.floor(n) || 0);
}

export async function resolveIssueState(env: ClusterEnv = {}): Promise<IssueClusterState> {
  const pin = pinnedCluster(env);
  if (pin) {
    return {
      cluster: pin,
      pinned: true,
      treasury_lamports: -1,
      treasury_sol: -1,
      using_devnet_fallback: pin === "devnet",
    };
  }
  const now = Date.now();
  if (issueCache && now - issueCache.at < ISSUE_CACHE_MS) return issueCache.state;
  const lamports = await mainnetTreasuryLamports(env);
  const funded = lamports >= TREASURY_ISSUE_MIN_LAMPORTS;
  const state: IssueClusterState = {
    cluster: funded ? "mainnet-beta" : "devnet",
    pinned: false,
    treasury_lamports: lamports,
    treasury_sol: lamports / 1e9,
    using_devnet_fallback: !funded,
  };
  issueCache = { state, at: now };
  return state;
}

export async function resolveIssueCluster(env: ClusterEnv = {}): Promise<SolanaCluster> {
  return (await resolveIssueState(env)).cluster;
}

export async function clusterForGoal(env: ClusterEnv, row: Record<string, unknown> | null | undefined): Promise<SolanaCluster> {
  return parseSolanaCluster(row?.token_cluster) || (await resolveIssueCluster(env));
}

export function explorerTx(signature: string, cluster: string = DEFAULT_SOLANA_CLUSTER): string {
  const s = encodeURIComponent(signature);
  return cluster === "mainnet-beta" || cluster === "mainnet"
    ? `https://solscan.io/tx/${s}`
    : `https://solscan.io/tx/${s}?cluster=${encodeURIComponent(cluster || "devnet")}`;
}

export function explorerToken(mint: string, cluster: string = DEFAULT_SOLANA_CLUSTER): string {
  const m = encodeURIComponent(mint);
  return cluster === "mainnet-beta" || cluster === "mainnet"
    ? `https://solscan.io/token/${m}`
    : `https://solscan.io/token/${m}?cluster=${encodeURIComponent(cluster || "devnet")}`;
}

export function clusterPublicFields(env: ClusterEnv = {}, state?: IssueClusterState) {
  const cluster = state?.cluster || solanaCluster(env);
  const fallback = Boolean(state?.using_devnet_fallback && !state.pinned);
  const pinned = Boolean(state?.pinned && cluster === "devnet");
  let cluster_note: string;
  if (pinned) {
    cluster_note =
      "Solana is pinned to devnet for testing. SOL, USDC, and goal tokens here are not mainnet. Card donations are still real USD.";
  } else if (fallback) {
    cluster_note =
      "Treasury has less than 0.01 SOL on mainnet, so new SOL, USDC, and goal tokens issue on Solana devnet. Card donations are still real USD. Fund the treasury with 0.01 SOL to issue on mainnet.";
  } else if (cluster === "devnet") {
    cluster_note =
      "Solana is on devnet. SOL, USDC, and goal tokens here are not mainnet. Card donations are still real USD.";
  } else {
    cluster_note = "Solana is on mainnet. Treasury has at least 0.01 SOL, enough to process issuance.";
  }
  return {
    solana_cluster: cluster,
    usdc_mint: cluster === "devnet" ? USDC_MINT_DEVNET : USDC_MINT_MAINNET,
    testnet: cluster === "devnet",
    using_devnet_fallback: fallback,
    issue_min_sol: TREASURY_ISSUE_MIN_LAMPORTS / 1e9,
    treasury_sol: state && state.treasury_sol >= 0 ? state.treasury_sol : null,
    cluster_note,
  };
}

export async function issuePublicFields(env: ClusterEnv = {}) {
  const state = await resolveIssueState(env);
  return clusterPublicFields(withCluster(env, state.cluster), state);
}
