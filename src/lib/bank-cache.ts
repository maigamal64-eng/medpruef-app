/**
 * Bank-wide cache tags and the debounced purge (a-db-relief-1, T0b/T0c).
 *
 * The readers that scan the whole question bank keep their result for 24 h
 * in the shared Data Cache, each under its own tag, so an edit purges only
 * what it changes:
 *
 *   topic counts   get_topic_counts (free-tier.ts)        is_active, topic, exam_type
 *   bank coverage  /api/bank-coverage pager                is_active, tags, exam_dates, exam_type
 *   GI coverage    /graz-innsbruck/abdeckung pager         is_active, tags, exam_type
 *   inventory      /pruefungsformate extras (exam-extras)  is_active, topic, choices, exam_type
 *   self-check     /api/selftest (public-selftest/server)  is_active, exam_type, question, choices, answer
 *
 * A purge is debounced to at most one per tag per 15-minute window (a batch
 * of activations would otherwise re-run every whole-bank reader once per
 * edit, during live traffic). The first edit in a window purges at once; a
 * later edit in the same window is recorded as pending and flushed by the
 * db-health-watch cron (every 5 minutes) in the next window, so the last
 * edit of a batch shows within about 20 minutes. The window records live in
 * the Data Cache (claimOnce); without one (local runs) every purge runs at
 * once. A missed purge never shows a wrong answer, only display counts up
 * to 24 h old. The cron reads the previous window only once the current one
 * is a minute old (a late edit may still be writing it) and always checks
 * the window before that, which also covers a missed run. Records are
 * written after the response, so two simultaneous first writers can both
 * win: at worst one extra purge.
 */
import { claimOnce } from "@/lib/data-cache";
import { BANK_CACHE_SECONDS, BANK_CACHE_TAGS, dropLocalBankCopies, type BankCacheTag } from "@/lib/bank-cache-tags";

export { BANK_CACHE_SECONDS, BANK_CACHE_TAGS, type BankCacheTag };
export const ALL_BANK_CACHE_TAGS: BankCacheTag[] = Object.values(BANK_CACHE_TAGS);
export const BANK_PURGE_WINDOW_MS = 15 * 60 * 1000;
/** The previous window is read only once the current one is this old. */
export const BANK_PURGE_SETTLE_MS = 60 * 1000;

const FIELD_TAGS: Record<string, BankCacheTag[]> = {
  is_active: ALL_BANK_CACHE_TAGS,
  exam_type: ALL_BANK_CACHE_TAGS,
  topic: [BANK_CACHE_TAGS.topicCounts, BANK_CACHE_TAGS.inventory],
  tags: [BANK_CACHE_TAGS.coverage, BANK_CACHE_TAGS.giCoverage],
  exam_dates: [BANK_CACHE_TAGS.coverage],
  choices: [BANK_CACHE_TAGS.inventory, BANK_CACHE_TAGS.selftest],
  question: [BANK_CACHE_TAGS.selftest],
  answer: [BANK_CACHE_TAGS.selftest],
};

/** The tags a question edit of these columns makes stale (stem and answer: only the self-check; explanation: none). */
export function tagsForQuestionEdit(fields: readonly string[]): BankCacheTag[] {
  const out = new Set<BankCacheTag>();
  for (const field of fields) for (const tag of FIELD_TAGS[field] ?? []) out.add(tag);
  return ALL_BANK_CACHE_TAGS.filter((tag) => out.has(tag));
}

export function isBankCacheTag(value: unknown): value is BankCacheTag {
  return typeof value === "string" && (ALL_BANK_CACHE_TAGS as string[]).includes(value);
}

export function purgeWindow(now: number): number {
  return Math.floor(now / BANK_PURGE_WINDOW_MS);
}

type Revalidate = (tag: string) => void | Promise<void>;
let revalidateOverride: Revalidate | null = null;

/** Test seam for next/cache revalidateTag. */
export function __setRevalidateTagForTests(fn: Revalidate | null): void {
  revalidateOverride = fn;
}

async function revalidate(tag: string): Promise<void> {
  if (revalidateOverride) return void (await revalidateOverride(tag));
  const { revalidateTag } = await import("next/cache");
  revalidateTag(tag);
}

export interface PurgeResult {
  purged: BankCacheTag[];
  deferred: BankCacheTag[];
}

/**
 * Purge `tags` now, or defer each one whose window already purged.
 * `force` (runbooks, owner request) ignores the window.
 */
export async function requestBankPurge(tags: readonly BankCacheTag[], options: { now?: number; force?: boolean } = {}): Promise<PurgeResult> {
  const now = options.now ?? Date.now();
  const window = purgeWindow(now);
  const result: PurgeResult = { purged: [], deferred: [] };
  for (const tag of tags) {
    const done = await claimOnce(["bank-purge-v1", "done", tag, String(window)], { at: now });
    if (done.claimed || options.force) {
      await revalidate(tag);
      result.purged.push(tag);
      continue;
    }
    await claimOnce(["bank-purge-v1", "pending", tag, String(window)], { pending: true, at: now });
    result.deferred.push(tag);
  }
  return result;
}

/** The PATCH side of the admin question editor. */
export async function purgeBankCachesForEdit(fields: readonly string[], now?: number): Promise<PurgeResult> {
  const tags = tagsForQuestionEdit(fields);
  if (tags.length === 0) return { purged: [], deferred: [] };
  // This instance's own copies go at once (an admin sees the edit here).
  for (const tag of tags) dropLocalBankCopies(tag);
  return requestBankPurge(tags, { now });
}

/**
 * Cron side: purge each tag that has a pending edit from the previous window,
 * unless the current window already purged it (that purge came later and
 * covers the edit). Reading a window with no record stores a "nothing
 * pending" record for it, which is harmless: that window is over.
 */
export async function flushDeferredBankPurges(now: number = Date.now()): Promise<BankCacheTag[]> {
  const window = purgeWindow(now);
  // A late edit can still be writing the previous window's record right at
  // the boundary, so that window is read only once this one is a minute old;
  // the window before it is always checked, which also covers a missed run.
  const settled = now - window * BANK_PURGE_WINDOW_MS >= BANK_PURGE_SETTLE_MS;
  const flushed: BankCacheTag[] = [];
  const isPending = async (tag: BankCacheTag, w: number) => {
    const rec = await claimOnce(["bank-purge-v1", "pending", tag, String(w)], { pending: false, at: now });
    return rec.shared && !rec.claimed && rec.value.pending === true;
  };
  // True when window w purged this tag (claiming a past window's record means it did not).
  const purgedIn = async (tag: BankCacheTag, w: number) =>
    !(await claimOnce(["bank-purge-v1", "done", tag, String(w)], { at: 0 })).claimed;
  for (const tag of ALL_BANK_CACHE_TAGS) {
    const needs = (settled && (await isPending(tag, window - 1))) ||
      ((await isPending(tag, window - 2)) && !(await purgedIn(tag, window - 1)));
    if (!needs) continue;
    const done = await claimOnce(["bank-purge-v1", "done", tag, String(window)], { at: now });
    if (!done.claimed) continue;
    await revalidate(tag);
    flushed.push(tag);
  }
  return flushed;
}
