"use client";

/**
 * a-free-credit-hooks L5 + a-rewards-program: the thank-you credits on a
 * testimonial or exam report row. The admin checks for spam only; the reward
 * never depends on what the text says. Preview first (consent, eligibility
 * facts, the sitting and the month's breaker for an exam report), then one
 * confirmed grant.
 */
import { useState } from "react";
import { authFetch } from "@/lib/authFetch";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";

interface Preview {
  kind?: string;
  sitting?: { key: string; label: string } | null;
  month?: { granted: number; cap: number };
  credits: number;
  expiry_days: number;
  consent_public: boolean;
  rewarded: boolean;
  eligibility: { distinctQuestions: number; activeDays: number; everPaid: boolean; meetsBar: boolean } | null;
}

export function TestimonialReward({ id, context }: { id: number | string; context: Record<string, unknown> | null | undefined }) {
  const { can } = useAdminPermissions();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const isExamReport = context?.kind === "exam_report";
  if (context?.kind !== "testimonial" && !isExamReport) return null;
  const t = ((isExamReport ? context.exam_report : context.testimonial) ?? {}) as { consent_public?: boolean };
  const rewarded = typeof context.reward_granted_at === "string";
  const canGrant = can("feedback.manage") && can("revenue.manage");

  const check = async () => {
    setBusy(true);
    try {
      const r = await authFetch("/api/admin/feedback/reward", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
      const body = (await r.json().catch(() => ({}))) as Preview & { error?: string };
      if (r.ok) setPreview(body); else setMessage(body.error ?? `Could not check (HTTP ${r.status}).`);
    } finally { setBusy(false); }
  };
  const grant = async () => {
    setBusy(true);
    try {
      const r = await authFetch("/api/admin/feedback/reward", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, confirm: true }) });
      const body = (await r.json().catch(() => ({}))) as { credits?: number; error?: string };
      setMessage(r.ok ? `Granted ${body.credits} credits.` : body.error === "already_rewarded" ? (isExamReport ? "This person already received the reward for this sitting." : "This person already received the reward.") : body.error === "cap_reached" ? "The monthly exam report limit is reached: not granted." : body.error === "sitting_unknown" ? "Unknown or future sitting: not granted." : body.error === "below_bar" ? "Below the L5 bar: not granted." : body.error ?? `Not granted (HTTP ${r.status}).`);
      if (r.ok) setPreview(null);
    } finally { setBusy(false); }
  };

  return (
    <div className="mt-2 rounded border border-[var(--mp-border-subtle)] p-2 text-xs" data-testid="testimonial-reward">
      <p><strong>{isExamReport ? `Exam report (${typeof context.sitting_key === "string" ? context.sitting_key : "unknown sitting"})` : "Testimonial"}</strong> · public use: <strong>{t.consent_public ? "yes (consented)" : "no"}</strong> · reward: <strong>{rewarded ? "granted" : "not yet"}</strong></p>
      <p className="text-[var(--mp-fg-muted)]">Check for spam only. Never decide by what the text says.</p>
      {canGrant && !rewarded && !preview && <button type="button" disabled={busy} onClick={() => void check()} className="mp-btn mp-btn--secondary mp-btn--sm mt-2 min-h-11">Check reward</button>}
      {preview && (
        <div className="mt-2 space-y-1">
          <p>{preview.eligibility ? `Learner: ${preview.eligibility.distinctQuestions} distinct questions on ${preview.eligibility.activeDays} days${preview.eligibility.everPaid ? ", has paid" : ""}. ${preview.eligibility.meetsBar ? "Meets the L5 bar." : "Below the L5 bar (20 questions on 2 days, or paid)."}` : "Anonymous: cannot be rewarded."}</p>
          {preview.month && <p>{`Exam report rewards this month: ${preview.month.granted} of ${preview.month.cap}.`}{preview.sitting ? ` Sitting: ${preview.sitting.label}.` : " Unknown or future sitting: cannot be rewarded."}</p>}
          {preview.rewarded ? <p>Already rewarded.</p> : preview.eligibility && !preview.eligibility.meetsBar ? <p>Below the bar: the reward cannot be granted.</p> : preview.eligibility && <button type="button" disabled={busy} onClick={() => void grant()} className="mp-btn mp-btn--primary mp-btn--sm min-h-11">Grant {preview.credits} credits ({preview.expiry_days} days)</button>}
        </div>
      )}
      {message && <p role="status" className="mt-1">{message}</p>}
    </div>
  );
}
