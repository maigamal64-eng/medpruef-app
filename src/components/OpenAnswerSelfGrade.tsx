"use client";

import { useState } from "react";
import { t, type Lang } from "@/lib/i18n";

interface Props {
  lang: Lang;
  /** Resolves true when the grade was saved or queued; false lets the learner tap again. */
  onSelfGrade: (known: boolean) => Promise<boolean>;
}

/**
 * a-open-answer-fix-1123: shown under the revealed answer of a question without
 * choices, only while OPEN_ANSWER_SELF_GRADE_ENABLED is on. Skipping it leaves
 * the reveal unscored; the Next button never waits for it.
 */
export default function OpenAnswerSelfGrade({ lang, onSelfGrade }: Props) {
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");

  const grade = async (known: boolean) => {
    if (state === "saving" || state === "done") return;
    setState("saving");
    let ok = false;
    try { ok = await onSelfGrade(known); } catch { ok = false; }
    setState(ok ? "done" : "error");
  };

  if (state === "done") {
    return <p role="status" className="text-[13px] text-[var(--mp-fg-muted)]">{t("a_open_self_saved", lang)}</p>;
  }
  return (
    <div className="space-y-2" data-open-answer-self-grade>
      <p id="open-self-grade-q" className="text-[13px] text-[var(--mp-fg-muted)]">{t("a_open_self_q", lang)}</p>
      <div role="group" aria-labelledby="open-self-grade-q" className="grid grid-cols-2 gap-2">
        <button type="button" disabled={state === "saving"} onClick={() => grade(true)} className="mp-btn mp-btn--secondary min-h-11">
          {t("a_open_self_known", lang)}
        </button>
        <button type="button" disabled={state === "saving"} onClick={() => grade(false)} className="mp-btn mp-btn--secondary min-h-11">
          {t("a_open_self_unknown", lang)}
        </button>
      </div>
      {state === "error" && <p role="alert" className="text-[13px] text-[var(--mp-error)]">{t("a_open_self_error", lang)}</p>}
    </div>
  );
}
