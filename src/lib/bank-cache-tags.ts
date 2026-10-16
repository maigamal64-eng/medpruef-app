/**
 * Bank-wide cache tags (a-db-relief-1). Dependency-free so the readers
 * (free-tier, bank coverage, exam extras) and the purge (bank-cache.ts) can
 * share them without importing each other.
 */
export const BANK_CACHE_TAGS = {
  topicCounts: "bank:topic-counts",
  coverage: "bank:coverage",
  giCoverage: "bank:gi-coverage",
  inventory: "exam-extras-inventory",
  // a-public-selftest: the served self-check rows (stem, options, key, active state).
  selftest: "bank:selftest",
} as const;
export type BankCacheTag = (typeof BANK_CACHE_TAGS)[keyof typeof BANK_CACHE_TAGS];

/** 24 h: the bank-wide readers' Data Cache lifetime. */
export const BANK_CACHE_SECONDS = 24 * 60 * 60;

// Per-instance copies that a purge on this instance should drop at once
// (registered by their owners, e.g. the topic-counts Map in free-tier.ts).
const localDroppers = new Map<BankCacheTag, Set<() => void>>();

export function onLocalBankPurge(tag: BankCacheTag, drop: () => void): void {
  const set = localDroppers.get(tag) ?? new Set();
  set.add(drop);
  localDroppers.set(tag, set);
}

export function dropLocalBankCopies(tag: BankCacheTag): void {
  for (const drop of localDroppers.get(tag) ?? []) drop();
}
