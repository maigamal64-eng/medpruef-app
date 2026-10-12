/**
 * a21 smoke: account and public pages at 375 px and desktop, light and dark,
 * DE and EN. Every API is mocked (no production call). Fails on a console
 * error or horizontal overflow; screenshots go to A21_SHOTS when set.
 */
import { expect, test, type Page } from "@playwright/test";
import { seedSession } from "../fixtures/session";

const SHOTS = process.env.A21_SHOTS;
const END = new Date(Date.now() + 40 * 86_400_000).toISOString();

type Case = { name: string; path: string; signedIn?: "free" | "pro" };
const CASES: Case[] = [
  { name: "pricing-visitor", path: "/pricing" },
  { name: "pricing-pro", path: "/pricing", signedIn: "pro" },
  { name: "checkout-success", path: "/checkout/success?tier=first_3mo_27", signedIn: "pro" },
  { name: "landing", path: "/landing" },
  { name: "faq", path: "/faq" },
  { name: "about", path: "/about" },
  { name: "login-plan", path: "/login?mode=register&next=%2Fpricing%3Faction%3Dstarter-3mo-checkout" },
  { name: "settings", path: "/settings", signedIn: "pro" },
  { name: "referrals", path: "/referrals", signedIn: "free" },
];

async function mockApis(page: Page, tier: "free" | "pro" | undefined) {
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/api/auth/me") return json({ user: { id: "synthetic-a21", email: "a21@example.test", role: "user", tier: tier ?? "free", tier_expires_at: tier === "pro" ? END : null, referrals_enabled: true } });
    if (path === "/api/trial/status") return json({ enabled: true, trial_days: 7, price_after_cents: 1900, currency: "EUR", charge_at: new Date(Date.now() + 7 * 86_400_000).toISOString() });
    if (path === "/api/whop/trial") return json({ eligible: tier !== "pro", trial_enabled: true, is_pro: tier === "pro", already_trialed: false, trial_days: 7, price_after_cents: 1900, currency: "EUR", charge_at: new Date(Date.now() + 7 * 86_400_000).toISOString() });
    if (path === "/api/whop/checkout/status") return json({ pending: null });
    if (path === "/api/whop/checkout/verify") return json({ granted: true, already: true, tier_expires_at: END, amount_cents: 4900 });
    if (path === "/api/user/subscription") return json(tier === "pro" ? { active: true, renewal_offer_suppressed: false, subscription: { tier: "premium_pass_guaranteed", tier_human_name: "Exam Cohort", tier_human_name_de: "Prüfungs-Kohorte", status: "active", expires_at: END, days_remaining: 40, access_active: true, billing_cadence: "one_time", provider_status: null, provider_state_verified: false, is_trial: false, cancel_at_period_end: false, next_charge_at: null, next_charge_amount_cents: null, billing_interval_days: null, manage_url: null, payment_provider: "whop", amount_cents: 12900, currency: "EUR" } } : { active: false, renewal_offer_suppressed: false });
    if (path === "/api/user/exam-preference") return json({ activeExam: "kenntnispruefung", examDate: new Date(Date.now() + 110 * 86_400_000).toISOString().slice(0, 10) });
    if (path === "/api/support/contact") return json({ enabled: true });
    if (path === "/api/referrals/status") return json({ code: "A21CODE", referrals: [], enabled: true });
    return json({});
  });
}

for (const viewport of [{ w: 375, h: 812 }, { w: 1280, h: 900 }]) for (const scheme of ["light", "dark"] as const) for (const lang of ["de", "en"] as const) for (const c of CASES) {
  test(`${c.name} ${viewport.w} ${scheme} ${lang}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.w, height: viewport.h });
    await page.emulateMedia({ colorScheme: scheme });
    const errors: string[] = [];
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.addInitScript((l) => {
      try {
        localStorage.setItem("medpruef-lang", l);
        localStorage.setItem("medpruef_cookie_consent", "declined");
        document.cookie = "mp_consent=declined; path=/";
      } catch { /* storage blocked */ }
    }, lang);
    if (c.signedIn) await seedSession(page, { userId: "synthetic-a21", email: "a21@example.test", tier: c.signedIn });
    await mockApis(page, c.signedIn);
    await page.goto(c.path, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load");
    await page.locator("h1").first().waitFor({ state: "attached", timeout: 20_000 });
    await page.waitForTimeout(1000);
    const measure = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const overflow = await measure().catch(async () => { await page.waitForLoadState("load"); return measure(); });
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${c.name}-${viewport.w}-${scheme}-${lang}.png`, fullPage: false });
    expect(overflow, "horizontal overflow").toBeLessThanOrEqual(1);
    const real = errors.filter((e) => !/Failed to load resource|net::ERR|Content Security Policy|clarity|googletagmanager|intercom|telegram/i.test(e));
    expect(real, real.join("\n")).toEqual([]);
  });
}
