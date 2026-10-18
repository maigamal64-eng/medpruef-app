/**
 * a-quiz-load-failed-honest (2026-10-17): why a quiz question did not load.
 *
 * Before this, every exception in the quiz's next-question read was logged as
 * `quiz_load_failed {status: 0, reason: "network"}`: an 8 s authFetch
 * deadline, a dropped connection and a body that was not JSON looked the
 * same, so the learner watch could not tell a slow server from a bad network.
 *
 * Pure owner of the split. Telemetry only; the learner-visible copy and the
 * offline pack button are gated separately (NEXT_PUBLIC_QUIZ_LOAD_HONEST).
 */
import { isDeadlineError } from "./quiz-pack-fallback";

export type QuizLoadReason =
  /** The browser reports no connection. */
  | "offline"
  /** The client deadline elapsed (authFetch TimeoutError, any deadline, pack flag or not). */
  | "timeout"
  /** The request was cancelled before its deadline (navigation, unmount). */
  | "aborted"
  /** The response arrived but its body was not JSON (SyntaxError). */
  | "parse"
  /** Any other failure to get a response (dropped connection, DNS, CORS). */
  | "network";

/** Error names worth keeping; anything else is reported as "other" (never free text). */
export const QUIZ_LOAD_ERROR_NAMES = ["TimeoutError", "AbortError", "TypeError", "SyntaxError"] as const;
export type QuizLoadErrorName = (typeof QUIZ_LOAD_ERROR_NAMES)[number] | "other";

export function quizLoadErrorName(error: unknown): QuizLoadErrorName {
  const name = error && typeof error === "object" ? (error as { name?: unknown }).name : undefined;
  return typeof name === "string" && (QUIZ_LOAD_ERROR_NAMES as readonly string[]).includes(name) ? (name as QuizLoadErrorName) : "other";
}

/** Older Safari rejects an aborted fetch with AbortError even when the abort reason was the deadline. */
const DEADLINE_SLACK_MS = 250;

export interface QuizLoadFailureInput {
  error: unknown;
  /** "fetch": no response arrived. "parse": a response arrived, reading its JSON body failed. */
  phase: "fetch" | "parse";
  /** HTTP status of the response, when one arrived (phase "parse"). */
  status?: number;
  /** navigator.onLine at the time of the failure (undefined outside a browser). */
  online?: boolean;
  elapsedMs: number;
  /** The deadline the read ran under (authFetch default or the pack-fallback deadline). */
  deadlineMs: number;
}

export interface QuizLoadFailure {
  reason: QuizLoadReason;
  status: number;
  error_name: QuizLoadErrorName;
  elapsed_ms: number;
}

export function classifyQuizLoadFailure(input: QuizLoadFailureInput): QuizLoadFailure {
  const error_name = quizLoadErrorName(input.error);
  const elapsed_ms = Math.max(0, Math.round(input.elapsedMs));
  const status = input.phase === "parse" ? input.status ?? 0 : 0;
  // A body that is not JSON is parse; a body read cut off mid-stream is a
  // connection failure and keeps the status that had arrived.
  if (input.phase === "parse" && error_name === "SyntaxError") return { reason: "parse", status, error_name, elapsed_ms };
  let reason: QuizLoadReason;
  if (input.online === false) reason = "offline";
  else if (isDeadlineError(input.error)) reason = "timeout";
  else if (error_name === "AbortError") reason = elapsed_ms >= input.deadlineMs - DEADLINE_SLACK_MS ? "timeout" : "aborted";
  else reason = "network";
  return { reason, status, error_name, elapsed_ms };
}

/** offline_download_finished.result from a downloadPack result (null = the download threw). */
export function offlineDownloadOutcome(result: { ok: true } | { ok: false; reason: string } | null): "ok" | "error" | "aborted" {
  if (!result) return "error";
  if (result.ok) return "ok";
  return result.reason === "aborted" ? "aborted" : "error";
}
