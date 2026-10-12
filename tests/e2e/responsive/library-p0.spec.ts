import { expect, test, type Page } from '@playwright/test';
import { seedSession } from '../fixtures/session';

// Synthetic, intercepted learner fixtures. track-A runs Chromium per COMMON.
const userId = '00000000-0000-4000-8000-000000000003';
const fixtureNote = (i: number) => ({ id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`, source_type: 'manual', title: `Fixture note ${i}`, content: { blocks: [{ type: 'concept', front: `Fixture prompt ${i}`, back: `Fixture answer ${i}` }], refs: [{ label: 'Synthetic source' }] }, source_ref: { question_excerpt: 'Synthetic source excerpt' }, tags: [], exam_type: 'pharma', topic: null, visibility: 'private', is_active: true, created_at: '2026-10-01', updated_at: '2026-10-01' });
async function setup(page: Page, lang = 'en', dark = false) {
  await seedSession(page, { userId, tier: 'pro' });
  await page.addInitScript(({ lang, dark, userId }) => {
    localStorage.setItem('medpruef-lang', lang); localStorage.setItem('medpruef_theme', dark ? 'dark' : 'light');
    localStorage.setItem(`medpruef_notes_account_migrated_${encodeURIComponent(userId)}`, '1');
    localStorage.setItem('medpruef_whats_new_seen', '2026-04-22'); localStorage.setItem('medpruef_survey_v1_completed', 'true');
  }, { lang, dark, userId });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    const origin = new URL(process.env.BASE_URL || 'http://localhost:3000').origin;
    if (url.origin !== origin) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let json: unknown = {};
    if (url.pathname === '/api/auth/me') json = { user: { id: userId, first_name: 'Fixture', tier: 'pro', role: 'user' } };
    if (url.pathname === '/api/user/exam-preference') json = { activeExam: 'pharma' };
    if (url.pathname === '/api/whop/trial') json = { eligible: false, trial_enabled: false };
    if (url.pathname === '/api/announcements/state') json = { qsAnsweredTotal: 0, sessionCount: 1, orientationModalSeenAt: '2026-01-01', whatsNewSeenAt: '2026-01-01', feedbackSurveyShownAt: '2026-01-01' };
    if (url.pathname === '/api/notes') json = { notes: url.searchParams.get('due') === 'true' ? [fixtureNote(1), fixtureNote(2)] : [fixtureNote(1), fixtureNote(2)], count: 2, offset: 0 };
    if (url.pathname === '/api/notes/explore') json = { enabled: false };
    if (url.pathname === '/api/notes/collections') json = { collections: [{ id: 'fixture-list', name: 'Fixture list', item_count: 0, is_default: true }] };
    if (url.pathname.endsWith('/save')) json = { collection_ids: [] };
    if (url.pathname.endsWith('/review')) json = { ok: true, next_review_at: '2026-10-12T12:00:00.000Z', interval_days: 1 };
    return route.fulfill({ json });
  });
}
for (const lang of ['de', 'en']) for (const dark of [false, true]) {
  test(`normal card reads; practice is deliberate; hint persists (${lang}, dark=${dark})`, async ({ page }) => {
    await page.setViewportSize({ width: 343, height: 812 }); await setup(page, lang, dark);
    let reviews = 0;
    page.on('request', req => { if (req.url().endsWith('/review') && req.method() === 'POST') reviews++; });
    await page.goto('/library', { waitUntil: 'domcontentloaded' });
    const hint = page.getByText(lang === 'de' ? 'Zum Wiederholen wähle Üben. Fällige Karten öffnen direkt die Wiederholung.' : 'Choose Practice to review. Due cards open review directly.', { exact: true });
    await expect(hint).toBeVisible();
    await page.getByRole('button', { name: lang === 'de' ? 'Hinweis schließen' : 'Dismiss hint' }).click();
    await page.reload({ waitUntil: 'domcontentloaded' }); await expect(hint).toHaveCount(0);
    const opener = page.getByRole('button', { name: /Fixture note 1/ }); await opener.click();
    const dialog = page.getByRole('dialog'); await expect(dialog.getByText('Fixture answer 1', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Synthetic source excerpt')).toBeVisible();
    await expect(dialog.getByRole('button', { name: lang === 'de' ? 'Gut' : 'Good', exact: true })).toHaveCount(0);
    expect(reviews).toBe(0);
    const practice = dialog.getByRole('button', { name: lang === 'de' ? 'Üben' : 'Practice', exact: true });
    await practice.focus(); await page.keyboard.press('Enter');
    const reveal = dialog.getByRole('button', { name: lang === 'de' ? 'Aufdecken' : 'Reveal', exact: true });
    await expect(reveal).toBeVisible(); await expect(dialog.getByText('Fixture answer 1', { exact: true })).toHaveCount(0);
    await reveal.focus(); await page.keyboard.press('Space'); await expect(dialog.getByText('Fixture answer 1', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: lang === 'de' ? 'Vorherige' : 'Previous', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: lang === 'de' ? 'Nächste' : 'Next', exact: true })).toBeVisible();
    expect(reviews).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`library-revealed-${lang}-${dark ? 'dark' : 'light'}.png`), fullPage: true });
    await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
  });
}

test('due activation opens review, skip and navigation record nothing, inputs retain native keys and focus trap', async ({ page }) => {
  await setup(page); let reviews = 0;
  page.on('request', req => { if (req.url().endsWith('/review') && req.method() === 'POST') reviews++; });
  await page.goto('/library', { waitUntil: 'domcontentloaded' });
  const due = page.getByRole('button', { name: /Notes due today/ }); await due.click();
  const dialog = page.getByRole('dialog'); await expect(dialog.getByRole('button', { name: 'Reveal', exact: true })).toBeVisible();
  await expect(dialog.getByText('Fixture answer 1', { exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Reveal', exact: true }).click();
  const add = dialog.getByRole('button', { name: 'Add to list', exact: true }); await add.focus(); await page.keyboard.press('Enter');
  const input = dialog.getByPlaceholder('New list…'); await input.fill('Draft name'); await input.press('Space');
  await expect(input).toHaveValue('Draft name '); await expect(dialog.getByText('Fixture answer 1', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Reveal', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Skip', exact: true }).click(); await expect(dialog).toHaveCount(0); await expect(due).toBeFocused(); expect(reviews).toBe(0);
  await due.click(); const close = dialog.getByRole('button', { name: 'Close', exact: true }); await close.focus(); await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
  await page.keyboard.press('Escape'); await expect(due).toBeFocused();
});

test('slow rating locks duplicate taps; failed save keeps revealed note and permits retry', async ({ page }) => {
  await setup(page); let writes = 0;
  await page.route('**/api/notes/*/review', async route => {
    writes++; await new Promise(resolve => setTimeout(resolve, 200));
    return route.fulfill(writes === 1 ? { status: 503, json: {} } : { json: { ok: true, interval_days: 1, next_review_at: '2026-10-12T12:00:00.000Z' } });
  });
  await page.goto('/library', { waitUntil: 'domcontentloaded' }); await page.getByRole('button', { name: /Notes due today/ }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: 'Reveal', exact: true }).click();
  const good = dialog.getByRole('button', { name: 'Good', exact: true }); await good.click();
  await expect(good).toBeDisabled(); await page.keyboard.press('Enter'); await page.keyboard.press('Space');
  await expect(dialog.getByText('Rating not saved. Try again.')).toBeVisible(); expect(writes).toBe(1);
  await expect(dialog.getByText('Fixture answer 1', { exact: true })).toBeVisible();
  await good.click(); await expect(dialog.getByRole('status')).toContainText('Next review:'); expect(writes).toBe(2);
});

for (const kind of ['server', 'malformed', 'offline']) test(`library ${kind} failure is not empty and retry recovers`, async ({ page }) => {
  await setup(page); let attempts = 0;
  await page.route('**/api/notes?*', route => {
    if (new URL(route.request().url()).searchParams.has('due')) return route.fulfill({ json: { notes: [], count: 0, offset: 0 } });
    attempts++;
    if (attempts > 1) return route.fulfill({ json: { notes: [fixtureNote(1)], count: 1, offset: 0 } });
    return kind === 'offline' ? route.abort('internetdisconnected') : route.fulfill(kind === 'server' ? { status: 500, json: {} } : { json: { notes: [null], count: 1, offset: 0 } });
  });
  await page.goto('/library', { waitUntil: 'domcontentloaded' }); await expect(page.getByText('Could not load your library', { exact: true })).toBeVisible();
  await expect(page.getByText('No notes yet', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again', exact: true }).click(); await expect(page.getByRole('button', { name: /Fixture note 1/ })).toBeVisible();
  await expect(page.getByText('Could not load your library', { exact: true })).toHaveCount(0); await expect(page).toHaveURL(/\/library$/);
});

test('paging beyond 200 keeps previous notes during failed append and retry', async ({ page }) => {
  await setup(page); let appends = 0;
  await page.route('**/api/notes?*', route => {
    const params = new URL(route.request().url()).searchParams;
    if (params.has('due')) return route.fulfill({ json: { notes: [], count: 0, offset: 0 } });
    const offset = Number(params.get('offset'));
    if (offset && ++appends === 1) return route.fulfill({ status: 500, json: {} });
    return route.fulfill({ json: { notes: offset ? [fixtureNote(201)] : Array.from({ length: 200 }, (_, i) => fixtureNote(i + 1)), count: 201, offset } });
  });
  await page.goto('/library', { waitUntil: 'domcontentloaded' }); await page.getByRole('button', { name: 'Load more', exact: true }).click();
  await expect(page.getByText('Could not load your library', { exact: true })).toBeVisible(); await expect(page.getByRole('button', { name: /Fixture note 1 / })).toBeVisible();
  await page.getByRole('button', { name: 'Try again', exact: true }).click(); await expect(page.getByRole('button', { name: /Fixture note 201/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0);
});
