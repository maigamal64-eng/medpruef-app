"use client";

/**
 * offlineDb — IndexedDB wrapper for the MedPrüf offline mode.
 *
 * User backlog item #7 — 6/11 surveys flagged offline mode as the #1
 * improvement. Users study on trains, metros, and hospital floors
 * where WiFi drops out mid-session. The existing PWA cache only
 * captures already-visited pages; going offline before pre-loading
 * questions drops the user cold.
 *
 * This module is the first half of the fix: a small, focused wrapper
 * around the native IndexedDB API — no npm deps, no broad surface.
 *
 * Two object stores:
 *   - `questions`       — question rows downloaded via /api/offline/questions,
 *                         keyed by id, indexed by (exam_type, topic) so the quiz
 *                         can pull a topic-filtered batch without scanning.
 *   - `pending_answers` — answers recorded while offline, keyed by a UUID so the
 *                         reconnect handler in src/lib/offlineSync.ts can drain
 *                         them to /api/answer one-by-one.
 *
 * The DB is `medpruef-offline` at version 1. If the schema needs to grow
 * (e.g. add a `pending_flags` store), bump DB_VERSION and handle the
 * migration inside `onupgradeneeded`.
 */

export interface OfflineQuestion {
  id: number;
  topic: string;
  question: string;
  answer: string;
  explanation: string | null;
  ai_explanation: string | null;
  exam_type: string;
  choices: unknown;
  image_url: string | null;
  image_urls: string[] | null;
  exam_dates: string[];
  tags: string[];
  cached_at: string;
}

export interface PendingAnswer {
  id: string;
  /**
   * Account that answered, so queued rows cannot leak into a later login.
   * Optional only for legacy v1 rows created before account ownership was
   * stored. New rows always require a userId in queuePendingAnswer.
   */
  userId?: string;
  questionId: number;
  userAnswer: string;
  isCorrect: boolean;
  timeSpentMs: number;
  createdAt: string;
  /** Failed replay attempts (UX-PRA-45); see shouldGiveUp in offlineSync for when a row is dropped. */
  attempts?: number;
  /** Flashcard rating queued after a server failure (a-stability): replayed as sent. */
  grade?: number;
  kind?: "quiz" | "flashcard";
  /** a-fo-07: fingerprint of the answer key the quiz graded against, replayed as sent. */
  keyFingerprint?: string;
}

/** Select only answers owned by the currently authenticated account. */
export function pendingAnswersForUser(
  pending: PendingAnswer[],
  userId: string | null | undefined,
): PendingAnswer[] {
  if (!userId) return [];
  return pending.filter((answer) => answer.userId === userId);
}

/** Keep pre-ownership rows visible for recovery, but never infer their owner. */
export function unownedPendingAnswers(pending: PendingAnswer[]): PendingAnswer[] {
  return pending.filter((answer) => !answer.userId);
}

/** Explicitly adopt only ownerless legacy rows after a user confirms ownership. */
export function claimUnownedPendingAnswers(
  pending: PendingAnswer[],
  userId: string | null | undefined,
): PendingAnswer[] {
  if (!userId) return pending;
  return pending.map((answer) => {
    if (answer.userId) return answer;
    const id = isUuidRequestId(answer.id) ? answer.id : createRequestId();
    return { ...answer, id, userId };
  });
}

const DB_NAME = "medpruef-offline";
const DB_VERSION = 1;
const QUESTIONS_STORE = "questions";
const PENDING_STORE = "pending_answers";

let dbPromise: Promise<IDBDatabase> | null = null;

function createRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Keep the UUID format accepted by /api/answer even in older WebViews.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    return (char === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function isUuidRequestId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

function isIndexedDbAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined";
}

/**
 * Lazily open (or upgrade) the IDB database. Subsequent callers reuse
 * the same Promise. On hard failure (Safari private-mode, corrupt DB)
 * the Promise rejects and callers should fall back to online flow.
 */
export function openDb(): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(new Error("IndexedDB unavailable"));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(QUESTIONS_STORE)) {
        const store = db.createObjectStore(QUESTIONS_STORE, { keyPath: "id" });
        store.createIndex("by_exam_topic", ["exam_type", "topic"]);
        store.createIndex("by_exam", "exam_type");
      }
      if (!db.objectStoreNames.contains(PENDING_STORE)) {
        db.createObjectStore(PENDING_STORE, { keyPath: "id" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IDB open failed"));
    req.onblocked = () => reject(new Error("IDB open blocked"));
  });

  return dbPromise;
}

function tx(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
): IDBObjectStore {
  return db.transaction(store, mode).objectStore(store);
}

/**
 * Bulk-write a batch of questions into the `questions` store. Uses a
 * single readwrite transaction so partial writes don't leave the store
 * inconsistent; resolves once `oncomplete` fires.
 */
export async function putQuestions(qs: OfflineQuestion[]): Promise<void> {
  if (qs.length === 0) return;
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(QUESTIONS_STORE, "readwrite");
    const store = transaction.objectStore(QUESTIONS_STORE);
    for (const q of qs) {
      // `put` — insert-or-replace, so re-downloads refresh stale rows.
      store.put(q);
    }
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("putQuestions failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("putQuestions aborted"));
  });
}

/**
 * Read all questions for a given exam_type + topic. Optional limit
 * returns the first N (in insertion order); pass 0/undefined for all.
 */
export async function getQuestionsByTopic(
  examType: string,
  topic: string,
  limit?: number,
): Promise<OfflineQuestion[]> {
  const db = await openDb();
  return new Promise<OfflineQuestion[]>((resolve, reject) => {
    const store = tx(db, QUESTIONS_STORE, "readonly");
    const index = store.index("by_exam_topic");
    const range = IDBKeyRange.only([examType, topic]);
    const results: OfflineQuestion[] = [];
    const cursorReq = index.openCursor(range);
    cursorReq.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        results.push(cursor.value as OfflineQuestion);
        if (typeof limit === "number" && limit > 0 && results.length >= limit) {
          resolve(results);
          return;
        }
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    cursorReq.onerror = () =>
      reject(cursorReq.error ?? new Error("getQuestionsByTopic failed"));
  });
}

/**
 * Read all questions for a given exam_type. Used by the quiz offline
 * branch when the user has no topic filter.
 */
export async function getAllQuestions(
  examType: string,
): Promise<OfflineQuestion[]> {
  const db = await openDb();
  return new Promise<OfflineQuestion[]>((resolve, reject) => {
    const store = tx(db, QUESTIONS_STORE, "readonly");
    const index = store.index("by_exam");
    const range = IDBKeyRange.only(examType);
    const req = index.getAll(range);
    req.onsuccess = () => resolve((req.result as OfflineQuestion[]) ?? []);
    req.onerror = () =>
      reject(req.error ?? new Error("getAllQuestions failed"));
  });
}

/**
 * Count questions in the store. Optional `examType` narrows to a single
 * exam; pass undefined for total across all exams.
 */
export async function countQuestions(examType?: string): Promise<number> {
  if (!isIndexedDbAvailable()) return 0;
  try {
    const db = await openDb();
    return new Promise<number>((resolve, reject) => {
      const store = tx(db, QUESTIONS_STORE, "readonly");
      let req: IDBRequest<number>;
      if (examType) {
        const index = store.index("by_exam");
        req = index.count(IDBKeyRange.only(examType));
      } else {
        req = store.count();
      }
      req.onsuccess = () => resolve(req.result ?? 0);
      req.onerror = () =>
        reject(req.error ?? new Error("countQuestions failed"));
    });
  } catch {
    // IndexedDB unavailable (private-mode Safari, blocked, etc.) — the
    // settings UI just shows 0, which is accurate.
    return 0;
  }
}

/**
 * Queue an answer for sync on reconnect. Assigns a UUID id + createdAt
 * timestamp so the caller doesn't have to.
 */
export async function queuePendingAnswer(
  p: Omit<PendingAnswer, "id" | "createdAt" | "userId"> & {
    userId: string;
    id?: string;
  },
): Promise<string> {
  const db = await openDb();
  const row: PendingAnswer = {
    ...p,
    id: p.id || createRequestId(),
    createdAt: new Date().toISOString(),
  };
  return new Promise<string>((resolve, reject) => {
    const transaction = db.transaction(PENDING_STORE, "readwrite");
    transaction.objectStore(PENDING_STORE).put(row);
    transaction.oncomplete = () => resolve(row.id);
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("queuePendingAnswer failed"));
  });
}

/** Store a changed queued row (attempt counter) without touching any other row. */
export async function updatePendingAnswer(row: PendingAnswer): Promise<void> {
  if (!isIndexedDbAvailable()) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(PENDING_STORE, "readwrite");
    transaction.objectStore(PENDING_STORE).put(row);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("updatePendingAnswer failed"));
  });
}

/**
 * Read every queued answer. Does NOT delete them — the sync handler in
 * src/lib/offlineSync.ts removes each row only after a successful POST
 * to /api/answer, so network flakiness can't drop data.
 */
export async function drainPendingAnswers(): Promise<PendingAnswer[]> {
  if (!isIndexedDbAvailable()) return [];
  try {
    const db = await openDb();
    return new Promise<PendingAnswer[]>((resolve, reject) => {
      const store = tx(db, PENDING_STORE, "readonly");
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as PendingAnswer[]) ?? []);
      req.onerror = () =>
        reject(req.error ?? new Error("drainPendingAnswers failed"));
    });
  } catch {
    return [];
  }
}

export async function countPendingAnswers(userId?: string | null): Promise<number> {
  if (!userId) return 0;
  if (!isIndexedDbAvailable()) return 0;
  try {
    const db = await openDb();
    return await new Promise<number>((resolve, reject) => {
      const req = tx(db, PENDING_STORE, "readonly").getAll();
      req.onsuccess = () => resolve(
        pendingAnswersForUser((req.result as PendingAnswer[]) ?? [], userId).length,
      );
      req.onerror = () => reject(req.error ?? new Error("countPendingAnswers failed"));
    });
  } catch {
    return 0;
  }
}

/** Count legacy rows separately so Settings can explain they are preserved. */
export async function countUnownedPendingAnswers(): Promise<number> {
  if (!isIndexedDbAvailable()) return 0;
  try {
    const db = await openDb();
    return await new Promise<number>((resolve, reject) => {
      const req = tx(db, PENDING_STORE, "readonly").getAll();
      req.onsuccess = () => resolve(
        unownedPendingAnswers((req.result as PendingAnswer[]) ?? []).length,
      );
      req.onerror = () => reject(req.error ?? new Error("countUnownedPendingAnswers failed"));
    });
  } catch {
    return 0;
  }
}

/**
 * Attach legacy rows to the account only after an explicit user confirmation.
 * Existing account-owned rows are never changed. This keeps rows on-device
 * until the owner confirms and allows the normal account-filtered sync to run.
 */
export async function claimUnownedPendingAnswersForUser(userId: string): Promise<number> {
  if (!userId || !isIndexedDbAvailable()) return 0;
  const db = await openDb();
  return new Promise<number>((resolve, reject) => {
    const transaction = db.transaction(PENDING_STORE, "readwrite");
    const store = transaction.objectStore(PENDING_STORE);
    const request = store.getAll();
    let claimedCount = 0;
    request.onsuccess = () => {
      const rows = (request.result as PendingAnswer[]) ?? [];
      const claimedRows = claimUnownedPendingAnswers(rows, userId);
      for (let index = 0; index < claimedRows.length; index += 1) {
        const row = claimedRows[index];
        if (!row.userId) continue;
        const original = rows[index];
        if (original && !original.userId) {
          if (original.id !== row.id) store.delete(original.id);
          store.put(row);
          claimedCount += 1;
        }
      }
    };
    request.onerror = () => transaction.abort();
    transaction.oncomplete = () => resolve(claimedCount);
    transaction.onerror = () => reject(transaction.error ?? new Error("claimUnownedPendingAnswers failed"));
    transaction.onabort = () => reject(transaction.error ?? request.error ?? new Error("claimUnownedPendingAnswers aborted"));
  });
}

/**
 * Remove a pending answer — called after a successful sync POST.
 */
export async function removePendingAnswer(id: string): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(PENDING_STORE, "readwrite");
    transaction.objectStore(PENDING_STORE).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("removePendingAnswer failed"));
  });
}

/**
 * Wipe every offline question + pending answer. Exposed in the Settings
 * UI as "Offline-Daten löschen" — used when the user wants to free
 * storage or start fresh after changing active exam.
 */
export async function clearAllOffline(): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(
      [QUESTIONS_STORE, PENDING_STORE],
      "readwrite",
    );
    transaction.objectStore(QUESTIONS_STORE).clear();
    transaction.objectStore(PENDING_STORE).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("clearAllOffline failed"));
  });
}

/** Remove downloaded question content without discarding unsynced answers. */
export async function clearOfflineQuestions(): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(QUESTIONS_STORE, "readwrite");
    transaction.objectStore(QUESTIONS_STORE).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("clearOfflineQuestions failed"));
  });
}

/**
 * Last-download timestamp helpers. Stored in localStorage (not IDB) so
 * Settings can show it without opening a transaction. Key is per-exam
 * so switching exams reveals the right "last sync" time.
 */
const LAST_SYNC_KEY = (examType: string) => `medpruef_offline_last_sync_${examType}`;

export function getLastSync(examType: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(LAST_SYNC_KEY(examType));
  } catch {
    return null;
  }
}

export function setLastSync(examType: string, iso: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LAST_SYNC_KEY(examType), iso);
  } catch {
    // quota / privacy mode — silently ignore
  }
}

export function clearLastSync(examType: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LAST_SYNC_KEY(examType));
  } catch {
    // storage may be disabled
  }
}
