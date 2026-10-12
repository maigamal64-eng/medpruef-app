"use client";

import Link from "next/link";
import TurnIntoNoteButton from "@/components/TurnIntoNoteButton";
import type { MentorAnswerBlock } from "@/lib/mentor/contract";
import type { MentorUiLang } from "@/lib/i18n-mentor";
import { a39T, deOrEn } from "./a39-copy";
import { formatDate } from "./view-model";

/**
 * MUX-64: only the grounded part of an explain answer becomes a flashcard
 * (background and options layers stay out), saved through /api/notes/transform as kind
 * ai_explanation with the question id, and labelled as a KI-Erklärung from
 * the mentor with its date so it is never mistaken for the learner's own note.
 */
export function groundedNoteText(blocks: MentorAnswerBlock[], lang: MentorUiLang, now: Date = new Date()): string {
  const grounded = blocks.filter((b) => !b.explain_layer || b.explain_layer === "grounded").map((b) => b.text.trim()).filter(Boolean);
  if (!grounded.length) return "";
  const label = a39T("note_label", lang, { date: formatDate(now.toISOString(), lang) });
  return `${label}\n\n${grounded.join("\n\n")}`;
}

export default function SaveExplanation({ blocks, questionId, lang }: { blocks: MentorAnswerBlock[]; questionId: number; lang: MentorUiLang }) {
  const text = groundedNoteText(blocks, lang);
  return (
    <div data-mentor-save className="mt-2 flex flex-wrap items-center gap-2">
      {text && <TurnIntoNoteButton kind="ai_explanation" lang={deOrEn(lang)} sourceRef={{ question_id: questionId }} text={text} size="sm" allowCustomize={false} />}
      <Link href={`/quiz?questionId=${questionId}&from=mentor`} className="inline-flex min-h-11 items-center rounded-full border border-[var(--mp-border)] px-3 text-[13px] font-semibold text-[var(--mp-cta-blue)]">{a39T("view_question", lang)}</Link>
    </div>
  );
}
