#!/usr/bin/env node
// C1 bank-wide blind-answer and explanation pre-screen (a-content-c1). Files only, never a database write.
//
//   node scripts/content/prescreen.mjs snapshot --out <snap.json>                       (read-only SELECTs)
//   node scripts/content/prescreen.mjs plan     --snapshot <snap.json> --state <dir>    (no model call)
//   node scripts/content/prescreen.mjs step     --snapshot <snap.json> --state <dir> --live --max-usd <n>
//   node scripts/content/prescreen.mjs report   --snapshot <snap.json> --state <dir>
//   node scripts/content/prescreen.mjs calibrate --snapshot <snap.json> --out <ids.json> --n 20
//   node scripts/content/prescreen.mjs calibrate-score --snapshot <snap.json> --state <dir> --ids <ids.json>
//
// A static ANTHROPIC_API_KEY is removed from the process and refused. Tokens are never printed.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const bin = path.join(root, "node_modules", ".bin", "vite-node");
if (!existsSync(bin)) {
  process.stderr.write("prescreen: node_modules/.bin/vite-node not found. Run npm ci first.\n");
  process.exit(2);
}
if (process.env.VERCEL_ENV === "production") process.exit(2);
const env = { ...process.env };
// Defence in depth: the child never sees a static key (the CLI drops it as well).
delete env.ANTHROPIC_API_KEY;
env.MEDPRUF_SCRIPT_ENTRY = "prescreen";
const res = spawnSync(
  bin,
  ["--root", root, "--config", path.join(root, "tests", "mentor-eval", "vitest.config.ts"), path.join(root, "scripts", "content", "prescreen", "main.ts"), "--", ...process.argv.slice(2)],
  { stdio: "inherit", cwd: root, env },
);
process.exit(res.status ?? 2);
