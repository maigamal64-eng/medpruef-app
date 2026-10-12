"use client";
/**
 * First-question primer (UX-ONB-33): one slim, dismissible strip on the first
 * question after onboarding, for free accounts only. It is part of the quiz
 * screen (outside the announcement queue), does not take focus, and is shown
 * once: "Verstanden" or the first answer ends it, and the acknowledgement is
 * stored per account (it also holds for this visit when storage is blocked).
 * It only says what the question card shows: some questions have more than
 * one correct answer. No scoring rule and no allowance line are repeated here.
 */
import { useEffect, useState } from "react";
import { safeStorage } from "@/lib/safe-storage";
import { t, type Lang } from "@/lib/i18n";
import { Info } from "lucide-react";

export const primerKey = (userId: string) => `medpruef_onb_primer:${userId}`;

export default function FirstQuestionPrimer({ userId, free, answered, lang }: { userId: string; free: boolean; answered: boolean; lang: Lang }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!userId || !free) { setShow(false); return; }
    try { setShow(safeStorage.getItem(primerKey(userId)) === "pending"); } catch { setShow(false); }
  }, [userId, free]);

  const done = () => {
    setShow(false);
    try { safeStorage.setItem(primerKey(userId), "done"); } catch { /* blocked: hidden for this visit */ }
  };
  useEffect(() => { if (show && answered) done(); }, [show, answered]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!show) return null;
  return (
    <section aria-label={t("a22_primer_label", lang)} className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-3 py-2" data-testid="first-question-primer">
      <Info className="h-4 w-4 flex-shrink-0 text-[var(--mp-info-text)]" aria-hidden />
      <p className="min-w-0 flex-1 text-[14px] text-[var(--mp-fg)]">{t("a22_primer_text", lang)}</p>
      <button type="button" onClick={done} className="mp-btn mp-btn--secondary min-h-11 text-[14px]">{t("a22_ios_coach_ok", lang)}</button>
    </section>
  );
}
