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
import type { MentorConfig } from "@/lib/mentor/config";
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
import { admitTurn } from "@/lib/mentor/turn";

export type MentorAuth = { ok: true; userId: string; paidAccess: boolean } | { ok: false };

export interface ChatHandlerDeps {
  config: MentorConfig;
  authenticate(req: Request): Promise<MentorAuth>;
  flag: FlagFn;
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

export async function handleMentorChat(req: Request, d: ChatHandlerDeps): Promise<Response> {
  // 1. auth
  const auth = await d.authenticate(req);
  if (!auth.ok) return errorResponse(mentorError("unauthenticated"));
  const { userId, paidAccess } = auth;

  // 2 + 3. switches (AI master, mentor master, allowlist, DB flag)
  const denied = await checkMentorAccess(d.config, userId, d.flag);
  if (denied) return errorResponse(denied);

  // 4. input
  const body = await readBody(req);
  if (!body.ok) return errorResponse(body.error);
  const parsed = parseChatRequest(body.value);
  if (!parsed.ok) return errorResponse(parsed.error);
  const request = parsed.request;
  if (request.question_id !== undefined && !paidAccess) {
    try {
      if (!(await d.canReadQuestion(userId, request.question_id))) return errorResponse(mentorError("invalid_input"));
    } catch {
      return errorResponse(mentorError("reserve_failed"));
    }
  }

  const now = d.clock.now();

  // 5. attempts (counted before any model call)
  const limited = await takeMentorAttempt(d.rpc, d.config, userId, now);
  if (limited) return errorResponse(limited);

  // 6. global breaker
  const resting = await checkMentorBreaker(d.rpc, d.config, now);
  if (resting) return errorResponse(resting);

  // 7. wallet, history, admission
  const services = d.services();
  if (!services) {
    d.alert("mentor services not wired (resolveMentorServices returned null)", { route: "/api/mentor/chat", userId });
    return errorResponse(mentorError("reserve_failed"));
  }
  try {
    await services.wallet.ensureIncludedGrants(userId, now);
  } catch (err) {
    d.alert(`ensureIncludedGrants failed: ${String((err as Error)?.message ?? err)}`, { route: "/api/mentor/chat", userId });
    return errorResponse(mentorError("reserve_failed"));
  }
  let conversation: Awaited<ReturnType<ConversationStore["resolve"]>>;
  try {
    conversation = await d.conversations.resolve(userId, request.conversation_id);
  } catch {
    return errorResponse(mentorError("reserve_failed"));
  }

  const deps: MentorDeps = {
    meter: d.meterFor(userId),
    brain: services.brain,
    facts: services.facts,
    callClaude: d.callClaude,
    clock: d.clock,
    wallet: services.wallet,
    house: d.house,
    config: d.config,
  };
  const input: MentorTurnInput = {
    requestId: d.newRequestId(),
    userId,
    conversationId: conversation.conversationId,
    request,
    history: conversation.history,
    paidAccess,
  };

  const admit = await admitTurn(deps, input);
  if (!admit.ok) return errorResponse(mentorError(admit.error));

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

  const task = (async () => {
    let final: MentorFinalEvent | null = null;
    try {
      for await (const ev of d.runTurn(deps, input)) {
        emit(ev);
        if (ev.type === "final") final = ev;
      }
    } catch (err) {
      d.alert(`mentor turn threw: ${String((err as Error)?.message ?? err)}`, { route: "/api/mentor/chat", userId, requestId: input.requestId });
      emit({ type: "error", error: "upstream_error" });
    } finally {
      if (open && controller) {
        try {
          (controller as ReadableStreamDefaultController<Uint8Array>).close();
        } catch {
          /* already closed */
        }
      }
    }
    if (final) {
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
      });
      if (!saved) d.alert("mentor history write failed", { route: "/api/mentor/chat", userId, requestId: input.requestId });
    }
  })();
  d.background(task);

  return new Response(stream, { status: 200, headers: { ...SSE_HEADERS } });
}
