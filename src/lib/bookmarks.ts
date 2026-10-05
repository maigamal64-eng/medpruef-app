import { authFetch } from "@/lib/authFetch";

const STORAGE_KEY = "medpruef_favorites";
export const BOOKMARK_EVENT = "medpruef-bookmarks-changed";
const CACHE_TTL_MS = 30_000;

type PendingBookmark = { questionId: number; isBookmarked: boolean } | { clearAll: true };
const remoteCache = new Map<string, { ids: number[]; fetchedAt: number }>();
const remoteLoads = new Map<string, Promise<number[] | null>>();
const mutationVersions = new Map<string, number>();

function validIds(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((id): id is number =>
    typeof id === "number" && Number.isSafeInteger(id) && id > 0,
  )));
}

export function bookmarkStorageKey(userId: string): string {
  return `${STORAGE_KEY}:${userId}`;
}

function pendingStorageKey(userId: string): string {
  return `${STORAGE_KEY}:pending:${userId}`;
}

function readLegacyIds(): number[] {
  if (typeof window === "undefined") return [];
  try {
    return validIds(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));
  } catch {
    return [];
  }
}

/** Availability only. Callers must not display the ownerless IDs. */
export function hasLegacyBookmarks(): boolean {
  return readLegacyIds().length > 0;
}

export function readCachedBookmarks(userId: string): number[] {
  if (typeof window === "undefined" || !userId) return [];
  try {
    return validIds(JSON.parse(localStorage.getItem(bookmarkStorageKey(userId)) || "[]"));
  } catch {
    return [];
  }
}

export function writeCachedBookmarks(userId: string, ids: number[]): void {
  if (typeof window === "undefined" || !userId) return;
  const normalized = validIds(ids);
  try {
    localStorage.setItem(bookmarkStorageKey(userId), JSON.stringify(normalized));
  } catch {
    // The server remains authoritative if local storage is unavailable.
  }
  window.dispatchEvent(new Event(BOOKMARK_EVENT));
}

function readPending(userId: string): PendingBookmark[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(pendingStorageKey(userId)) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter((item): item is PendingBookmark => {
      if (!item || typeof item !== "object") return false;
      if ((item as { clearAll?: unknown }).clearAll === true) return true;
      const change = item as { questionId?: unknown; isBookmarked?: unknown };
      return Number.isSafeInteger(change.questionId) && Number(change.questionId) > 0 && typeof change.isBookmarked === "boolean";
    });
  } catch {
    return [];
  }
}

/** Loads only the signed-in account's bookmarks and replays that account's offline changes. */
export async function loadBookmarks(userId: string): Promise<number[] | null> {
  if (!userId) return null;
  const cached = remoteCache.get(userId);
  const pending = readPending(userId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS && pending.length === 0) return cached.ids;
  const active = remoteLoads.get(userId);
  if (active) return active;

  const load = (async () => {
    const startingVersion = mutationVersions.get(userId) || 0;
    const clearQueued = pending.find((change) => "clearAll" in change);
    if (clearQueued) {
      const cleared = await authFetch("/api/bookmarks", { method: "DELETE" });
      if (!cleared.ok) return null;
      const remaining = pending.filter((change) => !("clearAll" in change));
      if (remaining.length) localStorage.setItem(pendingStorageKey(userId), JSON.stringify(remaining));
      else localStorage.removeItem(pendingStorageKey(userId));
    }
    const response = await authFetch("/api/bookmarks", { cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json() as { questionIds?: unknown };
    if (!Array.isArray(payload.questionIds)) return null;
    let ids = validIds(payload.questionIds);
    if (clearQueued) ids = [];
    const changes = pending.filter((change): change is Extract<PendingBookmark, { questionId: number }> => !("clearAll" in change));
    for (const change of changes) {
      const next = new Set(ids);
      if (change.isBookmarked) next.add(change.questionId);
      else next.delete(change.questionId);
      const saved = await authFetch("/api/bookmarks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(change),
      });
      if (!saved.ok) return null;
      ids = Array.from(next);
    }
    if (changes.length) {
      localStorage.removeItem(pendingStorageKey(userId));
      const refreshed = await authFetch("/api/bookmarks", { cache: "no-store" });
      if (!refreshed.ok) return null;
      const finalPayload = await refreshed.json() as { questionIds?: unknown };
      if (!Array.isArray(finalPayload.questionIds)) return null;
      ids = validIds(finalPayload.questionIds);
    }
    if ((mutationVersions.get(userId) || 0) !== startingVersion) return readCachedBookmarks(userId);
    writeCachedBookmarks(userId, ids);
    remoteCache.set(userId, { ids, fetchedAt: Date.now() });
    return ids;
  })().catch(() => null).finally(() => remoteLoads.delete(userId));

  remoteLoads.set(userId, load);
  return load;
}

/** Optimistic account-scoped update; failed network writes are kept for replay. */
export async function setBookmark(userId: string, questionId: number, isBookmarked: boolean): Promise<number[]> {
  mutationVersions.set(userId, (mutationVersions.get(userId) || 0) + 1);
  const previousIds = readCachedBookmarks(userId);
  const ids = new Set(previousIds);
  if (isBookmarked) ids.add(questionId);
  else ids.delete(questionId);
  const next = Array.from(ids);
  writeCachedBookmarks(userId, next);
  remoteCache.set(userId, { ids: next, fetchedAt: Date.now() });
  try {
    const response = await authFetch("/api/bookmarks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ questionId, isBookmarked }),
    });
    if (response.status === 401 || response.status === 403) {
      writeCachedBookmarks(userId, previousIds);
      remoteCache.set(userId, { ids: previousIds, fetchedAt: Date.now() });
      return previousIds;
    }
    if (!response.ok) throw new Error("Bookmark save failed");
    const pending = readPending(userId).filter((item) => "clearAll" in item || item.questionId !== questionId);
    if (pending.length) localStorage.setItem(pendingStorageKey(userId), JSON.stringify(pending));
  } catch {
    try {
      const pending = readPending(userId).filter((item) => "clearAll" in item || item.questionId !== questionId);
      pending.push({ questionId, isBookmarked });
      localStorage.setItem(pendingStorageKey(userId), JSON.stringify(pending));
    } catch {
      // The account-scoped cache still preserves offline UI for this account.
    }
  }
  return next;
}

/** Explicitly imports ownerless browser bookmarks into the signed-in account. */
export async function importLegacyBookmarks(userId: string): Promise<number> {
  if (!userId) return 0;
  const legacyIds = readLegacyIds();
  if (!legacyIds.length) return 0;
  const current = new Set(readCachedBookmarks(userId));
  const serverIds = await loadBookmarks(userId);
  for (const id of serverIds || []) current.add(id);
  let imported = 0;
  for (const id of legacyIds) {
    if (current.has(id)) continue;
    const next = await setBookmark(userId, id, true);
    if (next.includes(id)) {
      current.add(id);
      imported++;
    }
  }
  return imported;
}

/** Clears only this account's bookmarks. Failed/offline clears are journaled. */
export async function clearAccountBookmarks(userId: string): Promise<void> {
  if (!userId) return;
  mutationVersions.set(userId, (mutationVersions.get(userId) || 0) + 1);
  writeCachedBookmarks(userId, []);
  remoteCache.set(userId, { ids: [], fetchedAt: Date.now() });
  try {
    localStorage.removeItem(bookmarkStorageKey(userId));
  } catch {
    // Keep the in-memory account cache empty if persistent storage is blocked.
  }
  try {
    const response = await authFetch("/api/bookmarks", { method: "DELETE" });
    if (!response.ok) throw new Error("Bookmark clear failed");
    localStorage.removeItem(pendingStorageKey(userId));
  } catch {
    try {
      localStorage.setItem(pendingStorageKey(userId), JSON.stringify([{ clearAll: true }]));
    } catch {
      // Keep this account's visible local list empty even if the journal cannot be stored.
    }
  }
}
