import { describe, expect, it } from 'vitest';
import { activeDaysLast7, answersToday, effectiveStreak, hitRatePct, isStudySnapshot, studyPhase, viennaDay, type StudySnapshot } from '@/lib/home-study-core';
import { loadStudySnapshot } from '@/lib/home-study-server';

describe('UX-HOME-09 / LX-10 study snapshot rules (Vienna days, server confirmed)', () => {
  const now = new Date('2026-10-12T22:30:00Z'); // 00:30 on 13 Oct in Vienna
  it('uses the Vienna calendar day the answer RPC writes', () => {
    expect(viennaDay(now)).toBe('2026-10-13');
  });
  it('keeps the streak through yesterday and confirms a pause after that', () => {
    expect(effectiveStreak(5, '2026-10-13', '2026-10-13')).toBe(5);
    expect(effectiveStreak(5, '2026-10-12', '2026-10-13')).toBe(5);
    expect(effectiveStreak(5, '2026-10-11', '2026-10-13')).toBe(0);
    expect(effectiveStreak(5, null, '2026-10-13')).toBe(0);
  });
  it('counts answers today only on the reset day (daily rollover)', () => {
    expect(answersToday(12, '2026-10-13', '2026-10-13')).toBe(12);
    expect(answersToday(12, '2026-10-12', '2026-10-13')).toBe(0);
  });
  it('counts distinct active Vienna days in the last week', () => {
    const times = ['2026-10-12T21:59:00Z', '2026-10-12T22:10:00Z', '2026-10-10T08:00:00Z', '2026-10-01T08:00:00Z'];
    expect(activeDaysLast7(times, now)).toBe(3);
  });
  it('derives the learner phase for the hero', () => {
    expect(studyPhase(0, null, '2026-10-13')).toBe('new');
    expect(studyPhase(10, '2026-10-13', '2026-10-13')).toBe('active');
    expect(studyPhase(10, '2026-10-08', '2026-10-13')).toBe('returning');
    expect(studyPhase(10, '2026-09-01', '2026-10-13')).toBe('lapsed');
  });
  it('hit rate is null without answers, never a false 0', () => {
    expect(hitRatePct(0, 0)).toBeNull();
    expect(hitRatePct(61, 100)).toBe(61);
  });
});

function fakeSb(rows: { user?: unknown; gam?: unknown; week?: unknown[]; strength?: unknown[] }) {
  const calls: string[] = [];
  const chain = (result: unknown) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'gte', 'order', 'limit']) q[m] = () => q;
    q.maybeSingle = async () => result;
    q.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
    return q;
  };
  return {
    calls,
    from(table: string) {
      calls.push(table);
      if (table === 'users') return chain({ data: rows.user ?? null, error: null });
      if (table === 'user_gamification') return chain({ data: rows.gam ?? null, error: null });
      if (table === 'answer_history') return chain({ data: rows.week ?? [], error: null });
      if (table === 'user_topic_strength') return chain({ data: rows.strength ?? [], error: null });
      throw new Error(`unexpected ${table}`);
    },
  };
}

describe('loadStudySnapshot', () => {
  it('builds a valid snapshot scoped to the active exam', async () => {
    const sb = fakeSb({
      user: { active_exam: 'kmp_innsbruck', exam_date: '2026-11-13', daily_goal: 30 },
      gam: { current_streak: 4, last_study_date: '2026-10-12', daily_questions_today: 9, daily_reset_date: '2026-10-12', total_questions_answered: 120 },
      week: [{ created_at: '2026-10-12T08:00:00Z' }],
      strength: [{ answered: 80, correct: 60 }, { answered: 20, correct: 10 }],
    });
    const s = await loadStudySnapshot(sb as never, 'u1', new Date('2026-10-12T10:00:00Z'));
    expect(isStudySnapshot(s)).toBe(true);
    expect(s).toMatchObject<Partial<StudySnapshot>>({ day: '2026-10-12', streak: 4, answersToday: 9, dailyGoal: 30, activeDays7: 1, activeExam: 'kmp_innsbruck', examDate: '2026-11-13', hitRate: 70, phase: 'active' });
  });
  it('never invents an exam or a hit rate', async () => {
    const sb = fakeSb({ user: { active_exam: 'unknown', exam_date: null, daily_goal: null }, gam: null });
    const s = await loadStudySnapshot(sb as never, 'u1', new Date('2026-10-12T10:00:00Z'));
    expect(s.activeExam).toBeNull();
    expect(s.hitRate).toBeNull();
    expect(s.phase).toBe('new');
    expect(sb.calls).not.toContain('user_topic_strength');
  });
});
