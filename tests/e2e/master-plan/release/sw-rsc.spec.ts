import { expect, test, type Response } from "@playwright/test";
import { assertStandIn, prepare, trackErrors, type Variant } from "./release-harness";

test.beforeAll(async ({ request }) => assertStandIn(request));

/**
 * a-sw-rsc: with the service worker installed and controlling the page, no
 * App Router RSC (flight) request is answered by the worker, and Cache
 * Storage holds no flight entry. Positive control: an allowlisted brand icon
 * is answered by the worker, so the test cannot pass because the worker never
 * took control. Local production build only (see the a35 config).
 */

const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "en", dark: false },
  { width: 1280, height: 800, lang: "de", dark: false },
  { width: 1280, height: 800, lang: "en", dark: false },
];

const isRsc = (r: Response) => {
  const req = r.request();
  const h = req.headers();
  return new URL(req.url()).searchParams.has("_rsc") || h["rsc"] === "1" || (h["accept"] ?? "").includes("text/x-component");
};

for (const v of VARIANTS) {
  test(`RSC requests bypass the service worker on /quiz ${v.width}-${v.lang}`, async ({ context, page }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    await prepare(context, page, v, { signedIn: true, tier: "pro" });
    const errors = trackErrors(page);
    const rsc: { url: string; fromSW: boolean; status: number }[] = [];
    page.on("response", (r) => {
      if (isRsc(r)) rsc.push({ url: r.url(), fromSW: r.fromServiceWorker(), status: r.status() });
    });

    await page.goto("/quiz", { waitUntil: "domcontentloaded" });
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
          setTimeout(resolve, 10_000);
        });
      }
    });
    // Load again under the worker's control, then navigate client-side so
    // the router has to fetch flight data (prefetches count too).
    await page.reload({ waitUntil: "domcontentloaded" });
    expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await page.waitForLoadState("networkidle").catch(() => undefined);
    const link = page.locator('a[href="/progress"], a[href="/study-plan"], a[href="/library"], a[href="/"]').first();
    await link.waitFor({ state: "attached", timeout: 15_000 });
    await link.evaluate((a: HTMLAnchorElement) => a.click());
    await expect.poll(() => rsc.length, { timeout: 15_000 }).toBeGreaterThan(0);
    await page.waitForLoadState("networkidle").catch(() => undefined);

    expect(rsc.filter((r) => r.fromSW), JSON.stringify(rsc, null, 1)).toEqual([]);

    // Positive control: an allowlisted static file is answered by the worker.
    const iconResp = page.waitForResponse((r) => r.url().endsWith("/brand/icon-192.png"), { timeout: 10_000 });
    expect(await page.evaluate(async () => (await fetch("/brand/icon-192.png")).ok)).toBe(true);
    expect((await iconResp).fromServiceWorker()).toBe(true);
    const cache = await page.evaluate(async () => {
      const out: { url: string; type: string }[] = [];
      for (const name of await caches.keys()) {
        const c = await caches.open(name);
        for (const req of await c.keys()) {
          const res = await c.match(req, { ignoreVary: true });
          out.push({ url: req.url, type: res?.headers.get("content-type") ?? "" });
        }
      }
      return out;
    });
    expect(cache.filter((e) => e.url.includes("_rsc") || e.type.includes("text/x-component"))).toEqual([]);
    expect(cache.some((e) => e.url.includes("/brand/"))).toBe(true);
    expect(errors).toEqual([]);
    test.info().annotations.push({ type: "rsc", description: `${rsc.length} RSC responses, none from the worker; ${cache.length} cache entries` });
  });
}
