/**
 * Mentor turn loop (W2-CORE): runMentorTurn per contract C17 (seam.ts).
 *
 *   admission -> for each API call (at most config.maxToolRounds):
 *     build params -> reserve(ceiling) -> callClaude -> settle (or release)
 *   -> brain.validate -> delta events (validated text only) -> final
 *
 * Pure with respect to I/O: everything goes through MentorDeps, so the route
 * and the golden-set eval run this file unchanged (no supabase, no next).
 *
 * Billing ([name], 2026-10-11; MUX-38 option B, 2026-10-12): the learner pays
 * only for a DELIVERED, unreplaced answer. "Never pay for an error or a no."
 * Every reached call is still settled with its real cost (or the reserve
 * ceiling when the cost is unknown), but settles are DEFERRED to the end of
 * the turn, when the outcome is known, and then booked:
 *   - to the learner (kind settle): the calls of a turn that ends in a real
 *     answer the validator kept whole, except an attempt that was retried
 *     away (below);
 *   - to the house (kind house_cost, delta 0, cost logged for [name]): every
 *     call of a turn that ends in an error event, in the fallback notice
 *     only ("not officially confirmed, check the official page"), in a
 *     validator or safety refusal (AiRefusal), or in an answer the validator
 *     partly replaced, and every attempt that was retried away.
 *   - provably never reached the model (AiInputRejected, AiUpstream with
 *     reachedModel=false): the hold is released, nothing is booked.
 * Every call is reserved at its maximum cost before it runs and holds stay
 * open until the end of the turn, so a turn can never spend more than the
 * wallet held. A failed settle is retried once; if it still fails the hold
 * stays open and the stale sweep settles it at the ceiling to the house.
 *
 * Retry (once per turn): a call that stops at the output cap (stop_reason
 * max_tokens, also as AiEmptyText) or hits the per-call timeout is made
 * again with the same messages, when its reserve fits and the turn budget
 * (MENTOR_TURN_BUDGET_MS, under the route's 60 s maxDuration) leaves room.
 * A turn that still ends with only a protocol header or no text shows the
 * not-confirmed notice with the official link instead of an error.
 *
 * Model deltas are NOT forwarded: the code validator must see every date,
 * number, percentage and EUR amount before the learner does. `delta` events
 * carry validated block text only.
 */

import { explicitSolutionRequest } from "./explain-safety";
import {
  AiCacheTtlViolation,
  AiEmptyText,
  AiError,
  AiInputRejected,
  AiRefusal,
  AiTimeout,
  validateCallParams,
  type CallClaudeParams,
  type CallClaudeResult,
  type ClaudeUsage,
  type ContentBlock,
  type ContentBlockParam,
  type MessageParam,
  type MessageStartInfo,
  type ToolResultBlockParam,
} from "@/lib/ai/anthropic";
import { costMicroUsd, reserveCeilingMicro, trimHistoryToFit } from "@/lib/ai/pricing";
import { admitMessageMinMicro, canAdmitMessage, creditsExactFromMicro, messagesLeftEstimate } from "./config";
import type { MentorErrorCode, MentorLang, MentorSseEvent } from "./contract";
import { trimTruncatedAnswer } from "./prompt/protocol";
import { nextActions, planItemsFromTool } from "./actions";
import { studySentenceViolation } from "./study-safety";
import { topicNotice } from "./trust-copy";
import { refusalOffice } from "./office";
import { isFallbackOnlyText, officialLinkForExam, officialLinkForUniversity, refusalLine } from "./prompt/refusals";
import { answerDeadlineGap, isInternalFactId, trimUnaskedValues } from "./validator";
import { deadlineGap, deadlineLinesFromTools, hoistDeadlineLine } from "./deadline-first";
import { MENTOR_TOOL_NAMES } from "./seam";
import { glossTermsFromTools, learnerNamedTerms, repairGlossMeta } from "./gloss-terms";
import { answerLanguageMismatch, languageRetryInstruction } from "./answer-language";
import type { MentorDeps, MentorTurnInput, MeterUsage, RunMentorTurn, ToolResult, TurnContext, Wallet } from "./seam";

/** Per API call; 3 rounds (54 s) plus ledger round trips fit the chat route maxDuration (60 s, a limit every Vercel plan allows). */
export const MENTOR_CALL_TIMEOUT_MS = 18_000;

/**
 * Wall-clock budget of one turn. The chat route's maxDuration is 60 s; a killed
 * function would leave holds open for the stale sweep. A call never gets a
 * timeout past this budget, and the retry starts only with MENTOR_MIN_CALL_MS left.
 */
export const MENTOR_TURN_BUDGET_MS = 55_000;
export const MENTOR_MIN_CALL_MS = 8_000;

/** Automatic retries per turn (output cap or per-call timeout). */
export const MENTOR_MAX_RETRIES = 1;

/** Language regenerations per turn (track-A, 12 Oct): one, only on a language mismatch. */
export const MENTOR_MAX_LANGUAGE_RETRIES = 1;

/** Tool uses answered per round; extra ones get an error result (every tool_use needs a tool_result). */
export const MENTOR_MAX_TOOL_USES_PER_ROUND = 4;

export interface MentorAlert {
  kind:
    | "overrun"
    | "settle_failed"
    | "release_failed"
    | "unpriced_model"
    | "dropped_block"
    | "tool_error"
    | "brain_error"
    | "validator_error"
    | "house_policy_error"
    | "duplicate_reserve"
    | "retry";
  userId: string;
  requestId: string;
  callIndex?: number;
  detail?: string;
}

export interface TurnOptions {
  /** Ops alert sink (the route wires Sentry). Must not throw. */
  alert?: (a: MentorAlert) => void;
  /** Monotonic milliseconds for the turn budget (tests). Default Date.now. */
  elapsedNow?: () => number;
}

/** Fixed copy for a safety-classifier refusal (Arabic and others fall back to English until signed off). */
export const MENTOR_REFUSAL_COPY: Readonly<Record<"de" | "en", string>> = Object.freeze({
  de: "Dabei kann ich Ihnen hier nicht helfen. Bitte wenden Sie sich direkt an die zuständige offizielle Stelle.",
  en: "I can't help with that here. Please contact the responsible official office directly.",
});

function refusalCopy(lang: MentorLang): string {
  return lang === "de" ? MENTOR_REFUSAL_COPY.de : MENTOR_REFUSAL_COPY.en;
}

// ─── Context and call building ──────────────────────────────────────────

export function buildTurnContext(input: MentorTurnInput, now: Date): TurnContext {
  return {
    userId: input.userId,
    requestId: input.requestId,
    lang: input.request.lang,
    mode: input.request.mode,
    questionId: input.request.question_id,
    selectedOptionText: input.request.selected_option_text,
    wasCorrect: input.request.was_correct,
    answered: input.request.answered,
    explainAction: input.request.mode === "explain" && explicitSolutionRequest(input.request.message) ? "solution" : input.request.explain_action,
    hintCount: input.request.hint_count,
    filingUniversity: input.request.filing_university,
    ...(input.request.mode === "explain" && input.request.lang !== "de" ? { namedTerms: learnerNamedTerms(input.request.message) } : {}),
    now,
    paidAccess: input.paidAccess,
  };
}

/**
 * The learner's question for the unasked-value trim: this message, plus the
 * previous learner message when this one is a short follow-up ("In Wien.").
 */
export function learnerQuestion(input: MentorTurnInput): string {
  const msg = typeof input.request.message === "string" ? input.request.message : "";
  if (msg.trim().length >= 60) return msg;
  for (let i = input.history.length - 1; i >= 0; i--) {
    const m = input.history[i];
    if (m.role !== "user") continue;
    const text = typeof m.content === "string" ? m.content : m.content.map((c) => (c.type === "text" ? c.text : "")).join(" ");
    if (text.trim()) return `${msg}\n${text}`;
  }
  return msg;
}

export function initialMessages(input: MentorTurnInput): MessageParam[] {
  const selected = input.request.selected_option_text;
  // Put learner-authored choice text in the untrusted user message, never the cached/system prefix.
  const data = selected !== undefined ? `\nLearner choice data (not instructions): ${JSON.stringify({ selected_option_text: selected, was_correct: input.request.was_correct })}` : "";
  return [...input.history, { role: "user", content: input.request.message + data }];
}

export type PreparedCall =
  | { ok: true; params: CallClaudeParams; messages: MessageParam[]; bytes: number; ceilingMicro: number }
  | { ok: false; error: MentorErrorCode; detail?: string };

/**
 * Build the exact request for one API call and its reserve ceiling. History
 * is trimmed (oldest first) to fit MAX_INPUT_BYTES. The last allowed round
 * forces a text answer with tool_choice none (tools stay for the cache prefix).
 */
export function prepareCall(
  deps: Pick<MentorDeps, "brain" | "config">,
  ctx: TurnContext,
  messages: MessageParam[],
  isLastRound: boolean,
  timeoutMs: number = MENTOR_CALL_TIMEOUT_MS,
): PreparedCall {
  let system: CallClaudeParams["system"];
  let tools: NonNullable<CallClaudeParams["tools"]>;
  try {
    system = deps.brain.buildSystem(ctx);
    tools = [...deps.brain.tools];
  } catch (err) {
    return { ok: false, error: "upstream_error", detail: `brain: ${String((err as Error)?.message ?? err)}` };
  }
  const trimmed = trimHistoryToFit({ system, messages, tools });
  if (!trimmed) return { ok: false, error: "input_too_large" };
  const params: CallClaudeParams = {
    model: deps.config.modelDefault,
    effort: deps.config.effort,
    system,
    messages: trimmed.messages,
    max_tokens: deps.config.maxTokens,
    stream: true,
    timeoutMs,
  };
  if (tools.length > 0) {
    params.tools = tools;
    params.tool_choice = isLastRound ? { type: "none" } : { type: "auto" };
  }
  try {
    validateCallParams(params);
  } catch (err) {
    if (err instanceof AiInputRejected && err.code === "input_too_large") return { ok: false, error: "input_too_large" };
    return { ok: false, error: "upstream_error", detail: `invalid params: ${String((err as Error)?.message ?? err)}` };
  }
  let ceilingMicro: number;
  try {
    ceilingMicro = reserveCeilingMicro(params.model, trimmed.bytes, params.max_tokens);
  } catch (err) {
    // Unknown model or over-cap input: the mentor fails closed.
    return { ok: false, error: "reserve_failed", detail: `ceiling: ${String((err as Error)?.message ?? err)}` };
  }
  return { ok: true, params, messages: trimmed.messages, bytes: trimmed.bytes, ceilingMicro };
}

/** The reserve ceiling of the FIRST call of this turn, exactly as runMentorTurn will build it. */
export function firstCallCeiling(deps: Pick<MentorDeps, "brain" | "config" | "clock">, input: MentorTurnInput): PreparedCall {
  const ctx = buildTurnContext(input, deps.clock.now());
  return prepareCall(deps, ctx, initialMessages(input), deps.config.maxToolRounds === 1);
}

/**
 * MUX-23 (option A, [name] 2026-10-12): the one admission bar. A message may
 * start only with admitMessageMinMicro(first-call ceiling, maxToolRounds)
 * available. admitTurn, the 402 body and GET /api/mentor/usage all read this
 * number from here, so the pill, the banner, the 402 and the packages page
 * agree. The bar itself is unchanged.
 */
export function admissionMinMicro(deps: Pick<MentorDeps, "brain" | "config" | "clock">, input: MentorTurnInput): { ok: true; minMicro: number; ceilingMicro: number } | { ok: false; error: MentorErrorCode; detail?: string } {
  const first = firstCallCeiling(deps, input);
  if (!first.ok) return first;
  return { ok: true, minMicro: admitMessageMinMicro(first.ceilingMicro, deps.config.maxToolRounds), ceilingMicro: first.ceilingMicro };
}

/** The bar for a fresh short facts question with no history: what /usage shows. */
export const FRESH_MESSAGE_PROBE = "Wann ist die nächste Prüfung?";

export function freshMessageAdmissionMicro(deps: Pick<MentorDeps, "brain" | "config" | "clock">, userId: string, lang: MentorTurnInput["request"]["lang"] = "de"): number | null {
  try {
    const r = admissionMinMicro(deps, {
      requestId: "00000000-0000-4000-8000-000000000000",
      userId,
      conversationId: "00000000-0000-4000-8000-000000000000",
      request: { message: FRESH_MESSAGE_PROBE, lang, mode: "facts" } as MentorTurnInput["request"],
      history: [],
      paidAccess: false,
    });
    return r.ok ? r.minMicro : null;
  } catch {
    return null;
  }
}

export type AdmitResult =
  | { ok: true; ceilingMicro: number; availableMicro: number; everGranted: boolean }
  | { ok: false; error: MentorErrorCode; availableMicro?: number; admitMinMicro?: number; detail?: string };

/**
 * Frozen admission rule (config.ts canAdmitMessage): a message starts only
 * when available >= maxToolRounds x the first call's ceiling. Below it:
 * credits_required (never had a lot) or credits_exhausted.
 */
export async function admitTurn(deps: MentorDeps, input: MentorTurnInput): Promise<AdmitResult> {
  const first = admissionMinMicro(deps, input);
  if (!first.ok) return { ok: false, error: first.error, detail: first.detail };
  let available: number;
  let everGranted: boolean;
  try {
    const b = await deps.wallet.balance(input.userId);
    available = b.availableMicro;
    everGranted = b.everGranted;
  } catch (err) {
    return { ok: false, error: "reserve_failed", detail: `balance: ${String((err as Error)?.message ?? err)}` };
  }
  if (!Number.isFinite(available)) return { ok: false, error: "reserve_failed", detail: "balance not a number" };
  if (!canAdmitMessage(available, first.ceilingMicro, deps.config.maxToolRounds)) {
    return { ok: false, error: everGranted ? "credits_exhausted" : "credits_required", availableMicro: available, admitMinMicro: first.minMicro };
  }
  return { ok: true, ceilingMicro: first.ceilingMicro, availableMicro: available, everGranted };
}

// ─── Helpers ────────────────────────────────────────────────────────────

const ZERO_USAGE: ClaudeUsage = Object.freeze({
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
  cache_creation: null,
}) as ClaudeUsage;

function errMsg(err: unknown): string {
  return String((err as Error)?.message ?? err).slice(0, 300);
}

/** Actual cost from usage; falls back to the requested model's price, then to the ceiling. */
function priceCall(
  returnedModel: string | null | undefined,
  requestedModel: string,
  usage: ClaudeUsage,
  ceilingMicro: number,
  onUnpriced: (detail: string) => void,
): number {
  for (const m of [returnedModel, requestedModel]) {
    if (!m) continue;
    try {
      return costMicroUsd(m, usage, { onUnknown: "throw" });
    } catch {
      /* try the next id */
    }
  }
  onUnpriced(`no price for ${String(returnedModel)} / ${requestedModel}; settled at the ceiling`);
  return ceilingMicro;
}

/** Assistant content echoed back inside the tool loop. Only block types the wrapper accepts. */
export function assistantBlocks(blocks: ContentBlock[]): { blocks: ContentBlockParam[]; dropped: string[] } {
  const out: ContentBlockParam[] = [];
  const dropped: string[] = [];
  for (const b of blocks) {
    if (!b || typeof b !== "object") continue;
    const r = b as Record<string, unknown>;
    if (r.type === "text" && typeof r.text === "string") {
      if (r.text.length > 0) out.push({ type: "text", text: r.text });
    } else if (r.type === "thinking" && typeof r.thinking === "string" && typeof r.signature === "string") {
      out.push({ type: "thinking", thinking: r.thinking, signature: r.signature });
    } else if (r.type === "tool_use" && typeof r.id === "string" && typeof r.name === "string") {
      out.push({ type: "tool_use", id: r.id, name: r.name, input: r.input ?? {} });
    } else {
      dropped.push(String(r.type));
    }
  }
  return { blocks: out, dropped };
}

/**
 * The same request with one code-owned text block appended to the last user
 * message (a string or the tool results), so the cached prefix is unchanged
 * and the alternation of roles stays valid. Never learner text.
 */
export function withLanguageInstruction(messages: MessageParam[], instruction: string): MessageParam[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user") return [...messages, { role: "user", content: instruction }];
  const content: ContentBlockParam[] = typeof last.content === "string" ? [{ type: "text", text: last.content }] : [...(last.content as ContentBlockParam[])];
  content.push({ type: "text", text: instruction });
  return [...messages.slice(0, -1), { role: "user", content } as MessageParam];
}

const TOOL_NAMES: ReadonlySet<string> = new Set(MENTOR_TOOL_NAMES);

async function creditsView(wallet: Wallet, userId: string): Promise<{ credits_left: number; messages_left_estimate: number }> {
  try {
    const b = await wallet.balance(userId);
    let avg: number | null = null;
    try {
      avg = await wallet.avgMessageCostMicro(userId);
    } catch {
      avg = null;
    }
    return { credits_left: creditsExactFromMicro(b.availableMicro), messages_left_estimate: messagesLeftEstimate(b.availableMicro, avg) };
  } catch {
    return { credits_left: 0, messages_left_estimate: 0 };
  }
}

/**
 * MUX-38 option B ([name], 2026-10-12): the learner pays only for an answer the
 * validator kept whole. A validator or safety refusal and a partly replaced
 * answer are booked to the house (charged:false), like errors and notices.
 */
export function learnerPaysFor(validated: { refused?: unknown; replaced?: unknown }): boolean {
  return !validated.refused && !validated.replaced;
}

function errorEvent(error: MentorErrorCode): MentorSseEvent {
  return { type: "error", error };
}

// ─── The loop ───────────────────────────────────────────────────────────

export function createRunMentorTurn(opts: TurnOptions = {}): RunMentorTurn {
  const alert = (a: MentorAlert): void => {
    try {
      (opts.alert ?? defaultAlert)(a);
    } catch {
      /* alerts never break a turn */
    }
  };

  const elapsedNow = opts.elapsedNow ?? (() => Date.now());

  return async function* runMentorTurn(deps: MentorDeps, input: MentorTurnInput): AsyncGenerator<MentorSseEvent> {
    const { meter, brain, facts, callClaude, clock, wallet, config } = deps;
    const { userId, requestId } = input;
    const ctx = buildTurnContext(input, clock.now());
    const startedAt = elapsedNow();
    let retriesUsed = 0;

    const admit = input.admitted ? { ok: true as const } : await admitTurn(deps, input);
    if (!admit.ok) {
      if (admit.detail) alert({ kind: "brain_error", userId, requestId, detail: admit.detail });
      yield errorEvent(admit.error);
      return;
    }

    let creditsUsedMicro = 0;
    const settle = async (callIndex: number, amount: number, usage: MeterUsage, billUser: boolean): Promise<void> => {
      let r = await meter.settle(requestId, callIndex, amount, usage, billUser);
      if (!r.ok && r.reason !== "not_found" && r.reason !== "invalid_args") {
        r = await meter.settle(requestId, callIndex, amount, usage, billUser);
      }
      if (!r.ok) {
        alert({ kind: "settle_failed", userId, requestId, callIndex, detail: `${r.reason ?? "unknown"}; stale sweep books the ceiling to the house` });
      } else {
        if (r.billedTo === "user") creditsUsedMicro += r.chargedMicro ?? 0;
      }
      if (r.ok && r.overrun) {
        alert({ kind: "overrun", userId, requestId, callIndex, detail: `charged ${r.chargedMicro} micro-USD above the reserve` });
      }
    };

    const release = async (callIndex: number): Promise<void> => {
      let r = await meter.release(requestId, callIndex);
      if (!r.ok) r = await meter.release(requestId, callIndex);
      if (!r.ok) alert({ kind: "release_failed", userId, requestId, callIndex, detail: "hold stays open; stale sweep books the ceiling to the house" });
    };

    // Deferred settles: who pays is known only when the turn ends (see the header).
    interface Pending {
      callIndex: number;
      amount: number;
      usage: MeterUsage;
      /** false: an attempt that was retried away (never the learner's). */
      learnerPays: boolean;
    }
    const pending: Pending[] = [];
    /** Book every reached call: to the learner only when `delivered`. */
    const flush = async (delivered: boolean): Promise<void> => {
      const items = pending.splice(0, pending.length);
      for (const p of items) await settle(p.callIndex, p.amount, p.usage, delivered && p.learnerPays);
    };
    const fail = async (error: MentorErrorCode): Promise<MentorSseEvent> => {
      await flush(false);
      // Every reached call was just booked to the house: the server can say so (MUX-38, MUX-39).
      return { type: "error", error, credits_deducted: false, ...(retriesUsed ? { retries: retriesUsed } : {}) };
    };

    const unpricedFor = (callIndex: number) => (detail: string) => alert({ kind: "unpriced_model", userId, requestId, callIndex, detail });

    try {
      let messages = initialMessages(input);
      const factIds = new Set<string>();
      const toolResultsForUi: Array<{name:string;result:ToolResult}> = [];
      let needsFilingUniversity = false;
      let answer: string | null = null;
      const rounds = config.maxToolRounds;
      let retriesLeft = MENTOR_MAX_RETRIES;
      let languageRetryLeft = MENTOR_MAX_LANGUAGE_RETRIES;
      let forceText = false;
      let callIndex = 0;
      /** Complete sentences of a cut-off attempt, kept in case its retry cannot run or yields less. */
      let wasTruncated = false;
      /** wrongLanguage: the candidate is a complete answer in the wrong language (the language retry's fallback). */
      let cutCandidate: { text: string; pending: Pending; wrongLanguage?: boolean } | null = null;

      roundLoop: for (let round = 0; round < rounds; round++) {
        const isLast = round === rounds - 1;
        // One round may take a second attempt (the retry); `continue attempt` re-runs it.
        for (;;) {
          const left = MENTOR_TURN_BUDGET_MS - (elapsedNow() - startedAt);
          if (left < MENTOR_MIN_CALL_MS && callIndex > 0) {
            // Only reachable after a retry used the time: never start a call the route would cut off.
            if (cutCandidate) {
              cutCandidate.pending.learnerPays = true;
              answer = cutCandidate.text;
              break roundLoop;
            }
            yield await fail("upstream_error");
            return;
          }
          // The language retry only rewrites the text: no tool round (review P2).
          const prep = prepareCall(deps, ctx, messages, isLast || forceText, Math.min(MENTOR_CALL_TIMEOUT_MS, Math.max(left, MENTOR_MIN_CALL_MS)));
          if (!prep.ok) {
            if (prep.detail) alert({ kind: "brain_error", userId, requestId, callIndex, detail: prep.detail });
            yield await fail(prep.error);
            return;
          }
          messages = prep.messages;

          const reserved = await meter.reserve(requestId, callIndex, prep.ceilingMicro);
          if (!reserved.ok || reserved.duplicate) {
            if (reserved.duplicate) alert({ kind: "duplicate_reserve", userId, requestId, callIndex });
            if (cutCandidate && !reserved.duplicate) {
              // The retry does not fit: deliver the complete sentences of the cut-off attempt.
              cutCandidate.pending.learnerPays = true;
              answer = cutCandidate.text;
              break roundLoop;
            }
            yield await fail(reserved.ok === false && reserved.reason === "insufficient" ? "credits_exhausted" : "reserve_failed");
            return;
          }
          const thisCall = callIndex;
          callIndex++;

          let settleInput: Promise<unknown> = Promise.resolve();
          const onMessageStart = (info: MessageStartInfo): void => {
            try {
              const inputMicro = costMicroUsd(
                info.model || prep.params.model,
                {
                  input_tokens: info.input_tokens,
                  output_tokens: 0,
                  cache_read_input_tokens: info.cache_read_input_tokens,
                  cache_creation_input_tokens: info.cache_creation_input_tokens,
                },
                { onUnknown: "throw" },
              );
              settleInput = meter.settleInput(requestId, thisCall, inputMicro).catch(() => ({ ok: false }));
            } catch {
              /* evidence only; the final settle carries the full cost */
            }
          };

          // Checked after the call returns: the time it took counts against the budget.
          const canRetry = (): boolean => retriesLeft > 0 && MENTOR_TURN_BUDGET_MS - (elapsedNow() - startedAt) >= MENTOR_MIN_CALL_MS;
          const retry = (why: string): void => {
            retriesLeft--;
            retriesUsed++;
            alert({ kind: "retry", userId, requestId, callIndex: thisCall, detail: why });
          };

          yield { type: "status", phase: "writing" };
          let result: CallClaudeResult;
          try {
            // Never pass the client's abort signal: a disconnect must not abort upstream.
            result = await callClaude({ ...prep.params, onMessageStart });
          } catch (err) {
            await settleInput;
            if (err instanceof AiError && !err.reachedModel) {
              await release(thisCall);
              if (cutCandidate) {
                // A retry that never reached the model: the earlier answer is still the answer (review P3).
                cutCandidate.pending.learnerPays = true;
                answer = cutCandidate.text;
                break roundLoop;
              }
              yield await fail(err instanceof AiInputRejected && err.code === "input_too_large" ? "input_too_large" : "upstream_error");
              return;
            }
            const usage = err instanceof AiError && err.usage ? err.usage : null;
            const model = prep.params.model;
            if (err instanceof AiRefusal) {
              const amount = usage ? priceCall(model, model, usage, prep.ceilingMicro, unpricedFor(thisCall)) : prep.ceilingMicro;
              // MUX-38 B: a refusal is never the learner's; the call goes to the house.
              pending.push({ callIndex: thisCall, amount, usage: { ...(usage ?? ZERO_USAGE), model }, learnerPays: false });
              await flush(false);
              const blocks = [{ text: refusalCopy(input.request.lang), fact_ids: [] as string[] }];
              for (const b of blocks) yield { type: "delta", text: b.text };
              yield {
                type: "final",
                result: "refusal", charged: false, credits_used: 0,
                conversation_id: input.conversationId,
                answer_blocks: blocks,
                citations: [],
                refused: "out_of_scope",
                retries: retriesUsed,
                ...(await creditsView(wallet, userId)),
              };
              return;
            }
            // Our side or a reached upstream failure: real cost when the usage is complete, else the ceiling.
            const complete = err instanceof AiEmptyText || err instanceof AiCacheTtlViolation;
            const amount = complete && usage ? priceCall(model, model, usage, prep.ceilingMicro, unpricedFor(thisCall)) : prep.ceilingMicro;
            const entry: Pending = { callIndex: thisCall, amount, usage: { ...(usage ?? ZERO_USAGE), model }, learnerPays: false };
            pending.push(entry);
            const cutOff = err instanceof AiEmptyText && err.stop_reason === "max_tokens";
            if (cutOff) wasTruncated = true;
            if ((err instanceof AiTimeout || cutOff) && canRetry()) {
              retry(cutOff ? "empty answer at the output cap" : "per-call timeout");
              continue;
            }
            if (cutCandidate) {
              // The retry failed too: the first attempt's complete sentences are the answer.
              cutCandidate.pending.learnerPays = true;
              answer = cutCandidate.text;
              break roundLoop;
            }
            if (err instanceof AiEmptyText) break roundLoop; // no text: the notice below
            yield await fail("upstream_error");
            return;
          }

          await settleInput;
          const amount = priceCall(result.model, prep.params.model, result.usage, prep.ceilingMicro, unpricedFor(thisCall));
          const entry: Pending = { callIndex: thisCall, amount, usage: { ...result.usage, model: result.model || prep.params.model }, learnerPays: true };
          pending.push(entry);

          if (result.toolUses.length > 0 && !isLast && !forceText) {
            const echoed = assistantBlocks(result.blocks);
            if (echoed.dropped.length) {
              alert({ kind: "dropped_block", userId, requestId, callIndex: thisCall, detail: `dropped block types: ${echoed.dropped.join(",")}` });
            }
            const toolResults: ToolResultBlockParam[] = [];
            for (const [n, tu] of result.toolUses.entries()) {
              let res: ToolResult;
              if (n >= MENTOR_MAX_TOOL_USES_PER_ROUND) {
                res = { content: "Too many tool calls in one step. Use the results you already have.", factIds: [], isError: true };
              } else if (!TOOL_NAMES.has(tu.name)) {
                res = { content: `Unknown tool "${tu.name}".`, factIds: [], isError: true };
              } else {
                try {
                  yield { type: "status", phase: "checking_sources" };
                  res = await brain.runTool(tu.name, tu.input, ctx);
                } catch (err) {
                  alert({ kind: "tool_error", userId, requestId, callIndex: thisCall, detail: `${tu.name}: ${errMsg(err)}` });
                  res = { content: "The tool failed. Answer without it or say that no verified source is available.", factIds: [], isError: true };
                }
              }
              toolResultsForUi.push({ name: tu.name, result: res });
              if (tu.name === "get_dates" && !res.isError) {
                try { needsFilingUniversity ||= JSON.parse(res.content).needs_filing_university === true; } catch { /* malformed result adds nothing */ }
              }
              for (const id of res.factIds ?? []) if (typeof id === "string" && id) factIds.add(id);
              toolResults.push({
                type: "tool_result",
                tool_use_id: tu.id,
                content: typeof res.content === "string" && res.content.length > 0 ? res.content : "(no result)",
                ...(res.isError ? { is_error: true } : {}),
              });
            }
            messages = [...messages, { role: "assistant", content: echoed.blocks }, { role: "user", content: toolResults }];
            if (cutCandidate) cutCandidate = null;
            continue roundLoop;
          }

          if (result.stop_reason === "max_tokens") {
            wasTruncated = true;
            // Cut off by the output cap: keep only the complete sentences (eval round 1),
            // and try once more when that is possible.
            const trimmed = trimTruncatedAnswer(result.text);
            if (canRetry()) {
              entry.learnerPays = false;
              if (trimmed.trim() && (!cutCandidate || cutCandidate.wrongLanguage || trimmed.length > cutCandidate.text.length)) cutCandidate = { text: trimmed, pending: entry };
              retry("answer cut off at the output cap");
              continue;
            }
            if (cutCandidate && (cutCandidate.wrongLanguage ? !trimmed.trim() : trimmed.trim().length < cutCandidate.text.trim().length)) {
              // The first attempt kept more complete sentences (or the language retry kept none): deliver (and bill) that one.
              entry.learnerPays = false;
              cutCandidate.pending.learnerPays = true;
              answer = cutCandidate.text;
            } else {
              if (cutCandidate) cutCandidate.pending.learnerPays = false;
              answer = trimmed;
            }
            break roundLoop;
          }
          // track-A, 12 Oct (gate round 4): an answer in another language than the
          // learner's is regenerated once with an explicit language instruction. The
          // mismatched attempt goes to the house and stays the fallback if the retry
          // cannot run or fails; the learner pays for at most one answer.
          const wrongLang = languageRetryLeft > 0 ? answerLanguageMismatch(result.text, ctx.lang) : null;
          if (wrongLang && MENTOR_TURN_BUDGET_MS - (elapsedNow() - startedAt) >= MENTOR_MIN_CALL_MS) {
            languageRetryLeft--;
            retriesUsed++;
            alert({ kind: "retry", userId, requestId, callIndex: thisCall, detail: `answer language ${wrongLang}, requested ${ctx.lang}` });
            entry.learnerPays = false;
            // A complete answer replaces an earlier cut-off candidate (gate round 3, -8-tr: cut off, then German).
            if (cutCandidate) cutCandidate.pending.learnerPays = false;
            cutCandidate = { text: result.text, pending: entry, wrongLanguage: true };
            messages = withLanguageInstruction(messages, languageRetryInstruction(ctx.lang, wrongLang));
            forceText = true;
            continue;
          }
          if (cutCandidate) cutCandidate.pending.learnerPays = false;
          answer = result.text;
          break roundLoop;
        }
      }

      const lang = input.request.lang;
      const noticeFinal = async (reason: "no_source" | "truncated" | "empty" = wasTruncated ? "truncated" : "empty"): Promise<MentorSseEvent[]> => {
        // No usable text (only a protocol header, an empty answer, or tool use on the
        // last round): the not-confirmed notice with the official link, never charged.
        let link = officialLinkForExam(null);
        try {
          if (factIds.size > 0) {
            const official = (await facts.byIds([...factIds])).find((f) => !isInternalFactId(f.id) && /^https:\/\//.test(f.source_url));
            if (official) link = official.source_url;
          }
        } catch {
          /* the default official page */
        }
        await flush(false);
        const text = topicNotice(lang);
        return [
          { type: "delta", text },
          {
            type: "final",
            result: "notice", reason, charged: false, credits_used: 0,
            conversation_id: input.conversationId,
            answer_blocks: [{ text, fact_ids: [], replaced: true, official_url: link }],
            citations: [],
            retries: retriesUsed,
            ...(await creditsView(wallet, userId)),
          },
        ];
      };

      if (!answer || !answer.trim()) {
        for (const ev of await noticeFinal()) yield ev;
        return;
      }

      // An explain answer that argues about the gloss rules loses those lines; the
      // model's last glossed form of a named term stays first (gate round 3, -10-tr).
      if (ctx.mode === "explain" && ctx.lang !== "de") answer = repairGlossMeta(answer, glossTermsFromTools(toolResultsForUi), ctx.lang);

      const isStudyAnswer = ctx.mode === "study" || toolResultsForUi.some(r => r.name === "get_my_progress" && !r.result.isError);
      if (isStudyAnswer && studySentenceViolation(answer, ctx.lang)) {
        for (const ev of await noticeFinal("no_source")) yield ev;
        return;
      }
      let validated: ReturnType<typeof brain.validate>;
      let cited: Awaited<ReturnType<typeof facts.byIds>> = [];
      try {
        cited = factIds.size > 0 ? await facts.byIds([...factIds]) : [];
        validated = brain.validate(answer, cited, factIds);
      } catch (err) {
        alert({ kind: "validator_error", userId, requestId, detail: errMsg(err) });
        yield await fail("upstream_error");
        return;
      }
      // Answer only what was asked (deletes unasked fee, pass-mark and other-sitting
      // sentences; never adds text). A failure here keeps the validated answer.
      try {
        const byId = new Map(cited.map((f) => [f.id, f] as const));
        // Fact-sheet ids the answer cites without a tool call are looked up once more.
        const missing = [...new Set(validated.blocks.flatMap((b) => (Array.isArray(b.fact_ids) ? b.fact_ids : [])))].filter((id) => !byId.has(id));
        if (missing.length > 0) for (const f of await facts.byIds(missing)) byId.set(f.id, f);
        validated = trimUnaskedValues(validated, {
          question: learnerQuestion(input),
          lang: ctx.lang,
          // Computed status facts live in the brain's turn store, not the loader (closed windows for the next-sitting rule).
          resolve: (id) => byId.get(id) ?? brain.resolveFact?.(id) ?? null,
          retrievedIds: factIds,
        });
      } catch (err) {
        alert({ kind: "validator_error", userId, requestId, detail: `trim: ${errMsg(err)}` });
      }
      // Deadline first in every language: the tool's closing line opens the answer (reorder only).
      validated = hoistDeadlineLine(validated, deadlineLinesFromTools(toolResultsForUi));
      // A filing university without its own deadline: the code-owned not-confirmed line with
      // that university's page, first and every time; no other publisher's day or name.
      const gap = deadlineGap(toolResultsForUi);
      if (gap) validated = answerDeadlineGap(validated, gap.university, ctx.lang, gap.exam);
      let refusalOfficeLabel: string | undefined;
      if (validated.refused && validated.refused !== "patient_advice") {
        // Office/source selection is code-owned. Model refusal prose cannot contradict its button.
        let sources = cited;
        const routed = ctx.filingUniversity ? officialLinkForUniversity(ctx.filingUniversity) : validated.refusalLink;
        if (!refusalOffice(sources, routed, ctx.filingUniversity)) {
          const query = validated.refused === "certificate_acceptance" ? "Sprachprüfung C1 Zertifikat" : ctx.filingUniversity ? `Nostrifizierung ${ctx.filingUniversity}` : "Nostrifizierung";
          try { sources = [...sources, ...await facts.search(query)]; } catch { /* no new assertions */ }
        }
        const office = refusalOffice(sources, routed, ctx.filingUniversity);
        refusalOfficeLabel = office?.label;
        validated = { ...validated, blocks: [{text: refusalLine(validated.refused,lang),fact_ids:[]}], citations:[], refusalLink:office?.url };
      }
      const blocks = validated.blocks.filter((b) => b && typeof b.text === "string" && b.text.length > 0);
      if (blocks.length === 0) {
        alert({ kind: "validator_error", userId, requestId, detail: "validator returned no blocks" });
        for (const ev of await noticeFinal()) yield ev;
        return;
      }

      // Only a real answer the validator kept whole is the learner's (MUX-38 B).
      // A refusal, a partly replaced answer or nothing but the fallback notice is not.
      const fallbackOnly = !validated.refused && blocks.every((b) => isFallbackOnlyText(b.text));
      if (fallbackOnly) {
        await flush(false);
        for (const block of blocks) yield { type: "delta", text: block.text };
        yield { type: "final", result: "notice", reason: "no_source", charged: false, credits_used: 0, conversation_id: input.conversationId, answer_blocks: blocks, citations: [], retries: retriesUsed, ...(await creditsView(wallet, userId)) };
        return;
      }
      await flush(learnerPaysFor(validated));

      for (let i = 0; i < blocks.length; i++) {
        yield { type: "delta", text: i < blocks.length - 1 ? `${blocks[i].text}\n\n` : blocks[i].text };
      }
      yield {
        type: "final",
        result: validated.refused ? "refusal" : "answer", charged: creditsUsedMicro > 0, credits_used: creditsExactFromMicro(creditsUsedMicro),
        ...(isStudyAnswer && !validated.refused ? { study_answer: true, ...(() => {
          const progress = toolResultsForUi.find(r => r.name === "get_my_progress" && !r.result.isError);
          try { const total = progress && JSON.parse(progress.result.content).answered_total; return Number.isSafeInteger(total) && total >= 0 ? { study_scope: { answered: total } } : {}; } catch { return {}; }
        })() } : {}),
        ...(ctx.mode === "explain" && ctx.answered === false && ctx.explainAction !== "solution" && !validated.refused ? { explain_hint: { hints_used: Math.min(2, (ctx.hintCount ?? 0) + 1) as 1 | 2, next_credit_cost: (() => {
          const next = firstCallCeiling(deps, { ...input, request: { ...input.request, explain_action: "solution" } });
          return next.ok ? creditsExactFromMicro(next.ceilingMicro * config.maxToolRounds) : 0;
        })() } } : {}),
        conversation_id: input.conversationId,
        answer_blocks: blocks,
        citations: validated.citations,
        ...((needsFilingUniversity || blocks.some(b => /\?/.test(b.text) && /Wien|Vienna/iu.test(b.text) && /Graz/iu.test(b.text) && /Innsbruck/iu.test(b.text))) && !ctx.filingUniversity ? { needs_filing_university: true } : {}),
        ...(!validated.refused ? { next_actions: nextActions(ctx.mode,toolResultsForUi,ctx.questionId).filter(action => !action.exam_date || blocks.some(block => block.confirmed_dates?.includes(action.exam_date!))), plan_items: ctx.mode === "study" ? toolResultsForUi.filter(r => r.name === "get_my_progress").flatMap(r => planItemsFromTool(r.result)).slice(0,6) : [] } : {}),
        ...(validated.refusalLink && refusalOfficeLabel ? { refusal_label: refusalOfficeLabel } : {}),
        ...(validated.refused ? { refused: validated.refused } : {}),
        ...(validated.refusalLink ? { refusal_link: validated.refusalLink } : {}),
        ...(validated.replaced ? { validator_replaced: true, replaced_count: validated.rejected.length } : {}),
        retries: retriesUsed,
        ...(await creditsView(wallet, userId)),
      };
    } finally {
      // Any path that left a reached call unbooked (an unexpected throw, a consumer
      // that stopped early) books it to the house: never to the learner by accident.
      if (pending.length > 0) await flush(false);
    }
  };
}

function defaultAlert(a: MentorAlert): void {
  console.error(`[mentor] ${a.kind} user=${a.userId} request=${a.requestId}${a.callIndex !== undefined ? ` call=${a.callIndex}` : ""} ${a.detail ?? ""}`);
}

/** C17 runMentorTurn with console alerts (the eval uses this; the route passes Sentry). */
export const runMentorTurn: RunMentorTurn = createRunMentorTurn();
