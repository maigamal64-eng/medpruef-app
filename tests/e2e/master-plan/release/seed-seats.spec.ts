import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-seed-seats smoke. The server under test runs with SEED_SEATS_ENABLED,
 * AI_FEATURES_ENABLED, MENTOR_ENABLED (true), MENTOR_ACCESS_SCOPE=paid and
 * MENTOR_CAMPAIGN_CODES_ENABLED=true; the Supabase stand-in answers one live
 * seat code (SEAT-REZ: 30 Pro days, 200 credits) and one credits code
 * (TG-SPT). Browser /api calls are synthetic (release-harness). Covers: the
 * /gratis seat page signed out (seat copy, both CTAs, no price), signed in
 * with ?redeem=1 (one POST, the Pro end in the result), the credits code still
 * described as credits, and the Settings code card in seat mode. 375 and
 * 1280, DE and EN, light and dark; no horizontal page scroll, no console errors.
 */

const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: true },
  { width: 1280, height: 900, lang: "en", dark: false },
];
const OUT = process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35";
const json = (status: number, body: unknown) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

async function noOverflow(page: Page, where: string) {
  const m = await measure(page);
  expect(m.scrollWidth, `no horizontal page scroll on ${where} ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.innerWidth);
}

test.use({ serviceWorkers: "block" });
test.beforeAll(async ({ request }) => { await assertStandIn(request); });

for (const v of VARIANTS) {
  test(`gratis seat page signed out: 30 Pro days, credits, rule, no price ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: false });
    await page.goto(`/gratis/SEAT-REZ?lang=${v.lang}`, { waitUntil: "domcontentloaded" });
    const live = page.getByTestId("gratis-live");
    await expect(live).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId("gratis-seat")).toBeVisible();
    await expect(live.locator("h1")).toContainText(v.lang === "de" ? "30 Tage MedPrüf Pro" : "30 days of MedPrüf Pro");
    await expect(live).toContainText("200");
    await expect(live).toContainText(v.lang === "de" ? "höchstens 14 Tage alt" : "at most 14 days old");
    await expect(live).toContainText(v.lang === "de" ? "nichts verlängert sich automatisch" : "nothing renews");
    await expect(live).not.toContainText("€");
    const register = page.getByTestId("gratis-register");
    await expect(register).toBeVisible();
    expect(decodeURIComponent((await register.getAttribute("href")) ?? "")).toContain("next=/gratis/SEAT-REZ?redeem=1");
    await noOverflow(page, "/gratis/SEAT-REZ");
    await page.screenshot({ path: `${OUT}/seed-seats/gratis-seat-${tag(v)}.png`, fullPage: true });
    expect(errors, "console errors").toEqual([]);
  });

  test(`gratis seat page signed in with ?redeem=1 posts once and states the Pro end; a credits code stays credits ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    await page.addInitScript(() => { try { sessionStorage.setItem("medpruef_gratis_pending", "SEAT-REZ"); } catch { /* blocked */ } });
    let posts = 0;
    await page.route("**/api/mentor/campaign/redeem", (route) => { posts++; return route.fulfill(json(200, { ok: true, kind: "seat", duplicate: false, credits: 200, seat_ends_at: "2027-01-21T10:00:00Z", expires_at: "2027-01-21T10:00:00Z", code: "SEAT-REZ" })); });
    await page.goto(`/gratis/SEAT-REZ?redeem=1&lang=${v.lang}`, { waitUntil: "domcontentloaded" });
    const result = page.getByTestId("gratis-result");
    await expect(result).toBeVisible({ timeout: 25_000 });
    await expect(result).toContainText(v.lang === "de" ? "Eingelöst: Pro bis 21. Jänner 2027" : "Redeemed: Pro until 21 January 2027");
    await expect(page.locator('main a[href="/"]')).toBeVisible();
    await page.waitForTimeout(600);
    expect(posts).toBe(1);
    expect(page.url()).not.toContain("redeem=1");
    await noOverflow(page, "/gratis seat redeemed");
    await page.screenshot({ path: `${OUT}/seed-seats/gratis-seat-redeemed-${tag(v)}.png`, fullPage: false });

    await page.goto(`/gratis/TG-SPT?lang=${v.lang}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("gratis-live")).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId("gratis-seat")).toHaveCount(0);
    await expect(page.getByTestId("gratis-live").locator("h1")).toContainText("100");
    expect(errors, "console errors").toEqual([]);
  });

  test(`settings code card in seat mode ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    await page.route("**/api/auth/me**", (route) => route.fulfill(json(200, { user: { id: "51c5564a-5051-4b9b-8f81-4faf0e368533", first_name: "Fixture", tier: "free", tier_expires_at: null, role: "user", referrals_enabled: true, active_exam: "pharma", email: "release@example.invalid", campaign_codes: true } })));
    await page.route("**/api/mentor/campaign/status", (route) => route.fulfill(json(200, { enabled: true, eligible: true, needs_verification: false, redeemed: null, max_age_days: 14, seats: true })));
    await page.route("**/api/mentor/campaign/redeem", (route) => route.fulfill(json(200, { ok: true, kind: "seat", duplicate: false, credits: 200, seat_ends_at: "2027-01-21T10:00:00Z", code: "SEAT-REZ" })));
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    const card = page.getByTestId("settings-campaign-code");
    await expect(card).toBeVisible({ timeout: 25_000 });
    await expect(card).toContainText(v.lang === "de" ? "Code aus Ihrer Lerngruppe" : "Code from your study group");
    await expect(card).toContainText("14");
    await card.locator("input").fill("seat-rez");
    await card.locator('button[type="submit"]').click();
    await expect(card.locator('[role="status"]').first()).toContainText(v.lang === "de" ? "Pro bis" : "Pro until");
    await card.scrollIntoViewIfNeeded();
    await noOverflow(page, "/settings seat");
    await card.screenshot({ path: `${OUT}/seed-seats/settings-seat-${tag(v)}.png` });
    expect(errors, "console errors").toEqual([]);
  });

  test(`pricing: a seat holder sees the buy buttons, never "extension unavailable" ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "pro" });
    const endsAt = new Date(Date.now() + 20 * 86_400_000).toISOString();
    await page.route("**/api/auth/me*", (route) => route.fulfill(json(200, { user: { id: "51c5564a-5051-4b9b-8f81-4faf0e368533", first_name: "Fixture", tier: "pro", tier_expires_at: endsAt, role: "user", referrals_enabled: false, active_exam: "pharma", email: "release@example.invalid", seed_seat: { ends_at: endsAt } } })));
    const bodies: unknown[] = [];
    await page.route("**/api/whop/checkout", async (route) => {
      bodies.push(JSON.parse(route.request().postData() ?? "{}"));
      await route.fulfill(json(409, { code: "PLAN_NOT_READY" }));
    });
    await page.goto("/pricing", { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 25_000 });
    const buy = page.locator('[data-plan="first_month_19"] button');
    await expect(buy).toBeVisible({ timeout: 25_000 });
    await buy.click();
    await expect.poll(() => bodies.length).toBe(1);
    expect(bodies[0]).toEqual({ tier: "first_month_19" });
    await noOverflow(page, "/pricing seat holder");
    await page.screenshot({ path: `${OUT}/seed-seats/pricing-seat-holder-${tag(v)}.png`, fullPage: false });
    // The mocked 409 (never a Whop page) is the only expected browser log line.
    expect(errors.filter((e) => !e.includes("status of 409")), "console errors").toEqual([]);
  });
}
