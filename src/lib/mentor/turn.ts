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
 * Billing matrix (who pays what, per API call):
 *   - provably never reached the model (AiInputRejected, AiUpstream with
 *     reachedModel=false: 4xx, 529, connect errors)  -> release the hold, free.
 *   - AiRefusal (the model declined)                  -> billed to the user at
 *     the reported usage; the turn ends with a `final` carrying `refused`.
 *   - AiEmptyText / AiCacheTtlViolation (full usage)  -> actual cost; the
 *     house pays the first N a Vienna day, then the user.
 *   - timeout, cut stream, abort, other reached 5xx,
 *     unknown exception (cost unknown)                -> the reserve ceiling;
 *     house first N a day, then the user.
 *   - success                                         -> actual cost to the
 *     user. An unpriceable model id settles at the ceiling and alerts.
 *   A failed settle is retried once; if it still fails the hold stays open
 *   and the stale sweep settles it at the ceiling (never released).
 *
 * Model deltas are NOT forwarded: the code validator must see every date,
 * number, percentage and EUR amount before the learner does. `delta` events
 * carry validated block text only.
 */

import {
  AiCacheTtlViolation,
  AiEmptyText,
  AiError,
  AiInputRejected,
  AiRefusal,
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
import { canAdmitMessage, creditsFromMicro, messagesLeftEstimate } from "./config";
import type { MentorErrorCode, MentorLang, MentorSseEvent } from "./contract";
import { MENTOR_TOOL_NAMES } from "./seam";
import type { MentorDeps, MentorTurnInput, MeterUsage, RunMentorTurn, ToolResult, TurnContext, Wallet } from "./seam";

/** Per API call; 3 rounds (75 s) fit the chat route maxDuration (90 s). */
export const MENTOR_CALL_TIMEOUT_MS = 25_000;

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
    | "duplicate_reserve";
  userId: string;
  requestId: string;
  callIndex?: number;
  detail?: string;
}

export interface TurnOptions {
  /** Ops alert sink (the route wires Sentry). Must not throw. */
  alert?: (a: MentorAlert) => void;
}

/** Fixed copy for a safety-classifier refusal (Arabic and others fall back to English until signed off). */
export const MENTOR_REFUSAL_COPY: Readonly<Record<"de" | "en", string>> = Object.freeze({
  de: "Dabei kann ich dir hier nicht helfen. Bitte wende dich direkt an die zuständige offizielle Stelle.",
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
    now,
    paidAccess: input.paidAccess,
  };
}

export function initialMessages(input: MentorTurnInput): MessageParam[] {
  return [...input.history, { role: "user", content: input.request.message }];
}

export type PreparedCall =
  | { ok: true; params: CallClaudeParams; messages: MessageParam[]; bytes: number; ceilingMicro: number }
  | { ok: false; error: MentorErrorCode; detail?: string };

/**
 * Build the exact request for one API call and its reserve ceiling. History
 * is trimmed (oldest first) to fit MAX_INPUT_BYTES. The last allowed round
 * forces a text answer with tool_choice none (tools stay for the cache prefix).
 */
export function prepareCall(deps: MentorDeps, ctx: TurnContext, messages: MessageParam[], isLastRound: boolean): PreparedCall {
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
    timeoutMs: MENTOR_CALL_TIMEOUT_MS,
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
export function firstCallCeiling(deps: MentorDeps, input: MentorTurnInput): PreparedCall {
  const ctx = buildTurnContext(input, deps.clock.now());
  return prepareCall(deps, ctx, initialMessages(input), deps.config.maxToolRounds === 1);
}

export type AdmitResult =
  | { ok: true; ceilingMicro: number; availableMicro: number; everGranted: boolean }
  | { ok: false; error: MentorErrorCode; availableMicro?: number; detail?: string };

/**
 * Frozen admission rule (config.ts canAdmitMessage): a message starts only
 * when available >= maxToolRounds x the first call's ceiling. Below it:
 * credits_required (never had a lot) or credits_exhausted.
 */
export async function admitTurn(deps: MentorDeps, input: MentorTurnInput): Promise<AdmitResult> {
  const first = firstCallCeiling(deps, input);
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
    return { ok: false, error: everGranted ? "credits_exhausted" : "credits_required", availableMicro: available };
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
    return { credits_left: creditsFromMicro(b.availableMicro), messages_left_estimate: messagesLeftEstimate(b.availableMicro, avg) };
  } catch {
    return { credits_left: 0, messages_left_estimate: 0 };
  }
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

  return async function* runMentorTurn(deps: MentorDeps, input: MentorTurnInput): AsyncGenerator<MentorSseEvent> {
    const { meter, brain, facts, callClaude, clock, wallet, house, config } = deps;
    const { userId, requestId } = input;
    const ctx = buildTurnContext(input, clock.now());

    const admit = await admitTurn(deps, input);
    if (!admit.ok) {
      if (admit.detail) alert({ kind: "brain_error", userId, requestId, detail: admit.detail });
      yield errorEvent(admit.error);
      return;
    }

    const settle = async (callIndex: number, amount: number, usage: MeterUsage, billUser: boolean): Promise<void> => {
      let r = await meter.settle(requestId, callIndex, amount, usage, billUser);
      if (!r.ok && r.reason !== "not_found" && r.reason !== "invalid_args") {
        r = await meter.settle(requestId, callIndex, amount, usage, billUser);
      }
      if (!r.ok) {
        alert({ kind: "settle_failed", userId, requestId, callIndex, detail: `${r.reason ?? "unknown"}; stale sweep bills the ceiling` });
      } else if (r.overrun) {
        alert({ kind: "overrun", userId, requestId, callIndex, detail: `charged ${r.chargedMicro} micro-USD above the reserve` });
      }
    };

    const release = async (callIndex: number): Promise<void> => {
      let r = await meter.release(requestId, callIndex);
      if (!r.ok) r = await meter.release(requestId, callIndex);
      if (!r.ok) alert({ kind: "release_failed", userId, requestId, callIndex, detail: "hold stays open; stale sweep bills the ceiling" });
    };

    const houseTakes = async (): Promise<boolean> => {
      try {
        return await house.takeFreeFail(userId);
      } catch (err) {
        alert({ kind: "house_policy_error", userId, requestId, detail: errMsg(err) });
        return false; // fail closed: bill the user
      }
    };

    let messages = initialMessages(input);
    const factIds = new Set<string>();
    let answer: string | null = null;
    const rounds = config.maxToolRounds;

    for (let callIndex = 0; callIndex < rounds; callIndex++) {
      const isLast = callIndex === rounds - 1;
      const prep = prepareCall(deps, ctx, messages, isLast);
      if (!prep.ok) {
        if (prep.detail) alert({ kind: "brain_error", userId, requestId, callIndex, detail: prep.detail });
        yield errorEvent(prep.error);
        return;
      }
      messages = prep.messages;

      const reserved = await meter.reserve(requestId, callIndex, prep.ceilingMicro);
      if (!reserved.ok || reserved.duplicate) {
        if (reserved.duplicate) alert({ kind: "duplicate_reserve", userId, requestId, callIndex });
        yield errorEvent(reserved.ok === false && reserved.reason === "insufficient" ? "credits_exhausted" : "reserve_failed");
        return;
      }

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
          settleInput = meter.settleInput(requestId, callIndex, inputMicro).catch(() => ({ ok: false }));
        } catch {
          /* evidence only; the final settle carries the full cost */
        }
      };

      let result: CallClaudeResult;
      try {
        // Never pass the client's abort signal: a disconnect must not abort upstream.
        result = await callClaude({ ...prep.params, onMessageStart });
      } catch (err) {
        await settleInput;
        if (err instanceof AiError && !err.reachedModel) {
          await release(callIndex);
          yield errorEvent(err instanceof AiInputRejected && err.code === "input_too_large" ? "input_too_large" : "upstream_error");
          return;
        }
        const usage = err instanceof AiError && err.usage ? err.usage : null;
        const model = prep.params.model;
        const unpriced = (detail: string) => alert({ kind: "unpriced_model", userId, requestId, callIndex, detail });
        if (err instanceof AiRefusal) {
          const amount = usage ? priceCall(model, model, usage, prep.ceilingMicro, unpriced) : prep.ceilingMicro;
          await settle(callIndex, amount, { ...(usage ?? ZERO_USAGE), model }, true);
          const blocks = [{ text: refusalCopy(input.request.lang), fact_ids: [] as string[] }];
          for (const b of blocks) yield { type: "delta", text: b.text };
          yield {
            type: "final",
            conversation_id: input.conversationId,
            answer_blocks: blocks,
            citations: [],
            refused: "out_of_scope",
            ...(await creditsView(wallet, userId)),
          };
          return;
        }
        // Our side or a reached upstream failure.
        const complete = err instanceof AiEmptyText || err instanceof AiCacheTtlViolation;
        const amount = complete && usage ? priceCall(model, model, usage, prep.ceilingMicro, unpriced) : prep.ceilingMicro;
        const onHouse = await houseTakes();
        await settle(callIndex, amount, { ...(usage ?? ZERO_USAGE), model }, !onHouse);
        yield errorEvent("upstream_error");
        return;
      }

      await settleInput;
      const amount = priceCall(result.model, prep.params.model, result.usage, prep.ceilingMicro, (detail) =>
        alert({ kind: "unpriced_model", userId, requestId, callIndex, detail }),
      );
      await settle(callIndex, amount, { ...result.usage, model: result.model || prep.params.model }, true);

      if (result.toolUses.length > 0 && !isLast) {
        const echoed = assistantBlocks(result.blocks);
        if (echoed.dropped.length) {
          alert({ kind: "dropped_block", userId, requestId, callIndex, detail: `dropped block types: ${echoed.dropped.join(",")}` });
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
              res = await brain.runTool(tu.name, tu.input, ctx);
            } catch (err) {
              alert({ kind: "tool_error", userId, requestId, callIndex, detail: `${tu.name}: ${errMsg(err)}` });
              res = { content: "The tool failed. Answer without it or say that no verified source is available.", factIds: [], isError: true };
            }
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
        continue;
      }

      answer = result.text;
      break;
    }

    if (!answer) {
      // Tool use on the last round without text: already billed, nothing to show.
      yield errorEvent("upstream_error");
      return;
    }

    let validated: ReturnType<typeof brain.validate>;
    try {
      const cited = factIds.size > 0 ? await facts.byIds([...factIds]) : [];
      validated = brain.validate(answer, cited);
    } catch (err) {
      alert({ kind: "validator_error", userId, requestId, detail: errMsg(err) });
      yield errorEvent("upstream_error");
      return;
    }
    const blocks = validated.blocks.filter((b) => b && typeof b.text === "string" && b.text.length > 0);
    if (blocks.length === 0) {
      alert({ kind: "validator_error", userId, requestId, detail: "validator returned no blocks" });
      yield errorEvent("upstream_error");
      return;
    }

    for (let i = 0; i < blocks.length; i++) {
      yield { type: "delta", text: i < blocks.length - 1 ? `${blocks[i].text}\n\n` : blocks[i].text };
    }
    yield {
      type: "final",
      conversation_id: input.conversationId,
      answer_blocks: blocks,
      citations: validated.citations,
      ...(validated.refused ? { refused: validated.refused } : {}),
      ...(validated.refusalLink ? { refusal_link: validated.refusalLink } : {}),
      ...(validated.replaced ? { validator_replaced: true } : {}),
      ...(await creditsView(wallet, userId)),
    };
  };
}

function defaultAlert(a: MentorAlert): void {
  console.error(`[mentor] ${a.kind} user=${a.userId} request=${a.requestId}${a.callIndex !== undefined ? ` call=${a.callIndex}` : ""} ${a.detail ?? ""}`);
}

/** C17 runMentorTurn with console alerts (the eval uses this; the route passes Sentry). */
export const runMentorTurn: RunMentorTurn = createRunMentorTurn();
