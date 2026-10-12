"use client";

import type { Lang } from "@/lib/i18n";
import { tp } from "@/lib/i18n-puyp";
import { getExamLabel } from "@/lib/master-locale/exam-label";
import { Select, TextField } from "@/components/ui";
import { EXAM_TYPES, type ExamType } from "./rules";

/** Exam and date of the real attempt; shared by the choice and the proof form. */
export function ExamFields({
  lang,
  examType,
  setExamType,
  attemptDate,
  setAttemptDate,
  dateError,
  required,
}: {
  lang: Lang;
  examType: ExamType;
  setExamType: (v: ExamType) => void;
  attemptDate: string;
  setAttemptDate: (v: string) => void;
  dateError?: string;
  required?: boolean;
}) {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Select
        label={tp("examType", lang)}
        required={required}
        value={examType}
        onChange={(e) => setExamType(e.target.value as ExamType)}
        options={EXAM_TYPES.map((key) => ({ value: key, label: getExamLabel(key, "full", lang) }))}
      />
      <TextField
        label={tp("attemptDate", lang)}
        type="date"
        required={required}
        max={today}
        value={attemptDate}
        onChange={(e) => setAttemptDate(e.target.value)}
        error={dateError}
        helper={tp("attemptDateHelper", lang)}
      />
    </div>
  );
}
