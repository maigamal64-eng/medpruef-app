"use client";

import { useEffect, useId, useState } from "react";
import { Dialog } from "@/components/ui";
import { mentorT, type MentorKey, type MentorUiLang } from "@/lib/i18n-mentor";
import type { MentorReportReason } from "./api";

export const ANSWER_REPORT_REASONS: ReadonlyArray<{ value: MentorReportReason; key: MentorKey }> = [
  { value: "date_wrong", key: "report_date_wrong" },
  { value: "rule_wrong", key: "report_rule_wrong" },
  { value: "explanation_unclear", key: "report_explanation_unclear" },
  { value: "question_wrong", key: "report_question_wrong" },
  { value: "other", key: "report_other" },
];

/** Uses the shared Dialog's focus trap and focus return, with mobile sheet chrome. */
export default function ReportAnswerSheet({ open, onClose, onSubmit, lang, initialReason }: {
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: MentorReportReason, details: string) => Promise<boolean>;
  lang: MentorUiLang;
  /** Team reports of an unanswered question start with the general reason. */
  initialReason?: MentorReportReason;
}) {
  const name = useId();
  const [reason, setReason] = useState<MentorReportReason | "">(initialReason ?? "");
  const [details, setDetails] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => { if (open) { setReason(initialReason ?? ""); setDetails(""); setError(false); } }, [open, initialReason]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason || saving) return;
    setSaving(true);
    setError(false);
    const ok = await onSubmit(reason, details.trim());
    setSaving(false);
    if (!ok) setError(true);
  };
  return (
    <Dialog open={open} onOpenChange={(value) => { if (!value && !saving) onClose(); }} title={mentorT("report_answer", lang)} closeOnBackdrop={!saving} closeOnEscape={!saving} hideCloseButton>
      <form data-mentor-report onSubmit={submit}>
        <fieldset disabled={saving}>
          <legend className="mb-2 text-[13px] font-semibold text-[var(--mp-fg)]">{mentorT("report_reason_label", lang)}</legend>
          {ANSWER_REPORT_REASONS.map((r) => (
            <label key={r.value} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-[13px] text-[var(--mp-fg)] hover:bg-[var(--mp-surface-sunken)]">
              <input type="radio" name={name} value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} required className="h-4 w-4 accent-[var(--mp-viridian)]" />
              {mentorT(r.key, lang)}
            </label>
          ))}
          <label className="mt-3 block text-[13px] text-[var(--mp-fg-muted)]">
            {mentorT("report_details", lang)}
            <textarea value={details} onChange={(e) => setDetails(e.target.value)} maxLength={2000} rows={3} dir="auto" className="mt-1 w-full resize-y rounded-lg border border-[var(--mp-border)] bg-[var(--mp-surface-sunken)] p-2 text-[14px] text-[var(--mp-fg)]" />
          </label>
        </fieldset>
        {error && <p role="status" className="mt-2 text-[13px] text-[var(--mp-fg-muted)]">{mentorT("report_error", lang)}</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="mp-btn mp-btn--secondary min-h-11">{mentorT("report_cancel", lang)}</button>
          <button type="submit" disabled={!reason || saving} aria-busy={saving} className="mp-btn mp-btn--primary min-h-11">{mentorT("report_submit", lang)}</button>
        </div>
        <style>{`@media (max-width: 639px) { .mp-dialog__overlay:has([data-mentor-report]) { align-items: flex-end; padding: 0; } .mp-dialog__surface:has([data-mentor-report]) { max-width: none; max-height: 90dvh; border-radius: 20px 20px 0 0; padding-bottom: env(safe-area-inset-bottom); } }`}</style>
      </form>
    </Dialog>
  );
}
