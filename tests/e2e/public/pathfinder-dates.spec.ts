import { test, expect } from '@playwright/test';

// Chromium is installed in this workspace; phone projects exercise viewport/touch, not WebKit.
test.use({ browserName: 'chromium', serviceWorkers: 'block' });

// Public orientation only: fresh anonymous storage and read methods, no customer
// session, question-bank API, registration, purchase or preference server write.
for (const lang of ['de', 'en'] as const) {
  for (const exam of ['kenntnispruefung', 'kmp_innsbruck'] as const) {
    for (const date of ['', '2027-01-18']) {
      test(`${lang} ${exam} ${date || 'undated'} keeps study flow without institutional date advice`, async ({ page, context, baseURL }) => {
        const origin = new URL(baseURL!).origin;
        const progressKey = `medpruef-quiz-v4:${JSON.stringify(['synthetic-local', exam, 'unseen', 20, [], [], '', '', '', '', []])}`;
        const savedProgress = JSON.stringify({ v: 4, savedAt: 123, targetCount: 20, answered: [{ id: -1, correct: true }] });
        await context.addInitScript(({ l, key, value }) => {
          localStorage.setItem('medpruef-lang', l);
          localStorage.setItem(key, value);
        }, { l: lang, key: progressKey, value: savedProgress });
        await context.route('**/*', route => {
          const req = route.request();
          const url = new URL(req.url());
          if (!['GET', 'HEAD'].includes(req.method()) || url.origin !== origin || /\/api\/(questions|answer|study|quiz)/.test(url.pathname)) return route.abort();
          return route.continue();
        });
        await page.goto('/find-your-path', { waitUntil: 'networkidle' });
        await page.getByRole('button', { name: lang === 'de' ? 'Ich bin nicht sicher' : "I'm not sure", exact: false }).click();
        await expect(page.locator('body')).not.toContainText(/18.*(Jänner|January).*2027|18.*(November).*2026/);
        await expect(page.locator('body')).not.toContainText(/Anmeldeschluss:|Registration deadline:|Register by:/);
        await page.getByRole('button', { name: exam === 'kenntnispruefung'
          ? lang === 'de' ? 'Diese Fragenbank wählen: Wien' : 'Choose this bank: Vienna'
          : lang === 'de' ? 'Diese Fragenbank wählen: Stichprobentest' : 'Choose this bank: Stichprobentest', exact: true }).click();
        await page.getByRole('button', { name: lang === 'de' ? 'Weiter' : 'Next', exact: true }).click();
        await expect(page.locator('body')).not.toContainText(/18.*(Jänner|January).*2027|Anmeldeschluss in|Registration closes in/);
        await expect(page.getByRole('link', { name: lang === 'de' ? 'Offizielle Informationen Ihrer Universität prüfen' : 'Check your university’s official information' })).toHaveAttribute('href', exam === 'kenntnispruefung'
          ? 'https://www.meduniwien.ac.at/web/en/studium-weiterbildung/nostrifizierung/pruefungen/' : 'https://www.i-med.ac.at/studium/');
        if (date) await page.getByLabel(lang === 'de' ? 'Optionales Lernziel-Datum' : 'Optional study target date').fill(date);
        await page.getByRole('button', { name: lang === 'de' ? 'Weiter' : 'Next', exact: true }).click();
        await page.getByRole('button', { name: lang === 'de' ? 'Meinen Lernweg anzeigen' : 'Show my study path', exact: true }).click();
        await expect(page.locator('body')).not.toContainText(/Anmeldeschluss|Registration deadline|Registration closes|Register soon|Register now/);
        await expect(page.getByRole('link', { name: lang === 'de' ? 'Kostenlos üben und Niveau einschätzen' : 'Practice free and gauge your level', exact: true })).toHaveAttribute('href', `/quiz?exam=${exam}&free=1`);
        if (date) {
          await expect(page.getByRole('heading', { name: lang === 'de' ? 'Ihr Lernplan' : 'Your study plan', exact: true })).toBeVisible();
          await expect(page.locator('ol')).toBeVisible(); // Study phases survive deadline suppression.
        }
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('medpruef_onboarding')!));
        expect(saved.examSource).toBe(exam);
        expect(saved.examDate).toBe(date || 'not_planned');
        expect(saved.dailyGoal).toBe(20);
        expect(await page.evaluate(key => localStorage.getItem(key), progressKey)).toBe(savedProgress);
      });
    }
  }
}
