import { defineConfig } from "vitest/config";
import path from "node:path";

// Kassa replay (a-flip-kassa-replay): opt-in, starts a throwaway PostgreSQL.
// Ordinary `vitest run` never includes tests/replay.
process.env.KASSA_REPLAY = "1";
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "../../../src") } },
  css: { postcss: { plugins: [] } },
  test: {
    include: ["tests/replay/whop/replay.test.ts"],
    environment: "node",
    globals: false,
    passWithNoTests: false,
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 600_000,
    reporters: ["verbose"],
  },
});
