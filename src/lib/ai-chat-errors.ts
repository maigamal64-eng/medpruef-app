/**
 * In-card KI-Erklärung failures as system states (UX-PRA-28). Pure.
 *
 * A failure is never an assistant bubble: it is an Alert with one reason and
 * the right action. Retryable failures (offline, network, timeout, 5xx, burst
 * limit) offer "Erneut versuchen" for every tier; the daily or monthly limit
 * offers no retry and names when it resets, from the server's value; a 402
 * is the plan prompt.
 */
export type AiFailureKind = "offline" | "network" | "timeout" | "server" | "burst" | "daily_limit" | "monthly_limit" | "plan";

export interface AiFailure {
  kind: AiFailureKind;
  retryable: boolean;
  /** When the daily limit resets (from Retry-After / retry_after), if known. */
  resetAt: Date | null;
}

/** Client timeout for one AI explanation request (below the 25 s authFetch default). */
export const AI_CLIENT_TIMEOUT_MS = 15_000;

export function classifyAiFailure(input: {
  status?: number | null;
  body?: { error?: unknown; retry_after?: unknown; retryAfter?: unknown } | null;
  retryAfterHeader?: string | null;
  offline?: boolean;
  timedOut?: boolean;
  now?: Date;
}): AiFailure {
  const now = input.now ?? new Date();
  if (input.offline) return { kind: "offline", retryable: true, resetAt: null };
  if (input.timedOut) return { kind: "timeout", retryable: true, resetAt: null };
  const status = input.status ?? null;
  if (status === null) return { kind: "network", retryable: true, resetAt: null };
  if (status === 402) return { kind: "plan", retryable: false, resetAt: null };
  if (status === 429) {
    const error = typeof input.body?.error === "string" ? input.body.error : "";
    if (error === "monthly_cap_reached") return { kind: "monthly_limit", retryable: false, resetAt: null };
    const seconds = Number(input.body?.retry_after ?? input.retryAfterHeader ?? NaN);
    // The burst gate answers with retryAfter (camel case) and a short wait.
    if (input.body?.retryAfter !== undefined && input.body?.retry_after === undefined) {
      return { kind: "burst", retryable: true, resetAt: null };
    }
    const resetAt = Number.isFinite(seconds) && seconds > 0 ? new Date(now.getTime() + seconds * 1000) : null;
    return { kind: "daily_limit", retryable: false, resetAt };
  }
  return { kind: "server", retryable: true, resetAt: null };
}

/** "01:00" in the learner's device time, or null when unknown. */
export function resetClock(resetAt: Date | null, locale: string): string | null {
  if (!resetAt || Number.isNaN(resetAt.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(resetAt);
}
