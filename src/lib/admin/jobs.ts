/**
 * jobs helpers — enqueue / progress / finish / cancel long-running admin
 * jobs. §2.6 of the April 23 admin revamp sprint.
 *
 * UX contract:
 *  - enqueueJob() inserts a row with status='queued' and returns the id.
 *    Route handlers immediately flip it to 'running' when work starts.
 *  - updateJobProgress() writes progress_pct + progress_label. Realtime
 *    subscribers on the admin Overview page pick it up within ~1s.
 *  - finishJob() flips to 'succeeded' or 'failed' with result/error.
 *  - cancelJob() sets cancel_requested_at. Workers are expected to poll
 *    for this flag at reasonable checkpoints and bail out cleanly.
 */

import { getServiceClient } from "@/lib/supabase";
import { captureServerError } from "@/lib/sentry-capture";

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface EnqueueJobArgs {
  kind: string;
  startedBy: string;
  payload?: Record<string, unknown>;
  /** If true, immediately sets status='running' and started_at=now(). */
  startNow?: boolean;
}

export async function enqueueJob(args: EnqueueJobArgs): Promise<string | null> {
  try {
    const sb = getServiceClient();
    const { data, error } = await sb
      .from("jobs")
      .insert({
        kind: args.kind,
        started_by: args.startedBy,
        payload: args.payload ?? {},
        status: args.startNow ? "running" : "queued",
        started_at: args.startNow ? new Date().toISOString() : null,
      })
      .select("id")
      .maybeSingle();
    if (error) throw error;
    return (data?.id as string) ?? null;
  } catch (err) {
    captureServerError(err, { route: "admin/jobs/enqueue", kind: args.kind });
    return null;
  }
}

export interface UpdateJobProgressArgs {
  jobId: string;
  progressPct: number;
  progressLabel?: string;
}

export async function updateJobProgress(args: UpdateJobProgressArgs): Promise<void> {
  try {
    const sb = getServiceClient();
    const pct = Math.max(0, Math.min(100, Math.floor(args.progressPct)));
    const { error } = await sb
      .from("jobs")
      .update({
        progress_pct: pct,
        progress_label: args.progressLabel ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", args.jobId);
    if (error) throw error;
  } catch (err) {
    captureServerError(err, { route: "admin/jobs/progress", jobId: args.jobId });
  }
}

export interface FinishJobArgs {
  jobId: string;
  status: "succeeded" | "failed" | "cancelled";
  result?: Record<string, unknown>;
  error?: string;
}

export async function finishJob(args: FinishJobArgs): Promise<void> {
  try {
    const sb = getServiceClient();
    const { error } = await sb
      .from("jobs")
      .update({
        status: args.status,
        result: args.result ?? null,
        error: args.error ?? null,
        finished_at: new Date().toISOString(),
        progress_pct: args.status === "succeeded" ? 100 : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", args.jobId);
    if (error) throw error;
  } catch (err) {
    captureServerError(err, {
      route: "admin/jobs/finish",
      jobId: args.jobId,
      status: args.status,
    });
  }
}

export async function cancelJob(jobId: string): Promise<void> {
  try {
    const sb = getServiceClient();
    const { error } = await sb
      .from("jobs")
      .update({
        cancel_requested_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId);
    if (error) throw error;
  } catch (err) {
    captureServerError(err, { route: "admin/jobs/cancel", jobId });
  }
}

/**
 * Check whether a job has been requested-cancelled. Call this from
 * long-running workers at reasonable checkpoints (e.g. every 100 rows)
 * and bail out cleanly via finishJob({ status: 'cancelled' }).
 */
export async function isCancelRequested(jobId: string): Promise<boolean> {
  try {
    const sb = getServiceClient();
    const { data } = await sb
      .from("jobs")
      .select("cancel_requested_at")
      .eq("id", jobId)
      .maybeSingle();
    return !!data?.cancel_requested_at;
  } catch {
    return false;
  }
}
