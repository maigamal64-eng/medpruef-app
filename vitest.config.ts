import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Vitest config — unit tests only.
 *
 * Scope: pure logic modules under `src/lib/`. No DOM, no JSX, no
 * Next.js runtime. Anything component-level or browser-dependent
 * belongs in Playwright (see `tests/e2e/`), not here.
 *
 * Test files live under `tests/unit/**` mirroring the `src/` tree.
 *
 * Note on CSS: the project uses Tailwind v4 via a `postcss.config.mjs`
 * whose plugin shape vite's built-in PostCSS loader rejects. Since
 * unit tests never import CSS, we set `css.postcss = { plugins: [] }`
 * to skip postcss discovery entirely.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  css: {
    // Explicit empty plugins array tells vite to use an inline PostCSS
    // config instead of walking up to find `postcss.config.mjs` (which
    // ships Tailwind v4's non-standard plugin shape).
    postcss: { plugins: [] },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/mentor-eval/**/*.test.ts"],
    environment: "node",
    globals: false,
    passWithNoTests: false,
    reporters: ["default"],
  },
});
