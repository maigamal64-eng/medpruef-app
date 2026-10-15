#!/usr/bin/env node
// Plan narratives for the public /lernplan page (M8, a-study-plan-magnet). Dry run by default.
//
//   node scripts/study-plan-public/draft-narratives.mjs plan --counts <counts.json> [--out <dir>] [--today YYYY-MM-DD]
//   node scripts/study-plan-public/draft-narratives.mjs plan --from-supabase      (read-only RPC with the public anon key)
//   node scripts/study-plan-public/draft-narratives.mjs submit --live --max-usd 3 [--out <dir>] [--retry-failed]
//   node scripts/study-plan-public/draft-narratives.mjs collect [--wait] [--out <dir>]
//   node scripts/study-plan-public/draft-narratives.mjs approve --by <Lektor> (--keys k1,k2 | --all-clean --lektor-read-all)
//
// plan writes requests.jsonl and an estimate (nothing sent). submit sends one Message
// Batch on the growth key MEDPRUEF_GROWTH_ANTHROPIC_KEY after a worst-case cost check.
// collect writes content/study-plan-narratives/drafts.json for Lektor. Only approve
// writes src/lib/study-plan-public/narratives.data.json, the file the page reads.
// No database write, no live model call on the page. Keys are never printed.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const bin = path.join(root, "node_modules", ".bin", "vite-node");
if (!existsSync(bin)) {
  process.stderr.write("draft-narratives: node_modules/.bin/vite-node not found. Run npm ci first.\n");
  process.exit(2);
}
if (process.env.VERCEL_ENV === "production") process.exit(2);
const res = spawnSync(
  bin,
  ["--root", root, "--config", path.join(root, "tests", "mentor-eval", "vitest.config.ts"), path.join(root, "scripts", "study-plan-public", "main.ts"), "--", ...process.argv.slice(2)],
  { stdio: "inherit", cwd: root, env: process.env },
);
process.exit(res.status ?? 2);
