/**
 * Rendered language and direction (UX-GLOBAL-01, UX-GLOBAL-02).
 *
 * The stored preference (any of six languages) and the language actually on
 * screen are different things. A language renders only after its review gate
 * lifts (REVIEWED_LANGS in language-model.ts: ru/uk/tr after a native review
 * pass, ar after [name]). Until then every key falls back to English, and the
 * <html> attributes name English and left-to-right, so an Arabic account on
 * the English fallback never gets a mirrored English layout.
 *
 * German exam content (stems, options, explanations, flashcard faces, mistake
 * rows, topic and drug names) always carries lang="de" dir="ltr" through
 * GERMAN_CONTENT, whatever the chrome language.
 */
import { REVIEWED_LANGS, type UiLanguage } from '../language-model';

export const RTL_LANGUAGES: readonly UiLanguage[] = ['ar'];

/** Attributes for German exam content inside any chrome language. */
export const GERMAN_CONTENT = { lang: 'de', dir: 'ltr' } as const;

/** True once a language's strings may render (its review gate is lifted). */
export function isReviewedLanguage(lang: UiLanguage, reviewed: readonly UiLanguage[] = REVIEWED_LANGS): boolean {
  return reviewed.includes(lang);
}

/**
 * The language and direction of the copy rendered for a preference. dir is
 * rtl only when the rendered copy itself is a reviewed right-to-left language.
 */
export function renderedLanguage(
  preference: UiLanguage,
  reviewed: readonly UiLanguage[] = REVIEWED_LANGS,
): { lang: UiLanguage; dir: 'ltr' | 'rtl' } {
  const lang: UiLanguage = isReviewedLanguage(preference, reviewed) ? preference : 'en';
  return { lang, dir: RTL_LANGUAGES.includes(lang) ? 'rtl' : 'ltr' };
}

/**
 * Per-key resolution: a reviewed overlay string when present, otherwise the
 * English base, never German for a non-German preference and never a raw key.
 */
export function resolveString(
  base: { de?: string; en?: string } | undefined,
  preference: UiLanguage,
  overlay: Partial<Record<string, string>> | undefined,
  key: string,
  fallback: string,
  reviewed: readonly UiLanguage[] = REVIEWED_LANGS,
): { text: string; lang: UiLanguage } {
  if (preference === 'de' && base?.de) return { text: base.de, lang: 'de' };
  if (preference !== 'de' && preference !== 'en' && isReviewedLanguage(preference, reviewed)) {
    const v = overlay?.[key];
    if (v) return { text: v, lang: preference };
  }
  if (base?.en) return { text: base.en, lang: 'en' };
  return { text: fallback, lang: 'en' };
}
