#!/usr/bin/env node
// Claude bridge for Python scripts: JSON lines on stdin, "@@CLAUDE " answers on
// stdout. See scripts/ai/claude-bridge.ts. Started by
// scripts/regenerate_ai_explanations.py; not meant to be run by hand.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const bin = path.join(root, "node_modules", ".bin", "vite-node");
if (!existsSync(bin)) {
  process.stderr.write("claude-runner: node_modules/.bin/vite-node not found. Run npm ci first.\n");
  process.exit(2);
}
if (process.env.VERCEL || process.env.VERCEL_ENV) process.exit(2);
// Recursion guard: this launcher starts vite-node exactly once. A process that
// already runs under a launcher (MEDPRUEF_AI_LAUNCHER_CHILD=1) never starts
// another one, so a mis-resolved import can not fork without end.
if (process.env.MEDPRUEF_AI_LAUNCHER_CHILD === "1") {
  process.stderr.write("claude-runner: refusing to start a launcher from inside a launcher child\n");
  process.exit(2);
}
const res = spawnSync(
  bin,
  ["--root", root, "--config", path.join(root, "tests", "mentor-eval", "vitest.config.ts"), path.join(root, "scripts", "ai", "claude-bridge-main.ts")],
  { stdio: "inherit", cwd: root, env: { ...process.env, MEDPRUEF_AI_LAUNCHER_CHILD: "1" } },
);
process.exit(res.status ?? 2);
