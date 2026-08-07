#!/usr/bin/env node
/** Query Ava log index: node scripts/log-query.mjs [hours=24] */
import { syncLogIndex, queryLogIndex, logIndexPaths } from "../src/logIndex.mjs";

const hours = Number(process.argv[2] || 24) || 24;
syncLogIndex();
const rows = queryLogIndex({
  sinceMs: Date.now() - hours * 3600_000,
  levels: ["error", "warn", "info"],
  limit: 50,
});
console.log(JSON.stringify({ db: logIndexPaths().db, hours, count: rows.length, rows }, null, 2));
