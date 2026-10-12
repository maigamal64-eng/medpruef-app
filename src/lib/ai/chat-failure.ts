import * as Sentry from "@sentry/nextjs";

/**
 * One upstream attempt of /api/ai-chat, as recorded for the failure alert.
 * Status and code only: never the prompt, the reply or the learner's text.
 */
export interface UpstreamAttempt {
  provider: "anthropic" | "openai";
  model: string;
  role: "primary" | "fallback";
  status: string;
  code: string | null;
  durationMs: number;
}

export interface ChatFailureContext {
  userId: string;
  tier: string | null;
  mode: string;
  refused: boolean;
  durationMs: number;
  attempts: UpstreamAttempt[];
}

/** Minimal insert surface so the helper is testable without Supabase. */
export interface EventInsertClient {
  from(table: "user_events"): {
    insert(row: Record<string, unknown>): PromiseLike<{ error: { message?: string } | null }>;
  };
}

/**
 * The phase written to user_events and Sentry. A safety refusal is not an
 * outage; "no_provider" means no key or mode allowed any call at all.
 */
export function chatFailurePhase(ctx: Pick<ChatFailureContext, "refused" | "attempts">): "refusal" | "all_upstreams_failed" | "no_provider" {
  if (ctx.refused) return "refusal";
  if (ctx.attempts.length === 0) return "no_provider";
  return "all_upstreams_failed";
}

/**
 * Issue 4 (user activity 2026-10-12): every learner chat failed for five
 * weeks and nothing alerted. When no upstream returns a reply, raise one
 * Sentry message (error level, except a refusal) and write the
 * ai_chat_failed user_event with each attempt's provider, model, status
 * and code. Never throws: the learner still gets the 503 reply.
 */
export async function reportChatFailure(db: EventInsertClient | null, ctx: ChatFailureContext): Promise<void> {
  const phase = chatFailurePhase(ctx);
  const attempts = ctx.attempts.map((a) => ({
    provider: a.provider,
    model: a.model,
    role: a.role,
    status: a.status,
    code: a.code,
    duration_ms: a.durationMs,
  }));
  if (phase !== "refusal") {
    try {
      const summary = attempts.length
        ? attempts.map((a) => `${a.provider}/${a.model}: ${a.status}${a.code ? ` (${a.code})` : ""}`).join("; ")
        : "no provider attempted";
      Sentry.captureMessage(`ai-chat ${phase}: ${summary}`, {
        level: "error",
        // One Sentry issue per phase, so an outage groups instead of fragmenting by model and status.
        fingerprint: ["ai-chat", phase],
        tags: { route: "/api/ai-chat", step: phase, mode: ctx.mode, tier: ctx.tier ?? "unknown" },
        extra: { attempts, duration_ms: ctx.durationMs },
        user: { id: ctx.userId },
      });
    } catch {
      /* Sentry unavailable: the console line below still reaches the runtime log */
    }
    console.error(`[ai-chat] ${phase} after ${ctx.durationMs} ms`, JSON.stringify(attempts));
  }
  if (!db) return;
  try {
    const { error } = await db.from("user_events").insert({
      user_id: ctx.userId,
      event_type: "ai_chat_failed",
      event_data: {
        phase,
        duration_ms: ctx.durationMs,
        mode: ctx.mode,
        tier: ctx.tier,
        attempts,
      },
    });
    if (error) console.error("[ai-chat] ai_chat_failed event insert:", error.message ?? error);
  } catch (err) {
    console.error("[ai-chat] ai_chat_failed event insert threw:", err);
  }
}
