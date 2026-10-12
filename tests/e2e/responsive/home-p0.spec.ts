import { expect, test, type Page } from '@playwright/test';
import { seedSession } from '../fixtures/session';

// All API/provider traffic is intercepted. These are synthetic UI fixtures,
// not production/auth/provider acceptance. COMMON requires track-A to run them.
const userId = '00000000-0000-4000-8000-000000000003';
async function setup(page: Page, bank = 'pharma', language = 'en', dark = false) {
  await seedSession(page, { userId, tier: 'pro' });
  await page.addInitScript(({ bank, language, dark }) => {
    localStorage.setItem('medpruef_exam_source', bank);
    localStorage.setItem('medpruef-lang', language);
    localStorage.setItem('medpruef_theme', dark ? 'dark' : 'light');
    localStorage.setItem('medpruef_whats_new_seen', '2026-04-22');
    localStorage.setItem('medpruef_survey_v1_completed', 'true');
    localStorage.setItem('medpruef_orientation_modal_seen_v2', '1');
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, { bank, language, dark });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(process.env.BASE_URL || 'http://localhost:3000').origin && !url.pathname.startsWith('/api/')) {
      return route.abort('blockedbyclient');
    }
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let json: unknown = {};
    if (url.pathname === '/api/auth/me') json = { user: { id: userId, first_name: 'Fixture', tier: 'pro', role: 'user', referrals_enabled: false } };
    if (url.pathname === '/api/user/exam-preference') json = { activeExam: bank };
    if (url.pathname === '/api/whop/trial') json = { eligible: false, trial_enabled: false };
    if (url.pathname === '/api/checkout-feedback/eligibility') json = { eligible: false };
    if (url.pathname === '/api/user/last-session') json = { hasSession: false };
    if (url.pathname === '/api/announcements/state') json = { qsAnsweredTotal: 0, sessionCount: 1, orientationModalSeenAt: '2026-01-01', whatsNewSeenAt: '2026-01-01', feedbackSurveyShownAt: '2026-01-01' };
    if (url.pathname === '/api/questions') json = [{ topic: 'Pharmakologie', count: 40 }];
    if (url.pathname === '/api/user/topic-progress') json = [{ topic: 'Pharmakologie', total: 40, answered: 20, correct: 19, wrong: 1, accuracy: 95 }];
    return route.fulfill({ json });
  });
}

for (const lang of ['de', 'en']) for (const dark of [false, true]) {
  test(`Home topic failure stays signed in, retry succeeds (${lang}, dark=${dark})`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 812 }); await setup(page, 'pharma', lang, dark);
    let attempts = 0;
    await page.route('**/api/questions', route => route.fulfill(++attempts === 1
      ? { status: 503, json: { error: 'private-upstream-message' } }
      : { json: [{ topic: 'Pharmakologie', count: 40 }] }));
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const error = page.getByText(lang === 'de' ? 'Fachgebiete konnten nicht geladen werden.' : 'Topics could not be loaded.', { exact: true });
    await expect(error).toBeVisible(); await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText('private-upstream-message')).toHaveCount(0);
    const progress = page.getByRole('progressbar'); await expect(progress).not.toHaveAttribute('aria-valuenow', '0');
    await error.locator('..').getByRole('button', { name: lang === 'de' ? 'Erneut versuchen' : 'Try again' }).click();
    await expect(error).toHaveCount(0); await expect(progress).toHaveAttribute('aria-valuenow', '50');
    await expect(page.getByRole('link', { name: /Pharmakologie, 40/ })).toContainText(/95\u202F?%/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`home-${lang}-${dark ? 'dark' : 'light'}.png`), fullPage: true });
  });
}

for (const kind of ['malformed', 'offline', 'timeout']) {
  test(`Home ${kind} topics never redirects to marketing`, async ({ page }) => {
    await setup(page);
    await page.route('**/api/questions', route => kind === 'malformed' ? route.fulfill({ json: { error: 'wrong-shape' } })
      : kind === 'offline' ? route.abort('internetdisconnected') : new Promise<void>(() => {}));
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Topics could not be loaded.', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('link', { name: 'Study now', exact: true })).toBeVisible();
  });
}

for (const language of ['ru', 'uk', 'tr', 'ar']) {
  test(`saved ${language} Home preference retains bank/session with English LTR fallback`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 }); await setup(page, 'pharma', language);
    let languageWrites = 0;
    page.on('request', req => { if (req.url().includes('/api/user/language') && req.method() === 'PATCH') languageWrites++; });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('lang', 'en'); await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    const select = page.locator('select').first(); await expect(select).toHaveValue(language);
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
    expect(languageWrites).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem('medpruef-lang'))).toBe(language);
    expect(await page.evaluate(() => localStorage.getItem('medpruef_exam_source'))).toBe('pharma');
    expect(await page.evaluate(() => localStorage.getItem('medpruef_session_token'))).toBe('local-test-session-token');
    await page.screenshot({ path: test.info().outputPath(`home-fallback-${language}.png`), fullPage: true });
  });
}

for (const bank of ['kenntnispruefung', 'kmp_innsbruck', 'pharma']) {
  test(`${bank}: full progress map renders strong and zero-answer topics`, async ({ page }) => {
    await setup(page, bank);
    const topic = bank === 'kenntnispruefung' ? 'Innere Medizin' : 'Pharmakologie';
    await page.route('**/api/questions', route => route.fulfill({ json: [{ topic, count: 40 }] }));
    await page.route('**/api/user/topic-progress?*', route => route.fulfill({ json: [{ topic, total: 40, answered: 20, correct: 19, wrong: 1, accuracy: 95 }] }));
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const card = page.getByRole('link', { name: new RegExp(`${topic}, 40`) });
    await expect(card).toContainText('95%'); await expect(card).toContainText('20/40');
    if (bank !== 'kenntnispruefung') await expect(page.getByRole('link', { name: 'Simulate an exam' })).toHaveAttribute('href', `/exam?examSource=${bank}`);
    await page.route('**/api/user/topic-progress?*', route => route.fulfill({ json: [{ topic, total: 40, answered: 0, correct: 0, wrong: 0, accuracy: 0 }] }));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0'); await expect(card).not.toContainText('95%');
  });
}

test('progress retry replaces unknown metrics without navigation', async ({ page }) => {
  await setup(page); await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  // A failed reload has no cached in-memory metrics and must stay unknown.
  await page.route('**/api/user/topic-progress?*', route => route.fulfill({ status: 503, json: {} }));
  await page.reload({ waitUntil: 'domcontentloaded' });
  const retry = page.getByRole('group', { name: 'Your exam progress' }).getByRole('button', { name: 'Try again' });
  await expect(retry).toBeVisible(); await expect(page.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  await page.route('**/api/user/topic-progress?*', route => route.fulfill({ json: [{ topic: 'Pharmakologie', total: 40, answered: 20, correct: 19, wrong: 1, accuracy: 95 }] }));
  await retry.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  await expect(page).toHaveURL(/\/$/);
});

for (const status of [503, 401]) {
  test(`Mini App refresh ${status} keeps cached session only for network/server degradation`, async ({ page }) => {
    await setup(page);
    await page.addInitScript(() => {
      window.Telegram = { WebApp: { initData: 'synthetic-mini-app-fixture', initDataUnsafe: {}, ready() {}, expand() {}, setHeaderColor() {}, setBackgroundColor() {}, themeParams: {} } };
    });
    await page.route('**/api/auth', route => route.fulfill({ status, json: { error: 'fixture' } }));
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    if (status === 503) {
      await expect(page.getByRole('link', { name: 'Study now', exact: true })).toBeVisible();
      expect(await page.evaluate(() => localStorage.getItem('medpruef_session_token'))).toBe('local-test-session-token');
    } else {
      await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
      expect(await page.evaluate(() => localStorage.getItem('medpruef_session_token'))).toBeNull();
    }
    await expect(page).toHaveURL(/\/$/);
  });
}

test('Settings native language row reaches all saved options at 320 px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 812 }); await setup(page);
  await page.goto('/settings', { waitUntil: 'domcontentloaded' });
  const picker = page.getByRole('combobox', { name: /^App language/ });
  await expect(picker).toBeVisible();
  for (const value of ['de', 'en', 'ru', 'uk', 'tr', 'ar']) await expect(picker.locator(`option[value=${value}]`)).toHaveCount(1);
  await picker.focus(); await page.keyboard.press('ArrowDown');
  await picker.selectOption('ar');
  await expect(picker).toHaveValue('ar'); await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  expect(await page.evaluate(() => localStorage.getItem('medpruef-lang'))).toBe('ar');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const answers of [4, 5]) {
  test(`trial announcement queue hides under five answers and shows known cents (${answers} answers)`, async ({ page }) => {
    await setup(page);
    await page.route('**/api/auth/me?*', route => route.fulfill({ json: { user: { id: userId, first_name: 'Fixture', tier: 'free', role: 'user', referrals_enabled: false } } }));
    await page.route('**/api/announcements/state', route => route.fulfill({ json: { state: { userId, sessionCount: 2, qsAnsweredTotal: answers, orientationModalSeenAt: '2026-10-01', cohortBannerDismissedAt: '2026-10-01', referralFloaterDismissedAt: '2026-10-01', lastSessionAt: '2026-10-01' } } }));
    await page.route('**/api/whop/trial', route => route.fulfill({ json: { eligible: true, trial_enabled: true, is_pro: false, already_trialed: false, trial_days: 7, price_after_cents: 1772, currency: 'EUR' } }));
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const card = page.getByRole('region', { name: 'Pro trial announcement' });
    if (answers < 5) await expect(card).toHaveCount(0);
    else {
      await expect(card).toContainText('17.72 €');
      await expect(card).not.toContainText('cancel');
      await expect(card.getByRole('button', { name: 'View trial terms' })).toBeVisible();
      const stat = await page.getByText('Answers today', { exact: true }).boundingBox();
      expect((await card.boundingBox())!.y).toBeGreaterThan(stat!.y + stat!.height);
    }
  });
}
