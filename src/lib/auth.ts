/**
 * Client-side authentication utilities.
 * Supports Telegram Mini App, Telegram Login Widget, and Email/Password.
 * Safe to import in Client Components — no Node.js APIs.
 */

const SESSION_KEY = 'medpruef_session';

export interface TelegramWidgetUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

export interface StoredSession {
  user: {
    id: string;
    telegram_id?: number;
    email?: string;
    first_name: string;
    last_name?: string;
    role?: string;
    xp_total: number;
    streak_count: number;
    daily_goal: number;
  };
  gamification: {
    total_xp: number;
    current_streak: number;
    total_questions_answered: number;
    total_correct: number;
    daily_questions_today: number;
  };
}

/** Returns true when running inside a Telegram Mini App. */
export function isTelegramMiniApp(): boolean {
  if (typeof window === 'undefined') return false;
  const tg = (window as Window & { Telegram?: { WebApp?: { initData?: string } } }).Telegram;
  return !!(tg?.WebApp?.initData);
}

/** Returns the Mini App initData string (empty string if not in Mini App). */
export function getMiniAppInitData(): string {
  if (typeof window === 'undefined') return '';
  const tg = (window as Window & { Telegram?: { WebApp?: { initData?: string } } }).Telegram;
  return tg?.WebApp?.initData || '';
}

/** Retrieve stored session from localStorage (set after Login Widget auth). */
export function getStoredSession(): StoredSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

/** Persist a session to localStorage. */
export function storeSession(session: StoredSession): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {}
}

/** Remove stored session (logout). */
export function clearSession(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {}
}

/** Check if the current user has admin role. */
export function isAdmin(): boolean {
  const session = getStoredSession();
  return session?.user?.role === 'admin';
}
