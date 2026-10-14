import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-mentor-final smoke (mentor-open-picks 3 A): on /mentor/packages the Plus
 * card carries the Lektor-approved switch line only for an active Mentor
 * Basis subscriber, with the one-time top-up pointer while the top-up is on
 * sale. Synthetic /api/mentor answers, local server only (release-harness
 * fences it).
 */

const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: true },
  { width: 1280, height: 900, lang: "en", dark: false },
];

const OFFERS = [
  { package_id: "mentor_basis", kind: "subscription", credits: 150, messages_estimate: 150, price_eur_cents: 490, period_days: 30, valid_days: 33 },
  { package_id: "mentor_plus", kind: "subscription", credits: 400, messages_estimate: 400, price_eur_cents: 990, period_days: 30, valid_days: 33 },
  { package_id: "mentor_topup", kind: "topup", credits: 400, messages_estimate: 400, price_eur_cents: 1000, period_days: null, valid_days: 180 },
];

async function mentorRoutes(page: Page, basis: boolean) {
  const json = (status: number, body: unknown) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/mentor/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p.endsWith("/availability")) return route.fulfill(json(200, { available: true, can_buy: true }));
    if (p.endsWith("/usage")) return route.fulfill(json(200, {
      source: basis ? "package" : "none", state: basis ? "ok" : "none", low_threshold: 22, current_grant: basis ? 150 : 0, renewal_at: null,
      credits_left: basis ? 120 : 0, admit_min_credits: 4.2, messages_left_estimate: basis ? 120 : 0, next_expiry: null,
      sources: [basis ? "package" : "none"], can_buy: true, pending_purchase: null, recent_purchase: null,
      subscriptions: basis ? [{ package_id: "mentor_basis", renews: true, status: "active", renews_at: "2026-11-10T00:00:00Z", management_url: "https://whop.com/billing/manage/mem_fixture" }] : [],
    }));
    if (p.endsWith("/packages")) return route.fulfill(json(200, { packages: OFFERS }));
    return route.fulfill(json(200, {}));
  });
}

test.beforeAll(async ({ request }) => { await assertStandIn(request); });

for (const v of VARIANTS) {
  test(`Basis subscriber sees the switch line on the Plus card ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    await mentorRoutes(page, true);
    await page.goto("/mentor/packages", { waitUntil: "domcontentloaded" });
    const line = page.locator("#package-mentor_plus [data-mentor-basis-to-plus]");
    await expect(line).toBeVisible({ timeout: 25_000 });
    await expect(line).toContainText(v.lang === "de" ? "kündigen Sie danach Mentor Basis über „Bei Whop verwalten“" : "cancel Mentor Basis with “Manage on Whop”");
    await expect(line.locator('a[href="#topup"]')).toHaveText(v.lang === "de" ? "Wenn Sie nur mehr Credits brauchen, nutzen Sie stattdessen die einmalige Aufladung." : "If you only need more credits, use the one-time top-up instead.");
    await expect(page.locator("#package-mentor_basis [data-mentor-basis-to-plus]")).toHaveCount(0);
    const m = await measure(page);
    expect(m.scrollWidth, `no horizontal page scroll ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.innerWidth);
    await line.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35"}/mentor-final/basis-plus-${tag(v)}.png`, fullPage: false });
    expect(errors, "console errors").toEqual([]);
  });

  test(`no Basis subscription: no switch line ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    await mentorRoutes(page, false);
    await page.goto("/mentor/packages", { waitUntil: "domcontentloaded" });
    await expect(page.locator("#package-mentor_plus")).toBeVisible({ timeout: 25_000 });
    await expect(page.locator("[data-mentor-basis-to-plus]")).toHaveCount(0);
    const m = await measure(page);
    expect(m.scrollWidth, `no horizontal page scroll ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.innerWidth);
    expect(errors, "console errors").toEqual([]);
  });
}
