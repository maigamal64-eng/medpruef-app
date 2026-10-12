import { expect, test } from '@playwright/test';
import { seedSession } from '../fixtures/session';

// Hermetic UI fixtures. Every API request is intercepted; no learner data or
// provider sends/checkouts are used by this suite.
test.beforeEach(async ({ page, baseURL }) => {
  const ownOrigin = new URL(baseURL || 'http://localhost:3000').origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === ownOrigin
    ? route.continue() : route.abort('blockedbyclient'));
});

const user = { id: '00000000-0000-4000-8000-000000000001', first_name: 'Fixture', tier: 'free', role: 'user', tier_expires_at: null };
for (const lang of ['de', 'en'] as const) for (const dark of [false, true]) {
  test(`native picker and auth intent at 320px (${lang}, dark=${dark})`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.addInitScript(({ lang, dark }) => {
      localStorage.clear(); localStorage.setItem('medpruef-lang', lang);
      localStorage.setItem('medpruef_theme', dark ? 'dark' : 'light');
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    }, { lang, dark });
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.goto('/login?mode=register&intent=trial&exam=pharma&next=%2Fquiz%3Ftopic%3DHerz', { waitUntil: 'domcontentloaded' });
    const picker = page.locator('select').first();
    await expect(picker).toHaveValue(lang);
    await expect(page.locator('html')).toHaveAttribute('data-theme', dark ? 'dark' : 'light');
    await expect(picker.locator('option[value=ar]')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: lang === 'de' ? 'Registrieren' : 'Register', exact: true })).toHaveAttribute('aria-selected', 'true');
    const box = await picker.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    await picker.selectOption(lang === 'de' ? 'en' : 'de');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('medpruef_auth_entry')!).exam)).toBe('pharma');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('saved unvalidated Arabic retains preference with English LTR fallback', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('medpruef-lang', 'ar'));
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.goto('/login?reason=expired&next=%2Fquiz', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByText('Your session expired.', { exact: false })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('medpruef-lang'))).toBe('ar');
});

for (const state of ['pending', 'unmatched', 'failed', 'granted'] as const) {
  test(`checkout ${state} has distinct honest copy and exact cents`, async ({ page }) => {
    await seedSession(page, { userId: user.id });
    await page.addInitScript(() => localStorage.setItem('medpruef-lang', 'en'));
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.route('**/api/auth/me?*', route => route.fulfill({ json: { user } }));
    await page.route('**/api/whop/checkout/verify', route => route.fulfill({
      status: state === 'failed' ? 500 : 200,
      json: state === 'granted' ? { granted: true, amount_cents: 1772, payment_ref: 'fixture_reference' } : state === 'unmatched' ? { reason: 'payment_unmatched', payment_ref: 'fixture_reference' } : {},
    }));
    await page.goto('/checkout/success?tier=first_month_19&session=ch_fixture', { waitUntil: 'domcontentloaded' });
    const texts = { pending: 'Payment is being checked. Access is not active yet.', unmatched: 'Payment could not yet be linked to your account.', failed: 'Payment or access could not be checked.', granted: 'Your Pro access is active.' };
    await expect(page.getByText(texts[state], { exact: true })).toBeVisible();
    if (state === 'granted') await expect(page.getByText('17.72 €', { exact: true })).toBeVisible();
    else await expect(page.getByText(texts.granted, { exact: true })).toHaveCount(0);
  });
}

test('study plan 500 shows retry, then confirmed empty rather than an error as data', async ({ page }) => {
  await seedSession(page, { userId: user.id });
  await page.addInitScript(() => localStorage.setItem('medpruef-lang', 'en'));
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/api/auth/me?*', route => route.fulfill({ json: { user } }));
  let attempts = 0;
  await page.route('**/api/user/study-plan', route => route.fulfill(++attempts === 1
    ? { status: 500, json: { error: 'upstream-private-message' } }
    : { json: { plan: null, hasExamDate: false } }));
  await page.goto('/study-plan', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByText('upstream-private-message')).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
});

test('failed flashcard rating retains the card and retries the same rating', async ({ page }) => {
  await seedSession(page, { userId: user.id });
  await page.addInitScript(() => localStorage.setItem('medpruef-lang', 'en'));
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/api/auth/me?*', route => route.fulfill({ json: { user } }));
  const question = { id: 123, topic: 'Innere Medizin', question: 'Synthetic fixture prompt', answer: 'Fixture answer', choices: [], exam_type: 'kenntnispruefung' };
  let cardReads = 0; let ratings = 0;
  await page.route('**/api/questions?*', route => { cardReads++; return route.fulfill({ json: [question] }); });
  await page.route('**/api/answer', route => route.fulfill(++ratings === 1 ? { status: 500, json: {} } : { json: { ok: true } }));
  await page.goto('/flashcards?topic=Innere%20Medizin', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Show Answer', exact: true }).click();
  await page.getByRole('button', { name: /^Good,/ }).click();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  expect(cardReads).toBe(1);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect.poll(() => ratings).toBe(2);
  await expect.poll(() => cardReads).toBe(2);
});

test('an unidentified checkout return offers sign-in without claiming payment is pending', async ({ page }) => {
  await page.addInitScript(() => { localStorage.clear(); localStorage.setItem('medpruef-lang', 'en'); });
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.goto('/checkout/success', { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('This link does not identify a payment.', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in to check access' })).toHaveAttribute('href', /next=%2Fcheckout%2Fsuccess/);
  await expect(page.getByText('Payment is being checked. Access is not active yet.', { exact: true })).toHaveCount(0);
});

for (const lang of ['de', 'en'] as const) for (const path of ['/pricing', '/settings']) {
  test(`ledger cents remain exact on ${path} (${lang})`, async ({ page }) => {
    await seedSession(page, { userId: user.id, tier: 'pro' });
    await page.addInitScript(value => localStorage.setItem('medpruef-lang', value), lang);
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.route('**/api/auth/me?*', route => route.fulfill({ json: { user: { ...user, tier: 'pro', tier_expires_at: '2027-01-01T00:00:00Z' } } }));
    await page.route('**/api/user/subscription', route => route.fulfill({ json: { active: true, renewal_offer_suppressed: true, subscription: { tier: 'first_month_19', amount_cents: 1772, currency: 'EUR', expires_at: '2027-01-01T00:00:00Z', status: 'active' } } }));
    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#your-plan').getByText(lang === 'de' ? '17,72 €' : '17.72 €', { exact: true })).toBeVisible();
  });
}
