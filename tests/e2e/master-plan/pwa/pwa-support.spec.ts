/**
 * b36 PWA support proof. Allowlisted non-GET API calls: none (every non-GET /api/** is aborted).
 * Install guide: server rendered from the real component with iPhone environment snapshots, then
 * shown in the iPhone profiles. Offline: real service worker, setOffline, cold navigation.
 * Run: BASE_URL=http://localhost:3136 npx playwright test tests/e2e/master-plan/pwa --project="iPhone 14"
 */
import { expect, test, type Page } from "@playwright/test";
import { buildSync } from "esbuild";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const SHOTS = join(process.cwd(), "tests/e2e/.artifacts/b36-pwa");
mkdirSync(SHOTS, { recursive: true });

// Local runs use Chromium with the iPhone device profile (viewport, touch, UA); no matching WebKit build is installed.
test.use({ browserName: "chromium" });

const SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const INSTAGRAM =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 320.0";

type RenderFn = (props: Record<string, unknown>) => string;

function loadRenderer(): RenderFn {
  const out = buildSync({
    stdin: {
      contents: `
        import { createElement } from "react";
        import { renderToStaticMarkup } from "react-dom/server";
        import Guide from "@/components/master-pwa/IosInstallGuide";
        export const render = (props) => renderToStaticMarkup(createElement(Guide, props));
      `,
      resolveDir: process.cwd(),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    alias: { "@": join(process.cwd(), "src") },
    define: { "process.env.NODE_ENV": '"production"' },
  });
  const mod = { exports: {} as { render?: RenderFn } };
  new Function("module", "exports", "require", out.outputFiles[0].text)(mod, mod.exports, require);
  return mod.exports.render as RenderFn;
}

async function show(page: Page, html: string) {
  await page.setContent(
    `<!doctype html><html lang="de"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>body{margin:0;padding:16px;font-family:system-ui,sans-serif;background:#f7f8fa;color:#18212f}</style></head><body>${html}</body></html>`,
  );
}

test.describe("iOS install guide", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/**", (route) => (route.request().method() === "GET" ? route.continue() : route.abort()));
  });

  for (const [lang, title] of [["de", "MedPrüf auf dem Home-Bildschirm"], ["en", "MedPrüf on your Home Screen"]] as const) {
    test(`ready state in ${lang} shows four steps without horizontal scroll`, async ({ page }, info) => {
      const render = loadRenderer();
      await show(page, render({ lang, env: { userAgent: SAFARI } }));
      const guide = page.getByTestId("ios-install-guide");
      await expect(guide).toHaveAttribute("data-state", "ready");
      await expect(guide.getByRole("heading", { name: title })).toBeVisible();
      await expect(guide.locator("ol > li")).toHaveCount(4);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: join(SHOTS, `guide-${lang}-${info.project.name.replace(/\s+/g, "-")}.png`), fullPage: true });
    });
  }

  test("in-app browser asks for Safari, installed state hides the steps, non-iOS renders nothing", async ({ page }) => {
    const render = loadRenderer();
    await show(page, render({ lang: "de", env: { userAgent: INSTAGRAM } }));
    await expect(page.getByTestId("ios-install-guide")).toHaveAttribute("data-state", "in-app-browser");
    await expect(page.getByText("Bitte in Safari öffnen")).toBeVisible();
    await show(page, render({ lang: "de", env: { userAgent: SAFARI, navigatorStandalone: true } }));
    await expect(page.getByTestId("ios-install-guide")).toHaveAttribute("data-state", "installed");
    await expect(page.locator("ol")).toHaveCount(0);
    await show(page, render({ lang: "de", env: { userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/123.0 Safari/537.36" } }));
    await expect(page.getByTestId("ios-install-guide")).toHaveCount(0);
  });

  test("honest offline copy is on the guide", async ({ page }) => {
    const render = loadRenderer();
    await show(page, render({ lang: "de", env: { userAgent: SAFARI } }));
    await expect(page.getByTestId("ios-install-guide")).toContainText("Hinweisseite");
  });
});

test.describe("offline relaunch", () => {
  test.use({ serviceWorkers: "allow" });

  test("service worker precaches the offline page and a cold offline navigation shows it", async ({ context, page }, info) => {
    await page.route("**/api/**", (route) => (route.request().method() === "GET" ? route.continue() : route.abort()));
    await page.addInitScript(() => {
      localStorage.setItem("medpruef_cookies", "declined");
      localStorage.setItem("medpruef-lang", "de");
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const controlled = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
          setTimeout(resolve, 5000);
        });
      }
      return !!reg.active;
    });
    expect(controlled).toBe(true);
    await expect
      .poll(() => page.evaluate(async () => !!(await caches.match("/offline.html"))), { timeout: 10_000 })
      .toBe(true);

    await context.setOffline(true);
    await page.goto("/quiz", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.title()).toMatch(/offline/i);
    // Honest limit behind pick-offline option A: a cold navigation is served the notice page, not the app shell.
    await expect(page.locator("a[href='/quiz']")).toBeVisible();
    await page.screenshot({ path: join(SHOTS, `offline-${info.project.name.replace(/\s+/g, "-")}.png`), fullPage: true });
    await context.setOffline(false);
  });
});
