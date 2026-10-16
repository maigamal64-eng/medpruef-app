import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-pricing-v2 smoke. /pricing, /landing, /terms and llms.txt are built at
 * deploy, so each state needs its own build:
 *   PRICING_V2_BUILD=1  built with PRICING_V2_ENABLED=true, REVERSE_TRIAL_ENABLED=true
 *                       and REVERSE_TRIAL_SINCE set; server started with the
 *                       same env plus TICKET_RENEWAL_ENABLED=true
 *   unset               built and started without them (today's offer)
 * 375 and 1280 px, DE and EN, light and dark; no console error, no horizontal
 * page scroll. Every /api call is synthetic (release-harness) and the
 * checkout request is captured, never sent to Whop.
 */
const v2 = process.env.PRICING_V2_BUILD === "1";
const dir = () => `${process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35"}/pricing-v2`;
const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: true },
  { width: 1280, height: 900, lang: "en", dark: false },
];

test.beforeAll(async ({ request }) => { await assertStandIn(request); });

async function noOverflow(page: Page, label: string) {
  const m = await measure(page);
  expect(m.scrollWidth, `${label}: no horizontal scroll ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.innerWidth);
}

async function jsonLdOfferNames(page: Page): Promise<string[]> {
  return page.evaluate(() => [...document.querySelectorAll('script[type="application/ld+json"]')]
    .flatMap((el) => { try { return [JSON.parse(el.textContent ?? "")]; } catch { return []; } })
    .flatMap((x) => (x["@graph"] ?? [x]))
    .flatMap((n: { offers?: Array<{ name: string }> }) => (n.offers ?? []).map((o) => o.name)));
}

for (const v of VARIANTS) {
  test(`pricing ${v2 ? "v2" : "today"} signed out ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: false });
    await page.goto(`/pricing`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 25_000 });
    if (v2) {
      await expect(page.locator("[data-plan]")).toHaveCount(4);
      for (const t of ["flex_month", "sitting_pass", "half_year", "guarantee_ticket"]) await expect(page.locator(`[data-plan="${t}"]`)).toBeVisible();
      await expect(page.locator("#exam-timing")).toBeVisible();
      // The Sitting Pass asks for a sitting before anything else.
      await page.locator('[data-plan="sitting_pass"] button').click();
      await expect(page.locator("[data-sitting-needed]")).toBeVisible();
      // Picking the first official sitting marks one plan and shows the pass end.
      await page.locator('#exam-timing input[type="radio"]').first().check();
      await expect(page.locator("[data-plan] >> text=/Empfohlen|Recommended/")).toHaveCount(1);
      await expect(page.locator("[data-pass-end]")).toBeVisible();
      // "Not sure yet" marks the monthly plan.
      await page.locator('#exam-timing input[type="radio"]').last().check();
      await expect(page.locator('[data-plan="flex_month"]')).toContainText(v.lang === "de" ? "Empfohlen" : "Recommended");
      await expect(page.locator('[data-reverse-trial="visitor"]')).toBeVisible();
      expect(await jsonLdOfferNames(page)).toEqual(["Free tier", "Monthly plan", "Sitting Pass", "6 months", "Guarantee Ticket"]);
    } else {
      await expect(page.locator("[data-plan]")).toHaveCount(3);
      for (const t of ["first_3mo_27", "first_month_19", "premium_pass_guaranteed"]) await expect(page.locator(`[data-plan="${t}"]`)).toBeVisible();
      await expect(page.locator("#exam-timing")).toHaveCount(0);
      expect(await jsonLdOfferNames(page)).toEqual(["Free tier", "Single month", "3-month starter", "Exam Cohort"]);
    }
    await noOverflow(page, "/pricing");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${dir()}/pricing-${v2 ? "v2" : "today"}-signed-out-${tag(v)}.png`, fullPage: true });
    expect(errors, "console errors").toEqual([]);
  });
}

for (const v of VARIANTS.filter((x) => x.width === 375 || x.lang === "de")) {
  test(`pricing ${v2 ? "v2" : "today"} signed-in free checkout ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    const bodies: unknown[] = [];
    await page.route("**/api/whop/checkout", async (route) => {
      bodies.push(JSON.parse(route.request().postData() ?? "{}"));
      // Never a Whop page: answer like a plan that is not on sale yet.
      await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "PLAN_NOT_READY" }) });
    });
    await page.goto(`/pricing`, { waitUntil: "load" });
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 25_000 });
    if (v2) {
      await page.locator('#exam-timing input[type="radio"]').first().check();
      const passButton = page.locator('[data-plan="sitting_pass"] button');
      if (await passButton.count()) {
        await passButton.click();
        await expect.poll(() => bodies.length).toBe(1);
        const body = bodies[0] as { tier: string; sitting?: { bank: string; date: string; lastDay: string } };
        expect(body.tier).toBe("sitting_pass");
        expect(body.sitting?.bank).toBe("kenntnispruefung");
        expect(body.sitting?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        await expect(page.locator('[data-checkout-problem="not_ready"]')).toBeVisible();
      }
    } else {
      await page.locator('[data-plan="first_month_19"] button').click();
      await expect.poll(() => bodies.length).toBe(1);
      expect(bodies[0]).toEqual({ tier: "first_month_19" });
    }
    await noOverflow(page, "/pricing signed in");
    await page.screenshot({ path: `${dir()}/pricing-${v2 ? "v2" : "today"}-checkout-${tag(v)}.png`, fullPage: false });
    // The 409 is this spec's own checkout answer.
    expect(errors.filter((e) => !/status of 409/.test(e)), "console errors").toEqual([]);
  });
}

test(`landing, terms and llms.txt follow the build (${v2 ? "v2" : "today"})`, async ({ page, context, request }) => {
  const v = VARIANTS[0];
  await page.setViewportSize({ width: v.width, height: v.height });
  const errors = trackErrors(page);
  await prepare(context, page, v, { signedIn: false });
  await page.goto("/landing", { waitUntil: "load" });
  await page.locator("#pricing").scrollIntoViewIfNeeded();
  await expect(page.locator("[data-pricing-v2]")).toHaveCount(v2 ? 1 : 0);
  await noOverflow(page, "/landing");
  // A new page, so the landing page's in-flight prefetches are not cut off by the navigation.
  const termsPage = await context.newPage();
  const termsErrors = trackErrors(termsPage);
  await termsPage.setViewportSize({ width: v.width, height: v.height });
  await termsPage.goto("/terms", { waitUntil: "load" });
  await expect(termsPage.locator("[data-terms-ticket]")).toHaveCount(v2 ? 1 : 0);
  await noOverflow(termsPage, "/terms");
  expect(termsErrors, "console errors on /terms").toEqual([]);
  const llms = await (await request.get("/llms.txt")).text();
  const full = await (await request.get("/llms-full.txt")).text();
  if (v2) {
    expect(llms).toContain("Guarantee Ticket at €179");
    expect(full).toContain("Guarantee Ticket at €179");
    expect(llms).not.toContain("Cohort at €129");
  } else {
    expect(llms).toContain("6-month Cohort at €129");
    expect(full).toContain("6-month Cohort at €129");
  }
  expect(errors, "console errors").toEqual([]);
});

test.describe("v2 runtime surfaces", () => {
  test.skip(!v2, "needs the v2 build and TICKET_RENEWAL_ENABLED=true at runtime");
  for (const v of VARIANTS.filter((x) => x.lang === "de" || x.width === 1280)) {
    test(`home trial line and ticket renewal form ${tag(v)}`, async ({ page, context }) => {
      await page.setViewportSize({ width: v.width, height: v.height });
      const errors = trackErrors(page);
      await prepare(context, page, v, { signedIn: true, tier: "pro" });
      const endsAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
      await page.route("**/api/auth/me*", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        user: { id: "51c5564a-5051-4b9b-8f81-4faf0e368533", tier: "pro", tier_expires_at: endsAt, role: "user", referrals_enabled: false, reverse_trial: { ends_at: endsAt, started: false } },
      }) }));
      await page.goto("/", { waitUntil: "load" });
      await expect(page.locator("[data-reverse-trial-banner]")).toBeVisible({ timeout: 25_000 });
      await noOverflow(page, "/ home");
      await page.route("**/api/ticket-renewal", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        ticket: { expires_at: "2027-10-20T10:00:00Z", status: "active" }, renewals_used: 0, max_renewals: 2, pending: null, history: [], blocker: null,
      }) }));
      await page.goto("/ticket-renewal", { waitUntil: "load" });
      await expect(page.locator("[data-ticket-status]")).toBeVisible({ timeout: 25_000 });
      await expect(page.locator('form input[type="file"]')).toBeVisible();
      await noOverflow(page, "/ticket-renewal");
      await page.screenshot({ path: `${dir()}/ticket-renewal-${tag(v)}.png`, fullPage: true });
      expect(errors, "console errors").toEqual([]);
    });
  }
});
