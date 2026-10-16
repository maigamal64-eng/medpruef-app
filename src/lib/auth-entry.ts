import { safeSessionStorage, safeStorage } from './safe-storage';
import { EXAM_SOURCE_IDS, type ExamSourceId } from './topics';
import { t, type Lang, type TranslationKey } from './i18n';

// Existing learner destinations only. Login/verification cannot return to themselves.
const RETURN_ROUTES = new Set(['/', '/pricing', '/quiz', '/exam', '/history', '/settings', '/profile', '/progress', '/stats', '/study-plan', '/curriculum', '/library', '/flashcards', '/mistakes', '/referrals', '/materials', '/about', '/faq', '/changelog', '/terms', '/privacy', '/impressum', '/landing', '/kenntnispruefung-wien', '/stichprobentest', '/kmp-innsbruck', '/pharmakologie-pruefung-wien', '/checkout/success', '/exam-dates', '/gerichtsmedizin', '/gm-practice', '/trial/claim']);
// Signed-area sections whose own guards send visitors to /login?next=<deep path>.
const RETURN_PREFIXES = ['/admin', '/dashboard', '/history', '/mentor', '/gratis'];
function isReturnPath(path: string): boolean {
  return RETURN_ROUTES.has(path) || RETURN_PREFIXES.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
}
export function safeNext(value: string | null | undefined, fallback = '/'): string {
  if (!value || !/^\/(?![\/\\])/.test(value) || /[\\\u0000-\u001f\u007f]/.test(value)) return fallback;
  try {
    // Check decoded path too: browsers/proxies can normalize escaped separators.
    const path = value.split(/[?#]/)[0];
    if (!/^\/(?![\/\\])/.test(decodeURIComponent(path)) || /\\/.test(decodeURIComponent(path))) return fallback;
    const url = new URL(value, 'https://medpruf.com');
    if (url.origin !== 'https://medpruf.com' || !isReturnPath(url.pathname.replace(/\/$/, '') || '/')) return fallback;
    url.searchParams.delete('userId');
    return url.pathname + url.search + url.hash;
  } catch { return fallback; }
}
/** intent 'selftest' (a-public-selftest): a free signup from /selbsttest that carries the result and the named sitting (carry.ts). */
export type AuthIntent = 'free' | 'trial' | 'selftest';
export type AuthEntry = { intent?: AuthIntent; exam?: ExamSourceId; next: string };
export function parseAuthEntry(params: URLSearchParams): AuthEntry {
  const intent = params.get('intent');
  const exam = params.get('exam');
  return {
    intent: intent === 'free' || intent === 'trial' || intent === 'selftest' ? intent : undefined,
    exam: (EXAM_SOURCE_IDS as readonly string[]).includes(exam || '') ? exam as ExamSourceId : undefined,
    next: safeNext(params.get('next')),
  };
}
const ENTRY_KEY = 'medpruef_auth_entry';
export function persistAuthEntry(entry: AuthEntry): void {
  const record = JSON.stringify({ ...entry, expires: Date.now() + 30 * 60_000 });
  safeSessionStorage.setItem(ENTRY_KEY, record);
  safeStorage.setItem(ENTRY_KEY, record);
  if (typeof document !== 'undefined') document.cookie = `mp_auth_entry=${encodeURIComponent(record)}; path=/; max-age=1800; SameSite=Lax`;
}
export function readAuthEntry(params?: URLSearchParams): AuthEntry {
  if (params && ['intent', 'exam', 'next'].some(key => params.has(key))) return parseAuthEntry(params);
  try {
    const cookie = typeof document === 'undefined' ? '' : document.cookie.split('; ').find(row => row.startsWith('mp_auth_entry='))?.slice(14);
    const record = safeSessionStorage.getItem(ENTRY_KEY) || safeStorage.getItem(ENTRY_KEY) || (cookie ? decodeURIComponent(cookie) : '');
    const saved = JSON.parse(record);
    if (saved.expires > Date.now()) return parseAuthEntry(new URLSearchParams(saved));
  } catch { /* expired or corrupt hand-off */ }
  return { next: '/' };
}
export function authDestination(entry: AuthEntry): string {
  if (entry.intent === 'trial') return `/pricing?action=trial&intent=trial${entry.exam ? `&exam=${entry.exam}` : ''}#pro-test`;
  if (entry.intent === 'free' && entry.next === '/') return freeStudyDestination(entry.exam);
  return safeNext(entry.next);
}
export function freeStudyDestination(exam: ExamSourceId = 'kenntnispruefung'): string {
  return `/quiz?examSource=${exam}&practiceMode=unseen`;
}
/** Public CTA contract, including a safe default when storage is empty. */
export function publicStudyEntry(href: string): AuthEntry {
  const url = new URL(href.startsWith('/login?') ? href : safeNext(href), 'https://medpruf.com');
  const entry = parseAuthEntry(url.searchParams);
  const bank = url.searchParams.get('examSource') || url.searchParams.get('exam');
  const exam = (EXAM_SOURCE_IDS as readonly string[]).includes(bank || '') ? bank as ExamSourceId : entry.exam;
  return { intent: entry.intent || 'free', exam, next: url.pathname === '/quiz' ? freeStudyDestination(exam) : entry.next };
}
export function buildAuthHref(entry: Partial<AuthEntry> = {}, reason?: string): string {
  const params = new URLSearchParams({ mode: 'register', next: safeNext(entry.next) });
  if (reason) { params.delete('mode'); params.set('reason', reason); }
  if (entry.intent) params.set('intent', entry.intent);
  if (entry.exam) params.set('exam', entry.exam);
  return `/login?${params}`;
}
export function initialAuthMode(params: URLSearchParams, knownAccount: boolean): 'login' | 'register' {
  if (params.get('mode') === 'login' || params.has('reason')) return 'login';
  return params.get('mode') === 'register' || params.has('intent') || !knownAccount ? 'register' : 'login';
}

/** Destination names for the sign-in reason line (UX-GLOBAL-17). */
const DESTINATION_KEYS: Record<string, TranslationKey> = {
  '/mistakes': 'a12_dest_mistakes',
  '/progress': 'a12_dest_progress',
  '/stats': 'a12_dest_stats',
  '/history': 'a12_dest_history',
  '/study-plan': 'a12_dest_study_plan',
  '/library': 'a12_dest_library',
  '/exam': 'a12_dest_exam',
  '/settings': 'a12_dest_settings',
};

/** 'Bitte melden Sie sich an, um {Ziel} zu sehen.' or null for unnamed targets. */
export function signInReasonLine(next: string | null | undefined, lang: string): string | null {
  const key = DESTINATION_KEYS[safeNext(next).split(/[?#]/)[0]];
  return key ? t('a12_signin_reason', lang as Lang).replace('{target}', t(key, lang as Lang)) : null;
}
