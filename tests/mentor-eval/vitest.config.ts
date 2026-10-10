import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest config for the mentor eval (W2-EVAL), kept inside tests/mentor-eval so
 * this package edits only its own files. The root vitest.config.ts includes
 * tests/unit/** only; run these tests with
 *
 *   npx vitest run --config tests/mentor-eval/vitest.config.ts
 *
 * The same file gives scripts/mentor-eval.mjs (vite-node) the "@" alias.
 * R3 should add "tests/mentor-eval/**\/*.test.ts" to the root include so
 * `npm run test:unit` covers them.
 */
export default defineConfig({
  root: path.resolve(__dirname, "..", ".."),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "..", "..", "src"),
    },
  },
  css: { postcss: { plugins: [] } },
  test: {
    include: ["tests/mentor-eval/**/*.test.ts"],
    environment: "node",
    globals: false,
    passWithNoTests: false,
    reporters: ["default"],
  },
});
