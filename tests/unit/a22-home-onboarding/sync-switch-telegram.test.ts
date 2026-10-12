import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queueOnboardingSync, readDraft, readPending, replayOnboardingSync, writeDraft, DRAFT_TTL_MS } from '@/lib/onboarding-sync';
import { frageStartQuestionId, toFreeSliceQuestion, handleFrageCallback, handleFrageCommand, isFrageCommand, isFrageEnabled } from '@/lib/telegram-frage';

const ok = { ok: true, status: 200, json: async () => ({}) } as Response;
const fail = { ok: false, status: 500, json: async () => ({}) } as Response;

describe('UX-ONB-25 pending sync and resume', () => {
  const user = `u-${Math.random()}`;
  it('queues only chosen fields, merges newer choices, never sends a language', async () => {
    queueOnboardingSync(user, { examSource: 'pharma' }, 1);
    queueOnboardingSync(user, { dailyGoal: 30, completed: true }, 2);
    expect(readPending(user)?.payload).toEqual({ examSource: 'pharma', dailyGoal: 30, completed: true });
    const calls: { url: string; body: unknown }[] = [];
    const r = await replayOnboardingSync(user, async (url, init) => { calls.push({ url, body: JSON.parse(String(init.body)) }); return ok; });
    expect(r).toBe('done');
    expect(calls[0]).toEqual({ url: '/api/user/exam-preference', body: { activeExam: 'pharma', dailyGoal: 30 } });
    expect(calls[1].url).toBe('/api/user/onboarding-complete');
    expect(JSON.stringify(calls)).not.toContain('language');
    expect(readPending(user)).toBeNull();
  });
  it('a failure keeps the queue and counts it; an empty queue sends nothing', async () => {
    const u = `${user}-2`;
    expect(await replayOnboardingSync(u, async () => ok)).toBe('empty');
    queueOnboardingSync(u, { examSource: 'kmp_innsbruck' });
    expect(await replayOnboardingSync(u, async () => fail)).toBe('failed');
    expect(await replayOnboardingSync(u, async () => { throw new TypeError('offline'); })).toBe('failed');
    expect(readPending(u)?.failures).toBe(2);
  });
  it('a skipped date is not sent; an explicit no-date is sent as null', async () => {
    const u = `${user}-3`;
    queueOnboardingSync(u, { examSource: 'pharma', examDate: null });
    const bodies: unknown[] = [];
    await replayOnboardingSync(u, async (_url, init) => { bodies.push(JSON.parse(String(init.body))); return ok; });
    expect(bodies[0]).toEqual({ activeExam: 'pharma', examDate: null });
  });
  it('drafts expire after 24 hours and are per account', () => {
    writeDraft('a', 1, { examSource: 'pharma' }, 1000);
    expect(readDraft('a', 2000)?.step).toBe(1);
    expect(readDraft('b', 2000)).toBeNull();
    expect(readDraft('a', 1000 + DRAFT_TTL_MS + 1)).toBeNull();
  });
});

describe('UX-HOME-12 one exam-switch path', () => {
  let dispatched: Event[] = [];
  beforeEach(() => {
    dispatched = [];
    const target = new EventTarget();
    const mem = new Map<string, string>([['medpruef_session', JSON.stringify({ user: { id: 'u1' } })]]);
    const ls = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } };
    vi.stubGlobal('localStorage', ls);
    vi.stubGlobal('window', Object.assign(target, {
      localStorage: ls,
      dispatchEvent: (e: Event) => { dispatched.push(e); return EventTarget.prototype.dispatchEvent.call(target, e); },
    }));
  });
  it('rolls back and sends nothing when the account save fails', async () => {
    const { switchActiveExam } = await import('@/lib/exam-switch');
    const reload = vi.fn();
    expect(await switchActiveExam('pharma', 'kenntnispruefung', { fetcher: (async () => fail) as never, reload })).toBe('failed');
    expect(dispatched).toHaveLength(0);
    expect(reload).not.toHaveBeenCalled();
  });
  it('a page that refreshes in place cancels the reload; otherwise it reloads', async () => {
    const { switchActiveExam, EXAM_CHANGED_EVENT } = await import('@/lib/exam-switch');
    const bodies: string[] = [];
    const fetcher = (async (_u: string, init: RequestInit) => { bodies.push(String(init.body)); return ok; }) as never;
    const reload = vi.fn();
    const handler = (e: Event) => e.preventDefault();
    (window as unknown as EventTarget).addEventListener(EXAM_CHANGED_EVENT, handler);
    expect(await switchActiveExam('pharma', 'kenntnispruefung', { fetcher, reload })).toBe('saved');
    (window as unknown as EventTarget).removeEventListener(EXAM_CHANGED_EVENT, handler);
    await new Promise((r) => setTimeout(r, 80));
    expect(reload).not.toHaveBeenCalled();
    expect(bodies[0]).toBe(JSON.stringify({ activeExam: 'pharma' }));
    await switchActiveExam('kmp_innsbruck', 'pharma', { fetcher, reload });
    await new Promise((r) => setTimeout(r, 80));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

function frageSb(opts: { slice: number[]; rows: { id: number; question: string; choices: unknown }[]; activeExam?: string }) {
  const inserts: unknown[] = [];
  const chain = (result: unknown) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit', 'in']) q[m] = () => q;
    q.maybeSingle = async () => result;
    q.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
    return q;
  };
  const questionsChain = () => {
    let byIds = false;
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'limit']) q[m] = () => q;
    q.in = () => { byIds = true; return q; };
    q.then = (res: (v: unknown) => unknown) => Promise.resolve(byIds ? { data: opts.rows, error: null } : { data: opts.slice.map((id) => ({ id })), error: null }).then(res);
    return q;
  };
  return {
    inserts,
    from(table: string) {
      if (table === 'users') return chain({ data: opts.activeExam ? { active_exam: opts.activeExam } : null, error: null });
      if (table === 'telegram_login_tokens') return { insert: async (row: unknown) => { inserts.push(row); return { error: null }; } };
      if (table === 'questions') return questionsChain();
      throw new Error(table);
    },
  };
}

describe('LX-34 /frage', () => {
  const rows = [
    { id: 11, question: 'Welche Antwort?', choices: [{ text: 'Eins', correct: false }, { text: 'Zwei', correct: true }] },
    { id: 12, question: 'Mehrfach', choices: [{ text: 'a', correct: true }, { text: 'b', correct: true }] },
  ];
  it('ships off and recognises only the command', () => {
    expect(isFrageEnabled({})).toBe(false);
    expect(isFrageCommand('/frage')).toBe(true);
    expect(isFrageCommand('/frage@OtherBot')).toBe(false);
    expect(isFrageCommand('frage')).toBe(false);
  });
  it('the /start payload carries only a question id', () => {
    expect(frageStartQuestionId('frage_11')).toBe(11);
    expect(frageStartQuestionId('frage_x')).toBeNull();
    expect(frageStartQuestionId('web_login')).toBeNull();
  });
  it('single-answer items only', () => {
    expect(toFreeSliceQuestion(rows[0])?.correctIndex).toBe(1);
    expect(toFreeSliceQuestion(rows[1])).toBeNull();
  });
  it('never answers in a group', async () => {
    const send = vi.fn(async () => {});
    await handleFrageCommand(frageSb({ slice: [11, 12], rows }) as never, { chat: { id: 1, type: 'group' }, from: { id: 9 } }, send);
    expect(send).not.toHaveBeenCalled();
  });
  it('a private chat gets a free-slice question, letters and a credential-free bot deep link', async () => {
    const sent: { method: string; body: Record<string, unknown> }[] = [];
    const sb = frageSb({ slice: [11, 12], rows, activeExam: 'pharma' });
    await handleFrageCommand(sb as never, { chat: { id: 1, type: 'private' }, from: { id: 9 } }, async (method, body) => { sent.push({ method, body }); }, new Date('2026-10-12T10:00:00Z'));
    expect(sent).toHaveLength(1);
    const text = String(sent[0].body.text);
    expect(text).toContain('Welche Antwort?');
    expect(text).not.toMatch(/Zwei.*richtig/);
    const kb = JSON.stringify(sent[0].body.reply_markup);
    expect(kb).toContain('frage:11:0');
    // A forwarded message must not sign anyone in: no token in the button.
    expect(kb).not.toContain('tg_token');
    expect(kb).toContain('https://t.me/MedPruefBot?start=frage_11');
    expect(sb.inserts).toHaveLength(0);
  });
  it('option taps outside the free slice are refused; inside say right or wrong', async () => {
    const answers: Record<string, unknown>[] = [];
    const send = async (_m: string, body: Record<string, unknown>) => { answers.push(body); };
    await handleFrageCallback(frageSb({ slice: [11], rows, activeExam: 'kmp_innsbruck' }) as never, { id: 'c1', data: 'frage:99:0', from: { id: 9 } }, send);
    expect(answers[0].text).toBe('Diese Frage ist nicht mehr verfügbar.');
    await handleFrageCallback(frageSb({ slice: [11], rows, activeExam: 'kmp_innsbruck' }) as never, { id: 'c2', data: 'frage:11:0', from: { id: 9 } }, send);
    expect(answers[1].text).toContain('Richtig ist B');
    await handleFrageCallback(frageSb({ slice: [11], rows, activeExam: 'kmp_innsbruck' }) as never, { id: 'c3', data: 'frage:11:1', from: { id: 9 } }, send);
    expect(String(answers[2].text).startsWith('Richtig.')).toBe(true);
  });
});
