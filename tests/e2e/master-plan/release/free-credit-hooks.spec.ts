import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-free-credit-hooks smoke. The server under test runs with
 * MENTOR_CAMPAIGN_CODES_ENABLED=true and the Supabase stand-in answers one
 * live code (TG-SPT, 100 credits, 60 days); every other code is unknown.
 * Browser /api calls are synthetic (release-harness). Covers: the /gratis
 * landing signed out (both CTAs, no price), signed in with ?redeem=1 (one
 * POST, result line), an unknown code (neutral page), the two Settings cards,
 * the mentor on free credits only (balance, no packages link while plenty,
 * the link once low) and the admin Free credits tab. 375 and 1280, DE and EN,
 * light and dark; no horizontal page scroll, no console errors.
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

function usage(state: "ok" | "low", credits: number) {
  return {
    source: "gift", state, low_threshold: 10, current_grant: 25, renewal_at: null, credits_left: credits, admit_min_credits: 4.2,
    messages_left_estimate: credits, next_expiry: "2026-11-19T10:00:00Z", sources: ["gift"], subscriptions: [], can_buy: true,
    pending_purchase: null, recent_purchase: null, free_credits_only: true,
  };
}

// As in the other release specs: a fresh context would install the service
// worker on the first page and its clients.claim() reloads that page, which
// drops in-memory state such as the redeem result (a returning learner's
// browser is already controlled).
test.use({ serviceWorkers: "block" });

test.beforeAll(async ({ request }) => { await assertStandIn(request); });

for (const v of VARIANTS) {
  test(`gratis landing signed out: live code, both CTAs, no price ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: false });
    await page.goto(`/gratis/TG-SPT?lang=${v.lang}`, { waitUntil: "domcontentloaded" });
    const live = page.getByTestId("gratis-live");
    await expect(live).toBeVisible({ timeout: 25_000 });
    await expect(live.locator("h1")).toContainText("100");
    await expect(live).toContainText(v.lang === "de" ? "60 Tage" : "60 days");
    await expect(live).not.toContainText("€");
    const register = page.getByTestId("gratis-register");
    await expect(register).toBeVisible();
    expect(decodeURIComponent((await register.getAttribute("href")) ?? "")).toContain("next=/gratis/TG-SPT?redeem=1");
    await noOverflow(page, "/gratis/TG-SPT");
    await page.screenshot({ path: `${OUT}/free-credit-hooks/gratis-${tag(v)}.png`, fullPage: true });
    expect(errors, "console errors").toEqual([]);
  });

  test(`gratis landing signed in with ?redeem=1 posts once and shows the result; unknown code is neutral ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    // The visitor left this page through its sign-in button (sets the pending marker).
    await page.addInitScript(() => { try { sessionStorage.setItem("medpruef_gratis_pending", "TG-SPT"); } catch { /* blocked */ } });
    let posts = 0;
    await page.route("**/api/mentor/campaign/redeem", (route) => { posts++; return route.fulfill(json(200, { ok: true, duplicate: false, credits: 100, expires_at: "2026-12-19T10:00:00Z", code: "TG-SPT" })); });
    await page.goto(`/gratis/TG-SPT?redeem=1&lang=${v.lang}`, { waitUntil: "domcontentloaded" });
    const result = page.getByTestId("gratis-result");
    await expect(result).toBeVisible({ timeout: 25_000 });
    await expect(result).toContainText(v.lang === "de" ? "Eingelöst: 100 Credits" : "Redeemed: 100 AI Mentor credits");
    await expect(page.locator('main a[href="/mentor"]')).toBeVisible();
    await page.waitForTimeout(600);
    expect(posts).toBe(1);
    expect(page.url()).not.toContain("redeem=1");
    await noOverflow(page, "/gratis redeemed");
    await page.screenshot({ path: `${OUT}/free-credit-hooks/gratis-redeemed-${tag(v)}.png`, fullPage: false });

    await page.goto(`/gratis/NOPE-CODE?lang=${v.lang}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("gratis-inactive")).toBeVisible({ timeout: 25_000 });
    await expect(page.getByTestId("gratis-live")).toHaveCount(0);
    await noOverflow(page, "/gratis unknown");
    expect(errors, "console errors").toEqual([]);
  });

  test(`settings shows the code card and the experience card while their flags are on ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    await page.route("**/api/mentor/campaign/status", (route) => route.fulfill(json(200, { enabled: true, eligible: true, redeemed: null, max_age_days: 7 })));
    await page.route("**/api/testimonial", (route) => route.fulfill(json(200, { enabled: true, eligible: true, credits: 100, expiry_days: 30, submitted: false, rewarded: false })));
    let sent: Record<string, unknown> | null = null;
    await page.route("**/api/feedback", (route) => { sent = route.request().postDataJSON(); return route.fulfill(json(200, { ok: true })); });
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    const code = page.getByTestId("settings-campaign-code");
    const exp = page.getByTestId("settings-experience");
    await expect(code).toBeVisible({ timeout: 25_000 });
    await expect(exp).toBeVisible();
    await expect(exp).toContainText("100");
    await exp.locator("textarea").fill(v.lang === "de" ? "Die Fristen-Übersicht hat mir sehr geholfen, die Fragen sind gut erklärt." : "The deadline overview helped me a lot, and the questions are well explained.");
    await exp.locator('input[type="checkbox"]').check();
    await exp.locator('button[type="submit"]').click();
    await expect(exp.locator('[role="status"]')).toBeVisible();
    expect(sent).toMatchObject({ context: { kind: "testimonial", consent_public: true } });
    await code.scrollIntoViewIfNeeded();
    await noOverflow(page, "/settings");
    await page.screenshot({ path: `${OUT}/free-credit-hooks/settings-${tag(v)}.png`, fullPage: false });
    expect(errors, "console errors").toEqual([]);
  });

  test(`settings shows neither card while the flags are off ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    await page.route("**/api/mentor/campaign/status", (route) => route.fulfill(json(200, { enabled: false })));
    await page.route("**/api/testimonial", (route) => route.fulfill(json(200, { enabled: false })));
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.locator("h1").first().waitFor({ state: "visible", timeout: 25_000 });
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
    await expect(page.getByTestId("settings-campaign-code")).toHaveCount(0);
    await expect(page.getByTestId("settings-experience")).toHaveCount(0);
    expect(errors, "console errors").toEqual([]);
  });

  test(`mentor on free credits only: balance, packages only once low ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    let state: "ok" | "low" = "ok";
    await page.route("**/api/mentor/**", (route) => {
      const p = new URL(route.request().url()).pathname;
      if (p.endsWith("/availability")) return route.fulfill(json(200, { available: true, can_buy: true }));
      if (p.endsWith("/usage")) return route.fulfill(json(200, state === "ok" ? usage("ok", 25) : usage("low", 6)));
      if (p.endsWith("/packages")) return route.fulfill(json(200, { packages: [] }));
      if (p.endsWith("/chat/history")) return route.fulfill(json(200, { conversation_id: null, messages: [] }));
      return route.fulfill(json(200, {}));
    });
    await page.goto("/mentor", { waitUntil: "domcontentloaded" });
    const pill = page.locator('button[aria-expanded]').filter({ hasText: "25" }).first();
    await expect(pill).toBeVisible({ timeout: 25_000 });
    await pill.click();
    await page.waitForTimeout(300);
    await expect(page.locator('a[href^="/mentor/packages"]:visible')).toHaveCount(0);
    await noOverflow(page, "/mentor ok");
    await page.screenshot({ path: `${OUT}/free-credit-hooks/mentor-ok-${tag(v)}.png`, fullPage: false });

    state = "low";
    await page.reload({ waitUntil: "domcontentloaded" });
    const low = page.locator('button[aria-expanded]').filter({ hasText: "6" }).first();
    await expect(low).toBeVisible({ timeout: 25_000 });
    await low.click();
    await expect(page.locator('a[href^="/mentor/packages"]:visible').first()).toBeVisible({ timeout: 10_000 });
    expect(errors, "console errors").toEqual([]);
  });
}

test("a crafted ?redeem=1 link without a sign-in from this page never posts; the button stays", async ({ page, context }) => {
  const v = VARIANTS[0];
  await page.setViewportSize({ width: v.width, height: v.height });
  const errors = trackErrors(page);
  await prepare(context, page, v, { signedIn: true, tier: "free" });
  let posts = 0;
  await page.route("**/api/mentor/campaign/redeem", (route) => { posts++; return route.fulfill(json(200, { ok: true, duplicate: false, credits: 100, expires_at: null, code: "TG-SPT" })); });
  await page.goto(`/gratis/TG-SPT?redeem=1&lang=${v.lang}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("gratis-redeem")).toBeVisible({ timeout: 25_000 });
  await page.waitForTimeout(800);
  expect(posts).toBe(0);
  await page.getByTestId("gratis-redeem").click();
  await expect(page.getByTestId("gratis-result")).toBeVisible();
  expect(posts).toBe(1);
  expect(errors, "console errors").toEqual([]);
});

for (const v of [VARIANTS[0], VARIANTS[2]]) {
  test(`admin Free credits tab renders codes, the form and the grant log ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    const serverErrors: string[] = [];
    page.on("response", (r) => { if (r.status() >= 500) serverErrors.push(new URL(r.url()).pathname); });
    await prepare(context, page, v, { signedIn: true, tier: "pro" });
    await page.addInitScript(() => {
      try {
        const s = JSON.parse(localStorage.getItem("medpruef_session") ?? "{}");
        s.user = { ...s.user, role: "admin", tier: "admin" };
        localStorage.setItem("medpruef_session", JSON.stringify(s));
      } catch { /* storage blocked */ }
    });
    // The harness answers /api/auth/me as a learner; a refresh that lands before the
    // admin check would otherwise demote the session and leave /admin.
    await page.route("**/api/auth/me**", (route) => route.fulfill(json(200, { user: { id: "51c5564a-5051-4b9b-8f81-4faf0e368533", first_name: "Fixture", tier: "admin", tier_expires_at: null, role: "admin", referrals_enabled: true, active_exam: "kenntnispruefung", email: "admin@example.invalid" } })));
    await page.route("**/api/admin/access/me", (route) => route.fulfill(json(200, { actor: { userId: "51c5564a-5051-4b9b-8f81-4faf0e368533", email: "admin@example.invalid" }, roles: [{ key: "owner", name: "Owner" }], permissions: ["revenue.read", "revenue.manage", "feedback.read", "feedback.manage", "users.read", "system.read", "system.manage", "content.read", "content.moderate"] })));
    // The Cost tab's summary loads under every tab; the stand-in has no ledger.
    await page.route("**/api/mentor/admin/summary**", (route) => route.fulfill(json(503, { error: "ledger_not_applied" })));
    await page.route("**/api/admin/mentor-campaigns", (route) => route.fulfill(json(200, { installed: true, enabled: true, campaigns: [{ code: "TG-SPT", label: "Telegram SPT group", credits: 100, expiry_days: 60, total_cap: 200, daily_cap: 50, starts_at: "2026-10-20T00:00:00Z", ends_at: "2026-12-31T00:00:00Z", active: true, note: null, created_at: "2026-10-20T00:00:00Z", live: true, redeemed_total: 12, redeemed_today: 3, new_accounts: 10, payers: 1 }] })));
    await page.route("**/api/admin/mentor-grants", (route) => route.fulfill(json(200, {
      month_start: "2026-09-30T22:00:00Z", caps: { welcome: 200 }, truncated: false,
      flags: { MENTOR_HOUSE_GRANTS_SCOPE: "signed_in", MENTOR_WELCOME_ENABLED: true, MENTOR_CAMPAIGN_CODES_ENABLED: true },
      counts: { welcome: { lots: 4, credits: 100 }, campaign: { lots: 12, credits: 1200 }, experience: { lots: 0, credits: 0 }, referral_first_charge: { lots: 0, credits: 0 }, referral_trial_start: { lots: 1, credits: 25 }, referral_exam: { lots: 0, credits: 0 }, trial: { lots: 0, credits: 0 }, free_taste: { lots: 0, credits: 0 }, included: { lots: 2, credits: 400 } },
      recent: [{ kind: "campaign", account: "aaaaaaaa", credits: 100, created_at: "2026-10-20T09:00:00Z", expires_at: "2026-12-19T09:00:00Z", status: "live" }],
    })));
    await page.goto("/admin/mentor?tab=Free%20credits", { waitUntil: "domcontentloaded" });
    const section = page.getByTestId("admin-free-credits");
    await expect(section).toBeVisible({ timeout: 25_000 });
    await expect(section).toContainText("TG-SPT");
    await expect(section).toContainText("Welcome credits");
    await expect(section.getByRole("button", { name: "Create code" })).toBeVisible();
    await page.screenshot({ path: `${OUT}/free-credit-hooks/admin-${tag(v)}.png`, fullPage: true });
    // The only 5xx allowed is the mocked "ledger not applied" summary; the browser logs it as a failed resource.
    expect(serverErrors.every((u) => u.includes("/api/mentor/admin/summary")), `unexpected 5xx: ${serverErrors.join(", ")}`).toBe(true);
    expect(errors.filter((e) => !(serverErrors.length > 0 && /status of 503\b/.test(e))), "console errors").toEqual([]);
  });
}
