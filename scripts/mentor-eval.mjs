#!/usr/bin/env node
// Launcher for the mentor golden-set runner (W2-EVAL).
//
//   node scripts/mentor-eval.mjs --lint
//   node scripts/mentor-eval.mjs --stub
//   node scripts/mentor-eval.mjs --scripted
//
// It runs scripts/mentor-eval.ts with vite-node (already installed for vitest) and the
// tests/mentor-eval/vitest.config.ts alias set, so "@/..." imports resolve. Every flag is
// documented at the top of tests/mentor-eval/lib/cli.ts. No dependency is added.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bin = path.join(root, "node_modules", ".bin", "vite-node");
if (!existsSync(bin)) {
  process.stderr.write("mentor-eval: node_modules/.bin/vite-node not found. Run npm ci first.\n");
  process.exit(2);
}
// Recursion guard (a-keyless-dev): a process started by a launcher
// (MEDPRUEF_AI_LAUNCHER_CHILD=1) never starts another launcher.
if (process.env.MEDPRUEF_AI_LAUNCHER_CHILD === "1") {
  process.stderr.write("mentor-eval: refusing to start a launcher from inside a launcher child\n");
  process.exit(2);
}
const res = spawnSync(
  bin,
  ["--root", root, "--config", path.join(root, "tests", "mentor-eval", "vitest.config.ts"), path.join(root, "scripts", "mentor-eval.ts"), "--", ...process.argv.slice(2)],
  { stdio: "inherit", cwd: root, env: { ...process.env, MEDPRUEF_AI_LAUNCHER_CHILD: "1" } },
);
process.exit(res.status ?? 2);
