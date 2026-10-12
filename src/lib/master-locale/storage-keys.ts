/**
 * Account-state keys on shared devices (UX-GLOBAL-39, ONB-55, HOME-07).
 *
 * Browser keys that mirror one learner's account state are bound to the
 * account that wrote them. When a different account signs in on the same
 * device, or on logout, the mirrors are cleared so the next learner never
 * inherits the previous learner's exam, onboarding or progress caches. The
 * server stays the source of truth; every reader already re-fetches.
 *
 * Learner-created content (bookmarks, per-question notes, pending exam
 * results) is NOT cleared here: those stores are keyed or acknowledged by
 * their own modules and must never be lost silently.
 */
import { safeStorage, safeSessionStorage } from '../safe-storage';

export const ACCOUNT_OWNER_KEY = 'medpruef_account_owner';

/** Unscoped mirrors of one account's state. */
export const ACCOUNT_STATE_KEYS = [
  'medpruef_onboarding',
  'medpruef_profile',
  'medpruef_exam_source',
  'medpruef_active_exam',
  'medpruef_fyp_synced',
  'medpruef_quiz_session_v2',
  'medpruef_weakness',
  'medpruef_topic_strength_cache_v1',
  // a22 Home caches (UX-HOME-07/09): already keyed by user id, cleared here too.
  'medpruef_home_study_v1',
  'medpruef_home_topics_v1',
] as const;

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): boolean; removeItem(k: string): void };

/** "medpruef_onboarding:<userId>" for new per-account keys. */
export function userScopedKey(base: string, userId: string): string {
  return `${base}:${userId}`;
}

/** Remove every unscoped account mirror and the owner marker. */
export function clearAccountState(store: Store = safeStorage, session: Pick<Store, 'removeItem'> = safeSessionStorage): void {
  for (const key of ACCOUNT_STATE_KEYS) store.removeItem(key);
  store.removeItem(ACCOUNT_OWNER_KEY);
  session.removeItem('medpruef_guest_banner_dismissed');
}

/**
 * Bind the account mirrors to `userId`. When another account owned them,
 * they are cleared first. Returns true when a previous account's state was
 * cleared. Guest ids and empty ids are ignored.
 */
export function bindAccountState(userId: string | null | undefined, store: Store = safeStorage): boolean {
  if (!userId || userId.startsWith('guest_')) return false;
  const owner = store.getItem(ACCOUNT_OWNER_KEY);
  let cleared = false;
  if (owner && owner !== userId) {
    for (const key of ACCOUNT_STATE_KEYS) store.removeItem(key);
    cleared = true;
  }
  if (owner !== userId) store.setItem(ACCOUNT_OWNER_KEY, userId);
  return cleared;
}
