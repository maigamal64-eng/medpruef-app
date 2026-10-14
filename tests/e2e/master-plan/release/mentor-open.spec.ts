import { expect, test, type Page } from "@playwright/test";
import { BASE, assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-mentor-open smoke: a free signed-in account. With MENTOR_ACCESS_SCOPE=signed_in
 * the server answers the mentor routes as the unit-tested handlers do for a
 * scope-admitted account with 0 credits (availability 200; usage state "none",
 * credits_only, referral_credits while the referral program is on), and the
 * learner sees the mentor entry plus the buy and refer paths. With the default
 * scope (beta) the same account gets 403 not_eligible and sees nothing new.
 * Synthetic answers only, local server only (release-harness fences it).
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

async function mentorRoutes(page: Page, scope: "signed_in" | "beta") {
  const json = (status: number, body: unknown) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route("**/api/mentor/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    if (scope === "beta") return route.fulfill(json(403, p.endsWith("/availability") ? { error: "mentor_disabled", reason: "not_eligible" } : { error: "mentor_disabled" }));
    if (p.endsWith("/availability")) return route.fulfill(json(200, { available: true, can_buy: true }));
    if (p.endsWith("/usage")) return route.fulfill(json(200, {
      source: "none", state: "none", low_threshold: 10, current_grant: 0, renewal_at: null, credits_left: 0, admit_min_credits: 4.2,
      messages_left_estimate: 0, next_expiry: null, sources: ["none"], subscriptions: [], can_buy: true, pending_purchase: null, recent_purchase: null,
      credits_only: true, referral_credits: 50,
    }));
    if (p.endsWith("/packages")) return route.fulfill(json(200, { packages: OFFERS }));
    if (p.endsWith("/chat/history")) return route.fulfill(json(200, { conversation_id: null, messages: [] }));
    return route.fulfill(json(200, {}));
  });
  await page.route("**/api/referrals/status", (route) => route.fulfill(json(200, {
    referralCode: "FIXTURE1", referralLink: `${BASE}/?ref=FIXTURE1`, referrals: [], referralCodeCopiedAt: "2026-10-01T00:00:00Z",
    stats: { totalReferrals: 0, pending: 0, qualifiedInHold: 0, claimable: 0, rewarded: 0, earnedCents: 0, paidOutCents: 0 },
    qualifiedActivityCount: 0, thresholdN: 2, proUntilExamGrantedAt: null,
    ...(scope === "signed_in" ? { mentorCredits: 50 } : {}),
  })));
}

const mentorLink = (page: Page) => page.locator('a[href="/mentor"]:visible');

test.beforeAll(async ({ request }) => { await assertStandIn(request); });

for (const v of VARIANTS) {
  test(`scope signed_in: free account sees the mentor and the 0-credit buy and refer state ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    await mentorRoutes(page, "signed_in");

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(mentorLink(page).first()).toBeVisible({ timeout: 25_000 });

    await page.goto("/mentor", { waitUntil: "domcontentloaded" });
    const card = page.locator("[data-mentor-first-run]");
    await expect(card).toBeVisible({ timeout: 25_000 });
    await expect(card.locator('a[href^="/mentor/packages"]')).toBeVisible();
    const refer = card.locator("[data-mentor-refer]");
    await expect(refer).toBeVisible();
    await expect(refer).toContainText("50");
    await expect(refer.locator('a[href^="/referrals"]')).toHaveText(v.lang === "de" ? "Kolleginnen und Kollegen einladen" : "Invite colleagues");
    const m = await measure(page);
    expect(m.scrollWidth, `no horizontal page scroll on /mentor ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.innerWidth);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35"}/mentor-open/mentor-${tag(v)}.png`, fullPage: false });

    await page.goto("/referrals", { waitUntil: "domcontentloaded" });
    const line = page.locator("[data-referral-mentor-credits]");
    await expect(line).toBeVisible({ timeout: 25_000 });
    await expect(line).toContainText(v.lang === "de" ? "50 Credits für den KI-Mentor" : "50 AI Mentor credits");
    const r = await measure(page);
    expect(r.scrollWidth, `no horizontal page scroll on /referrals ${JSON.stringify(r.offenders)}`).toBeLessThanOrEqual(r.innerWidth);
    await line.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35"}/mentor-open/referrals-${tag(v)}.png`, fullPage: false });
    expect(errors, "console errors").toEqual([]);
  });

  test(`scope beta: the same free account sees nothing new ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    await mentorRoutes(page, "beta");
    const probe = page.waitForResponse((res) => res.url().includes("/api/mentor/availability"), { timeout: 25_000 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await probe;
    await page.waitForTimeout(800);
    await expect(mentorLink(page)).toHaveCount(0);
    await page.goto("/referrals", { waitUntil: "domcontentloaded" });
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 25_000 });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await expect(page.locator("[data-referral-mentor-credits]")).toHaveCount(0);
    expect(errors, "console errors").toEqual([]);
  });
}
