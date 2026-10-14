/**
 * a-fo-10: short, account-keyed client cache for reads that every page load
 * repeats although their answer rarely changes (Sidebar referral status,
 * the announcement state row). Per tab (sessionStorage, page memory when the
 * store is blocked), five minutes, and only for the account that wrote it:
 * the entry carries its owner, so another account on the same device never
 * reads it, and logout clears it (clearAccountState).
 */
import { safeSessionStorage } from "./safe-storage";

export const CLIENT_READ_CACHE_TTL_MS = 5 * 60_000;

export const REFERRAL_STATUS_CACHE_KEY = "medpruef_referral_status_v1";
export const ANNOUNCEMENT_STATE_CACHE_KEY = "medpruef_announcement_state_v1";
export const CLIENT_READ_CACHE_KEYS = [REFERRAL_STATUS_CACHE_KEY, ANNOUNCEMENT_STATE_CACHE_KEY] as const;

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): boolean; removeItem(k: string): void };
type Entry<T> = { owner: string; at: number; value: T };

/** The cached value when `owner` wrote it less than five minutes ago, else undefined. */
export function readAccountCache<T>(key: string, owner: string | null | undefined, now: number = Date.now(), store: Store = safeSessionStorage): T | undefined {
  if (!owner) return undefined;
  const raw = store.getItem(key);
  if (!raw) return undefined;
  try {
    const entry = JSON.parse(raw) as Partial<Entry<T>>;
    if (entry.owner !== owner || typeof entry.at !== "number") return undefined;
    const age = now - entry.at;
    if (age < 0 || age >= CLIENT_READ_CACHE_TTL_MS) return undefined;
    return entry.value as T;
  } catch {
    return undefined;
  }
}

export function writeAccountCache<T>(key: string, owner: string | null | undefined, value: T, now: number = Date.now(), store: Store = safeSessionStorage): void {
  if (!owner || owner.startsWith("guest_")) return;
  store.setItem(key, JSON.stringify({ owner, at: now, value } satisfies Entry<T>));
}

export function forgetAccountCache(key: string, store: Pick<Store, "removeItem"> = safeSessionStorage): void {
  store.removeItem(key);
}
