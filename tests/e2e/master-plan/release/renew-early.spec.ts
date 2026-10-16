import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-renew-early smoke (the default build: flags are server-side, so the
 * synthetic /api/user/subscription answer stands for them). A learner whose
 * plan still renews and may switch sees the switch note, a button only on the
 * longer plan and, on click, the confirm sheet with the Lektor line about the
 * old plan; a one-time payer may renew early on every plan; with nothing
 * offered (flags off) no plan has a button. 375 and 1280 px, DE and EN, light
 * and dark; no console error, no horizontal scroll; checkout is never sent.
 */
const dir = () => `${process.env.A35_EVIDENCE_DIR ?? "../../.artifacts/a35"}/renew-early`;
const VARIANTS: Variant[] = [
  { width: 375, height: 812, lang: "de", dark: false },
  { width: 375, height: 812, lang: "en", dark: true },
  { width: 1280, height: 900, lang: "de", dark: true },
  { width: 1280, height: 900, lang: "en", dark: false },
];
const END = "2026-11-29T12:00:00.000Z";

test.beforeAll(async ({ request }) => { await assertStandIn(request); });

async function subscription(page: Page, body: Record<string, unknown>) {
  await page.route("**/api/user/subscription", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
    active: true, renewal_offer_suppressed: true,
    subscription: { id: "sub_fixture", tier: "first_month_19", status: "active", access_active: true, expires_at: END, subscription_expires_at: END,
      next_charge_at: END, next_charge_amount_cents: 1900, billing_cadence: "auto_renews", provider_status: "active", payment_provider: "whop" },
    ...body,
  }) }));
  // Checkout is captured, never sent.
  await page.route("**/api/whop/checkout", (route) => route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ code: "PLAN_NOT_READY" }) }));
}
async function noOverflow(page: Page, label: string) {
  const m = await measure(page);
  expect(m.scrollWidth, `${label}: no horizontal scroll ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.innerWidth);
}

for (const v of VARIANTS) {
  test(`switch from a renewing plan ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "pro" });
    await subscription(page, { renewal_state: "renews", extension_available: true, switch_tiers: ["premium_pass_guaranteed"] });
    await page.goto("/pricing", { waitUntil: "load" });
    const note = page.locator("[data-account-note]");
    await expect(note).toContainText(v.lang === "de" ? "Sie können zu einem längeren Tarif wechseln" : "You can switch to a longer plan", { timeout: 25_000 });
    await expect(page.locator('[data-plan="premium_pass_guaranteed"] button')).toHaveCount(1);
    await expect(page.locator('[data-plan="first_month_19"] button')).toHaveCount(0);
    await page.locator('[data-plan="premium_pass_guaranteed"] button').click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText(v.lang === "de" ? "Ihr bisheriges Abo kündigen wir für Sie zum Ende des laufenden Zeitraums" : "We cancel your current plan for you at the end of its current period");
    await expect(sheet).toContainText(v.lang === "de" ? "Die neue Laufzeit beginnt, wenn Ihr jetziger Zugang am" : "The new period starts when your current access ends on");
    await page.waitForTimeout(600); // the dialog's scale-in
    await page.screenshot({ path: `${dir()}/switch-sheet-${tag(v)}.png`, fullPage: false });
    await sheet.getByRole("button", { name: v.lang === "de" ? "Zurück zu den Tarifen" : "Back to plans" }).click();
    await noOverflow(page, "/pricing switch");
    expect(errors, "console errors").toEqual([]);
  });
}

for (const v of VARIANTS) {
  test(`renew early from a one-time pass ${tag(v)}`, async ({ page, context }) => {
    await page.setViewportSize({ width: v.width, height: v.height });
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "pro" });
    await subscription(page, { renewal_state: "one_time", extension_available: true, switch_tiers: [] });
    await page.goto("/pricing", { waitUntil: "load" });
    await expect(page.locator("#pro-status")).toContainText(v.lang === "de" ? "Sie können jetzt verlängern" : "You can extend now", { timeout: 25_000 });
    await expect(page.locator("[data-plan] button")).toHaveCount(3);
    await page.locator("#pro-status").scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${dir()}/renew-early-${tag(v)}.png`, fullPage: false });
    await noOverflow(page, "/pricing renew early");
    expect(errors, "console errors").toEqual([]);
  });
}

test("flags off: a renewing plan offers no second plan", async ({ page, context }) => {
  const v = VARIANTS[0];
  await page.setViewportSize({ width: v.width, height: v.height });
  await prepare(context, page, v, { signedIn: true, tier: "pro" });
  await subscription(page, { renewal_state: "renews", extension_available: false, switch_tiers: [] });
  await page.goto("/pricing", { waitUntil: "load" });
  await expect(page.locator("[data-account-note]")).toContainText("Kein zweiter Tarif nötig", { timeout: 25_000 });
  await expect(page.locator("[data-plan] button")).toHaveCount(0);
});
