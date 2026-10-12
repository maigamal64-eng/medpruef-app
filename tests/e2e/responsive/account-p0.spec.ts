import { expect, test } from '@playwright/test';
import { seedSession } from '../fixtures/session';
const id = '00000000-0000-4000-8000-000000000005';
const user = { id, tier: 'free', role: 'user', first_name: 'Fixture', daily_goal: 20 };
test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL || 'http://localhost:3000').origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/api/auth/me?*', route => route.fulfill({ json: { user } }));
  await page.route('**/api/whop/checkout/status', route => route.fulfill({ json: { pending: null } }));
  await seedSession(page, { userId: id, email: 'fixture@example.test' });
});
for (const lang of ['de', 'en'] as const) for (const dark of [false, true]) test(`non-granted checkout has one warning and no FAB overlap (${lang}, dark=${dark})`, async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.addInitScript(({ lang, dark }) => { localStorage.setItem('medpruef-lang', lang); localStorage.setItem('medpruef_theme', dark ? 'dark' : 'light'); }, { lang, dark });
  await page.route('**/api/whop/checkout/verify', route => route.fulfill({ json: { granted: false, reason: 'payment_unmatched', payment_ref: null } }));
  await page.goto('/checkout/success?tier=first_month_19&session=ch_fixture');
  await expect(page.getByText(lang === 'de' ? 'Bitte bezahle nicht noch einmal.' : 'Please do not pay again.', { exact: false })).toHaveCount(1);
  await expect(page.getByText(lang === 'de' ? 'Wir haben deine Zahlung gesehen' : 'We found your payment', { exact: false })).toHaveCount(0);
  const cta = page.getByRole('link', { name: lang === 'de' ? 'Weiterlernen' : 'Continue studying', exact: true });
  await expect(cta).toBeVisible();
  await expect(page.locator('button').filter({ has: page.locator('svg.lucide-message-square-plus') })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('manual, visibility and bfcache return share guard and fifteen minute ceiling', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('medpruef-lang', 'en'));
  await page.clock.install(); let count = 0;
  await page.route('**/api/whop/checkout/verify', route => { count++; return route.fulfill({ json: { granted: false, reason: 'payment_not_found' } }); });
  await page.goto('/checkout/success?tier=first_month_19'); await expect.poll(() => count).toBe(1);
  await page.evaluate(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); document.dispatchEvent(new Event('visibilitychange')); });
  await page.getByRole('button', { name: 'Check access', exact: true }).click({ force: true }); expect(count).toBe(1);
  await page.clock.fastForward(900_000); const after = count;
  await expect(page.getByText('Automatic checks have ended.', { exact: false })).toBeVisible();
  await page.clock.fastForward(120_000); expect(count).toBe(after);
});
test('other feedback keeps text on failure and thanks only after retry accepted', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('medpruef-lang', 'en'));
  await page.route('**/api/checkout-feedback/eligibility', route => route.fulfill({ json: { eligible: true } }));
  let posts = 0; let payload: unknown;
  await page.route('**/api/checkout-feedback', route => { posts++; payload = route.request().postDataJSON(); return route.fulfill({ status: posts === 1 ? 500 : 200, json: { ok: posts > 1 } }); });
  await page.goto('/pricing');
  await page.getByRole('button', { name: 'Other', exact: true }).click();
  const input = page.getByPlaceholder('Want to tell us a bit more? (optional)');
  await input.fill('Card page did not work'); await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Not sent' })).toBeVisible(); await expect(input).toHaveValue('Card page did not work');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  expect(posts).toBe(2); expect(payload).toMatchObject({ reason: 'other', details: 'Card page did not work' });
});
