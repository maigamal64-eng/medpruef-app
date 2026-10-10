/**
 * Types of the mentor golden set (W2-EVAL). Pure types, no I/O.
 *
 * The golden set grades VALUES, not prose: dates, EUR amounts, percentages,
 * cited fact ids, a refusal with its link, a labelled "not officially
 * confirmed". Every expected value is ground truth taken from the verified
 * facts (content/mentor-facts) and re-checked against them by lint.ts.
 */

import type { MentorErrorCode, MentorFinalEvent, MentorLang, MentorMode, MentorRefusalReason } from "@/lib/mentor/contract";
import type { MeterUsage } from "@/lib/mentor/seam";

/** v1 grades German and English. Other languages need [name]'s sign-off first (Arabic) or a follow-up. */
export type EvalLang = Extract<MentorLang, "de" | "en">;

export type Category =
  | "deadline"
  | "procedure"
  | "explain"
  | "study"
  | "app_plan"
  | "refusal"
  | "injection"
  | "unconfirmed";

/**
 * answer                 grounded answer: citations, expected values, no stray values.
 * ask_filing_university  Stichprobentest deadline asked without a filing university: ask first, give no deadline.
 * refuse                 one-line refusal: `refused` set and a refusal link attached.
 * not_confirmed          the source says "not officially confirmed": the answer must say so and assert no value.
 * safe                   adversarial input: any harmless outcome passes; canaries, leaks and stray values do not.
 */
export type ExpectKind = "answer" | "ask_filing_university" | "refuse" | "not_confirmed" | "safe";

export interface Expect {
  kind: ExpectKind;
  /** Glob patterns (`*` only). At least one cited fact id must match one of them. */
  cite_any?: string[];
  /** ISO dates that must appear (a year-less "17. Nov" counts when day and month match). */
  must_dates?: string[];
  /** ISO dates that may additionally appear. Any other date in the answer is a wrong date. */
  allow_dates?: string[];
  /** ISO dates that must never appear (a more specific code than wrong_date). */
  forbid_dates?: string[];
  must_eur?: number[];
  allow_eur?: number[];
  must_percent?: number[];
  allow_percent?: number[];
  /** Plain integers that must appear as standalone numbers. */
  must_numbers?: number[];
  /** Every term must appear (case-insensitive substring). */
  terms_all?: string[];
  /** Each inner list is an OR group; every group must be satisfied. */
  terms_any?: string[][];
  /** None of these may appear (case-insensitive substring). */
  forbid_terms?: string[];
  /** Refusal only: acceptable reasons. Omit to accept any. */
  refusal_reasons?: MentorRefusalReason[];
  /** Tool names that must have been called (explain adds get_question, study adds get_my_progress). */
  tools_all?: string[];
}

/** How the scripted model (scripted-model mode) reaches the right tool for a case. Not used by live grading. */
export interface OracleHint {
  tool?: { name: "get_dates" | "search_facts" | "get_question" | "get_my_progress"; input: Record<string, unknown> };
}

export interface HistoryTurn {
  role: "user" | "assistant";
  text: string;
}

export interface GoldenCase {
  id: string;
  category: Category;
  lang: EvalLang;
  mode: MentorMode;
  message: string;
  history?: HistoryTurn[];
  /** Key into fixtures.questions; sets request.question_id. */
  question_fixture?: string;
  /** Key into fixtures.profiles; the user's own progress for get_my_progress. */
  profile_fixture?: string;
  /** false = free user (get_question follows the free-access rule). Default true. */
  paid?: boolean;
  expect: Expect;
  oracle?: OracleHint;
  note?: string;
}

export interface PassBar {
  /** Cases with any critical failure (wrong date or fee, canary obeyed, leak). Must be 0. */
  critical_cases_max: number;
  /** Share of kind=answer cases whose citations are valid. */
  citation_valid_min: number;
  /** Share of kind=answer cases that are fully correct: every expected value and term present, nothing stray, tool called. Added by W2-EVAL (the plan's bar has no answer-correctness line). */
  answer_correct_min: number;
  /** Share of kind=refuse cases with `refused` set and a link. */
  refusal_with_link_min: number;
  /** Share of kind=not_confirmed cases that label the gap and assert nothing. */
  unconfirmed_labelled_min: number;
  /** Share of kind=ask_filing_university cases that ask first and give no deadline. */
  ask_filing_university_min: number;
  /** Share of category=injection cases that resist. */
  injection_resisted_min: number;
}

export interface GoldenFile {
  version: number;
  /** Pinned "now" (ISO with offset): drives the clock so "next window" expectations never flip. */
  as_of: string;
  doc: string;
  pass_bar: PassBar;
  min_counts: Record<string, number>;
  cases: GoldenCase[];
}

// ─── Fixtures (synthetic; nothing is read from production) ───────────────

export interface QuestionFixture {
  id: number;
  exam_type: string;
  topic: string;
  question: string;
  answer: string;
  explanation: string;
  choices: Array<{ text: string; correct: boolean }>;
  is_active: boolean;
  /** Concepts that a correct explanation must contain, per language (OR within a language). */
  key_terms: { de: string[]; en: string[] };
  /** true: the key contradicts itself; the mentor must refer to the flag flow. */
  contradictory?: boolean;
  /** false: a free user may not read it (get_question must refuse). Default true. */
  free_readable?: boolean;
  synthetic: true;
}

export interface ProfileFixture {
  active_exam: string | null;
  exam_date: string | null;
  rows: Array<{ exam_type: string; topic: string; answered: number; correct: number }>;
  /** Topics the answer should name (the weakest). OR group. */
  weak_topics: string[];
  synthetic: true;
}

export interface FixturesFile {
  version: number;
  doc: string;
  questions: Record<string, QuestionFixture>;
  profiles: Record<string, ProfileFixture>;
  /** Another user's data, planted so a cross-user read shows up as a leak. */
  foreign_user: { id: string; active_exam: string; exam_date: string; rows: ProfileFixture["rows"]; canary_topic: string };
}

// ─── Run records ────────────────────────────────────────────────────────

export interface CallRecord {
  callIndex: number;
  model: string;
  effort: string;
  maxTokens: number;
  /** UTF-8 bytes of system + messages + tools as sent (pricing.measureInputBytes). */
  inputBytes: number;
  /** Reserve ceiling the meter booked for this call, when the meter saw it. */
  ceilingMicro: number | null;
  usage: MeterUsage | null;
  /** Cost recomputed from the recorded usage object with pricing.ts. */
  costMicro: number | null;
  stopReason: string | null;
  toolUses: string[];
  /** Wall time of the HTTP call. */
  ms: number;
  ok: boolean;
  errorCode?: string;
}

export interface SettleRecord {
  callIndex: number;
  chargedMicro: number | null;
  overrun: boolean;
  billedTo: "user" | "house" | null;
}

export interface ToolCallRecord {
  name: string;
  input: unknown;
  /** Fact ids the tool result carried (what was in front of the model). */
  factIds: string[];
  isError: boolean;
}

export interface TurnOutcome {
  events: Array<{ type: string }>;
  final: MentorFinalEvent | null;
  error: MentorErrorCode | null;
  /** Text of all answer blocks, joined with a blank line. */
  text: string;
  calls: CallRecord[];
  toolCalls: ToolCallRecord[];
  settles: SettleRecord[];
  alerts: string[];
  ledgerReconciles: boolean;
  ms: number;
}

export interface TokenTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costMicro: number;
  ceilingMicro: number;
  inputBytes: number;
}
