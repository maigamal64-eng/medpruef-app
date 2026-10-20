/**
 * a-topic-reset-selfserve-1019 ([name] 19 Oct, decision topic-reset-selfserve-1019):
 * a signed-in learner resets the progress of one subject; every reset is
 * backed up in progress_resets and an admin can restore it.
 * Pure rules shared by the routes and the client. SQL owner:
 * supabase/migrations/20270112090000_a_topic_reset.sql.
 */
import { EXAM_SOURCE_IDS } from "@/lib/topics";

/** Server runtime flag: only the literal 'true' turns the reset on. */
export function topicResetEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.TOPIC_RESET_ENABLED === "true";
}

/** Resets per learner in 24 hours (checked in SQL under the learner lock). */
export const TOPIC_RESET_DAILY_LIMIT = 10;
/** Bound on archived rows per reset (a subject has a few hundred questions). */
export const TOPIC_RESET_MAX_ROWS = 20000;
export const TOPIC_MAX_LENGTH = 200;

export interface TopicResetInput { examType: string; topic: string }

export function parseTopicResetBody(body: unknown): TopicResetInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const examType = typeof b.exam_type === "string" ? b.exam_type : "";
  const topic = typeof b.topic === "string" ? b.topic.trim() : "";
  if (!(EXAM_SOURCE_IDS as readonly string[]).includes(examType)) return null;
  if (!topic || topic.length > TOPIC_MAX_LENGTH) return null;
  return { examType, topic };
}

export type ResetStatus = "reset" | "empty" | "unknown_topic" | "rate_limited" | "too_large" | "invalid";
export type RestoreStatus = "restored" | "already_restored" | "not_found" | "invalid";

export const RESET_HTTP: Record<ResetStatus, number> = {
  reset: 200, empty: 200, unknown_topic: 404, rate_limited: 429, too_large: 409, invalid: 400,
};
export const RESTORE_HTTP: Record<RestoreStatus, number> = {
  restored: 200, already_restored: 409, not_found: 404, invalid: 400,
};

export function isResetStatus(v: unknown): v is ResetStatus {
  return typeof v === "string" && v in RESET_HTTP;
}
export function isRestoreStatus(v: unknown): v is RestoreStatus {
  return typeof v === "string" && v in RESTORE_HTTP;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A function or table that is not installed yet (changeset not applied). */
export function missingSchema(error: { code?: string } | null | undefined): boolean {
  return Boolean(error && ["PGRST202", "PGRST205", "42883", "42P01"].includes(String(error.code)));
}

/** One admin list row: never the archived rows themselves. */
export interface ProgressResetSummary {
  id: string;
  exam_type: string;
  topic: string;
  created_at: string;
  restored_at: string | null;
  counts: Record<string, number>;
  restore_counts: Record<string, number> | null;
}
