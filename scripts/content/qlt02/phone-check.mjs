/** track-A browser proof: actual frozen /quiz card and lightbox, mocked GET data.
 * All non-GET API requests and all external non-image requests are aborted.
 * Run only against local next start, using the prepared 20-question fixture.
 * No login, database writes, tracker sends, or medical activation occur.
 */
import { chromium } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

async function main() {
  const [base, fixturePath, objectsPath, output] = process.argv.slice(2);
  const url = new URL(base);
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.protocol !== 'http:' || !output) throw new Error('Supply local http next start URL, fixture, objects and output');
  const rows = JSON.parse(await readFile(fixturePath, 'utf8'));
  const objects = JSON.parse(await readFile(objectsPath, 'utf8'));
  if (rows.length !== 20 || new Set(rows.map(row => row.id)).size !== 20) throw new Error('Expected 20 distinct image questions');
  await mkdir(output, { recursive: true });
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const lang of ['de', 'en']) for (const row of rows) {
      const context = await browser.newContext({ viewport: { width: 375, height: 812 }, serviceWorkers: 'block' });
      try {
        const page = await context.newPage();
        const blocked = [];
        await page.route('**/*', async route => {
          const request = route.request();
          const requestUrl = new URL(request.url());
          if (requestUrl.origin === url.origin) return route.continue();
          if (request.method() === 'GET' && request.resourceType() === 'image' && requestUrl.hostname.endsWith('.supabase.co')) return route.continue();
          blocked.push({ method: request.method(), path: requestUrl.pathname });
          return route.abort();
        });
        // Registered after catch-all: priority interception of every API path.
        await page.route('**/api/**', async route => {
          if (route.request().method() !== 'GET') {
            blocked.push({ method: route.request().method(), path: new URL(route.request().url()).pathname });
            return route.abort();
          }
          const pathname = new URL(route.request().url()).pathname;
          const runtime = { ...row, options: row.choices?.map(choice => ({ text: choice.text, correct: choice.correct, image_url: choice.image_url ?? null })) ?? null,
            n_correct: row.choices?.filter(choice => choice.correct).length ?? 1 };
          const body = pathname === '/api/questions' ? [runtime]
            : pathname.includes('subscription') || pathname.includes('user-tier') ? { tier: 'pro', role: 'user', active: true }
            : pathname.includes('announcements') ? { pending: [], current: null, history: [] }
            : pathname.includes('bookmarks') ? { ids: [] }
            : pathname.includes('topic-progress') ? { topics: [] }
            : [];
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
        });
        for (const object of objects) {
          await page.route(`**/${object.object_path}`, route => route.fulfill({ contentType: 'image/webp', path: object.local_path }));
        }
        await page.addInitScript(({ language, examType }) => {
          const session = { user: { id: '00000000-0000-4000-8000-000000000009', email: 'fixture@example.invalid', role: 'user', tier: 'pro', first_name: 'Fixture', xp_total: 0, streak_count: 0, daily_goal: 20 }, gamification: { total_xp: 0, current_streak: 0, total_questions_answered: 0, total_correct: 0, daily_questions_today: 0 } };
          localStorage.setItem('medpruef_session', JSON.stringify(session));
          localStorage.setItem('medpruef_session_token', 'local-fixture-only');
          localStorage.setItem('medpruef_onboarding', JSON.stringify({ completedAt: '2026-01-01T00:00:00.000Z', examSource: examType }));
          localStorage.setItem('medpruef-lang', language);
          localStorage.setItem('medpruef-kaf-mode', '0');
          localStorage.setItem('medpruef-cookie-consent', 'rejected');
        }, { language: lang, examType: row.exam_type });
        await page.goto(`${base}/quiz?examSource=${encodeURIComponent(row.exam_type)}&questionId=${row.id}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        const card = page.locator(`[data-question-id="${row.id}"]`);
        await card.waitFor({ state: 'visible', timeout: 30_000 });
        const trigger = card.getByRole('button', { name: lang === 'de' ? 'Bild vergrößern' : 'Enlarge image', exact: true });
        const image = trigger.locator('img');
        await image.waitFor({ state: 'visible' });
        await page.waitForFunction(id => {
          const img = document.querySelector(`[data-question-id="${id}"] img`);
          return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0;
        }, row.id, { timeout: 30_000 });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > 375);
        if (overflow) throw new Error(`Horizontal overflow q${row.id} ${lang}`);
        const shot = resolve(output, `${row.id}-${lang}-375.png`);
        await page.screenshot({ path: shot, fullPage: true });
        await trigger.click();
        const close = page.getByRole('button', { name: lang === 'de' ? 'Schließen' : 'Close', exact: true });
        await close.waitFor({ state: 'visible' });
        const lightbox = resolve(output, `${row.id}-${lang}-lightbox-375.png`);
        await page.screenshot({ path: lightbox });
        await page.keyboard.press('Escape');
        await close.waitFor({ state: 'hidden' });
        results.push({ id: row.id, lang, viewport: '375x812', screenshot: shot, lightbox, overflow, blocked_mutations: blocked.filter(request => request.method !== 'GET') });
      } finally { await context.close(); }
    }
  } finally {
    await browser.close();
    await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  }
  console.log(JSON.stringify({ distinct_rows: 20, screenshots: results.length * 2, lightbox_checks: results.length, api_writes: 0 }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
