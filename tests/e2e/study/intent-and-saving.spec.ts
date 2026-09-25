import { test, expect, type Page } from '@playwright/test';
import { seedSession } from '../fixtures/session';
import { seedPreferences, expectNoHorizontalScroll } from '../helpers/page-setup';

// The app's service worker can serve stale API responses and bypass Playwright
// page.route mocks. Keep this contract suite isolated from that browser cache.
test.use({ serviceWorkers: 'block' });

async function setup(page: Page, lang: 'de'|'en', failFirst = false) {
  await seedSession(page, {userId:'study-ui-test',tier:'pro'});
  await page.addInitScript(() => localStorage.setItem('medpruef_session_token', 'e2e-signed-session-token'));
  await seedPreferences(page,{lang});
  const saved = new Set<number>();
  const requests: Array<{questionId:number;requestId:string;userAnswer?:string|null;isCorrect?:boolean}> = [];
  const authHeaders: string[] = [];
  const questionQueries: string[] = [];
  const q = (id:number) => ({id,topic:'Neurologie',question:`Study fixture ${id}`,answer:'Correct option',explanation:'Fixture explanation',difficulty:1,exam_dates:[],options:[{text:'Correct option',correct:true},{text:'Other option',correct:false}]});
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/auth/me') return route.fulfill({json:{user:{id:'study-ui-test',tier:'pro',role:'user'}}});
    if (url.pathname === '/api/questions') {
      authHeaders.push(route.request().headers()['x-session-token'] || '');
      if (url.searchParams.has('countOnly')) return route.fulfill({json:{count:3}});
      if (route.request().method() === 'POST') return route.fulfill({json:[{topic:'Neurologie',count:3}]});
      const mode = url.searchParams.get('practiceMode');
      if (!url.searchParams.has('countOnly')) questionQueries.push(url.search);
      const excluded = (url.searchParams.get('excludeIds')||'').split(',').map(Number);
      const explicit = Number(url.searchParams.get('ids'));
      if (explicit) return route.fulfill({json:explicit === 999 ? [] : [q(explicit)]});
      if (mode === 'review') return route.fulfill({json:[]});
      const pool = mode === 'wrong' ? [1,2] : [1,2,3].filter(id=>!saved.has(id));
      const ids = pool.filter(id=>!excluded.includes(id));
      return route.fulfill({json:(url.searchParams.has('list') ? ids : ids.slice(0,1)).map(q)});
    }
    if (url.pathname === '/api/answer') {
      authHeaders.push(route.request().headers()['x-session-token'] || '');
      const data = route.request().postDataJSON(); requests.push(data);
      if (failFirst && requests.length === 1) return route.fulfill({status:503,json:{error:'Simulated outage'}});
      saved.add(data.questionId);
      return route.fulfill({json:{xp:10,saved:true}});
    }
    return route.fulfill({json:{}});
  });
  return {saved, requests, questionQueries, authHeaders};
}
async function submitAnswer(page: Page, option: RegExp) {
  await page.getByRole('radio', {name:option}).click();
}
for (const lang of ['de','en'] as const) {
  test(`new questions persist, resume and exhaust without repeats (${lang})`, async ({page}) => {
    const {saved,authHeaders} = await setup(page,lang);
    await page.goto('/quiz?topic=Neurologie&examSource=kmp_innsbruck&limit=3', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-question-text]')).toHaveText('Study fixture 1');
    await expect(page.getByRole('combobox')).toHaveValue('unseen');
    await expect.poll(() => authHeaders.some(value => value === 'e2e-signed-session-token')).toBe(true);
    await submitAnswer(page,/Correct option/);
    await expect.poll(()=>saved.size).toBe(1);
    expect(authHeaders).toContain('e2e-signed-session-token');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button',{name:lang==='de'?'Fortsetzen':'Resume',exact:true}).click();
    await expect(page.locator('[data-question-text]')).toHaveText('Study fixture 2');
    await submitAnswer(page,/Correct option/);
    await page.getByRole('button',{name:lang==='de'?'Nächste Frage':'Next question',exact:false}).click();
    await expect(page.locator('[data-question-text]')).toHaveText('Study fixture 3');
    await submitAnswer(page,/Correct option/);
    await page.getByRole('button',{name:lang==='de'?'Quiz beenden':'Finish quiz',exact:false}).click();
    await expect.poll(()=>saved.size).toBe(3);
    await page.goto('/quiz?topic=Neurologie&examSource=kmp_innsbruck&limit=3', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(lang==='de'?'Alle verfügbaren Fragen in dieser Auswahl sind bearbeitet. Wiederhole nur, wenn du möchtest.':'You have covered all available questions in this selection. Review only when you choose.')).toBeVisible();
    await expect(page.locator('[data-question-text]')).toHaveCount(0);
    await expectNoHorizontalScroll(page);
  });
  test(`failed save blocks progress and retries same request (${lang})`, async ({page}) => {
    const {saved,requests} = await setup(page,lang,true);
    await page.goto('/quiz?topic=Neurologie&examSource=kmp_innsbruck&limit=3');
    await submitAnswer(page,/Correct option/);
    const retry = page.getByRole('button',{name:lang==='de'?'Speichern erneut versuchen':'Retry saving'});
    await expect(retry).toBeVisible();
    expect(saved.size).toBe(0);
    await page.getByRole('button',{name:lang==='de'?'Quiz verlassen':'Leave quiz'}).click();
    await expect(page).toHaveURL(/\/quiz/);
    await page.getByRole('link',{name:lang==='de'?'Fehlerliste ansehen':'View mistake list'}).click();
    await expect(page).toHaveURL(/\/quiz/);
    await retry.click();
    await expect.poll(()=>saved.size).toBe(1);
    expect(requests).toHaveLength(2);
    expect(requests[0].requestId).toBe(requests[1].requestId);
    await expect(page.getByRole('button',{name:lang==='de'?'Nächste Frage':'Next question',exact:false})).toBeVisible();
    await expectNoHorizontalScroll(page);
  });
  test(`mistake list and explicit due-review exhaustion (${lang})`, async ({page}) => {
    await setup(page,lang);
    await page.goto('/mistakes?topic=Neurologie&examSource=kmp_innsbruck', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Study fixture 1')).toBeVisible();
    await page.getByRole('link',{name:/Study fixture 1/}).click();
    await expect(page.locator('[data-question-text]')).toHaveText('Study fixture 1');
    await submitAnswer(page,/Correct option/);
    await page.getByRole('button',{name:lang==='de'?'Nächste Frage':'Next question',exact:false}).click();
    await expect(page.locator('[data-question-text]')).toHaveText('Study fixture 2');
    await page.getByRole('combobox').selectOption('review');
    await expect(page.getByText(lang==='de'?'Keine fälligen Wiederholungen in dieser Auswahl.':'No due reviews in this selection.')).toBeVisible();
    await page.goto('/quiz?topic=Neurologie&examSource=kmp_innsbruck', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('combobox')).toHaveValue('review');
    await expectNoHorizontalScroll(page);
  });
  test(`mode switching preserves every selected topic and filter (${lang})`, async ({page}) => {
    const {questionQueries} = await setup(page,lang);
    await page.addInitScript(() => {
      sessionStorage.setItem('medpruef-study-config:study-ui-test', JSON.stringify({
        topics:['Neurologie','Chirurgie'], tags:['kmp6a'], targetCount:3,
        timeLimitMin:null, examDateFrom:'2026-01', examDateTo:'2026-03',
        examSource:'kmp_innsbruck', examYear:'2026',
      }));
    });
    await page.goto('/quiz?configured=1&examSource=kmp_innsbruck&practiceMode=unseen&limit=3', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-question-text]')).toHaveText('Study fixture 1');
    await page.getByRole('combobox').selectOption('wrong');
    await expect(page.getByRole('combobox')).toHaveValue('wrong');
    await expect.poll(() => questionQueries.some(query => query.includes('practiceMode=wrong'))).toBe(true);
    const switched = new URLSearchParams(questionQueries.find(query => query.includes('practiceMode=wrong')));
    expect(switched.get('topics')).toBe('Neurologie,Chirurgie');
    expect(switched.get('tags')).toBe('kmp6a');
    expect(switched.get('examDateFrom')).toBe('2026-01');
    expect(switched.get('examDateTo')).toBe('2026-03');
    expect(switched.get('examYear')).toBe('2026');
    await page.goto('/quiz?configured=1&examSource=kmp_innsbruck&limit=3', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('combobox')).toHaveValue('wrong');
    await expectNoHorizontalScroll(page);
  });
  test(`keyboard answers save the selected option (${lang})`, async ({page}) => {
    const {requests} = await setup(page,lang);
    await page.goto('/quiz?topic=Neurologie&examSource=kmp_innsbruck&limit=3', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-question-text]')).toHaveText('Study fixture 1');
    await page.keyboard.press('b');
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0].userAnswer).toBe('Other option');
    expect(requests[0].isCorrect).toBe(false);
  });
}
