export type BillingSnapshot = {
  pro_unlocked: boolean;
  life_member: boolean;
  subscription_status: string;
};

/** Minimal D1 surface (avoids pulling `@cloudflare/workers-types` into `shared/`). */
export type BillingD1Statement = {
  first: <T>() => Promise<T | null>;
  all: <T>() => Promise<{ results: T[] }>;
  run: () => Promise<{ meta?: { rows_written?: number } }>;
};

export type BillingD1 = {
  prepare: (query: string) => {
    bind: (...args: unknown[]) => BillingD1Statement;
  };
};

/** Reads `user_accounts` billing flags (written by Stripe webhooks on `rootrecord-license`, same D1). */
export async function fetchBillingSnapshot(db: BillingD1, email: string): Promise<BillingSnapshot | null> {
  const em = email.trim().toLowerCase();
  if (!em) return null;
  const row = await db
    .prepare(
      `SELECT pro_unlocked, life_member, subscription_status
       FROM user_accounts WHERE email = ?`
    )
    .bind(em)
    .first<{
      pro_unlocked: number | null;
      life_member: number | null;
      subscription_status: string | null;
    }>();
  if (!row) return null;
  const life = row.life_member === 1;
  const proRow = row.pro_unlocked === 1;
  const pro = proRow || life;
  const subscription_status = String(row.subscription_status || "none").trim() || "none";
  return { pro_unlocked: pro, life_member: life, subscription_status };
}
