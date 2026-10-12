import { expect, test, type Page } from '@playwright/test';
import { seedSession } from '../fixtures/session';

const userId = '00000000-0000-4000-8000-000000000016';
const rolling = { plan: null, hasExamDate: false, dailyGoal: 20, activeExam: 'pharma', rollingPlan: { newQuestions: 20, dueReviews: 4, topics: [{ topic: 'Pharmakologie', targetCount: 20 }] } };
const stats = { gamification: { total_xp: 100, current_streak: 2, longest_streak: 3, total_questions_answered: 40, total_correct: 30, level: 2, rank_name: 'Famulant' }, topicStats: {} };
async function setup(page: Page, lang = 'en', dark = false) {
  await seedSession(page, { userId, tier: 'pro' });
  await page.addInitScript(({ lang, dark }) => {
    localStorage.setItem('medpruef-lang', lang);
    localStorage.setItem('medpruef_theme', dark ? 'dark' : 'light');
    localStorage.setItem('medpruef_whats_new_seen', '2026-04-22');
    localStorage.setItem('medpruef_survey_v1_completed', 'true');
    localStorage.setItem('medpruef_orientation_modal_seen_v2', '1');
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, { lang, dark });
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    let json: unknown = {};
    if (path === '/api/auth/me') json = { user: { id: userId, first_name: 'Fixture', tier: 'pro', role: 'user' } };
    if (path === '/api/user/study-plan') json = rolling;
    if (path === '/api/stats') json = stats;
    if (path === '/api/puyp/status') json = { eligible: true, exam_type: 'pharma', exam_date: '2026-10-01', qbank_completion_pct: 80, qbank_answered: 80, qbank_total: 100, meets_completion_gate: true };
    if (path === '/api/announcements/state') json = { qsAnsweredTotal: 0, sessionCount: 1, orientationModalSeenAt: '2026-01-01', whatsNewSeenAt: '2026-01-01', feedbackSurveyShownAt: '2026-01-01' };
    return route.fulfill({ json });
  });
}
for (const lang of ['de', 'en']) for (const dark of [false, true]) {
  test(`no date choice, failed save retains selection, rolling plan in place ${lang} dark=${dark}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 812 }); await setup(page, lang, dark);
    let writes = 0;
    await page.route('**/api/user/exam-preference', route => route.fulfill(++writes === 1 ? { status: 500, json: { error: 'upstream private failure' } } : { json: { ok: true, persisted: true } }));
    await page.goto('/study-plan');
    const create = page.getByRole('button', { name: lang === 'de' ? 'Lernplan erstellen' : 'Create study plan', exact: true });
    await expect(create).toBeDisabled();
    const noDate = page.getByRole('button', { name: lang === 'de' ? /Ich habe noch keinen Termin/ : /I do not have a date yet/ });
    await expect(noDate).toHaveAttribute('aria-pressed', 'false');
    await noDate.click(); await create.click();
    await expect(noDate).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: lang === 'de' ? 'Erneut versuchen' : 'Try again', exact: true }).click();
    await expect(page.getByText(lang === 'de' ? 'Vorläufiger Plan, bis du ein Datum wählst' : 'Provisional plan until you choose a date', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
    await expect(page.getByRole('link', { name: lang === 'de' ? 'Jetzt wiederholen' : 'Review now' })).toHaveAttribute('href', /practiceMode=review/);
    await expect(page).toHaveURL(/study-plan$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.reload();
    await expect(page.getByText(lang === 'de' ? 'Vorläufiger Plan, bis du ein Datum wählst' : 'Provisional plan until you choose a date', { exact: true })).toBeVisible();
  });
}
for (const fault of ['500', 'offline', 'malformed']) {
  test(`study-plan ${fault} is retryable error rather than date absence`, async ({ page }) => {
    await setup(page);
    await page.route('**/api/user/study-plan', route => fault === 'offline' ? route.abort('internetdisconnected') : route.fulfill(fault === '500' ? { status: 500, json: {} } : { json: { plan: null } }));
    await page.goto('/study-plan');
    await expect(page.getByText('Could not load your study plan', { exact: true })).toBeVisible();
    await expect(page.getByText('When is your exam?', { exact: true })).toHaveCount(0);
    await page.route('**/api/user/study-plan', route => route.fulfill({ json: rolling }));
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByText('When is your exam?', { exact: true })).toBeVisible();
  });
}
test('stats arbitrary pass flag cannot claim a recorded result or payout', async ({ page }) => {
  await setup(page); await page.goto('/stats?examPassed=1');
  await expect(page.getByText('You passed.', { exact: true })).toBeVisible();
  await expect(page.getByText('We have recorded your result.', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Save result or try again' })).toBeVisible();
  await expect(page.getByText(/payout|available shortly/)).toHaveCount(0);
});

for (const result of ['success', 'failure', 'pending']) {
  test(`real pass write ${result} acknowledgement`, async ({ page }) => {
    await setup(page);
    let finish: (() => void) | undefined;
    await page.route('**/api/puyp/result', route => {
      if (result === 'pending') return new Promise<void>(resolve => { finish = () => { void route.fulfill({ status: 500, json: {} }).then(resolve); }; });
      return route.fulfill(result === 'success' ? { json: { ok: true, result: 'pass', attempt_id: 'fixture-attempt' } } : { status: 500, json: { error: 'Could not record result' } });
    });
    await page.goto('/dashboard/exam-result');
    await page.getByRole('button', { name: 'I passed', exact: true }).click();
    if (result === 'success') {
      await expect(page).toHaveURL(/stats/);
      await expect(page.getByText('We have recorded your result.', { exact: false })).toBeVisible();
    } else {
      await expect(page).toHaveURL(/dashboard\/exam-result/);
      await expect(page.getByText('We have recorded your result.', { exact: false })).toHaveCount(0);
      if (result === 'failure') await expect(page.getByRole('button', { name: 'I passed', exact: true })).toBeEnabled();
      finish?.();
    }
  });
}
for (const surface of ['stats', 'readiness']) {
  test(`${surface} failure shows named error and restores known data on retry`, async ({ page }) => {
    await setup(page);
    const endpoint = surface === 'stats' ? '**/api/stats' : '**/api/user/readiness';
    await page.route(endpoint, route => route.fulfill({ status: 503, json: {} }));
    await page.goto(surface === 'stats' ? '/stats' : '/progress');
    const title = surface === 'stats' ? 'Could not load your statistics' : 'Could not load practice readiness';
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await page.route(endpoint, route => route.fulfill({ json: surface === 'stats' ? stats : { band: 'building', factors: { coverage: .4, accuracy: .7, consistency: .5, pace: null }, trend: 'up', lowestFactor: 'coverage', hasExamDate: false } }));
    await page.getByText(title, { exact: true }).locator('..').getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByText(title, { exact: true })).toHaveCount(0);
    if (surface === 'readiness') await expect(page.getByText('Building', { exact: true })).toBeVisible();
    else await expect(page.getByText('40', { exact: true }).first()).toBeVisible();
  });
}
test('custom planning date saves and regenerates the active-bank plan without leaving the route', async ({ page }) => {
  await setup(page);
  let saved = false;
  await page.route('**/api/user/study-plan', route => route.fulfill({ json: saved ? {
    hasExamDate: true, examDate: '2027-01-15', dailyGoal: 20, activeExam: 'pharma',
    plan: { totalDays: 90, totalQuestions: 20, generatedFor: '2027-01-15', phaseBreak: '2027-01-01', weakTopics: [], status: 'normal', dailySchedule: [{ day: new Date().toISOString().slice(0, 10), phase: 'new', totalQuestions: 20, topics: [{ topic: 'Pharmakologie', targetCount: 20, focus: 'new' }] }] },
  } : rolling }));
  await page.route('**/api/user/exam-preference', route => {
    expect(route.request().postDataJSON()).toEqual({ examDate: '2027-01-15' });
    saved = true; return route.fulfill({ json: { ok: true, persisted: true } });
  });
  await page.goto('/study-plan');
  await page.getByRole('button', { name: 'Custom date', exact: true }).click();
  await expect(page.getByText('A date you enter is only for your planning and does not confirm a registration.', { exact: true })).toBeVisible();
  await page.getByLabel('Custom exam date', { exact: true }).fill('2027-01-15');
  await page.getByRole('button', { name: 'Create study plan', exact: true }).click();
  await expect(page.getByText('15 January 2027', { exact: false })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await expect(page).toHaveURL(/study-plan$/);
});
