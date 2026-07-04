"use client";

/**
 * TranslateButton — the "Übersetzen" tab surface.
 *
 * Reimplemented for UX-6. The old flow forced a manual click + wait on every
 * question and never auto-showed a saved translation or let the user flip
 * languages without re-clicking. It now delegates to the shared
 * <ExplanationTranslator>, which:
 *   - fetches all cached translations on mount at ZERO cost (read-only GET),
 *   - auto-shows the one matching the user's UI language,
 *   - offers a language switcher (German original + 7 targets) where cached
 *     languages are instant and uncached ones generate-on-first-view (then
 *     cached for everyone),
 *   - renders the translated text as markdown, and
 *   - surfaces the free-tier 5/day quota gracefully (never removes it).
 *
 * This tab does not have the German source text prop (QuestionCard renders it
 * without one — the untranslated original lives on the neighbouring Erklärung
 * tab), so <ExplanationTranslator> starts on a translation here and hides the
 * "Deutsch" option. Props stay backward compatible: only the existing ones
 * are consumed, `defaultTarget` is still accepted for callers that pass it.
 */

import ExplanationTranslator from "@/components/ExplanationTranslator";

type Lang = "de" | "en";
type Field = "ai_explanation" | "explanation";
type TargetLang = "ru" | "ar" | "en" | "fr" | "tr" | "uk" | "sr";

interface TranslateButtonProps {
  questionId: number;
  /** UI language — used for the button/menu copy, NOT the translation target */
  lang: Lang;
  /** User tier — free tier is quota-limited (enforced server-side) */
  userTier?: string;
  /** Which field to translate — ai_explanation preferred, falls back to explanation */
  field: Field;
  /** Optional: preselect a target lang, e.g. from user profile.
   *  Accepted for backward compatibility; the shared translator now decides
   *  the initial language from the user's UI language + cache. */
  defaultTarget?: TargetLang;
}

export default function TranslateButton({
  questionId,
  lang,
  userTier = "free",
  field,
}: TranslateButtonProps) {
  return (
    <ExplanationTranslator
      questionId={questionId}
      lang={lang}
      field={field}
      userTier={userTier}
    />
  );
}
