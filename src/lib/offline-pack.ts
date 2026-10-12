"use client";

/**
 * Offline pack downloader (LX-16, ACC-50). A pack is a whole topic or the
 * whole bank of one exam, fetched in chunks of 100 by id cursor from
 * GET /api/offline/questions, stored in IndexedDB (offlineDb) and, when the
 * learner asks for it, with its question images in OFFLINE_IMAGE_CACHE.
 *
 * Resumable: after every stored chunk the cursor is saved per scope, so a
 * download stopped by the network or a closed tab continues where it stopped.
 * Every failure has its own reason (offline, sign-in, storage full, server).
 *
 * Shared devices: the downloaded content belongs to the account that loaded
 * it. ensureOfflineOwner() clears the questions, images and cursors when a
 * different account signs in on the device; unsynced answers are never
 * touched (they carry their own owner, offlineDb.pendingAnswersForUser).
 */
import {
  clearLastSync,
  clearOfflineQuestions,
  putQuestions,
  setLastSync,
  type OfflineQuestion,
} from "./offlineDb";
import {
  OFFLINE_CHUNK_SIZE,
  OFFLINE_MAX_IMAGES_PER_PACK,
  packCursorKey,
} from "./offline-pack-rules";
import {
  OFFLINE_IMAGE_CACHE,
  collectImageUrls,
  warmImageCache,
} from "./master-pwa/offline-images";
import { requestOfflinePersistence } from "./offline-persist";
import { safeStorage } from "./safe-storage";
import { EXAM_SOURCE_IDS } from "./topics";

export const OFFLINE_OWNER_KEY = "medpruef_offline_owner";
/** { accessUntil: ISO | null } of the paid access that allowed the stored pack. */
export const OFFLINE_ACCESS_KEY = "medpruef_offline_access";

export interface PackScope {
  examType: string;
  /** null = the whole bank of examType. */
  topic: string | null;
}

export interface PackSummary {
  total: number;
  images: number;
  estimatedTextBytes: number;
  topics: { topic: string; count: number }[];
  /** True when the free allowance bounds the pack. */
  limited: boolean;
}

export type PackFailure = "offline" | "auth" | "quota" | "rate" | "server" | "aborted";

export interface PackProgress {
  stored: number;
  total: number | null;
  textBytes: number;
  imagesCached: number;
  imageBytes: number;
}

export type PackResult =
  | { ok: true; progress: PackProgress; imagesSkipped: number; imagesFailed: number }
  | { ok: false; reason: PackFailure; progress: PackProgress };

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

function scopeQuery(scope: PackScope): string {
  const params = new URLSearchParams({ examType: scope.examType });
  if (scope.topic) params.set("topic", scope.topic);
  return params.toString();
}

function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

export function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: string }).name ?? "";
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED";
}

export async function fetchPackSummary(fetchFn: FetchFn, scope: PackScope): Promise<PackSummary | PackFailure> {
  if (isOffline()) return "offline";
  try {
    const res = await fetchFn(`/api/offline/questions?${scopeQuery(scope)}&summary=1`);
    if (res.status === 401 || res.status === 403) return "auth";
    if (res.status === 429) return "rate";
    if (!res.ok) return "server";
    const body = (await res.json()) as Partial<PackSummary>;
    if (typeof body.total !== "number") return "server";
    return {
      total: body.total,
      images: typeof body.images === "number" ? body.images : 0,
      estimatedTextBytes: typeof body.estimatedTextBytes === "number" ? body.estimatedTextBytes : 0,
      topics: Array.isArray(body.topics) ? body.topics.filter((t) => t && typeof t.topic === "string") : [],
      limited: body.limited === true,
    };
  } catch {
    return isOffline() ? "offline" : "server";
  }
}

export function readPackCursor(scope: PackScope): number | null {
  const raw = safeStorage.getItem(packCursorKey(scope.examType, scope.topic));
  const value = raw ? Number(raw) : NaN;
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function writePackCursor(scope: PackScope, cursor: number | null): void {
  const key = packCursorKey(scope.examType, scope.topic);
  if (cursor === null) safeStorage.removeItem(key);
  else safeStorage.setItem(key, String(cursor));
}

async function openImageCache(): Promise<Cache | null> {
  try {
    if (typeof caches === "undefined") return null;
    return await caches.open(OFFLINE_IMAGE_CACHE);
  } catch {
    return null;
  }
}

/**
 * Download one pack. `resume` continues from the saved cursor of this scope;
 * otherwise the pack starts from its first question (stored rows are simply
 * replaced, put is insert-or-replace).
 */
export async function downloadPack(opts: {
  fetchFn: FetchFn;
  scope: PackScope;
  userId: string;
  includeImages: boolean;
  total?: number | null;
  resume?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: PackProgress) => void;
}): Promise<PackResult> {
  const { fetchFn, scope, includeImages, signal, onProgress } = opts;
  const progress: PackProgress = { stored: 0, total: opts.total ?? null, textBytes: 0, imagesCached: 0, imageBytes: 0 };
  let imagesSkipped = 0;
  let imagesFailed = 0;
  let imageBudget = OFFLINE_MAX_IMAGES_PER_PACK;
  await ensureOfflineOwner(opts.userId);
  const imageCache = includeImages ? await openImageCache() : null;
  let cursor = opts.resume ? readPackCursor(scope) : null;
  let persistenceAsked = false;
  let accessUntil: string | null = null;
  let limitedPack = false;

  for (;;) {
    if (signal?.aborted) return { ok: false, reason: "aborted", progress };
    if (isOffline()) return { ok: false, reason: "offline", progress };
    let rows: OfflineQuestion[];
    let next: number | null;
    try {
      const after = cursor !== null ? `&afterId=${cursor}` : "";
      const res = await fetchFn(`/api/offline/questions?${scopeQuery(scope)}&count=${OFFLINE_CHUNK_SIZE}${after}`, { signal });
      if (res.status === 401 || res.status === 403) return { ok: false, reason: "auth", progress };
      if (res.status === 429) return { ok: false, reason: "rate", progress };
      if (!res.ok) return { ok: false, reason: "server", progress };
      const body = (await res.json()) as { questions?: OfflineQuestion[]; nextAfterId?: number | null; sizeBytes?: number; accessUntil?: string | null; limited?: boolean };
      rows = Array.isArray(body.questions) ? body.questions : [];
      next = typeof body.nextAfterId === "number" ? body.nextAfterId : null;
      progress.textBytes += typeof body.sizeBytes === "number" ? body.sizeBytes : 0;
      accessUntil = typeof body.accessUntil === "string" ? body.accessUntil : null;
      limitedPack = body.limited === true;
      // A cursor that does not move forward would loop for ever.
      if (next !== null && cursor !== null && next <= cursor) return { ok: false, reason: "server", progress };
    } catch (error) {
      if (signal?.aborted || (error as { name?: string })?.name === "AbortError") return { ok: false, reason: "aborted", progress };
      return { ok: false, reason: isOffline() ? "offline" : "server", progress };
    }

    if (rows.length > 0) {
      try {
        await putQuestions(rows);
      } catch (error) {
        return { ok: false, reason: isQuotaError(error) ? "quota" : "server", progress };
      }
      if (!persistenceAsked) {
        // LX-14: ask once, after the first chunk is safely stored. A request,
        // never a promise: the browser may say no (Settings shows the answer).
        persistenceAsked = true;
        void requestOfflinePersistence();
      }
      progress.stored += rows.length;
      // A free-slice download never lifts the end date of paid content
      // already on the device; a paid download sets the current one.
      if (!limitedPack) writePackAccess(accessUntil);
      setLastSync(scope.examType, new Date().toISOString());

      if (imageCache && imageBudget > 0 && typeof window !== "undefined") {
        const urls = collectImageUrls(rows, window.location.origin, imageBudget);
        if (urls.length > 0) {
          const warm = await warmImageCache({ cache: imageCache, fetchFn: fetch, urls, signal });
          imageBudget -= urls.length;
          progress.imagesCached += warm.cached;
          progress.imageBytes += warm.bytes;
          imagesSkipped += warm.skipped;
          imagesFailed += warm.failed;
        }
      }
      // Resume point only after the rows and their images are stored.
      if (signal?.aborted) return { ok: false, reason: "aborted", progress };
      writePackCursor(scope, next);
    }
    onProgress?.({ ...progress });
    if (next === null) {
      writePackCursor(scope, null);
      return { ok: true, progress, imagesSkipped, imagesFailed };
    }
    cursor = next;
  }
}

/**
 * Store the end of the paid access that allowed the pack. The latest chunk
 * wins: null means a free pack or access without an end date.
 */
function writePackAccess(accessUntil: string | null): void {
  safeStorage.setItem(OFFLINE_ACCESS_KEY, JSON.stringify({ accessUntil }));
}

/**
 * Online truth for a paid pack (called after every successful /api/auth/me
 * read in useUserTier). A renewal moves the end date forward, so the stamp is
 * rewritten from the live value; when the account no longer has paid access
 * the pack is cleared, because the server confirmed it. Free-only packs
 * (no stamp) are never touched.
 */
export async function syncPackAccess(live: { isPaid: boolean; tierExpiresAt: string | null; role: string }): Promise<"none" | "updated" | "cleared"> {
  if (safeStorage.getItem(OFFLINE_ACCESS_KEY) === null) return "none";
  if (live.isPaid) {
    writePackAccess(live.role === "admin" ? null : live.tierExpiresAt);
    return "updated";
  }
  await clearOfflinePack();
  return "cleared";
}

/**
 * True when the stored pack came from paid access whose end date has passed
 * on this device's clock. The offline quiz then refuses the pack until an
 * online check (syncPackAccess) renews or clears it; it never deletes on its
 * own, since a renewal may simply not have been seen yet.
 */
export function isPackAccessExpired(now: number = Date.now()): boolean {
  try {
    const raw = safeStorage.getItem(OFFLINE_ACCESS_KEY);
    if (!raw) return false;
    const until = (JSON.parse(raw) as { accessUntil?: unknown }).accessUntil;
    if (typeof until !== "string") return false;
    const end = Date.parse(until);
    return Number.isFinite(end) && end < now;
  } catch {
    return false;
  }
}

/** Remove downloaded questions, their images, cursors and sync stamps (never queued answers). */
export async function clearOfflinePack(): Promise<void> {
  await clearOfflineQuestions();
  safeStorage.removeItem(OFFLINE_ACCESS_KEY);
  try {
    if (typeof caches !== "undefined") await caches.delete(OFFLINE_IMAGE_CACHE);
  } catch {
    /* Cache API unavailable: nothing stored there */
  }
  for (const exam of EXAM_SOURCE_IDS) clearLastSync(exam);
  try {
    if (typeof window !== "undefined") {
      const keys: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key && key.startsWith("medpruef_offline_cursor:")) keys.push(key);
      }
      for (const key of keys) window.localStorage.removeItem(key);
    }
  } catch {
    /* storage blocked */
  }
}

/**
 * Bind downloaded content to one account. Returns true when a previous
 * account's pack was cleared. Guest and empty ids never own a pack.
 */
export async function ensureOfflineOwner(userId: string | null | undefined): Promise<boolean> {
  if (!userId || userId.startsWith("guest_")) return false;
  const owner = safeStorage.getItem(OFFLINE_OWNER_KEY);
  if (owner === userId) return false;
  let cleared = false;
  if (owner) {
    await clearOfflinePack();
    cleared = true;
  }
  safeStorage.setItem(OFFLINE_OWNER_KEY, userId);
  return cleared;
}
