import { EXAM_SOURCE_IDS, type ExamSourceId } from "@/lib/topics";
import { dualLang } from "./lang";

/**
 * a-first-five-1104: the exam a campaign or post link names, read from its
 * `examSource` query value.
 * Anything that is not one of the three bank keys reads as null.
 */
export function arrivalExamFromSearch(search: string): ExamSourceId | null {
  const p = new URLSearchParams(search);
  const raw = p.get("examSource") ?? "";
  return (EXAM_SOURCE_IDS as readonly string[]).includes(raw) ? (raw as ExamSourceId) : null;
}

export function arrivalExamCopy(lang: string): { title: string; hint: string } {
  return {
    de: { title: "Welche Prüfung bereiten Sie vor?", hint: "Wir starten mit dem passenden Fragenpool. Sie können ihn jederzeit wechseln." },
    en: { title: "Which exam are you preparing for?", hint: "We start with the matching question bank. You can switch any time." },
  }[dualLang(lang)];
}
