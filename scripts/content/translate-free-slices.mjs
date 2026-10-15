#!/usr/bin/env node
// Free-set explanation translation staging (a29, CNT-35, LX-21). Dry run by default.
//
//   node scripts/content/translate-free-slices.mjs plan                         (read-only: missing cells + estimate)
//   node scripts/content/translate-free-slices.mjs stage --live --max-usd 3 --pilot 50
//   node scripts/content/translate-free-slices.mjs sample --staging <staging.jsonl>
//   node scripts/content/translate-free-slices.mjs sql --staging <staging.jsonl> --signoff <signoff.json>
//   node scripts/content/translate-free-slices.mjs batch-submit --live --max-usd 3 --pilot 50   (Message Batches, half price)
//   node scripts/content/translate-free-slices.mjs batch-collect                                (poll + collect into staging.jsonl)
//   node scripts/content/translate-free-slices.mjs batch-submit --scope bank --snapshot <snap.json> --live --max-usd 18   (C4: English, whole bank)
//   node scripts/content/translate-free-slices.mjs qa-submit --live --max-usd 18 / qa-collect                           (C4: back-translation QA)
//
// It never writes the database: stage writes a staging file, sql writes a guarded
// changeset for track-A to apply after [name]'s GO. Database keys come from the environment
// (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) and are never printed. Model calls are
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const bin = path.join(root, "node_modules", ".bin", "vite-node");
if (!existsSync(bin)) {
  process.stderr.write("translate-free-slices: node_modules/.bin/vite-node not found. Run npm ci first.\n");
  process.exit(2);
}
if (process.env.VERCEL_ENV === "production") process.exit(2);
// Recursion guard (a-keyless-dev): a process started by a launcher
// (MEDPRUEF_AI_LAUNCHER_CHILD=1) never starts another launcher.
if (process.env.MEDPRUEF_AI_LAUNCHER_CHILD === "1") {
  process.stderr.write("translate-free-slices: refusing to start a launcher from inside a launcher child\n");
  process.exit(2);
}
const env = { ...process.env };
// Defence in depth: the child never sees a static key (the CLI drops and refuses it as well).
delete env.ANTHROPIC_API_KEY;
env.MEDPRUF_SCRIPT_ENTRY = "translate-free-slices";
env.MEDPRUEF_AI_LAUNCHER_CHILD = "1";
const res = spawnSync(
  bin,
  ["--root", root, "--config", path.join(root, "tests", "mentor-eval", "vitest.config.ts"), path.join(root, "scripts", "content", "translate-free-slices", "main.ts"), "--", ...process.argv.slice(2)],
  { stdio: "inherit", cwd: root, env },
);
process.exit(res.status ?? 2);
