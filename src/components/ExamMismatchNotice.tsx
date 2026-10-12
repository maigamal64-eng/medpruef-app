"use client";

/**
 * Shown when a link names a different exam than the account's active exam
 * (UX-GLOBAL-30): the account exam is practised, and switching is an explicit,
 * saved choice. Copy is Sie (pick-copy-register B).
 */
import { useState } from "react";
import { EXAM_SOURCES, type ExamSourceId } from "@/lib/topics";

const label = (id: ExamSourceId) => EXAM_SOURCES.find((e) => e.id === id)?.label ?? id;

export default function ExamMismatchNotice({ lang, active, linked, onSwitch }: {
  lang: "de" | "en" | string;
  active: ExamSourceId;
  linked: ExamSourceId;
  onSwitch: (exam: ExamSourceId) => Promise<boolean>;
}) {
  const de = lang === "de";
  const [state, setState] = useState<"idle" | "saving" | "failed">("idle");
  return (
    <div className="mx-4 mt-3 rounded-xl border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] p-3 text-sm text-[var(--mp-fg)] lg:mx-8" data-exam-mismatch={linked}>
      <p>
        {de
          ? `Dieser Link gehört zu ${label(linked)}. Geübt wird Ihre aktive Prüfung: ${label(active)}.`
          : `This link is for ${label(linked)}. You are practising your active exam: ${label(active)}.`}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="min-h-11 rounded-lg border border-[var(--mp-viridian)] px-3 text-[var(--mp-viridian)] disabled:opacity-60"
          disabled={state === "saving"}
          onClick={async () => {
            setState("saving");
            if (await onSwitch(linked)) window.location.reload();
            else setState("failed");
          }}
        >
          {de ? `Zu ${label(linked)} wechseln` : `Switch to ${label(linked)}`}
        </button>
        <span role="status" className="text-[var(--mp-fg-muted)]">
          {state === "failed" ? (de ? "Wechsel nicht gespeichert. Bitte erneut versuchen." : "Switch not saved. Please try again.") : ""}
        </span>
      </div>
    </div>
  );
}
