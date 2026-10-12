import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createSafeStorage } from '@/lib/safe-storage';
import { ACCOUNT_OWNER_KEY, ACCOUNT_STATE_KEYS, bindAccountState, clearAccountState, userScopedKey } from '@/lib/master-locale/storage-keys';
import { GLOSSARY, rankLabel, term } from '@/lib/master-locale/glossary';
import { compare, scan } from '../../../scripts/master-language/narrow-reader.mjs';

function memoryStore() {
  const m = new Map<string, string>();
  return createSafeStorage(() => ({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }) as unknown as Storage);
}

describe('UX-GLOBAL-39 safe storage and account-scoped keys', () => {
  it('keeps working in memory when the browser store throws', () => {
    const s = createSafeStorage(() => { throw new Error('SecurityError'); });
    expect(s.setItem('medpruef_onboarding', '{}')).toBe(false);
    expect(s.getItem('medpruef_onboarding')).toBe('{}');
  });
  it('clears the previous account mirrors when another account signs in', () => {
    const s = memoryStore();
    bindAccountState('user-a', s);
    s.setItem('medpruef_onboarding', '{"completedAt":"x"}');
    s.setItem('medpruef_exam_source', 'pharma');
    s.setItem('medpruef_favorites', '[1]');
    expect(bindAccountState('user-a', s)).toBe(false);
    expect(s.getItem('medpruef_exam_source')).toBe('pharma');
    expect(bindAccountState('user-b', s)).toBe(true);
    expect(s.getItem('medpruef_onboarding')).toBeNull();
    expect(s.getItem('medpruef_exam_source')).toBeNull();
    expect(s.getItem('medpruef_favorites')).toBe('[1]');
    expect(s.getItem(ACCOUNT_OWNER_KEY)).toBe('user-b');
  });
  it('clears every mirror on logout and ignores guest ids', () => {
    const s = memoryStore(); const ss = memoryStore();
    for (const k of ACCOUNT_STATE_KEYS) s.setItem(k, '1');
    s.setItem(ACCOUNT_OWNER_KEY, 'user-a');
    clearAccountState(s, ss);
    for (const k of [...ACCOUNT_STATE_KEYS, ACCOUNT_OWNER_KEY]) expect(s.getItem(k)).toBeNull();
    expect(bindAccountState('guest_1', s)).toBe(false);
    expect(s.getItem(ACCOUNT_OWNER_KEY)).toBeNull();
    expect(userScopedKey('medpruef_onboarding', 'u1')).toBe('medpruef_onboarding:u1');
  });
  it('routes the shared banners and modals through safeStorage', () => {
    for (const f of ['src/components/CookieBanner.tsx', 'src/components/GuestMigrationBanner.tsx', 'src/components/WhatsNewModal.tsx', 'src/components/OrientationModal.tsx', 'src/components/UserSurveyModal.tsx', 'src/app/page.tsx']) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/(?<![\w.])(window\.)?(localStorage|sessionStorage)\.(getItem|setItem|removeItem)\(/);
    }
  });
  it('storeSession binds mirrors; a second account clears them; only logout clears on clearSession', async () => {
    const m = new Map<string, string>();
    const ls = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    vi.stubGlobal('window', { localStorage: ls, sessionStorage: ls, dispatchEvent: () => true });
    vi.stubGlobal('document', { cookie: '' });
    const { storeSession, clearSession } = await import('@/lib/auth');
    const session = (id: string) => ({ user: { id, first_name: 'X', xp_total: 0, streak_count: 0, daily_goal: 20 }, gamification: { total_xp: 0, current_streak: 0, total_questions_answered: 0, total_correct: 0, daily_questions_today: 0 } });
    storeSession(session('user-a'));
    m.set('medpruef_exam_source', 'pharma');
    storeSession(session('user-a'));
    expect(m.get('medpruef_exam_source')).toBe('pharma');
    clearSession();
    expect(m.get('medpruef_exam_source')).toBe('pharma');
    storeSession(session('user-b'));
    expect(m.get('medpruef_exam_source')).toBeUndefined();
    m.set('medpruef_onboarding', '{}');
    clearSession({ logout: true });
    expect(m.get('medpruef_onboarding')).toBeUndefined();
    vi.unstubAllGlobals();
  });
});

describe('UX-GLOBAL-05 glossary', () => {
  it('uses formal Sie and no dashes', () => {
    for (const [k, e] of Object.entries(GLOSSARY)) {
      expect(e.de, k).not.toMatch(/\b(du|dich|dir|dein|deine|deinen)\b/i);
      expect(`${e.de} ${e.en}`, k).not.toMatch(/[–—]/);
      expect(e.retired as readonly string[], k).not.toContain(e.de);
    }
    expect(term('sign_in', 'de')).toBe('Einloggen');
    expect(rankLabel(3, 8, 'de')).toBe('Stufe 3 von 8');
  });
  it('keeps exam-registration words out of German sign-in strings', () => {
    const src = readFileSync('src/lib/i18n.ts', 'utf8');
    const signIn = [...src.matchAll(/^\s*'?(?:auth_contact|profile_not_logged_in|sign_in_for_stats)'?:\s*\{\s*de:\s*'([^']+)'/gm)].map((m) => m[1]);
    expect(signIn).toHaveLength(3);
    for (const s of signIn) expect(s).not.toMatch(/Anmeld|melde/);
  });
});

describe('LX-19 narrow-reader ratchet', () => {
  it('fails when a learner file adds getLang() or inline de/en ternaries', () => {
    const baseline = JSON.parse(readFileSync('scripts/master-language/narrow-reader-baseline.json', 'utf8')).files;
    expect(compare(scan(), baseline)).toEqual([]);
  });
  it('the negative control trips', () => {
    expect(compare({ 'src/app/new/page.tsx': { getLang: 1, ternaries: 0 } }, {})).toHaveLength(1);
  });
});
