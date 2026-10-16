import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, visit, type Variant } from "./release-harness";

/**
 * a-release-int-4 smoke: Home (signed-in free account), /pricing (signed out)
 * and /mentor (signed-in free account, mentor answers mocked) at 375 and 1280,
 * DE/EN, light/dark. Each page renders, has no horizontal page scroll, no
 * element styled fixed in the page flow and no console error. Runs against
 * either build (flags off, or the 20 Oct flip set); synthetic answers only,
 * local server only (release-harness fences it).
 */

const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: true },
  { width: 1280, height: 900, lang: "en", dark: false },
];

const EVIDENCE = process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35";

async function mentorAvailable(page: Page) {
  const json = (status: number, body: unknown) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/mentor/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith("/availability")) return route.fulfill(json(200, { available: true, can_buy: true }));
    if (p.endsWith("/usage")) return route.fulfill(json(200, {
      source: "none", state: "none", low_threshold: 10, current_grant: 0, renewal_at: null, credits_left: 0, admit_min_credits: 4.2,
      messages_left_estimate: 0, next_expiry: null, sources: ["none"], subscriptions: [], can_buy: true, pending_purchase: null, recent_purchase: null,
      credits_only: true,
    }));
    if (p.endsWith("/packages")) return route.fulfill(json(200, { packages: [] }));
    if (p.endsWith("/chat/history")) return route.fulfill(json(200, { conversation_id: null, messages: [] }));
    return route.fulfill(json(200, {}));
  });
}

async function fits(page: Page, label: string) {
  const m = await measure(page);
  expect(m.scrollWidth, `no horizontal page scroll on ${label} ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.innerWidth);
  expect(m.fixedInFlow, `fixed elements in the page flow on ${label}`).toEqual([]);
}

test.beforeAll(async ({ request }) => { await assertStandIn(request); });

for (const v of VARIANTS) {
  test(`home, pricing and mentor render ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);

    await prepare(context, page, v, { signedIn: false });
    await visit(page, "/pricing");
    await fits(page, "/pricing");
    await page.screenshot({ path: `${EVIDENCE}/release-int-4/pricing-${tag(v)}.png`, fullPage: false });

    await prepare(context, page, v, { signedIn: true, tier: "free" });
    await mentorAvailable(page);
    await visit(page, "/");
    await fits(page, "/");
    await page.screenshot({ path: `${EVIDENCE}/release-int-4/home-${tag(v)}.png`, fullPage: false });

    const res = await page.goto("/mentor", { waitUntil: "domcontentloaded" });
    expect(res?.status(), "/mentor HTTP status").toBe(200);
    await expect(page.locator("[data-mentor-first-run], [data-mentor-composer]").first()).toBeVisible({ timeout: 25_000 });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await fits(page, "/mentor");
    await page.screenshot({ path: `${EVIDENCE}/release-int-4/mentor-${tag(v)}.png`, fullPage: false });

    expect(errors, "console errors").toEqual([]);
  });
}
