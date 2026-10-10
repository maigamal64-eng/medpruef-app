/**
 * Mentor seam (contract C17, revised for the CREDITS model, frozen by
 * W0-C0B-MENTOR on 2026-10-10). Types and signatures only.
 *
 * Every mentor builder imports from here, so the route, the eval runner and
 * the in-memory test meter share one set of types:
 *   W2-CORE     implements runMentorTurn (src/lib/mentor/turn.ts) and the real
 *               Meter over the C3 RPCs (src/lib/mentor/meter.ts, ledger.ts).
 *   W2-BRAIN    implements Brain and FactsLoader.
 *   W2-CREDITS  implements Wallet and the Whop branch (src/lib/mentor/credits/).
 *   W2-EVAL     calls the same runMentorTurn with createTestMeter/createTestWallet.
 *   W2-UI       builds against contract.ts types and fixtures.ts only.
 *   W3-COSTVIEW returns contract.ts MentorAdminSummary (read-only).
 * Admission: the W2-CORE guard admits a message only when config.ts
 * canAdmitMessage(available, firstCallCeiling, maxToolRounds) holds.
 *
 * Money is integer micro-USD everywhere in this file. Credits are derived for
 * display only (config.ts creditsFromMicro).
 */

import type {
  ClaudeUsage,
  CallClaudeParams,
  CallClaudeResult,
  MessageParam,
  TextBlockParam,
  ToolDefinition,
} from "@/lib/ai/anthropic";
import type { MentorConfig } from "./config";
import type {
  CreditLotSource,
  MentorAccessSource,
  MentorAnswerBlock,
  MentorChatRequest,
  MentorCitation,
  MentorLang,
  MentorMode,
  MentorPackageId,
  MentorPackageKind,
  MentorRefusalReason,
  MentorSseEvent,
} from "./contract";

export type {
  ClaudeUsage,
  MessageParam,
  TextBlockParam,
  ToolDefinition,
  MentorConfig,
  MentorChatRequest,
  MentorSseEvent,
  MentorAnswerBlock,
  MentorCitation,
  MentorRefusalReason,
};

// ─── Meter (one instance per user; W2-CORE real, test-meter.ts in memory) ──

export type ReserveFailReason = "insufficient" | "invalid_args" | "db_error" | "bad_response" | "already_closed";

export interface ReserveResult {
  ok: boolean;
  /** Spendable micro-USD left after this hold (may be negative when in debt); null on error. */
  remainingMicro: number | null;
  reason?: ReserveFailReason;
  /** The same (request, callIndex) was reserved before; nothing new was booked. */
  duplicate?: boolean;
}

export interface SettleResult {
  ok: boolean;
  chargedMicro: number | null;
  billedTo: "user" | "house" | null;
  /** Actual cost exceeded the reserve ceiling: the caller alerts [name]. */
  overrun: boolean;
  duplicate?: boolean;
  reason?: "not_found" | "invalid_args" | "db_error" | "bad_response";
}

/** Usage as recorded in the ledger (the wrapper's usage plus the model id). */
export type MeterUsage = ClaudeUsage & { model?: string };

/**
 * C17 Meter, bound to one user at construction (createMeter(userId)).
 * requestId is a uuid per user message; callIndex counts API calls within
 * it (0, 1, 2; MAX_TOOL_ROUNDS 3). Every method fails closed: any DB or
 * parse error comes back as ok=false, never as an exception.
 */
export interface Meter {
  reserve(requestId: string, callIndex: number, ceilingMicro: number): Promise<ReserveResult>;
  /** Input cost known at message_start (evidence only; no balance moves). */
  settleInput(requestId: string, callIndex: number, inputMicro: number): Promise<{ ok: boolean }>;
  settle(requestId: string, callIndex: number, actualMicro: number, usage: MeterUsage, billUser: boolean): Promise<SettleResult>;
  /** Only for an upstream 5xx/429 that never reached the model (AiUpstream.reachedModel === false). */
  release(requestId: string, callIndex: number): Promise<{ ok: boolean }>;
}

// ─── Facts (C6 record shape, mirrored from content/mentor-facts/SCHEMA.json
// on ov/w0-c0a-20261010; R3 integration re-verifies the field names) ────────

export type MentorExamKey =
  | "sip4a"
  | "sip5a"
  | "stichprobentest"
  | "rezeptierkunde"
  | "gerichtsmedizin"
  | "c1"
  | "general"
  | "fsp";

export type MentorFactTopic =
  | "dates"
  | "registration"
  | "format"
  | "scoring"
  | "pass_rule"
  | "fee"
  | "attempts"
  | "results"
  | "language"
  | "documents"
  | "glossary";

export type FilingUniversity = "wien" | "graz" | "innsbruck" | "all";

export interface MentorFact {
  id: string;
  exam_key: MentorExamKey;
  topic: MentorFactTopic;
  filing_university: FilingUniversity;
  deadline_type?: "filing_cutoff" | "registration";
  text_de: string;
  text_en: string;
  aliases: string[];
  source_url: string;
  source_label: string;
  edition: string;
  read_on: string;
  verdict: "confirmed" | "partly" | "contradicted" | "not_in_sources";
  review_every_days: number;
  valid_until?: string;
  status: "live" | "needs_review" | "retracted";
}

/**
 * C7 OfficialSitting (src/lib/exam-dates.ts on ov/w0-c0a-20261010), mirrored
 * structurally so this seam compiles before C0a merges. The brain passes the
 * exam-dates objects straight through; never a second date list.
 */
export interface OfficialSittingView {
  exam_key: MentorExamKey;
  learner_label: { de: string; en: string };
  date: string;
  date_end?: string;
  registration_opens: string | null;
  registration_closes: string | null;
  closes_at_time?: string;
  deadline_type: "filing_cutoff" | "registration";
  publisher: string;
  filing_university?: FilingUniversity;
  source_url: string;
  read_on: string;
  /** true: the sitting date is confirmed, the registration window is not (review M2). */
  window_unconfirmed?: boolean;
}

/**
 * The ONLY reader of content/mentor-facts (W2-BRAIN, src/lib/mentor/facts-loader.ts).
 * Returns assertable facts only: verdict "confirmed" AND status "live" AND not
 * past valid_until (Europe/Vienna). Anything else answers "not officially
 * confirmed" plus the official link.
 */
export interface FactsLoader {
  byIds(ids: string[]): Promise<MentorFact[]>;
  search(queryDe: string, examKey?: MentorExamKey, topic?: MentorFactTopic): Promise<MentorFact[]>;
  dates(examKey: MentorExamKey, filingUniversity: FilingUniversity): Promise<{ sittings: OfficialSittingView[]; facts: MentorFact[] }>;
}

// ─── Brain (W2-BRAIN) ───────────────────────────────────────────────────

/** Frozen tool names (C6). Read-only; exam_dates recall markers are never reachable. */
export const MENTOR_TOOL_NAMES = ["get_dates", "search_facts", "get_question", "get_my_progress"] as const;
export type MentorToolName = (typeof MENTOR_TOOL_NAMES)[number];

export interface TurnContext {
  userId: string;
  requestId: string;
  lang: MentorLang;
  mode: MentorMode;
  questionId?: number;
  now: Date;
  /** Whether the caller is a paid/Pro user (question access for get_question follows the free-access rule otherwise). */
  paidAccess: boolean;
}

export interface ToolResult {
  /** Text handed back to the model as the tool_result content (data, never instructions). */
  content: string;
  /** Fact ids the result contained (validator input). */
  factIds: string[];
  isError?: boolean;
}

export interface ValidatedAnswer {
  blocks: MentorAnswerBlock[];
  citations: MentorCitation[];
  refused?: MentorRefusalReason;
  refusalLink?: string;
  /** True when at least one unsupported date, number, percentage or EUR amount was replaced. */
  replaced: boolean;
  /** Values the validator rejected, for the review queue (never shown to the learner). */
  rejected: Array<{ value: string; reason: "not_in_cited_facts" | "uncited_number" | "unknown_fact_id" }>;
}

export interface Brain {
  /** Stable prefix first (byte-identical across calls for cache hits), cache_control on the last stable block. */
  buildSystem(ctx: TurnContext): TextBlockParam[];
  /** Deterministic order; part of the cached prefix. */
  readonly tools: ToolDefinition[];
  runTool(name: string, input: unknown, ctx: TurnContext): Promise<ToolResult>;
  /** Code validator: every date, number, percentage and EUR amount must appear in the cited facts. */
  validate(answer: string, facts: MentorFact[]): ValidatedAnswer;
}

// ─── Wallet (W2-CREDITS, src/lib/mentor/credits/wallet.ts) ──────────────

export interface WalletLot {
  lotId: string;
  packageId: MentorPackageId;
  kind: MentorPackageKind;
  source: CreditLotSource;
  remainingMicro: number;
  grantedMicro: number;
  startsAt: string;
  expiresAt: string;
}

export interface WalletBalance {
  /** lots - reserved - debt (what one reserve is checked against). */
  availableMicro: number;
  lotsMicro: number;
  reservedMicro: number;
  debtMicro: number;
  nextExpiry: string | null;
  everGranted: boolean;
  lots: WalletLot[];
}

export interface Wallet {
  /**
   * Make every included grant the user is entitled to right now (Pro or cohort
   * 30-day slice, trial taste once ever, admin month, admin gift, referral,
   * unknown paid tier). Idempotent on the C3 lot keys. Throws on DB error
   * (the caller fails closed with 503 reserve_failed).
   */
  ensureIncludedGrants(userId: string, now: Date): Promise<void>;
  balance(userId: string): Promise<WalletBalance>;
  /** Rolling average settled cost per user message (last 20), or null without history. */
  avgMessageCostMicro(userId: string): Promise<number | null>;
  /** Which sources currently fund the user (copy only). */
  accessSources(userId: string): Promise<MentorAccessSource[]>;
}

// ─── Turn loop (W2-CORE) ────────────────────────────────────────────────

export interface Clock {
  now(): Date;
}

/** Decides who pays for a failure on our side (empty text, timeout). */
export interface HousePolicy {
  /** true: this failure is on the house (first N a Vienna day); false: bill the user or lock for the day. */
  takeFreeFail(userId: string): Promise<boolean>;
}

export type CallClaudeFn = (params: CallClaudeParams) => Promise<CallClaudeResult>;

export interface MentorDeps {
  meter: Meter;
  brain: Brain;
  facts: FactsLoader;
  callClaude: CallClaudeFn;
  clock: Clock;
  wallet: Wallet;
  house: HousePolicy;
  config: MentorConfig;
}

export interface MentorTurnInput {
  requestId: string;
  userId: string;
  conversationId: string;
  request: MentorChatRequest;
  /** Prior turns rebuilt from stored text, newest last, at most MENTOR_HISTORY_TURNS. */
  history: MessageParam[];
  paidAccess: boolean;
}

/**
 * runMentorTurn: reserve -> call -> settle per API call (each tool round is
 * its own reserve and settle), at most config.maxToolRounds calls, then
 * brain.validate, then one `final` event. Emits `error` and stops when a
 * reserve fails (no call is made). Used unchanged by the route and the eval.
 */
export type RunMentorTurn = (deps: MentorDeps, input: MentorTurnInput) => AsyncIterable<MentorSseEvent>;
