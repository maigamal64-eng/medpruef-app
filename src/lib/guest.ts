/**
 * Client-side guest mode utilities.
 * Safe to import in Client Components — no Node.js APIs.
 */

const GUEST_ID_KEY = 'medpruef_guest_id';

/** Returns true when running inside a real Telegram WebApp context. */
export function isTelegramContext(): boolean {
  if (typeof window === 'undefined') return false;
  const tg = (window as Window & { Telegram?: { WebApp?: { initData?: string } } }).Telegram;
  return !!(tg?.WebApp?.initData);
}

/**
 * Returns a stable guest ID stored in localStorage.
 * Creates one on first call.
 */
export function getOrCreateGuestId(): string {
  if (typeof window === 'undefined') return '';
  try {
    let id = localStorage.getItem(GUEST_ID_KEY);
    if (!id) {
      id = 'guest_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
      localStorage.setItem(GUEST_ID_KEY, id);
    }
    return id;
  } catch {
    return 'guest_fallback';
  }
}

/** Returns true if the given userId is a guest (not a real DB user). */
export function isGuestId(userId: string): boolean {
  return userId.startsWith('guest_');
}
