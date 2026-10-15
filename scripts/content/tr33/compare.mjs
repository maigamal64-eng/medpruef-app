#!/usr/bin/env node
// TR-33 launcher: MedPrüf AI explanation path vs one general chatbot on contested items.
//
//   node scripts/content/tr33/compare.mjs run   --out <dir> [--n 50] [--seed 33] [--max-usd 3] [--general-model gpt-4o] [--dry]
//   node scripts/content/tr33/compare.mjs score --out <dir>      (after scores.json and rescore.json exist)
//
// "run" reads the track-B b03 snapshot (no database read), calls the exact /api/ai-chat
// prompt (src/lib/ai/legacy-explain-prompt.ts + citation guard) and an unprompted general
// chatbot, and writes blind.json (labels A/B) plus key.json (kept away from raters).
// Keys come from the environment and are never printed. No database or flag is touched.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const bin = path.join(root, "node_modules", ".bin", "vite-node");
if (!existsSync(bin)) {
  process.stderr.write("tr33: node_modules/.bin/vite-node not found. Run npm ci first.\n");
  process.exit(2);
}
if (process.env.VERCEL_ENV === "production") process.exit(2);
// Recursion guard (a-keyless-dev): a process started by a launcher
// (MEDPRUEF_AI_LAUNCHER_CHILD=1) never starts another launcher.
if (process.env.MEDPRUEF_AI_LAUNCHER_CHILD === "1") {
  process.stderr.write("tr33: refusing to start a launcher from inside a launcher child\n");
  process.exit(2);
}
const res = spawnSync(
  bin,
  ["--root", root, "--config", path.join(root, "tests", "mentor-eval", "vitest.config.ts"), path.join(root, "scripts", "content", "tr33", "compare.ts"), "--", ...process.argv.slice(2)],
  { stdio: "inherit", cwd: root, env: { ...process.env, MEDPRUEF_AI_LAUNCHER_CHILD: "1" } },
);
process.exit(res.status ?? 2);
