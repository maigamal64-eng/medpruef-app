import { expect, test, type Browser } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

test.setTimeout(90_000);

const EVIDENCE = join(process.cwd(), "reviews/ux-review-2026-09-26/evidence/pwa-controlled-navigation");
mkdirSync(EVIDENCE, { recursive: true });

async function newFixture(browser: Browser, width: number, height: number) {
  const context = await browser.newContext({
    viewport: { width, height },
    locale: "en-US",
    serviceWorkers: "allow",
  });
  const page = await context.newPage();

  // Keep this a local-only browser test. API traffic is fixture-backed and
  // every remote origin, including analytics and font CDNs, is blocked.
  await page.route(/^https?:\/\/(?!((localhost|127\.0\.0\.1):3102))/, (route) => route.abort());
  // Serve a tiny same-origin page so the test exercises the real app worker
  // without depending on Next client chunks, auth data, or application APIs.
  await page.route("**/__sw_navigation_fixture", (route) => route.fulfill({
    status: 200,
    contentType: "text/html; charset=utf-8",
    body: "<!doctype html><html lang='en'><head><meta name='viewport' content='width=device-width,initial-scale=1'><title>Worker fixture</title></head><body><main>Online worker fixture</main></body></html>",
  }));
  return { context, page };
}

test("registered service worker serves the privacy-safe offline shell for an offline app navigation", async ({ browser }) => {
  for (const viewport of [
    { width: 390, height: 844, label: "phone" },
    { width: 768, height: 1024, label: "tablet" },
    { width: 1440, height: 900, label: "desktop" },
  ]) {
    const { context, page } = await newFixture(browser, viewport.width, viewport.height);
    try {
      await page.goto("/__sw_navigation_fixture", { waitUntil: "domcontentloaded" });
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
        if (registration.active?.state !== "activated") {
          await new Promise<void>((resolve, reject) => {
            const worker = registration.installing || registration.waiting || registration.active;
            if (!worker) return reject(new Error("service worker did not create a worker"));
            if (worker.state === "activated") return resolve();
            worker.addEventListener("statechange", () => worker.state === "activated" && resolve(), { once: true });
            window.setTimeout(() => reject(new Error(`service worker activation timed out (${worker.state})`)), 15_000);
          });
        }
      });
      // The worker calls clients.claim() on activate, so wait until this page
      // is controlled before turning off the network.
      await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 15_000 }).toBe(true);

      const cacheHasOfflineShell = await page.evaluate(async () => {
        const keys = await caches.keys();
        for (const key of keys) {
          const response = await (await caches.open(key)).match("/offline.html");
          if (response) return true;
        }
        return false;
      });
      expect(cacheHasOfflineShell, "the installed worker should precache the standalone offline page").toBe(true);

      expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
      await context.setOffline(true);
      await page.goto("/quiz?offline-fixture=1", { waitUntil: "domcontentloaded", timeout: 15_000 });

      // pick-offline A (a28): honest notice, a reload button (never a link into
      // the app) and no pointer to Settings. The browser here is en-US, so the
      // page renders English (de* locales read German).
      await expect(page.getByRole("heading", { name: "You are offline right now." })).toBeVisible();
      await expect(page.getByText(/Your account stays protected/)).toBeVisible();
      await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
      await expect(page.getByRole("link", { name: /Try again|Erneut versuchen/ })).toHaveCount(0);
      await expect(page.getByText("Fixture", { exact: true })).toHaveCount(0);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(1);
      await page.screenshot({ path: join(EVIDENCE, `offline-navigation-${viewport.label}-${viewport.width}x${viewport.height}.png`), fullPage: true });
    } finally {
      await context.close();
    }
  }
});
