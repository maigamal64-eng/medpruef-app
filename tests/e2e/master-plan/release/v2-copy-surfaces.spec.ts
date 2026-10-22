import { expect, test, type Page } from "@playwright/test";
import { assertStandIn, measure, prepare, tag, trackErrors, type Variant } from "./release-harness";

/**
 * a-v2-copy-surfaces-1021: the surfaces that showed v1 copy after the 21 Oct
 * pricing v2 flip. Needs a build with PRICING_V2_ENABLED=true (pages are built
 * at deploy) and the 6-month readiness flags unset (today's production state):
 *   V2_COPY_BUILD=1 BASE_URL=http://127.0.0.1:31xx A35_STANDIN_URL=... npx playwright test -c tests/e2e/master-plan/release v2-copy-surfaces.spec.ts
 * 375 and 1280 px, DE and EN, light and dark; no console error, no
 * horizontal page scroll. Every /api call is synthetic (release-harness).
 */
const ON = process.env.V2_COPY_BUILD === "1";
const EVIDENCE = process.env.A35_EVIDENCE_DIR;
const VARIANTS: Variant[] = [375, 1280].flatMap((width) =>
  (["de", "en"] as const).flatMap((lang) => [false, true].map((dark) => ({ width, height: width < 800 ? 812 : 900, lang, dark })))
);
/** v1 lines that must not show under v2 (offer text, not the history line for Cohorts already bought). */
const V1 = [
  /Prüfungs-Kohorte ansehen|See Exam Cohort|See the Exam Cohort/,
  /auf der Prüfungs-Kohorte|on the Exam Cohort/,
  /Einzelmonat und 3-Monats-Tarif|Single Month and 3-Month plans/,
  /zur Prüfungs-Kohorte oder|switch to the Exam Cohort/,
  /Bestehe beim ersten Versuch|Pass on your first try/,
  /129 ?€|€ ?129/,
];

test.beforeAll(async ({ request }) => { await assertStandIn(request); });
test.describe.configure({ mode: "parallel" });

async function check(page: Page, v: Variant, label: string, errors: string[]) {
  const m = await measure(page);
  expect(m.scrollWidth, `${label}: no horizontal scroll ${JSON.stringify(m.offenders)}`).toBeLessThanOrEqual(m.innerWidth);
  expect(errors, label).toEqual([]);
  if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/v2-copy-surfaces/${label.replace(/[^\w-]+/g, "_")}-${tag(v)}.png`, fullPage: false });
}

/**
 * FAQ and terms keep the PUYP terms for Cohorts already bought (history, not
 * an offer: "Für bereits gekaufte Prüfungs-Kohorten gilt weiterhin: ... (129 €
 * einmalig für 6 Monate)"). Drop that one sentence before the v1 checks.
 */
function offerText(text: string): string {
  return text.replace(/(Für bereits gekaufte Prüfungs-Kohorten gilt weiterhin:|For Exam Cohorts already bought, this still applies:)[^)]*\)/g, "$1");
}

async function bodyText(page: Page): Promise<string> {
  return (await page.locator("body").innerText()).replace(/\s+/g, " ");
}

const PUBLIC: Array<{ path: string; scroll?: string; expectText: { de: RegExp; en: RegExp } }> = [
  { path: "/faq", scroll: "#payment", expectText: { de: /Garantie-Ticket/, en: /Guarantee Ticket/ } },
  { path: "/terms", scroll: "h2:has-text('5.')", expectText: { de: /Garantie-Ticket kostet einmalig/, en: /Guarantee Ticket costs/ } },
  { path: "/stichprobentest", expectText: { de: /bis zu zwei Verlängerungsjahre auf Nachweis/, en: /up to two renewal years on proof/ } },
  { path: "/pharmakologie-pruefung-wien", expectText: { de: /Tarife ansehen/, en: /See plans/ } },
  { path: "/blog/medizin-lernen-in-deiner-sprache", expectText: { de: /Garantie-Ticket kostet 179 €/, en: /Guarantee Ticket costs 179 €|Garantie-Ticket kostet 179 €/ } },
];

for (const v of VARIANTS) {
  for (const route of PUBLIC) {
    test(`${route.path} v2 copy ${tag(v)}`, async ({ browser }) => {
      test.skip(!ON, "needs the PRICING_V2_ENABLED build");
      const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
      const page = await context.newPage();
      const errors = trackErrors(page);
      await prepare(context, page, v, { signedIn: false });
      const res = await page.goto(`${route.path}?lang=${v.lang}`, { waitUntil: "networkidle" });
      expect(res?.status()).toBe(200);
      await page.waitForTimeout(800);
      const text = await bodyText(page);
      expect(text, route.path).toMatch(route.expectText[v.lang]);
      for (const re of V1) expect(offerText(text), `${route.path} ${re}`).not.toMatch(re);
      if (route.path === "/faq" || route.path === "/terms") expect(text, route.path).not.toMatch(/6-Monats-Tarif \(|6-month plan \(|6-Monats-Tarif kostet|6-month plan costs/);
      if (route.scroll) await page.locator(route.scroll).first().scrollIntoViewIfNeeded().catch(() => {});
      await check(page, v, route.path, errors);
      await context.close();
    });
  }
}

const PUYP_STATUS = (tier: string | null) => ({
  eligible: false,
  reason_code: tier ? "tier_not_eligible" : "no_subscription",
  subscription: tier ? { tier, expires_at: "2027-10-21T00:00:00Z", puyp_extensions_used: 0 } : undefined,
  exam_type: "kenntnispruefung", exam_date: null,
  qbank_completion_pct: 12.5, qbank_answered: 40, qbank_total: 320, meets_completion_gate: false,
});

for (const v of VARIANTS) {
  for (const holder of [null, "guarantee_ticket"] as const) {
    test(`/dashboard/exam-result ${holder ?? "no plan"} ${tag(v)}`, async ({ browser }) => {
      test.skip(!ON, "needs the PRICING_V2_ENABLED build");
      const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
      const page = await context.newPage();
      const errors = trackErrors(page);
      await prepare(context, page, v, { signedIn: true, tier: holder ? "pro" : "free" });
      await page.route("**/api/puyp/status", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PUYP_STATUS(holder)) }));
      const res = await page.goto(`/dashboard/exam-result?lang=${v.lang}`, { waitUntil: "networkidle" });
      expect(res?.status()).toBe(200);
      const de = v.lang === "de";
      await expect(page.getByText(de ? "Prüfungsergebnis" : "Exam result", { exact: true }).first()).toBeVisible();
      if (holder) {
        const link = page.getByRole("link", { name: de ? "Ticket verlängern" : "Renew ticket" });
        await expect(link).toHaveAttribute("href", "/ticket-renewal");
      } else {
        const link = page.getByRole("link", { name: de ? "Garantie-Ticket ansehen" : "See the Guarantee Ticket" });
        await expect(link).toHaveAttribute("href", "/pricing#plan-guarantee-ticket");
      }
      const text = await bodyText(page);
      for (const re of V1) expect(text, `exam-result ${re}`).not.toMatch(re);
      expect(text).not.toMatch(/nur mit der Prüfungs-Kohorte|only available with the Exam Cohort|Pass-Until-You-Pass/);
      await check(page, v, `exam-result-${holder ?? "no-plan"}`, errors);
      await context.close();
    });
  }
}

for (const v of VARIANTS) {
  test(`orientation modal v2 ${tag(v)}`, async ({ browser }) => {
    test.skip(!ON, "needs the PRICING_V2_ENABLED build");
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
    const page = await context.newPage();
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: true, tier: "free" });
    await page.addInitScript(() => { try { localStorage.removeItem("medpruef_orientation_modal_seen_v2"); } catch { /* blocked */ } });
    await page.route("**/api/announcements/state", (r) => r.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify({ state: { userId: "51c5564a-5051-4b9b-8f81-4faf0e368533", sessionCount: 4, qsAnsweredTotal: 40, orientationModalSeenAt: null, cohortBannerDismissedAt: "2026-01-01", referralFloaterDismissedAt: "2026-01-01" } }),
    }));
    await page.goto(`/?lang=${v.lang}`, { waitUntil: "networkidle" });
    const de = v.lang === "de";
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog).toContainText(de ? "Verlängerung auf Nachweis" : "Renewal on proof");
    await expect(dialog).toContainText(de ? "Mit dem Garantie-Ticket verlängern wir Ihren Zugang" : "With the Guarantee Ticket we extend your access");
    const text = (await dialog.innerText()).replace(/\s+/g, " ");
    for (const re of V1) expect(text, `modal ${re}`).not.toMatch(re);
    if (de) expect(text).not.toMatch(/\b(du|dein\w*|dich|dir)\b/i);
    await check(page, v, "orientation-modal", errors);
    await context.close();
  });
}

for (const v of [VARIANTS[0], VARIANTS[VARIANTS.length - 1]]) {
  test(`/pricing#plan-guarantee-ticket scrolls to the Ticket card ${tag(v)}`, async ({ browser }) => {
    test.skip(!ON, "needs the PRICING_V2_ENABLED build");
    const context = await browser.newContext({ viewport: { width: v.width, height: v.height } });
    const page = await context.newPage();
    const errors = trackErrors(page);
    await prepare(context, page, v, { signedIn: false });
    await page.goto(`/pricing?lang=${v.lang}#plan-guarantee-ticket`, { waitUntil: "networkidle" });
    const card = page.locator("#plan-guarantee-ticket");
    await expect(card).toBeVisible();
    await expect.poll(async () => card.evaluate((el) => Math.abs(el.getBoundingClientRect().top) < window.innerHeight / 2)).toBe(true);
    await check(page, v, "pricing-ticket-anchor", errors);
    await context.close();
  });
}
