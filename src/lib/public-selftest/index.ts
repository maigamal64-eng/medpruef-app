/**
 * a-public-selftest: the public, no-account timed self-check (/selbsttest).
 * Pure and client-safe; the database read lives in server.ts.
 *
 * - Questions: a fixed allowlist per bank (allowlist.data.json, built by
 *   scripts/selftest/build-allowlist.ts). Every id is in the free set, has two
 *   agreeing Content Medic reads on its served text (key and stem), no image,
 *   and pins the sha256 of the served fields (question, choices, answer). The
 *   route serves a row only while its live text still has that hash.
 * - Grading: the app's strict multi-answer rule (gradeSelection): a question
 *   counts only when every correct option and no wrong one is picked.
 * - Timer: the custom-run pace (customDurationS, 1.5 minutes per question,
 *   at least 10 minutes). Never presented as an official duration.
 * - Carry: on "Ergebnis und Plan speichern" the answers and the named sitting
 *   wait in localStorage (one hour) and land in the new account after sign-in
 *   (carry.ts): answers through the answer outbox (/api/answer), the sitting
 *   through /api/user/exam-preference (the picker path).
 */
import allowlist from "./allowlist.data.json";
import { gradeSelection } from "@/lib/practice-exam-state";
import { customDurationS } from "@/lib/exam-run";
import { OFFICIAL_KEYS_BY_BANK, getUpcomingOfficialFor, groupOfficialByDate } from "@/lib/exam-dates";

export const SELFTEST_PATH = "/selbsttest";
export const SELFTEST_BANKS = ["kmp_innsbruck", "kenntnispruefung"] as const;
export type SelftestBank = (typeof SELFTEST_BANKS)[number];
/** Questions served per run. */
export const SELFTEST_SIZE = 10;
/** Below this many intact allowlisted rows the route answers unavailable instead of a short run. */
export const SELFTEST_MIN_ITEMS = 8;

export function asSelftestBank(value: unknown): SelftestBank | null {
  return typeof value === "string" && (SELFTEST_BANKS as readonly string[]).includes(value) ? (value as SelftestBank) : null;
}

export interface AllowlistEntry {
  id: number;
  /** The row's topic as stored (the result groups by it). */
  field: string;
  /** sha256 of servedCanonical(row) at review time (served-hash.ts). */
  served_sha256: string;
  /** Read files (relative to the main checkout's reports/) that approve this exact state. */
  reads: string[];
}

interface AllowlistFile {
  version: string;
  banks: Record<SelftestBank, AllowlistEntry[]>;
}

const LIST = allowlist as unknown as AllowlistFile;

export const SELFTEST_ALLOWLIST_VERSION: string = LIST.version;

/** Ordered: the route serves the first SELFTEST_SIZE entries whose live text is unchanged. */
export function allowlistFor(bank: SelftestBank): readonly AllowlistEntry[] {
  return LIST.banks[bank] ?? [];
}

// ---------------------------------------------------------------------------
// Wire shape (GET /api/selftest?bank=)
// ---------------------------------------------------------------------------

export interface SelftestOption {
  text: string;
  correct: boolean;
}

export interface SelftestItem {
  id: number;
  field: string;
  question: string;
  /** Unshuffled, as stored; the client shuffles per load like the quiz. */
  options: SelftestOption[];
  /** Number of correct options (multi-answer when above 1). */
  required: number;
  /** a-fo-07 key fingerprint of the row as served, replayed with the answer after sign-in. */
  keyFingerprint: string;
}

export interface SelftestPayload {
  bank: SelftestBank;
  version: string;
  durationS: number;
  items: SelftestItem[];
}

/** 1.5 minutes per question, at least 10 minutes (the app's custom-run pace). */
export function selftestDurationS(count: number): number {
  return customDurationS(count);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface GradedItem {
  id: number;
  field: string;
  isCorrect: boolean;
  answered: boolean;
}

export interface FieldScore {
  field: string;
  correct: number;
  total: number;
}

export interface SelftestScore {
  correct: number;
  total: number;
  answered: number;
  items: GradedItem[];
  fields: FieldScore[];
}

/**
 * Grade a run. `selections` maps an item id to the indexes the visitor picked
 * in `options` (the order the item was displayed in). Unanswered = not correct.
 * Fields keep the order in which they first appear.
 */
export function scoreSelftest(
  items: readonly { id: number; field: string; options: readonly { correct: boolean }[] }[],
  selections: Readonly<Record<number, readonly number[]>>,
): SelftestScore {
  const graded: GradedItem[] = items.map((item) => {
    const picks = selections[item.id] ?? [];
    return { id: item.id, field: item.field, answered: picks.length > 0, isCorrect: picks.length > 0 && gradeSelection(item.options, picks).isCorrect };
  });
  const fields: FieldScore[] = [];
  for (const g of graded) {
    let f = fields.find((x) => x.field === g.field);
    if (!f) { f = { field: g.field, correct: 0, total: 0 }; fields.push(f); }
    f.total += 1;
    if (g.isCorrect) f.correct += 1;
  }
  return {
    correct: graded.filter((g) => g.isCorrect).length,
    total: graded.length,
    answered: graded.filter((g) => g.answered).length,
    items: graded,
    fields,
  };
}

export const SCORE_BUCKETS = ["0-3", "4-6", "7-8", "9-10"] as const;
export type ScoreBucket = (typeof SCORE_BUCKETS)[number];

/** The only score that leaves the browser: a band on a 10-point scale. */
export function scoreBucket(correct: number, total: number): ScoreBucket {
  const ten = total > 0 ? Math.round((Math.max(0, Math.min(correct, total)) * 10) / total) : 0;
  if (ten <= 3) return "0-3";
  if (ten <= 6) return "4-6";
  if (ten <= 8) return "7-8";
  return "9-10";
}

// ---------------------------------------------------------------------------
// Sitting (official sittings of the bank only, as the picker lists them)
// ---------------------------------------------------------------------------

/** First days of the bank's upcoming official sittings (the values ExamSittingPicker emits). */
export function selftestSittingDates(bank: SelftestBank, now: Date = new Date()): string[] {
  return groupOfficialByDate(getUpcomingOfficialFor({ exams: OFFICIAL_KEYS_BY_BANK[bank], now })).map((g) => g.date);
}

export function isSelftestSitting(bank: SelftestBank, iso: unknown, now: Date = new Date()): iso is string {
  return typeof iso === "string" && /^\d{4}-\d{2}-\d{2}$/.test(iso) && selftestSittingDates(bank, now).includes(iso);
}

// ---------------------------------------------------------------------------
// Carry record (device-local, one hour)
// ---------------------------------------------------------------------------

/** Signed user_events row written once per account after the carry (POST /api/selftest/saved). */
export const SELFTEST_SAVED_EVENT = "selftest_saved";

export const SELFTEST_PENDING_KEY = "medpruef_selftest_pending_v1";
export const SELFTEST_PENDING_TTL_MS = 60 * 60_000;

export interface SelftestPendingAnswer {
  id: number;
  /** Stable per answer, so a replay is a duplicate on the server, never a second answer. */
  requestId: string;
  userAnswer: string;
  isCorrect: boolean;
  timeSpentMs: number;
  keyFingerprint: string;
}

export interface SelftestPending {
  v: 1;
  bank: SelftestBank;
  /** An official sitting date of the bank, or "" when the visitor left it open. */
  sitting: string;
  answers: SelftestPendingAnswer[];
  expires: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FINGERPRINT_RE = /^k1:[0-9a-f]{64}$/;

export function pendingRecord(p: Omit<SelftestPending, "v" | "expires">, nowMs: number): string {
  return JSON.stringify({ v: 1, ...p, expires: nowMs + SELFTEST_PENDING_TTL_MS } satisfies SelftestPending);
}

/**
 * Read a stored record. Anything malformed, expired, for another bank's ids or
 * outside the allowlist is refused whole (null): the record never carries more
 * than the self-check could have produced.
 */
export function parsePending(record: string | null | undefined, nowMs: number): SelftestPending | null {
  if (!record) return null;
  try {
    const p = JSON.parse(record) as Partial<SelftestPending>;
    const bank = asSelftestBank(p.bank);
    if (p.v !== 1 || !bank || typeof p.expires !== "number" || p.expires <= nowMs) return null;
    if (typeof p.sitting !== "string" || (p.sitting !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(p.sitting))) return null;
    if (!Array.isArray(p.answers) || p.answers.length === 0 || p.answers.length > SELFTEST_SIZE) return null;
    const allowed = new Set(allowlistFor(bank).map((e) => e.id));
    const seen = new Set<number>();
    for (const a of p.answers) {
      if (!a || typeof a !== "object") return null;
      if (typeof a.id !== "number" || !allowed.has(a.id) || seen.has(a.id)) return null;
      seen.add(a.id);
      if (typeof a.requestId !== "string" || !UUID_RE.test(a.requestId)) return null;
      if (typeof a.userAnswer !== "string" || !a.userAnswer || a.userAnswer.length > 2000) return null;
      if (typeof a.isCorrect !== "boolean") return null;
      if (typeof a.timeSpentMs !== "number" || !Number.isFinite(a.timeSpentMs) || a.timeSpentMs < 0 || a.timeSpentMs > 3_600_000) return null;
      if (typeof a.keyFingerprint !== "string" || !FINGERPRINT_RE.test(a.keyFingerprint)) return null;
    }
    return { v: 1, bank, sitting: p.sitting, answers: p.answers as SelftestPendingAnswer[], expires: p.expires };
  } catch {
    return null;
  }
}

/** Where the visitor lands after sign-in: the study plan with a named sitting, else the free questions of the bank. */
export function selftestNext(bank: SelftestBank, sitting: string): string {
  return sitting ? "/study-plan" : `/quiz?examSource=${bank}&practiceMode=unseen`;
}

/** The entry link of a public page (?bank preselects the bank). */
export function selftestHref(bank?: SelftestBank, lang?: "de" | "en"): string {
  const p = new URLSearchParams();
  if (bank) p.set("bank", bank);
  if (lang === "en") p.set("lang", "en");
  const q = p.toString();
  return q ? `${SELFTEST_PATH}?${q}` : SELFTEST_PATH;
}
