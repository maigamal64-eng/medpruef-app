"use client";

/**
 * Submit confirmation (UX-EXM-11, UX-EXM-55): tiles for answered, open and
 * flagged (partial selections count as open), the time left, and at most two
 * actions. While questions are open the primary jumps to the first open one;
 * with only flagged items it opens the first flagged one; otherwise "Jetzt
 * abgeben" is primary. Submitting is inert for 800 ms after opening and
 * pending from the first tap (the finalise guard makes it idempotent).
 */
import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui";
import { StatTile } from "@/components/ui/StatTile";
import { te } from "@/lib/i18n-exam";
import { formatClock } from "./ExamClock";

export interface ExamSubmitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lang: string;
  answered: number;
  openCount: number;
  partial: number;
  flagged: number;
  secondsLeft: number | null;
  firstOpenIdx: number | null;
  firstFlaggedIdx: number | null;
  onJump: (idx: number) => void;
  onSubmit: () => void;
}

export function ExamSubmitDialog(p: ExamSubmitDialogProps) {
  const { lang } = p;
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!p.open) { setArmed(false); setPending(false); return; }
    const id = setTimeout(() => setArmed(true), 800);
    return () => clearTimeout(id);
  }, [p.open]);

  const submit = () => {
    if (!armed || pending) return;
    setPending(true);
    p.onSubmit();
  };
  const submitBtn = (primary: boolean) => (
    <button
      type="button"
      className={`mp-btn ${primary ? "mp-btn--primary" : "mp-btn--secondary"} min-h-12 w-full sm:w-auto`}
      aria-disabled={!armed || pending}
      aria-busy={pending || undefined}
      onClick={submit}
    >
      {pending ? te("submit_pending", lang) : te("submit_now", lang)}
    </button>
  );
  const jumpTo = (idx: number) => { p.onOpenChange(false); p.onJump(idx); };

  let footer: React.ReactNode;
  if (p.openCount > 0 && p.firstOpenIdx !== null) {
    footer = <>
      {submitBtn(false)}
      <button type="button" data-dialog-safe className="mp-btn mp-btn--primary min-h-12 w-full sm:w-auto" onClick={() => jumpTo(p.firstOpenIdx!)}>{te("submit_first_open", lang)}</button>
    </>;
  } else if (p.flagged > 0 && p.firstFlaggedIdx !== null) {
    footer = <>
      {submitBtn(false)}
      <button type="button" data-dialog-safe className="mp-btn mp-btn--primary min-h-12 w-full sm:w-auto" onClick={() => jumpTo(p.firstFlaggedIdx!)}>{te("submit_review_flagged", lang)}</button>
    </>;
  } else {
    footer = <>
      {submitBtn(true)}
      <button type="button" data-dialog-safe className="mp-btn mp-btn--secondary min-h-12 w-full sm:w-auto" onClick={() => p.onOpenChange(false)}>{te("submit_back", lang)}</button>
    </>;
  }

  return (
    <Dialog
      open={p.open}
      onOpenChange={(o) => { if (!pending) p.onOpenChange(o); }}
      title={p.answered === 0 ? te("submit_none_title", lang) : te("submit_title", lang)}
      placement="auto"
      kind="confirm"
      busy={pending}
      footer={<div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>}
    >
      <div className="grid grid-cols-3 gap-2">
        <StatTile label={te("submit_answered", lang)} value={p.answered} />
        <StatTile label={te("submit_open", lang)} value={p.openCount} />
        <StatTile label={te("submit_flagged", lang)} value={p.flagged} />
      </div>
      {p.partial > 0 && <p className="mt-3 text-sm text-[var(--mp-fg)]">{te("submit_partial", lang, { n: p.partial })}</p>}
      {p.secondsLeft !== null && <p className="mt-2 text-sm text-[var(--mp-fg)]" dir="auto">{te("submit_time_left", lang, { time: formatClock(p.secondsLeft) })}</p>}
      <p className="mt-2 text-base text-[var(--mp-fg)]">{te("submit_open_wrong", lang)}</p>
    </Dialog>
  );
}
