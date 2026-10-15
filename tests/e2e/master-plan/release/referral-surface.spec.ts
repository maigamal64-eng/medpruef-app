import { expect, test, type Page } from "@playwright/test";
import { BASE, USER_ID, assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-referral-surface smoke. GET /api/referrals/invite is the only switch the
 * client sees: enabled (REFERRAL_SURFACE_ENABLED on, account enrolled, exam
 * reward live) shows the weekly Home card, the one-tap share on the mentor
 * 0-credit note and the invite line after a saved pass; `{enabled:false}`
 * (the default) shows none of them. Synthetic answers only, local server only.
 */

const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: true },
  { width: 1280, height: 900, lang: "en", dark: false },
];
const EVIDENCE = `${process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35"}/referral-surface`;
const LINK = `${BASE}/login?ref=FIXTURE1`;
const json = (status: number, body: unknown) => ({ status, contentType: "application/json", body: JSON.stringify(body) });

async function inviteRoute(page: Page, enabled: boolean, eligible = true) {
  // /api/auth/me carries the switch (referral_surface); off means no invite request at all.
  await page.route("**/api/auth/me**", (route) => route.fulfill(json(200, { user: {
    id: USER_ID, first_name: "Fixture", tier: "free", tier_expires_at: null, role: "user", referrals_enabled: true,
    referral_surface: enabled, active_exam: "kenntnispruefung", email: "release@example.invalid",
  } })));
  await page.route("**/api/referrals/invite**", (route) => route.fulfill(json(200, enabled
    ? { enabled: true, link: LINK, mentorCredits: 50, ...(new URL(route.request().url()).searchParams.get("card") === "1" ? { card: { activeDays14: eligible ? 4 : 2, eligible } } : {}) }
    : { enabled: false })));
}

test.beforeAll(async ({ request }) => { await assertStandIn(request); });

for (const v of VARIANTS) {
  test(`Home card: shown once, shares in one tap, hides for a week ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(BASE).origin });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    await inviteRoute(page, true);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const card = page.getByTestId("referral-home-card");
    await expect(card).toBeVisible({ timeout: 25_000 });
    await expect(card).toContainText(v.lang === "de" ? "50 Credits für den KI-Mentor" : "50 AI Mentor credits");
    await expect(card).toContainText(v.lang === "de" ? "30 Tage" : "30 days");
    await expect(card.locator('a[href^="https://t.me/share/url"]')).toBeVisible();
    await expect(card.locator('a[href^="https://wa.me/"]')).toBeVisible();
    await expect(card.locator('a[href^="mailto:?subject="]')).toBeVisible();
    // One referral pitch per viewport: the code card defers to the weekly card.
    await expect(page.getByText(v.lang === "de" ? "Ihr Empfehlungscode" : "Your referral code", { exact: true })).toHaveCount(0);
    // The floater (6 s mount delay) is not elected while the card holds the gate.
    await page.waitForTimeout(6500);
    await expect(page.getByText(v.lang === "de" ? "Kennen Sie jemanden, der sich auch auf die Prüfung vorbereitet?" : "Know someone else preparing for the exam?")).toHaveCount(0);
    const m = await measure(page);
    expect(m.scrollWidth, `no horizontal page scroll on / ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.innerWidth);
    await card.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${EVIDENCE}/home-${tag(v)}.png`, fullPage: false });

    await card.getByRole("button", { name: v.lang === "de" ? "Einladung kopieren" : "Copy invite" }).click();
    await expect(card.getByRole("button", { name: v.lang === "de" ? "Kopiert" : "Copied" })).toBeVisible();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain(LINK);

    await card.getByRole("button", { name: v.lang === "de" ? "Hinweis für eine Woche ausblenden" : "Hide this for a week" }).click();
    await expect(card).toHaveCount(0);
    const stamp = await page.evaluate((id) => localStorage.getItem(`medpruef_referral_card_v1:${id}`), USER_ID);
    expect(Number(stamp)).toBeGreaterThan(0);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await expect(page.getByTestId("referral-home-card")).toHaveCount(0);
    expect(errors, "console errors").toEqual([]);
  });

  test(`flag off: no invite request, no Home card, the floater as before ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    await inviteRoute(page, false);
    const inviteCalls: string[] = [];
    page.on("request", (req) => { if (req.url().includes("/api/referrals/invite")) inviteCalls.push(req.url()); });
    const me = page.waitForResponse((res) => res.url().includes("/api/auth/me"), { timeout: 25_000 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await me;
    await page.waitForTimeout(2500);
    expect(inviteCalls, "no invite request while the surfaces are off").toEqual([]);
    await expect(page.getByTestId("referral-home-card")).toHaveCount(0);
    // Control: with the card absent the gate elects the existing floater as before.
    await expect(page.getByText(v.lang === "de" ? "Kennen Sie jemanden, der sich auch auf die Prüfung vorbereitet?" : "Know someone else preparing for the exam?")).toBeVisible({ timeout: 10_000 });
    expect(errors, "console errors").toEqual([]);
  });

  test(`mentor 0-credit note and /stats pass line share the invite ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    await inviteRoute(page, true);
    await page.route("**/api/mentor/**", async (route) => {
      const p = new URL(route.request().url()).pathname;
      if (p.endsWith("/availability")) return route.fulfill(json(200, { available: true, can_buy: true }));
      if (p.endsWith("/usage")) return route.fulfill(json(200, {
        source: "none", state: "none", low_threshold: 10, current_grant: 0, renewal_at: null, credits_left: 0, admit_min_credits: 4.2,
        messages_left_estimate: 0, next_expiry: null, sources: ["none"], subscriptions: [], can_buy: true, pending_purchase: null, recent_purchase: null,
        credits_only: true, referral_credits: 50,
      }));
      if (p.endsWith("/packages")) return route.fulfill(json(200, { packages: [{ package_id: "mentor_basis", kind: "subscription", credits: 150, messages_estimate: 150, price_eur_cents: 490, period_days: 30, valid_days: 33 }] }));
      if (p.endsWith("/chat/history")) return route.fulfill(json(200, { conversation_id: null, messages: [] }));
      return route.fulfill(json(200, {}));
    });
    await page.goto("/mentor", { waitUntil: "domcontentloaded" });
    const share = page.locator('[data-referral-share="mentor_zero"]').first();
    await expect(share).toBeVisible({ timeout: 25_000 });
    await expect(share).toContainText(LINK);
    await expect(share.getByRole("button", { name: v.lang === "de" ? "Einladung kopieren" : "Copy invite" })).toBeVisible();
    const m = await measure(page);
    expect(m.scrollWidth, `no horizontal page scroll on /mentor ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.innerWidth);
    await share.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${EVIDENCE}/mentor-${tag(v)}.png`, fullPage: false });

    await page.addInitScript((id) => {
      try { sessionStorage.setItem("medpruef_pass_receipt", JSON.stringify({ userId: id, attemptId: "fixture-attempt", recordedAt: Date.now() })); } catch { /* blocked */ }
    }, USER_ID);
    await page.goto("/stats?examPassed=1", { waitUntil: "domcontentloaded" });
    const line = page.getByTestId("referral-line-exam_pass");
    await expect(line).toBeVisible({ timeout: 25_000 });
    await expect(line).not.toContainText(/Credits|credits|Belohnung|reward/);
    await line.getByRole("button", { name: v.lang === "de" ? "Link teilen" : "Share link" }).click();
    await expect(line.locator('[data-referral-share="exam_pass"]')).toBeVisible();
    const s = await measure(page);
    expect(s.scrollWidth, `no horizontal page scroll on /stats ${JSON.stringify(s.offenders)}`).toBeLessThanOrEqual(s.innerWidth);
    await line.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${EVIDENCE}/stats-${tag(v)}.png`, fullPage: false });
    expect(errors, "console errors").toEqual([]);
  });
}
