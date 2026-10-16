"use client";
import { useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui";
import DeadlineReminder from "@/components/DeadlineReminder";
import { isSittingDate, saveMentorExamDate } from "./exam-date";
import type { MentorNextAction } from "@/lib/mentor/contract";
import type { MentorUiLang } from "@/lib/i18n-mentor";
import { r4T } from "./r4-copy";

export default function ExamDateAction({ action, lang, onClick, className = "mp-btn mp-btn--secondary min-h-11 whitespace-normal text-start", icon }: { action: MentorNextAction; lang: MentorUiLang; onClick?: () => void; className?: string; icon?: ReactNode }) {
  const [open,setOpen] = useState(false);
  const [saving,setSaving] = useState(false);
  const [result,setResult] = useState<"saved"|"saveError"|null>(null);
  if (action.kind === "set_exam_date" && !isSittingDate(action.exam_date)) return null;
  const reminder = action.kind === "deadline_reminder";
  async function confirm() {
    if (!action.exam_date || saving) return;
    setSaving(true);
    const ok = await saveMentorExamDate(action.exam_date);
    setSaving(false); setResult(ok ? "saved" : "saveError");
    if (ok) setOpen(false);
  }
  return <>
    <button type="button" className={className} onClick={() => { onClick?.(); setResult(null); setOpen(true); }}>{icon}{r4T(reminder ? "reminder" : "setDate",lang)}</button>
    {result && <p role="status" className="basis-full text-[13px] text-[var(--mp-fg-muted)]">{r4T(result,lang)}</p>}
    <Dialog open={open} onOpenChange={v => {if(!saving)setOpen(v);}} title={r4T(reminder ? "reminder" : "dateConfirm",lang)} hideCloseButton closeOnEscape={!saving} closeOnBackdrop={!saving}>
      <div data-mentor-date-confirm>
        {reminder ? <DeadlineReminder lang={lang === "de" ? "de" : "en"}/> : <p className="text-[14px]">{action.sitting_label} <strong>{action.exam_date}</strong></p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" className="mp-btn mp-btn--secondary min-h-11" disabled={saving} onClick={()=>setOpen(false)}>{r4T("cancel",lang)}</button>
          {!reminder && <button type="button" disabled={saving} aria-busy={saving} onClick={()=>void confirm()} className="mp-btn mp-btn--primary min-h-11">{r4T("setDate",lang)}</button>}
        </div>
      </div>
    </Dialog>
    <style>{`@media(max-width:639px){.mp-dialog__overlay:has([data-mentor-date-confirm]){align-items:flex-end;padding:0}.mp-dialog__surface:has([data-mentor-date-confirm]){max-width:none;border-radius:20px 20px 0 0;padding-bottom:calc(16px + env(safe-area-inset-bottom))}}`}</style>
  </>;
}
