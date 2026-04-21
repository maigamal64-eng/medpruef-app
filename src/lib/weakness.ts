/**
 * Weakness detection library.
 *
 * Two layered APIs:
 *
 *   1. `getServerWeakness()` / `getServerAllStrengths()` (preferred) —
 *      async functions that read from `/api/user/topic-strength`, which
 *      in turn reads the server-side `user_topic_strength` table. This
 *      is the cross-device source of truth (backlog #13, 2026-04-21).
 *      Results are cached in sessionStorage for 5 minutes to keep
 *      component re-renders cheap.
 *
 *   2. Legacy localStorage helpers (`getWeakTopics`, `getStrengthTopics`,
 *      `getAllTopicStats`, `addQuizResult`, `recordAnswer`) — kept for
 *      backwards compatibility only. New callers should use the
 *      server-side async API above. These are DEPRECATED and will be
 *      removed once every caller is migrated.
 */
import { authFetch } from "@/lib/authFetch";

export interface TopicStats {
  topic: string;
  correct: number;
  total: number;
  accuracy: number;
}

export interface QuizResult {
  topic: string;
  questionId: string;
  correct: boolean;
  timestamp: string;
}

/** Shape returned by `/api/user/topic-strength`. */
export interface TopicStrength {
  examType: string;
  topic: string;
  answered: number;
  correct: number;
  accuracy: number;
  lastAnsweredAt: string;
}

// ───────────────────────────────────────────────────────────────
// Server-side API (preferred, cross-device)
// ───────────────────────────────────────────────────────────────

const SERVER_CACHE_KEY = "medpruef_topic_strength_cache_v1";
const SERVER_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface ServerCacheEntry {
  fetchedAt: number;
  examType: string | null;
  strengths: TopicStrength[];
}

function readServerCache(examType: string | null): TopicStrength[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(SERVER_CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as ServerCacheEntry;
    if (!entry || !Array.isArray(entry.strengths)) return null;
    if (entry.examType !== examType) return null;
    if (Date.now() - entry.fetchedAt > SERVER_CACHE_TTL_MS) return null;
    return entry.strengths;
  } catch {
    return null;
  }
}

function writeServerCache(examType: string | null, strengths: TopicStrength[]) {
  if (typeof window === "undefined") return;
  try {
    const entry: ServerCacheEntry = {
      fetchedAt: Date.now(),
      examType,
      strengths,
    };
    sessionStorage.setItem(SERVER_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // sessionStorage can be disabled / over-quota — cache miss is fine.
  }
}

/**
 * Invalidate the sessionStorage cache. Call this after submitting an
 * answer so the next page that needs strengths fetches fresh data.
 */
export function invalidateServerWeaknessCache(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(SERVER_CACHE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Load the authenticated user's per-topic strength rows from the server,
 * optionally scoped to a single exam type. Cached in sessionStorage for
 * 5 minutes to avoid repeated fetches inside a single render tree.
 *
 * Returns [] on any error (network, unauthenticated, etc.) so callers
 * can render a sensible "no data" UI instead of crashing.
 */
export async function getServerWeakness(examType?: string): Promise<TopicStrength[]> {
  const key = examType ?? null;
  const cached = readServerCache(key);
  if (cached) return cached;

  if (typeof window === "undefined") return [];

  try {
    const url = examType
      ? `/api/user/topic-strength?examType=${encodeURIComponent(examType)}`
      : "/api/user/topic-strength";
    const res = await authFetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    const json = (await res.json()) as { strengths?: TopicStrength[] };
    const strengths = Array.isArray(json.strengths) ? json.strengths : [];
    writeServerCache(key, strengths);
    return strengths;
  } catch (err) {
    console.error("[weakness] getServerWeakness failed:", err);
    return [];
  }
}

/**
 * Convenience: weak topics only (accuracy < 60%, answered >= 5).
 * Matches the legacy `getWeakTopics` threshold so UI callers keep the
 * same contract when migrating from localStorage to server.
 */
export async function getServerWeakTopics(examType?: string): Promise<TopicStrength[]> {
  const all = await getServerWeakness(examType);
  return all.filter(s => s.answered >= 5 && s.accuracy < 60);
}

/**
 * Convenience: strong topics only (accuracy > 80%, answered >= 5).
 */
export async function getServerStrengthTopics(examType?: string): Promise<TopicStrength[]> {
  const all = await getServerWeakness(examType);
  return all.filter(s => s.answered >= 5 && s.accuracy > 80);
}

// ───────────────────────────────────────────────────────────────
// Legacy localStorage API (DEPRECATED — kept for back-compat only)
// ───────────────────────────────────────────────────────────────
// NEW CALLERS: use `getServerWeakness()` / `getServerWeakTopics()` /
// `getServerStrengthTopics()` instead. These read the server-side
// `user_topic_strength` table and sync across devices.

/**
 * Get quiz history from localStorage.
 *
 * @deprecated Legacy single-device cache. Use `getServerWeakness()` instead.
 */
function getQuizHistory(): QuizResult[] {
  if (typeof window === 'undefined') return [];

  try {
    // Collect from various localStorage keys that might contain quiz data
    const results: QuizResult[] = [];

    // Check last session data
    const lastSession = localStorage.getItem("medpruef_last_session");
    if (lastSession) {
      const session = JSON.parse(lastSession);
      // This is just session progress, not detailed results
      // We'll need to track individual answers in the practice component
      void session;
    }

    // Check for any stored quiz results
    const storedResults = localStorage.getItem("medpruef_quiz_results");
    if (storedResults) {
      const parsed = JSON.parse(storedResults);
      if (Array.isArray(parsed)) {
        results.push(...parsed);
      }
    }

    return results;
  } catch (error) {
    console.error('Error reading quiz history:', error);
    return [];
  }
}

/**
 * Calculate topic statistics from localStorage quiz history.
 *
 * @deprecated Single-device only. Use `getServerWeakness()` for
 * cross-device cumulative accuracy.
 */
function calculateTopicStats(): TopicStats[] {
  const history = getQuizHistory();
  const topicMap = new Map<string, { correct: number; total: number }>();

  for (const result of history) {
    const existing = topicMap.get(result.topic) || { correct: 0, total: 0 };
    existing.total += 1;
    if (result.correct) {
      existing.correct += 1;
    }
    topicMap.set(result.topic, existing);
  }

  const stats: TopicStats[] = [];
  for (const [topic, data] of topicMap.entries()) {
    stats.push({
      topic,
      correct: data.correct,
      total: data.total,
      accuracy: data.total > 0 ? (data.correct / data.total) * 100 : 0,
    });
  }

  return stats.sort((a, b) => b.total - a.total); // Sort by total questions answered
}

/**
 * Get weak topics (accuracy < 60% with at least 5 questions answered).
 *
 * @deprecated Single-device cache. Prefer `getServerWeakTopics()` for
 * cross-device consistency.
 */
export function getWeakTopics(): TopicStats[] {
  const stats = calculateTopicStats();
  return stats.filter(stat => stat.accuracy < 60 && stat.total >= 5);
}

/**
 * Get strength topics (accuracy > 80% with at least 5 questions answered).
 *
 * @deprecated Single-device cache. Prefer `getServerStrengthTopics()` for
 * cross-device consistency.
 */
export function getStrengthTopics(): TopicStats[] {
  const stats = calculateTopicStats();
  return stats.filter(stat => stat.accuracy > 80 && stat.total >= 5);
}

/**
 * Get all topic statistics.
 *
 * @deprecated Single-device cache. Prefer `getServerWeakness()` for
 * cross-device consistency.
 */
export function getAllTopicStats(): TopicStats[] {
  return calculateTopicStats();
}

/**
 * Add a quiz result to the history.
 *
 * @deprecated No-op writes to localStorage only. The server-side
 * `user_topic_strength` table is populated automatically by `/api/answer`
 * — callers no longer need to explicitly record answers. Kept as a
 * no-op-compatible shim so older UI code doesn't crash during migration.
 */
export function addQuizResult(topic: string, questionId: string, correct: boolean) {
  if (typeof window === 'undefined') return;

  try {
    const history = getQuizHistory();
    const newResult: QuizResult = {
      topic,
      questionId,
      correct,
      timestamp: new Date().toISOString(),
    };

    history.push(newResult);

    // Keep only the last 1000 results to prevent localStorage bloat
    const limited = history.slice(-1000);

    localStorage.setItem("medpruef_quiz_results", JSON.stringify(limited));
  } catch (error) {
    console.error('Error saving quiz result:', error);
  }
}

/**
 * Record an answer (alias for addQuizResult).
 *
 * @deprecated The server now records answers automatically via `/api/answer`.
 * Prefer invalidating the server cache with `invalidateServerWeaknessCache()`
 * after a successful submission, then reading with `getServerWeakness()`.
 */
export function recordAnswer(topic: string, correct: boolean) {
  // Use a random question ID since we don't have the actual questionId
  const questionId = `q_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  addQuizResult(topic, questionId, correct);
}

// generateMockData() was removed 2026-04-15 (Frontend audit P2-5).
// It was dev-only demo data that shipped in the production client
// bundle. Never called from production code paths.
