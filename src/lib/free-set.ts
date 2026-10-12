/**
 * The free question set (a-free-set, 2026-10-12). Pure, no I/O.
 *
 * Until 2026-10-12 the free allowance was the 150 lowest active ids per exam
 * type. Ids follow import order by topic, so the Kenntnisprüfung slice was
 * mostly Augenheilkunde and the Innsbruck slice mostly Dermatologie, and a
 * free learner who picked another topic got nothing or a false "150 used"
 * wall. The set is now a committed list built by
 * scripts/free-set/build_free_set.py: 150 per exam, spread across topics,
 * good rows only. The old slice is frozen next to it as `legacy`.
 *
 * Access rule for a free caller in one exam type (the only place it lives):
 *   counted  = answered ∩ (new set ∪ legacy set)           (cap counter)
 *   capped   = enforcement on, signed-in, counted >= 150
 *   readable = capped ? answered ∩ (new ∪ legacy)
 *                     : new set ∪ (legacy ∩ answered)
 * So a learner keeps every question they already answered under the old
 * slice, never sees the wall before 150 distinct free answers in that exam,
 * and can never read a question outside (new set plus already answered).
 * Guests (no identity) read the new set only. A stored id that is inactive
 * at runtime is not served: every reader also filters is_active.
 */
import data from './free-set.data.json'

export const FREE_SET_SIZE = 150

type ExamKey = keyof typeof data.sets

const EMPTY: readonly number[] = Object.freeze([])

function examKey(exam: string): ExamKey | null {
  return Object.prototype.hasOwnProperty.call(data.sets, exam) ? (exam as ExamKey) : null
}

/** The 150 free question ids of an exam type (empty for an unknown exam). */
export function freeSetIds(exam: string): readonly number[] {
  const key = examKey(exam)
  return key ? data.sets[key] : EMPTY
}

/** The old free slice (150 lowest active ids on 2026-10-12), frozen. */
export function legacyFreeIds(exam: string): readonly number[] {
  const key = examKey(exam)
  return key ? data.legacy[key] : EMPTY
}

/** Curated first questions for a learner with no answer in this bank (inside the set). */
export function freeOpeningIds(exam: string): readonly number[] {
  const key = examKey(exam)
  return key ? data.opening[key] : EMPTY
}

/** New set ∪ legacy set: every id that can ever count toward the free cap (<= 300). */
export function freeUniverseIds(exam: string): number[] {
  return Array.from(new Set([...freeSetIds(exam), ...legacyFreeIds(exam)]))
}

/** Topic of each new-set id as of the build (fallback when the live read fails). */
export function freeSetTopicsAtBuild(exam: string): Map<number, string> {
  const key = examKey(exam)
  const out = new Map<number, string>()
  if (!key) return out
  const topics = (data.topics as Record<string, Record<string, number[]>>)[key] ?? {}
  for (const [topic, ids] of Object.entries(topics)) for (const id of ids) out.set(id, topic)
  return out
}

export interface FreeAccess {
  exam: string
  /** Distinct answered questions that were free under the old or the new set. */
  counted: number
  capped: boolean
  /** Ids the caller may read or be served (still subject to is_active). */
  readable: number[]
  /** Answered ids inside the universe. */
  answered: Set<number>
}

/** Apply the access rule above. `answered` may hold any ids; only the universe counts. */
export function computeFreeAccess(args: {
  exam: string
  answered: Iterable<number>
  signedIn: boolean
  enforced: boolean
}): FreeAccess {
  const newIds = freeSetIds(args.exam)
  const legacy = legacyFreeIds(args.exam)
  const universe = new Set<number>([...newIds, ...legacy])
  const answered = new Set<number>()
  if (args.signedIn) for (const id of args.answered) if (universe.has(id)) answered.add(id)
  const counted = answered.size
  const capped = args.signedIn && args.enforced && counted >= FREE_SET_SIZE
  const readable = capped
    ? Array.from(answered)
    : Array.from(new Set<number>([...newIds, ...legacy.filter((id) => answered.has(id))]))
  return { exam: args.exam, counted, capped, readable: readable.sort((a, b) => a - b), answered }
}

export type FreeEmptyReason = 'no_free_in_topic' | 'all_seen' | 'other'

export interface FreeTopicLeft {
  topic: string
  left: number
}

/**
 * Free questions left per topic: active new-set ids the learner has not
 * answered. `topicOf` maps the active new-set ids to their live topic.
 */
export function freeLeftByTopic(topicOf: Map<number, string>, answered: Set<number>): Map<string, number> {
  const out = new Map<string, number>()
  for (const [id, topic] of topicOf) {
    if (!out.has(topic)) out.set(topic, 0)
    if (!answered.has(id)) out.set(topic, (out.get(topic) ?? 0) + 1)
  }
  return out
}

/**
 * Why a free selection came back empty, and up to `limit` other topics that
 * still have free questions. `exhausted` means the learner has answered every
 * active question of the set: only then is the "all free questions used"
 * wall honest.
 */
export function classifyFreeEmpty(args: {
  topicOf: Map<number, string>
  answered: Set<number>
  requestedTopics: string[] | null
  limit?: number
}): { exhausted: boolean; reason: FreeEmptyReason; topics: FreeTopicLeft[]; left: number } {
  const left = freeLeftByTopic(args.topicOf, args.answered)
  const total = Array.from(left.values()).reduce((a, b) => a + b, 0)
  const requested = args.requestedTopics && args.requestedTopics.length > 0 ? args.requestedTopics : null
  let reason: FreeEmptyReason = 'other'
  if (requested) {
    const inSet = requested.some((t) => left.has(t))
    reason = inSet ? 'all_seen' : 'no_free_in_topic'
  }
  const topics = Array.from(left.entries())
    .filter(([topic, n]) => n > 0 && !(requested ?? []).includes(topic))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, args.limit ?? 3)
    .map(([topic, n]) => ({ topic, left: n }))
  return { exhausted: total === 0, reason, topics, left: total }
}

// (user, exam) pairs already past the curated opening, per server instance,
// so /api/questions runs its history check a handful of times per learner
// instead of on every draw. Bounded; a cleared entry only costs one re-check.
const OPENING_DONE = new Set<string>()
const OPENING_DONE_MAX = 5000

export function isOpeningDone(key: string): boolean {
  return OPENING_DONE.has(key)
}

export function markOpeningDone(key: string): void {
  if (OPENING_DONE.size >= OPENING_DONE_MAX) OPENING_DONE.clear()
  OPENING_DONE.add(key)
}

/** Test seam. */
export function resetOpeningCacheForTests(): void {
  OPENING_DONE.clear()
}
