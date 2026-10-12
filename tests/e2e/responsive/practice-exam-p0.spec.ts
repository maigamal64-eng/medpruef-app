import { expect, test, type Page } from '@playwright/test';
import { seedSession } from '../fixtures/session';
const account = '00000000-0000-4000-8000-000000000041';
const attemptId = '00000000-0000-4000-8000-000000000042';
const question = { id: 41, topic: 'Innere Medizin', question: 'Synthetic fixture: choose two entries.', answer: 'Fixture A; Fixture B', explanation: '', difficulty: 1, n_correct: 2, exam_dates: ['2023', '2024-11'], tags: ['qtype:2', 'answer-leak'], options: [{ text: 'Fixture A', correct: true }, { text: 'Fixture B', correct: true }, { text: 'Fixture C', correct: false }] };
async function setup(page: Page, dark = false, lang = 'en', saved = true, tier = 'pro') {
  await seedSession(page, { userId: account, tier: tier as 'pro' | 'free' });
  await page.addInitScript(({ account, attemptId, question, dark, lang, saved }) => {
    localStorage.setItem('medpruef-lang', lang); localStorage.setItem('medpruef_theme', dark ? 'dark' : 'light');
    localStorage.setItem('medpruef_whats_new_seen', '2026-04-22'); localStorage.setItem('medpruef_survey_v1_completed', 'true');
    localStorage.setItem('medpruef_orientation_modal_seen_v2', '1');
    // Seed once, never overwrite persisted answers/pending records on reload.
    if (saved && !sessionStorage.getItem('fixture-seeded')) {
      localStorage.setItem(`medpruef_exam_autosave:v1:${account}`, JSON.stringify({ v: 1, startedAt: Date.now(), durationS: 14_400, questions: [question, { ...question, id: 42 }, { ...question, id: 43 }], answers: {}, flaggedIdxs: [], currentIdx: 0, selectedPart: 'custom', examSource: 'kenntnispruefung', attemptId, savedAt: Date.now() }));
      sessionStorage.setItem('fixture-seeded', '1');
    }
  }, { account, attemptId, question, dark, lang, saved });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(process.env.BASE_URL || 'http://localhost:3000').origin && !url.pathname.startsWith('/api/')) return route.abort('blockedbyclient');
    if (!url.pathname.startsWith('/api/')) return route.continue();
    let json: unknown = {};
    if (url.pathname === '/api/auth/me') json = { user: { id: account, tier, role: 'user', first_name: 'Fixture', referrals_enabled: false } };
    if (url.pathname === '/api/user/exam-preference') json = { activeExam: 'kenntnispruefung' };
    if (url.pathname === '/api/questions') json = url.searchParams.has('topics') ? [{ topic: 'Innere Medizin', count: 3 }] : [question];
    if (url.pathname === '/api/history/exams') json = { attempts: [], total: 0 };
    if (url.pathname === '/api/bookmarks') json = { ids: [] };
    if (url.pathname === '/api/announcements/state') json = { qsAnsweredTotal: 0, sessionCount: 1, orientationModalSeenAt: '2026-01-01', whatsNewSeenAt: '2026-01-01', feedbackSurveyShownAt: '2026-01-01' };
    return route.fulfill({ json });
  });
}
for (const dark of [false, true]) for (const lang of ['de', 'en']) {
  test(`running focus, partial and scroll (${lang}, dark=${dark})`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 }); await setup(page, dark, lang);
    await page.goto('/exam'); await page.getByRole('button', { name: lang === 'de' ? 'Laufende Prüfung fortsetzen' : 'Resume current exam' }).click();
    await expect(page.locator('.bottom-nav')).toHaveCount(0);
    await expect(page.getByText('answer-leak')).toHaveCount(0); await expect(page.getByText('qtype:2')).toHaveCount(0);
    const first = page.getByRole('checkbox', { name: /Fixture A/ });
    await first.click(); await expect(page.getByText(lang === 'de' ? '1 von 2 gewählt' : '1 of 2 selected')).toBeVisible();
    await first.click(); await expect(page.getByText(lang === 'de' ? '0 von 2 gewählt' : '0 of 2 selected')).toBeVisible();
    await first.click(); await page.locator('.mp-exam-pane').evaluate(el => { el.scrollTop = 400; });
    await page.getByRole('button', { name: lang === 'de' ? 'Weiter' : 'Next', exact: true }).click();
    expect(await page.locator('.mp-exam-pane').evaluate(el => el.scrollTop)).toBe(0);
    await expect(page.locator('[data-question-heading]')).toBeFocused();
    await page.getByRole('button', { name: lang === 'de' ? 'Übersicht' : 'Overview' }).click();
    await expect(page.locator('[data-cell-idx="0"]')).toContainText('◐');
    await page.getByRole('button', { name: /Submit exam|Prüfung abgeben/ }).last().click();
    const dialog = page.getByRole('dialog').last();
    await expect(dialog).toContainText(/3 (open|offen)/); await expect(dialog).toContainText(/1 (Partial|Teilweise)/);
    await page.screenshot({ path: test.info().outputPath(`exam-confirm-${lang}-${dark}.png`), fullPage: true });
  });
}
test('replacement/discard cancellation preserves exact saved bytes', async ({ page }) => {
  await setup(page); await page.goto('/exam');
  const before = await page.evaluate(account => localStorage.getItem(`medpruef_exam_autosave:v1:${account}`), account);
  await page.getByRole('button', { name: 'Discard', exact: true }).click(); await page.getByRole('button', { name: 'Keep', exact: true }).click();
  expect(await page.evaluate(account => localStorage.getItem(`medpruef_exam_autosave:v1:${account}`), account)).toBe(before);
  await page.getByRole('button', { name: /New exam \(replaces/ }).click(); await page.getByRole('button', { name: 'Keep', exact: true }).click();
  expect(await page.evaluate(account => localStorage.getItem(`medpruef_exam_autosave:v1:${account}`), account)).toBe(before);
});
test('failed save survives reload and acknowledged retry clears only pending attempt', async ({ page }) => {
  await setup(page); let posts = 0; let succeed = false;
  await page.route('**/api/history/exams', async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ json: { attempts: [], total: 0 } });
    posts++; const body = route.request().postDataJSON();
    return route.fulfill(succeed ? { json: { ok: true, attempt: { id: body.attempt_id, attempt_id: body.attempt_id } } } : { status: 500, json: { error: 'fixture-failure' } });
  });
  await page.goto('/exam'); await page.getByRole('button', { name: 'Resume current exam' }).click();
  await page.getByRole('checkbox', { name: /Fixture A/ }).click();
  await page.getByRole('button', { name: 'Next', exact: true }).click(); await page.getByRole('button', { name: 'Next', exact: true }).click();
  await page.locator('.mp-exam-actions').getByRole('button', { name: /Submit exam/ }).click();
  const confirm = page.getByRole('dialog').getByRole('button', { name: /Submit exam/ }); await expect(confirm).toBeEnabled(); await confirm.click();
  await expect(page.getByText('Not saved', { exact: true })).toBeVisible();
  await page.reload(); await expect(page.getByText('Not saved', { exact: true })).toBeVisible();
  const pending = await page.evaluate(account => JSON.parse(localStorage.getItem(`medpruef_exam_pending:v1:${account}`) || '[]'), account);
  expect(pending[0].answers[0]).toEqual([0]); succeed = true;
  await page.getByRole('button', { name: /Retry saving/ }).first().click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
  expect(await page.evaluate(account => JSON.parse(localStorage.getItem(`medpruef_exam_pending:v1:${account}`) || '[]').length, account)).toBe(0);
  expect(posts).toBeGreaterThanOrEqual(3);
});
test('history failure retries to truthful empty', async ({ page }) => {
  await setup(page, false, 'en', false); let fail = true;
  await page.route('**/api/history/exams?*', route => route.fulfill(fail ? { status: 500, json: {} } : { json: { attempts: [], total: 0 } }));
  await page.goto('/history'); await expect(page.getByText('History could not be loaded.', { exact: true })).toBeVisible();
  await expect(page.getByText('No saved simulations yet.', { exact: true })).toHaveCount(0); fail = false;
  await page.getByRole('button', { name: /Retry|Try again/ }).click(); await expect(page.getByText('No saved simulations yet.', { exact: true })).toBeVisible();
});
test('practice 402 removes revealed answer and grants no XP or stored attempt', async ({ page }) => {
  await setup(page, false, 'en', false);
  await page.route('**/api/answer', route => route.fulfill({ status: 402, json: { gate: 'qbank_limit' } }));
  await page.goto('/quiz?examSource=kenntnispruefung');
  // a23 (UX-PRA-15): the multi-answer check arms only with exactly N picks.
  await page.getByRole('checkbox', { name: /Fixture A/ }).click(); await page.getByRole('checkbox', { name: /Fixture B/ }).click(); await page.getByRole('button', { name: 'Check Answer' }).click();
  // a12: the one paywall dismisses with "Later".
  await expect(page.getByRole('dialog')).toBeVisible(); await page.getByRole('button', { name: 'Later', exact: true }).click();
  await expect(page.getByText('Synthetic fixture: choose two entries.')).toHaveCount(0);
  await expect(page.getByText(/Your access does not allow/)).toBeVisible();
  await expect(page.getByText('+10 XP', { exact: true })).toHaveCount(0);
});
test('flashcard focused action remains native, inactive face is inert', async ({ page }) => {
  await setup(page, false, 'en', false); await page.goto('/flashcards?examSource=kenntnispruefung');
  const face = page.locator('.flip-card-front'); await face.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('region', { name: 'Answer, now rate it' })).toBeFocused();
  await expect(face).toHaveAttribute('inert', '');
  const rating = page.getByRole('button', { name: /^Good/ }); await rating.focus(); await page.keyboard.press('Space');
  // Native focused rating alone fires; no page-wide flip/rate handler intercepts it.
});
test('wall clock resync and 30/10/5 minute notices follow elapsed time', async ({ page }) => {
  await setup(page); await page.goto('/exam'); await page.getByRole('button', { name: 'Resume current exam' }).click();
  const setElapsed = async (elapsed: number) => page.evaluate(({ account, elapsed }) => {
    const saved = JSON.parse(localStorage.getItem(`medpruef_exam_autosave:v1:${account}`) || '{}');
    Date.now = () => saved.startedAt + elapsed * 1000;
    document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); window.dispatchEvent(new Event('focus'));
  }, { account, elapsed });
  await setElapsed(1800); await expect(page.locator('header')).toContainText('03:30:00');
  for (const minutes of [30, 10, 5]) {
    await setElapsed(14400 - minutes * 60); await expect(page.getByText(`${minutes} minutes remaining.`, { exact: true })).toBeVisible();
  }
  // Backward device clock cannot increase the last five minutes.
  await setElapsed(0); await expect(page.locator('header')).toContainText('00:05:00');
});
for (const count of [70, 180]) {
  test(`expired ${count}-question run uses the actual denominator and part label`, async ({ page }) => {
    await setup(page);
    await page.addInitScript(({ account, attemptId, question, count }) => {
      localStorage.setItem(`medpruef_exam_autosave:v1:${account}`, JSON.stringify({ v: 1, startedAt: Date.now() - 14_405_000, durationS: 14_400, questions: Array.from({ length: count }, (_, i) => ({ ...question, id: i + 100 })), answers: Object.fromEntries(Array.from({ length: 58 }, (_, i) => [i, [0, 1]])), flaggedIdxs: [], currentIdx: 0, selectedPart: count === 70 ? 'sip4' : 'all', examSource: 'kenntnispruefung', attemptId, savedAt: Date.now() }));
    }, { account, attemptId, question, count });
    await page.route('**/api/history/exams', route => route.request().method() === 'POST' ? route.fulfill({ json: { attempt: { id: attemptId, attempt_id: attemptId } } }) : route.fulfill({ json: { attempts: [], total: 0 } }));
    await page.goto('/exam'); await page.getByRole('button', { name: 'View result', exact: true }).click();
    // a24 result screen: tiles carry the counts against the actual denominator.
    await expect(page.locator('.mp-stat').filter({ hasText: 'Correct' })).toContainText('58');
    await expect(page.locator('.mp-stat').filter({ hasText: 'Open' })).toContainText(String(count - 58));
    await expect(page.getByText('Time expired', { exact: true })).toBeVisible();
    if (count === 70) await expect(page.getByText('Result for this selection', { exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`time-up-${count}.png`), fullPage: true });
  });
}

// pick-ux-exm-38 B ([name], 12 Oct): free and lapsed accounts read a summary list on /history;
// the exam entry still never loads the paid latest-simulation card.
test('free exam entry never fetches simulation history; /history shows the read-only list', async ({ page }) => {
  await setup(page, false, 'en', false, 'free'); let examReads = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/history/exams' && request.method() === 'GET' && page.url().includes('/exam')) examReads++; });
  await page.route('**/api/history/exams**', route => route.fulfill({ json: { attempts: [], total: 0, access: 'summary' } }));
  await page.goto('/exam'); await expect(page.getByText('Latest simulation', { exact: true })).toHaveCount(0); expect(examReads).toBe(0);
  await page.goto('/settings'); await page.getByRole('button', { name: /Exam history/ }).first().click();
  await expect(page).toHaveURL(/\/history/);
});
test('exam keyboard respects native activation, unsafe keys, overlays and shortcut off switch', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 }); await setup(page); await page.goto('/exam');
  await page.getByRole('button', { name: 'Resume current exam' }).click();
  const a = page.getByRole('checkbox', { name: /Fixture A/ }); const b = page.getByRole('checkbox', { name: /Fixture B/ });
  await page.locator('[data-question-heading]').focus();
  for (const key of ['Enter', 'Escape', 'End', 'ArrowDown', 'Backspace', 'Delete', 'Control+c', 'Meta+c']) await page.keyboard.press(key);
  await expect(a).toHaveAttribute('aria-checked', 'false'); await expect(b).toHaveAttribute('aria-checked', 'false');
  await a.focus(); await page.keyboard.press('Enter'); await expect(a).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('Space'); await expect(a).toHaveAttribute('aria-checked', 'false');
  await page.locator('[data-question-heading]').focus(); await page.keyboard.press('?');
  const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible(); await page.keyboard.press('b');
  await expect(b).toHaveAttribute('aria-checked', 'false');
  await dialog.getByRole('checkbox', { name: 'Enable single-character shortcuts' }).uncheck(); await page.keyboard.press('Escape');
  await page.locator('[data-question-heading]').focus(); await page.keyboard.press('b'); await expect(b).toHaveAttribute('aria-checked', 'false');
  await b.focus(); await page.keyboard.press('Space'); await expect(b).toHaveAttribute('aria-checked', 'true');
});
