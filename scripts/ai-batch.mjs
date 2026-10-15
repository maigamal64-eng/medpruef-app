#!/usr/bin/env node
// Message Batches runner (a-anthropic-features): offline bulk generation at half price.
//
//   node scripts/ai-batch.mjs submit  --items items.jsonl --state <dir> --live --max-usd 5
//   node scripts/ai-batch.mjs poll    --state <dir>
//   node scripts/ai-batch.mjs collect --state <dir>
//   node scripts/ai-batch.mjs status  --state <dir>
//
// (development token helper) or wif. A static ANTHROPIC_API_KEY is removed and refused
// ([name], 14 Oct 2026). Tokens are never printed.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "node_modules", ".bin", "vite-node");
if (!existsSync(bin)) {
  process.stderr.write("ai-batch: node_modules/.bin/vite-node not found. Run npm ci first.\n");
  process.exit(2);
}
if (process.env.VERCEL_ENV === "production") process.exit(2);
const env = { ...process.env };
// The child never sees a static key (the runner refuses it as well).
delete env.ANTHROPIC_API_KEY;
const res = spawnSync(
  bin,
  ["--root", root, "--config", path.join(root, "tests", "mentor-eval", "vitest.config.ts"), path.join(root, "scripts", "ai-batch", "cli.ts"), "--", ...process.argv.slice(2)],
  { stdio: "inherit", cwd: root, env },
);
process.exit(res.status ?? 2);
