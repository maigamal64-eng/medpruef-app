/**
 * TR-10: email the reporter when their question report is resolved.
 *
 * Behind SUGGESTION_RESOLVED_EMAIL_ENABLED (default OFF). One mail per
 * report ever: context.notified_at is claimed with a compare-and-set
 * before sending, so a second PATCH or a double click never mails twice.
 * A failed send releases the claim and records context.notify_error so
 * the admin can retry with "Email reporter". Anonymous reports and
 * accounts without an email are never mailed. The caller awaits this
 * inside its own try/catch: a mail failure never changes the resolution.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendUnlessSuppressed } from "@/lib/mail-suppression";
import { flagResolutionLang, renderFlagResolution } from "@/lib/email/flag-resolution";
import type { ReporterOutcome } from "@/lib/reports/report-status";

export const REPORT_EMAIL_FLAG = "SUGGESTION_RESOLVED_EMAIL_ENABLED";
const SEND_TIMEOUT_MS = 12_000;

export function reportEmailEnabled(): boolean {
  return process.env[REPORT_EMAIL_FLAG] === "true";
}

export type NotifyResult =
  | { notified: true }
  | { notified: false; reason: "disabled" | "anonymous" | "no_email" | "already_notified" | "no_outcome" | "lookup_failed" | "send_failed" | "not_resolved" };

export interface NotifiableReport {
  id: number | string;
  question_id: number;
  user_id: string | null;
  status: string;
  created_at: string | null;
  context: Record<string, unknown>;
}

export async function notifyReporter(
  db: SupabaseClient,
  report: NotifiableReport,
  opts: { outcome: ReporterOutcome | null; adminNote: string | null },
): Promise<NotifyResult> {
  if (!reportEmailEnabled()) return { notified: false, reason: "disabled" };
  if (report.status !== "approved" && report.status !== "rejected") return { notified: false, reason: "not_resolved" };
  if (!report.user_id) return { notified: false, reason: "anonymous" };
  if (!opts.outcome) return { notified: false, reason: "no_outcome" };
  if (typeof report.context.notified_at === "string") return { notified: false, reason: "already_notified" };

  const { data: user, error: userErr } = await db
    .from("users")
    .select("email, first_name, language_code")
    .eq("id", report.user_id)
    .maybeSingle();
  if (userErr) return { notified: false, reason: "lookup_failed" };
  const email = typeof user?.email === "string" ? user.email.trim() : "";
  if (!email || !email.includes("@")) return { notified: false, reason: "no_email" };

  const claimedAt = new Date().toISOString();
  const { notify_error: _previousError, ...base } = report.context;
  void _previousError;
  const { data: claimed, error: claimErr } = await db
    .from("question_suggestions")
    .update({ context: { ...base, notified_at: claimedAt, notified_outcome: opts.outcome } })
    .eq("id", report.id)
    .eq("status", report.status)
    .is("context->>notified_at", null)
    .select("id")
    .maybeSingle();
  if (claimErr) return { notified: false, reason: "lookup_failed" };
  if (!claimed) return { notified: false, reason: "already_notified" };

  const mail = renderFlagResolution({
    lang: flagResolutionLang(user?.language_code as string | null | undefined),
    firstName: (user?.first_name as string | null | undefined) ?? null,
    questionId: report.question_id,
    outcome: opts.outcome,
    adminNote: opts.adminNote,
    reportedAtIso: report.created_at,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL || "https://medpruf.com",
  });

  let ok = false;
  let failure: string = "send_failed";
  try {
    const result = await Promise.race([
      // A reply to the learner's own report: transactional. A withheld address
      // (suppressed, unkeyable, list unreadable) is a definite non-send below.
      sendUnlessSuppressed(db, "transactional", { to: email, subject: mail.subject, htmlBody: mail.htmlBody }),
      new Promise<{ ok: false; reason: "timeout" }>((resolve) => setTimeout(() => resolve({ ok: false, reason: "timeout" }), SEND_TIMEOUT_MS)),
    ]);
    ok = result.ok;
    if (!result.ok) failure = result.reason;
  } catch {
    ok = false;
  }
  if (ok) return { notified: true };

  if (failure === "timeout") {
    // The provider may still deliver: keep the claim (one mail per report
    // ever) and record that the outcome is unknown.
    const { error: markErr } = await db
      .from("question_suggestions")
      .update({ context: { ...base, notified_at: claimedAt, notified_outcome: opts.outcome, notify_error: { at: new Date().toISOString(), reason: "timeout" } } })
      .eq("id", report.id)
      .eq("context->>notified_at", claimedAt);
    if (markErr) console.error("[notify-reporter] could not record timeout", report.id);
    return { notified: false, reason: "send_failed" };
  }

  // A definite failure: release the claim so a retry is possible.
  const { error: releaseErr } = await db
    .from("question_suggestions")
    .update({ context: { ...base, notify_error: { at: new Date().toISOString(), reason: failure } } })
    .eq("id", report.id)
    .eq("context->>notified_at", claimedAt);
  if (releaseErr) console.error("[notify-reporter] claim release failed; retry stays blocked", report.id);
  return { notified: false, reason: "send_failed" };
}
