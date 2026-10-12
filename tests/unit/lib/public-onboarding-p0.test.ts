import { afterEach, describe, expect, it, vi } from 'vitest';
import { authDestination, buildAuthHref, freeStudyDestination, initialAuthMode, parseAuthEntry, persistAuthEntry, publicStudyEntry, readAuthEntry, safeNext } from '@/lib/auth-entry';
import { billingAuthContext, billingFreeOffer, billingTrialLine } from '@/lib/billing-copy';
import { pharmaDate, pharmaWindow } from '@/lib/pharma-window';
import { t } from '@/lib/i18n';
import { safeSessionStorage, safeStorage } from '@/lib/safe-storage';

afterEach(() => { safeStorage.removeItem('medpruef_auth_entry'); safeSessionStorage.removeItem('medpruef_auth_entry'); vi.unstubAllGlobals(); });

describe('public registration entry', () => {
  it.each(['kenntnispruefung', 'kmp_innsbruck', 'pharma'] as const)('retains %s from the exam CTA with empty storage', exam => {
    const entry = publicStudyEntry(`/quiz?exam=${exam}&free=1`);
    expect(entry).toEqual({ intent: 'free', exam, next: freeStudyDestination(exam) });
    const params = new URL(buildAuthHref(entry), 'https://medpruf.com').searchParams;
    expect(initialAuthMode(params, true)).toBe('register');
    expect(authDestination(parseAuthEntry(params))).toBe(freeStudyDestination(exam));
  });
  it('recognizes a login-marketing URL rather than dropping trial intent', () => {
    const entry = publicStudyEntry(buildAuthHref({ intent: 'trial', exam: 'pharma' }));
    expect(authDestination(entry)).toBe('/pricing?action=trial&intent=trial&exam=pharma#pro-test');
  });
  it('does not turn unsafe or nonexistent return routes into redirects', () => {
    for (const target of ['//evil.test', '/\\evil.test', '/%2f%2fevil.test', '/%5cevil.test', '/unknown', 'https://evil.test'])
      expect(safeNext(target)).toBe('/');
  });
  it('retains context through local storage, then a cookie when both stores are unavailable', () => {
    vi.stubGlobal('window', { get localStorage() { throw Error('blocked'); }, get sessionStorage() { throw Error('blocked'); } });
    vi.stubGlobal('document', { cookie: '' });
    const entry = { intent: 'trial' as const, exam: 'pharma' as const, next: '/pricing' };
    persistAuthEntry(entry);
    safeSessionStorage.removeItem('medpruef_auth_entry');
    expect(readAuthEntry()).toEqual(entry);
    safeStorage.removeItem('medpruef_auth_entry');
    expect(readAuthEntry()).toEqual(entry);
    // Explicit URL context always takes precedence over any old handoff.
    expect(readAuthEntry(new URLSearchParams('intent=free&exam=kmp_innsbruck'))).toMatchObject({ intent: 'free', exam: 'kmp_innsbruck' });
  });
  it('ignores an expired handoff', () => {
    vi.stubGlobal('window', {}); vi.stubGlobal('document', { cookie: '' });
    safeStorage.setItem('medpruef_auth_entry', JSON.stringify({ intent: 'trial', expires: 1 }));
    expect(readAuthEntry()).toEqual({ next: '/' });
  });
});

describe('shared free and trial disclosure', () => {
  it.each(['de', 'en'] as const)('uses plan cents without an unqualified cancellation claim (%s)', lang => {
    const free = billingFreeOffer(lang, 1772);
    expect(free).toContain(lang === 'de' ? '17,72 €' : '17.72 €');
    expect(free).toContain('150');
    expect(free).not.toMatch(/jederzeit kündbar|cancel anytime|[\u2013\u2014]/);
    expect(billingAuthContext(lang, 'trial', { trialDays: 7, priceAfterCents: 1772 }))
      .toBe(billingTrialLine(lang, { trialDays: 7, priceAfterCents: 1772 }));
    expect(billingAuthContext(lang, 'free')).toContain(lang === 'de' ? 'Fortschritt' : 'progress');
  });
  it.each(['ru', 'uk', 'tr', 'ar'] as const)('uses the English contact fallback for saved %s', lang => {
    expect(t('auth_contact', lang)).toBe(t('auth_contact', 'en'));
  });
});

describe('Rezeptierkunde published week', () => {
  it('uses the official deadline and source reading date', () => {
    const selected = pharmaWindow(new Date('2026-10-11T12:00:00Z'))!;
    expect(selected.current.date).toBe('2026-11-23');
    expect(selected.current.date_end).toBe('2026-11-27');
    expect(selected.current.registration_closes).toBe('2026-10-20');
    expect(selected.current.closes_at_time).toBe('12:00');
    expect(selected.current.read_on).toBe('2026-10-10');
    expect(selected.open).toBe(true);
    expect(pharmaDate(selected.current.registration_closes!, 'de')).toBe('20. Oktober 2026');
  });
  it('closes at noon Vienna time and retains the published next week', () => {
    expect(pharmaWindow(new Date('2026-10-20T09:59:59Z'))!.open).toBe(true);
    const closed = pharmaWindow(new Date('2026-10-20T10:00:00Z'))!;
    expect(closed.open).toBe(false);
    expect(closed.next?.date).toBe('2027-01-18');
  });
  it('ages past the week, handles the winter offset, and never invents unpublished dates', () => {
    expect(pharmaWindow(new Date('2026-11-28T12:00:00Z'))!.current.date).toBe('2027-01-18');
    expect(pharmaWindow(new Date('2026-12-15T11:00:00Z'))!.open).toBe(false);
    expect(pharmaWindow(new Date('2028-01-01T00:00:00Z'))).toBeNull();
    expect(pharmaWindow(new Date('2026-10-11T12:00:00Z'), [])).toBeNull();
  });
});
