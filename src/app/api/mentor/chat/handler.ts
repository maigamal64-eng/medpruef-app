/**
 * POST /api/mentor/chat handler (W2-CORE), framework-free so tests drive it
 * with fakes. route.ts only builds the real dependencies.
 *
 * Errors before the stream starts are JSON MentorErrorBody with the
 * contract.ts HTTP status. After that the body is Server-Sent Events, one
 * frame per MentorSseEvent:  `data: <json>\n\n`  (`type` discriminates:
 * delta | final | error). `delta` carries validated text only.
 *
 * A client disconnect never aborts the upstream call: the turn runs in a
 * background task (Next `after`) that keeps settling the ledger and writes
 * the conversation history after the `final` event.
 */

import type { CallClaudeFn, Clock, HousePolicy, Meter, MentorDeps, MentorTurnInput, RunMentorTurn } from "@/lib/mentor/seam";
import type { RpcClient } from "@/lib/ai/limits";
import { creditsExactFromMicro, type MentorConfig } from "@/lib/mentor/config";
import type { MentorFinalEvent, MentorSseEvent } from "@/lib/mentor/contract";
import type { ConversationStore } from "@/lib/mentor/conversation";
import {
  MENTOR_MAX_BODY_BYTES,
  checkMentorAccess,
  checkMentorBreaker,
  mentorError,
  parseChatRequest,
  takeMentorAttempt,
  type FlagFn,
  type MentorHttpError,
  type MentorServices,
} from "@/lib/mentor/guard";
import type { MentorRequestStore } from "@/lib/mentor/requests";
import { makeTurnRow, type MentorTurnRow } from "@/lib/mentor/outcomes";
import { admitTurn } from "@/lib/mentor/turn";

export type MentorAuth = { ok: true; userId: string; paidAccess: boolean } | { ok: false };

export interface ChatHandlerDeps {
  config: MentorConfig;
  requests: MentorRequestStore;
  recordTurn(row: MentorTurnRow): Promise<void>;
  recordReview?(input: { requestId: string; userId: string; request: import("@/lib/mentor/contract").MentorChatRequest; final: MentorFinalEvent }): Promise<void>;
  authenticate(req: Request): Promise<MentorAuth>;
  flag: FlagFn;
  betaAllowed?(userId: string): Promise<boolean>;
  rpc: RpcClient;
  services(): MentorServices | null;
  meterFor(userId: string): Meter;
  house: HousePolicy;
  conversations: ConversationStore;
  /** Free-access rule for non-paid callers (src/lib/free-access.ts). Throws on DB error. */
  canReadQuestion(userId: string, questionId: number): Promise<boolean>;
  callClaude: CallClaudeFn;
  clock: Clock;
  newRequestId(): string;
  runTurn: RunMentorTurn;
  /** Keeps the task alive after the response is sent (Next `after`). */
  background(task: Promise<unknown>): void;
  alert(message: string, ctx: Record<string, string | number | boolean | null | undefined>): void;
}

export const SSE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-store, no-transform",
  "x-accel-buffering": "no",
});

export function sseFrame(ev: MentorSseEvent): string {
  return `data: ${JSON.stringify(ev)}\n\n`;
}

export function errorResponse(e: MentorHttpError): Response {
  const headers: Record<string, string> = { "content-type": "application/json", "cache-control": "no-store" };
  if (e.body.retry_after_seconds) headers["retry-after"] = String(e.body.retry_after_seconds);
  return new Response(JSON.stringify(e.body), { status: e.status, headers });
}

async function readBody(req: Request): Promise<{ ok: true; value: unknown } | { ok: false; error: MentorHttpError }> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MENTOR_MAX_BODY_BYTES) return { ok: false, error: mentorError("input_too_large") };
  let text: string;
  try {
    text = await req.text();
  } catch {
    return { ok: false, error: mentorError("invalid_input") };
  }
  if (new TextEncoder().encode(text).length > MENTOR_MAX_BODY_BYTES) return { ok: false, error: mentorError("input_too_large") };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: mentorError("invalid_input") };
  }
}

/** True when credit is left and every funding lot is the free taste. */
export function onlyFreeTasteFunds(lots: ReadonlyArray<{ source: string; remainingMicro: number; startsAt: string; expiresAt: string }>, nowMs: number): boolean {
  const live = lots.filter((l) => l.remainingMicro > 0 && Date.parse(l.startsAt) <= nowMs && Date.parse(l.expiresAt) > nowMs);
  return live.length > 0 && live.every((l) => l.source === "free_taste");
}

export async function handleMentorChat(req: Request, d: ChatHandlerDeps): Promise<Response> {
  // 1. auth
  const auth = await d.authenticate(req);
  if (!auth.ok) return errorResponse(mentorError("unauthenticated"));
  const { userId, paidAccess } = auth;

  // 2 + 3. switches (AI master, mentor master, allowlist, DB flag)
  const denied = await checkMentorAccess(d.config, userId, d.flag, d.betaAllowed);
  if (denied) return errorResponse(denied);

  // 4. input
  const body = await readBody(req);
  if (!body.ok) return errorResponse(body.error);
  const parsed = parseChatRequest(body.value);
  if (!parsed.ok) return errorResponse(parsed.error);
  const request = parsed.request;
  // This route is the web transport. A Telegram adapter has not passed its release gates.
  if (request.channel === "telegram" || request.entry === "telegram") return errorResponse(mentorError("invalid_input"));
  if (request.question_id !== undefined && !paidAccess) {
    try {
      if (!(await d.canReadQuestion(userId, request.question_id))) return errorResponse(mentorError("invalid_input", { reason: "question_access" }));
    } catch {
      return errorResponse(mentorError("reserve_failed"));
    }
  }

  const now = d.clock.now();
  let requestId: string;
  try {
    const claim = await d.requests.claim(userId, request, d.newRequestId());
    if (!claim.claimed) {
      if (claim.result.status === "complete" && claim.result.final) return new Response(sseFrame(claim.result.final), { headers: { ...SSE_HEADERS } });
      if (claim.result.status === "in_progress") return new Response(sseFrame({ type: "in_progress", client_request_id: request.client_request_id }), { headers: { ...SSE_HEADERS } });
      return errorResponse(mentorError(claim.result.error ?? "upstream_error"));
    }
    requestId = claim.requestId;
  } catch {
    return errorResponse(mentorError("reserve_failed"));
  }
  const startedMs = Date.now();
  const recordedSettles = new Set<number>();
  const stats = { calls: 0, retries: 0, chargedMicro: 0, houseMicro: 0, coldCache: false };
  const record = async (final: MentorFinalEvent | null, error?: import("@/lib/mentor/contract").MentorErrorCode) => {
    try {
      await d.recordTurn(makeTurnRow({ requestId, userId, request, startedAt: now, final, error, latencyMs: Date.now() - startedMs, ...stats }));
    } catch {
      d.alert("mentor outcome write failed", { route: "/api/mentor/chat", userId, requestId });
    }
  };
  const finish = async (final: MentorFinalEvent | import("@/lib/mentor/contract").MentorErrorCode) => {
    try { await d.requests.finish(userId, requestId, final); }
    catch { d.alert("mentor result write failed", { route: "/api/mentor/chat", userId, requestId }); }
  };
  const blocked = async (e: MentorHttpError) => {
    await record(null, e.body.error);
    await finish(e.body.error);
    return errorResponse(e);
  };


  // 6. global breaker
  const resting = await checkMentorBreaker(d.rpc, d.config, now);
  if (resting) return blocked(resting);

  // 7. wallet, history, admission
  const services = d.services();
  if (!services) {
    d.alert("mentor services not wired (resolveMentorServices returned null)", { route: "/api/mentor/chat", userId });
    return blocked(mentorError("reserve_failed"));
  }
  try {
    await services.wallet.ensureIncludedGrants(userId, now);
  } catch (err) {
    d.alert(`ensureIncludedGrants failed: ${String((err as Error)?.message ?? err)}`, { route: "/api/mentor/chat", userId });
    return blocked(mentorError("reserve_failed"));
  }
  // The free taste funds facts mode only ([name] pick MUX-20 A). Any other
  // credit lot lifts the restriction.
  if (request.mode !== "facts") {
    try {
      if (onlyFreeTasteFunds((await services.wallet.balance(userId)).lots, now.getTime())) {
        return blocked(mentorError("credits_required", { reason: "facts_only" }));
      }
    } catch {
      return blocked(mentorError("reserve_failed"));
    }
  }
  let conversation: Awaited<ReturnType<ConversationStore["resolve"]>>;
  try {
    conversation = await d.conversations.resolve(userId, request.conversation_id);
  } catch {
    return blocked(mentorError("reserve_failed"));
  }

  const deps: MentorDeps = {
    meter: (() => {
      const meter = d.meterFor(userId);
      return {
        ...meter,
        async reserve(...args: Parameters<Meter["reserve"]>) {
          const r = await meter.reserve(...args);
          if (r.ok && !r.duplicate) stats.calls++;
          return r;
        },
        async settle(...args: Parameters<Meter["settle"]>) {
          const r = await meter.settle(...args);
          if (r.ok && r.billedTo && !recordedSettles.has(args[1])) {
            recordedSettles.add(args[1]);
            if (r.billedTo === "user") stats.chargedMicro += r.chargedMicro ?? 0;
            else stats.houseMicro += r.chargedMicro ?? 0;
            if ((args[3].cache_read_input_tokens ?? 0) === 0) stats.coldCache = true;
          }
          return r;
        },
      };
    })(),
    brain: services.brain,
    facts: services.facts,
    callClaude: d.callClaude,
    clock: d.clock,
    wallet: services.wallet,
    house: d.house,
    config: d.config,
  };
  const input: MentorTurnInput = {
    requestId,
    userId,
    conversationId: conversation.conversationId,
    request,
    history: conversation.history,
    paidAccess,
  };

  const admit = await admitTurn(deps, input);
  if (!admit.ok) {
    // MUX-23: the 402 names the same bar /usage shows, with the balance it was compared to.
    const numbers = admit.error === "credits_exhausted" && admit.admitMinMicro !== undefined && admit.availableMicro !== undefined
      ? { admit_min_credits: creditsExactFromMicro(admit.admitMinMicro), credits_left: creditsExactFromMicro(admit.availableMicro) }
      : {};
    return blocked(mentorError(admit.error, numbers));
  }

  // Only admitted, successfully reserved messages enter the rate counters.
  // Cache the first reserve for the loop; its internal admission already passed.
  const firstReserve = await deps.meter.reserve(requestId, 0, admit.ceilingMicro);
  if (!firstReserve.ok || firstReserve.duplicate) {
    if (firstReserve.reason !== "insufficient") return blocked(mentorError("reserve_failed"));
    // A balance that moved between admission and reserve: the same bar (MUX-23).
    return blocked(mentorError("credits_exhausted", { admit_min_credits: creditsExactFromMicro(admit.ceilingMicro * d.config.maxToolRounds), credits_left: creditsExactFromMicro(admit.availableMicro) }));
  }
  const limited = await takeMentorAttempt(d.rpc, d.config, userId, now, requestId);
  if (limited) {
    await deps.meter.release(requestId, 0);
    return blocked(limited);
  }
  const realReserve = deps.meter.reserve.bind(deps.meter);
  let initialHold = true;
  deps.meter.reserve = async (id, index, ceiling) => {
    if (initialHold && id === requestId && index === 0 && ceiling === admit.ceilingMicro) {
      initialHold = false;
      return firstReserve;
    }
    return realReserve(id, index, ceiling);
  };
  input.admitted = true;

  // 8. stream
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
    cancel() {
      open = false; // client went away; the turn keeps running and settling
    },
  });
  const emit = (ev: MentorSseEvent): void => {
    if (!open || !controller) return;
    try {
      controller.enqueue(encoder.encode(sseFrame(ev)));
    } catch {
      open = false;
    }
  };

  const heartbeat = setInterval(() => emit({ type: "heartbeat" }), 10_000);
  const task = (async () => {
    let final: MentorFinalEvent | null = null;
    let error: import("@/lib/mentor/contract").MentorErrorCode | undefined;
    try {
      for await (const ev of d.runTurn(deps, input)) {
        if (ev.type === "final") final = { ...ev, request_id: requestId, ...(request.question_id ? { question_id: request.question_id } : {}) };
        else if (ev.type === "error") { error = ev.error; stats.retries = ev.retries ?? 0; }
        else emit(ev);
      }
    } catch (err) {
      d.alert(`mentor turn threw: ${String((err as Error)?.message ?? err)}`, { route: "/api/mentor/chat", userId, requestId: input.requestId });
      error = "upstream_error";
    }
    if (final && final.result !== "notice") {
      const factIds = [...new Set(final.answer_blocks.flatMap((b) => b.fact_ids))];
      const saved = await d.conversations.append({
        conversationId: input.conversationId,
        userId,
        requestId: input.requestId,
        lang: request.lang,
        mode: request.mode,
        userText: request.message,
        assistantText: final.answer_blocks.map((b) => b.text).join("\n\n"),
        factIds,
        refused: final.refused,
      }).catch(() => false);
      if (!saved) d.alert("mentor history write failed", { route: "/api/mentor/chat", userId, requestId: input.requestId });
    }
    if (final && d.recordReview) await d.recordReview({ requestId, userId, request, final }).catch(() => d.alert("mentor review snapshot write failed", { requestId }));
    if (initialHold) await deps.meter.release(requestId, 0);
    clearInterval(heartbeat);
    stats.retries = final?.retries ?? stats.retries;
    await record(final, error);
    await finish(final ?? error ?? "upstream_error");
    // turn.ts books a turn without a final to the house. Say so only when no
    // settle of this request was booked to the learner (a throw after the
    // final flush could follow a learner debit).
    emit(final ?? { type: "error", error: error ?? "upstream_error", ...(stats.chargedMicro === 0 ? { credits_deducted: false as const } : {}) });
    if (open && controller) {
      try { (controller as ReadableStreamDefaultController<Uint8Array>).close(); } catch { /* closed */ }
    }
  })();
  d.background(task);

  return new Response(stream, { status: 200, headers: { ...SSE_HEADERS } });
}
