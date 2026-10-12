/**
 * Last topic list per account and bank (UX-HOME-07). Paints Home's topic grid
 * at once while the network answers; the fresh list always replaces it. The
 * key is bound to the account owner (storage-keys.ts) and cleared on logout
 * or an account switch; another account's or bank's list is never returned.
 */
import { safeStorage } from "@/lib/safe-storage";
import type { HomeTopic } from "@/lib/home-topics-request";

export const HOME_TOPICS_CACHE_KEY = "medpruef_home_topics_v1";

interface Entry { userId: string; lists: Record<string, HomeTopic[]> }

function read(): Entry | null {
  try {
    const raw = safeStorage.getItem(HOME_TOPICS_CACHE_KEY);
    return raw ? (JSON.parse(raw) as Entry) : null;
  } catch {
    return null;
  }
}

const valid = (v: unknown): v is HomeTopic[] =>
  Array.isArray(v) && v.every((t) => t && typeof t.topic === "string" && Number.isInteger(t.count) && t.count >= 0);

export function readHomeTopicsCache(userId: string, exam: string): HomeTopic[] | null {
  const entry = read();
  if (!entry || entry.userId !== userId) return null;
  const list = entry.lists?.[exam];
  return valid(list) && list.length > 0 ? list : null;
}

export function writeHomeTopicsCache(userId: string, exam: string, topics: HomeTopic[]): void {
  if (!userId || userId.startsWith("guest_")) return;
  const entry = read();
  const lists = entry && entry.userId === userId ? { ...entry.lists } : {};
  lists[exam] = topics;
  try { safeStorage.setItem(HOME_TOPICS_CACHE_KEY, JSON.stringify({ userId, lists } satisfies Entry)); } catch { /* storage blocked */ }
}
