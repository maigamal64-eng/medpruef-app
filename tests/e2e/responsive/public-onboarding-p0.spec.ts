import { expect, test } from '@playwright/test';
import { seedSession } from '../fixtures/session';

// The service worker's first-install takeover reloads the page once and drops typed values.
test.use({ serviceWorkers: 'block' });
const user = { id: '00000000-0000-4000-8000-000000000001', first_name: 'Fixture', tier: 'free', role: 'user', daily_goal: 20 };
test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL || 'http://localhost:3000').origin;
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/api/auth/me?*', route => route.fulfill({ json: { user } }));
  await page.route('**/api/trial/status', route => route.fulfill({ json: { enabled: true, trial_days: 7, price_after_cents: 1772, currency: 'EUR' } }));
});

for (const method of ['email', 'telegram'] as const) test(`empty-storage ${method} registration retains the bank and free intent`, async ({ page }) => {
  let selected: unknown;
  await page.route('**/api/user/exam-preference', async route => { selected = route.request().postDataJSON(); await route.fulfill({ json: { ok: true } }); });
  await page.route('**/api/auth', route => route.fulfill({ json: { user, sessionToken: 'fixture-signed-session' } }));
  await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('medpruef-lang', 'en'); });
  await page.goto('/login?mode=register&intent=free&exam=pharma&next=%2Fquiz%3FexamSource%3Dpharma%26practiceMode%3Dunseen', { waitUntil: 'domcontentloaded' });
  // a22 (UX-ONB-15): two pressed buttons over one form, no tab roles.
  await expect(page.getByRole('button', { name: 'Register', exact: true })).toHaveAttribute('aria-pressed', 'true');
  if (method === 'email') {
    await page.getByLabel('First name', { exact: true }).fill('Fixture');
    await page.getByLabel('Email', { exact: true }).fill('fixture@example.test');
    await page.getByLabel('Password', { exact: true }).fill('Fixture-password-123');
    await page.getByRole('button', { name: 'Create account', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'I have a Telegram code', exact: true }).click();
    await page.getByLabel('Telegram code', { exact: true }).fill('00000000-0000-4000-8000-000000000002');
    await page.getByRole('button', { name: 'Redeem code & sign in', exact: true }).click();
  }
  await expect(page).toHaveURL(/\/quiz\?examSource=pharma&practiceMode=unseen/);
  expect(selected).toEqual({ activeExam: 'pharma' });
});

for (const lang of ['de', 'en'] as const) for (const dark of [false, true]) test(`registration fold, contact and no overflow (${lang}, dark=${dark})`, async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.addInitScript(({ lang, dark }) => { localStorage.setItem('medpruef-lang', lang); localStorage.setItem('medpruef_theme', dark ? 'dark' : 'light'); }, { lang, dark });
  await page.goto('/login?intent=free&exam=pharma', { waitUntil: 'domcontentloaded' });
  const first = page.getByLabel(lang === 'de' ? 'Vorname' : 'First name', { exact: true });
  await expect(first).toBeVisible();
  expect((await first.boundingBox())!.y + (await first.boundingBox())!.height).toBeLessThan(667);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  const contact = page.getByRole('link', { name: lang === 'de' ? 'Probleme beim Anmelden? Schreib uns' : 'Trouble signing in? Contact us' });
  await contact.scrollIntoViewIfNeeded();
  await contact.focus(); await expect(contact).toBeFocused();
  await expect(contact).toHaveAttribute('href', 'mailto:user-b7e46e80@example.com');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('trial resume focuses its deliberate button with no automatic checkout', async ({ page }) => {
  await seedSession(page, { userId: user.id });
  await page.addInitScript(() => localStorage.setItem('medpruef-lang', 'en'));
  let posts = 0;
  await page.route('**/api/whop/trial', route => { if (route.request().method() === 'POST') posts++; return route.fulfill({ json: { eligible: true, trial_enabled: true, trial_days: 7, price_after_cents: 1772, currency: 'EUR' } }); });
  await page.goto('/pricing?action=trial&exam=pharma', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Try Pro for 7 days', exact: true })).toBeFocused();
  await expect(page.getByText('17.72 €', { exact: false }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Continue without a card', exact: true })).toHaveAttribute('href', '/quiz?examSource=pharma&practiceMode=unseen');
  expect(posts).toBe(0);
});

test('disabled trial returns to the chosen bank without posting checkout', async ({ page }) => {
  await seedSession(page, { userId: user.id });
  let posts = 0;
  await page.route('**/api/whop/trial', route => { if (route.request().method() === 'POST') posts++; return route.fulfill({ json: { eligible: false, trial_enabled: false } }); });
  await page.goto('/pricing?action=trial&exam=kmp_innsbruck', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/quiz\?examSource=kmp_innsbruck&practiceMode=unseen/);
  expect(posts).toBe(0);
});

test('verify link language renders English without replacing a saved Arabic preference', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('medpruef-lang', 'ar'));
  await page.route('**/api/user/link-email/verify', route => route.fulfill({ json: { ok: true } }));
  await page.goto('/verify-email?token=fixture-token&lang=en', { waitUntil: 'domcontentloaded' });
  // UX-ONB-40: nothing is consumed on load; the learner confirms with a POST.
  await page.getByRole('button', { name: 'Confirm email' }).click();
  await expect(page.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();
  expect(page.url()).not.toContain('fixture-token');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  expect(await page.evaluate(() => localStorage.getItem('medpruef-lang'))).toBe('ar');
});

for (const closed of [false, true]) test(`Pharma official card ages at the noon cutoff (closed=${closed})`, async ({ page }) => {
  await page.clock.setFixedTime(new Date(closed ? '2026-10-20T10:00:00Z' : '2026-10-11T12:00:00Z'));
  await page.addInitScript(() => localStorage.setItem('medpruef-lang', 'de'));
  await page.goto('/pharmakologie-pruefung-wien', { waitUntil: 'domcontentloaded' });
  const card = page.getByRole('region', { name: 'Rezeptierkunde und Gerichtsmedizin' });
  await expect(card).toContainText(closed ? 'Anmeldung geschlossen' : '20. Oktober 2026, 12:00');
  if (closed) await expect(card).toContainText('18. Januar 2027');
  await expect(page.locator('body')).not.toContainText('NOTES.md');
  await expect(page.locator('body')).not.toContainText('kein Fixtermin');
});
