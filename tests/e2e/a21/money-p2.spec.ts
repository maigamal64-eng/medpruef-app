/**
 * a21 P2 money smoke: /pricing and /checkout/success at 375 px and 1280 px,
 * light and dark, DE and EN, every API mocked (no production call).
 *  - the renewal note appears only when the server confirms it (renewal_state)
 *  - an unverifiable plan gets the neutral note, once, in the Pro status card
 *  - the resume after login never opens checkout for active Pro
 *  - verify already:true never announces a new Whop receipt
 * Runs once on the Desktop project (it sets its own viewport):
 *   BASE_URL=http://localhost:3121 npx playwright test tests/e2e/a21/money-p2.spec.ts --project=Desktop
 */
import { expect, test, type Page } from "@playwright/test";
import { seedSession } from "../fixtures/session";

const SHOTS = process.env.A21_SHOTS;
const END = new Date(Date.now() + 40 * 86_400_000).toISOString();
type Renewal = "renews" | "unknown" | "one_time";

const COPY = {
  de: { renews: "Ihr Abo verlängert sich automatisch", unverified: "Ihr Tarif konnte gerade nicht geprüft werden", extension: "Eine Verlängerung vor dem Ende Ihres Zugangs", newPeriod: "Die neue Laufzeit beginnt", receipt: "Die Quittung kommt per E-Mail", oldPromise: "verlängern wir passend" },
  en: { renews: "Your plan renews automatically", unverified: "Your plan could not be checked", extension: "Extending before your access ends", newPeriod: "The new period starts", receipt: "Whop sends the receipt", oldPromise: "we extend it to fit" },
} as const;

async function setup(page: Page, o: { lang: "de" | "en"; scheme: "light" | "dark"; w: number; tier?: "free" | "pro"; renewal?: Renewal; already?: boolean }) {
  await page.setViewportSize({ width: o.w, height: o.w < 500 ? 812 : 900 });
  await page.emulateMedia({ colorScheme: o.scheme });
  const errors: string[] = [];
  const checkoutPosts: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.addInitScript((l) => {
    try {
      localStorage.setItem("medpruef-lang", l);
      localStorage.setItem("medpruef_cookie_consent", "declined");
      document.cookie = "mp_consent=declined; path=/";
    } catch { /* storage blocked */ }
  }, o.lang);
  if (o.tier) await seedSession(page, { userId: "synthetic-a21", email: "a21@example.test", tier: o.tier });
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/auth/me") return json({ user: { id: "synthetic-a21", email: "a21@example.test", role: "user", tier: o.tier ?? "free", tier_expires_at: o.tier === "pro" ? END : null, referrals_enabled: false } });
    if (path === "/api/whop/checkout") { checkoutPosts.push(route.request().method()); return json({ code: "CHECKOUT_PENDING", tier: "first_3mo_27" }, 409); }
    if (path === "/api/whop/checkout/status") return json({ pending: null });
    if (path === "/api/whop/checkout/verify") return json({ granted: true, already: o.already ?? true, tier_expires_at: END, amount_cents: 4900 });
    if (path === "/api/whop/trial") return json({ eligible: false, trial_enabled: true, is_pro: o.tier === "pro", already_trialed: false, trial_days: 7, price_after_cents: 1900, currency: "EUR" });
    if (path === "/api/trial/status") return json({ enabled: false });
    if (path === "/api/user/subscription") return json(o.tier === "pro" ? {
      active: true, renewal_offer_suppressed: o.renewal !== "one_time", renewal_state: o.renewal ?? "one_time", extension_available: false,
      subscription: { tier: "first_3mo_27", tier_human_name: "3 months", tier_human_name_de: "3 Monate", status: "active", expires_at: END, days_remaining: 40, access_active: true, billing_cadence: o.renewal === "renews" ? "auto_renews" : o.renewal === "unknown" ? "unknown" : "one_time", provider_status: o.renewal === "renews" ? "active" : null, provider_state_verified: o.renewal === "renews", is_trial: false, cancel_at_period_end: false, next_charge_at: o.renewal === "renews" ? END : null, next_charge_amount_cents: o.renewal === "renews" ? 4900 : null, billing_interval_days: o.renewal === "renews" ? 90 : null, manage_url: null, payment_provider: "whop", amount_cents: 4900, currency: "EUR" },
    } : { active: false, renewal_offer_suppressed: false, renewal_state: "one_time", extension_available: false });
    if (path === "/api/user/exam-preference") return json({ activeExam: "kenntnispruefung", examDate: null });
    if (path === "/api/support/contact") return json({ enabled: false });
    return json({});
  });
  return { errors, checkoutPosts };
}

async function settle(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("load");
  await page.locator("h1").first().waitFor({ state: "attached", timeout: 20_000 });
  await page.waitForTimeout(1200);
}

async function common(page: Page, errors: string[], shot: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: true });
  expect(overflow, "horizontal overflow").toBeLessThanOrEqual(1);
  const real = errors.filter((e) => !/Failed to load resource|net::ERR|Content Security Policy|clarity|googletagmanager|intercom|telegram/i.test(e));
  expect(real, real.join("\n")).toEqual([]);
}

for (const w of [375, 1280]) for (const scheme of ["light", "dark"] as const) for (const lang of ["de", "en"] as const) {
  const tag = `${w} ${scheme} ${lang}`;
  const c = COPY[lang];

  for (const renewal of ["unknown", "renews", "one_time"] as const) {
    test(`pricing pro ${renewal} ${tag}`, async ({ page }, info) => {
      test.skip(info.project.name !== "Desktop", "sets its own viewport");
      const { errors, checkoutPosts } = await setup(page, { lang, scheme, w, tier: "pro", renewal });
      await settle(page, "/pricing");
      const note = page.locator("[data-account-note]");
      await expect(note).toHaveCount(1);
      const expected = renewal === "renews" ? c.renews : renewal === "unknown" ? c.unverified : c.extension;
      await expect(note).toContainText(expected);
      const body = await page.locator("main").innerText();
      // The note is said once, never on each plan card.
      expect(body.split(expected).length - 1).toBe(1);
      if (renewal !== "renews") expect(body).not.toContain(c.renews);
      expect(body).not.toContain(c.oldPromise);
      await expect(page.locator("article[data-plan] button")).toHaveCount(0);
      expect(checkoutPosts).toEqual([]);
      await common(page, errors, `p2-pricing-pro-${renewal}-${w}-${scheme}-${lang}`);
    });
  }

  test(`pricing resume after login, active Pro ${tag}`, async ({ page }, info) => {
    test.skip(info.project.name !== "Desktop", "sets its own viewport");
    const { errors, checkoutPosts } = await setup(page, { lang, scheme, w, tier: "pro", renewal: "one_time" });
    await settle(page, "/pricing?action=starter-3mo-checkout");
    expect(checkoutPosts).toEqual([]);
    expect(await page.locator("main").innerText()).not.toContain(c.newPeriod);
    await expect(page.locator("[role=dialog]")).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get("action")).toBeNull();
    await common(page, errors, `p2-pricing-resume-pro-${w}-${scheme}-${lang}`);
  });

  test(`pricing resume after login, free learner ${tag}`, async ({ page }, info) => {
    test.skip(info.project.name !== "Desktop", "sets its own viewport");
    const { errors, checkoutPosts } = await setup(page, { lang, scheme, w, tier: "free" });
    await settle(page, "/pricing?action=starter-3mo-checkout");
    await expect.poll(() => checkoutPosts.length).toBe(1);
    await common(page, errors, `p2-pricing-resume-free-${w}-${scheme}-${lang}`);
  });

  for (const already of [true, false]) {
    test(`checkout success already=${already} ${tag}`, async ({ page }, info) => {
      test.skip(info.project.name !== "Desktop", "sets its own viewport");
      const { errors } = await setup(page, { lang, scheme, w, tier: "pro", renewal: "one_time", already });
      await settle(page, "/checkout/success?tier=first_3mo_27");
      await expect(page.locator("section").first()).toBeVisible();
      const body = await page.locator("main").innerText();
      if (already) expect(body).not.toContain(c.receipt);
      else expect(body).toContain(c.receipt);
      await common(page, errors, `p2-success-already-${already}-${w}-${scheme}-${lang}`);
    });
  }
}
