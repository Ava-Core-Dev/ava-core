/**
 * @deprecated Do NOT delete TOWNY_SINK rows — they are real closed-loop Towny payments.
 * Reserve accounting excludes them from net; only transaction tax (TAX) counts as reserve inflow.
 *
 * To restore audit rows purged from D1:
 *   node scripts/resync-towny-sink-from-mysql.mjs
 */
console.error(
  "Aborted: TOWNY_SINK rows are valid audit entries (outpost, bonus blocks, claims).\n" +
    "They must NOT be deleted. Reserve net excludes them automatically.\n" +
    "To restore D1 from MySQL: node scripts/resync-towny-sink-from-mysql.mjs",
);
process.exit(1);
