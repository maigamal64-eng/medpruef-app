/**
 * Recorded language decision (LX-23, pick-language-scope A, 2026-10-11).
 * Per language: does the app UI render it, are AI explanations and
 * flash-notes offered in it, and why. Public "languages" lines quote
 * EXPLANATION_LANGUAGES in content-truth.ts, which this table must agree with
 * (tests/unit/master-locale/language-decision.test.ts cross-checks the
 * translate route, the picker list and content-truth).
 */

export type DecisionLang = 'de' | 'en' | 'ru' | 'uk' | 'tr' | 'ar' | 'fr' | 'sr' | 'ro' | 'fa';

export type UiState =
  /** Rendered in full and offered on first-run surfaces. */
  | 'live'
  /** Listed in Settings; shown with per-key English fallback until native review. */
  | 'settings-english-fallback'
  /** Listed in Settings for accounts that already store it; English until [name] signs off. */
  | 'settings-pending-[name]'
  | 'none';

export type ExplanationState = 'original' | 'claimed' | 'unreviewed-label' | 'pending-[name]' | 'none';

export type LanguageDecision = { ui: UiState; explanations: ExplanationState; reason: string };

export const LANGUAGE_DECISION: Record<DecisionLang, LanguageDecision> = {
  de: { ui: 'live', explanations: 'original', reason: 'Exam language; every question and explanation is authored in German.' },
  en: { ui: 'live', explanations: 'claimed', reason: 'Authored source for every UI string and the per-key fallback.' },
  ru: { ui: 'settings-english-fallback', explanations: 'claimed', reason: 'Large share of learners. UI overlay exists as drafts; renders after one native review pass.' },
  uk: { ui: 'settings-english-fallback', explanations: 'claimed', reason: 'Large share of learners. UI overlay exists as drafts; renders after one native review pass.' },
  tr: { ui: 'settings-english-fallback', explanations: 'claimed', reason: 'UI overlay exists as drafts; renders after one native review pass.' },
  ar: { ui: 'settings-pending-[name]', explanations: 'pending-[name]', reason: 'Egyptian-register copy and right-to-left layout need [name] sign-off before any public claim. Digits stay Latin (pick-arabic-digits A).' },
  fr: { ui: 'none', explanations: 'unreviewed-label', reason: 'Few learners; explanations offered with an unreviewed label, no UI.' },
  sr: { ui: 'none', explanations: 'unreviewed-label', reason: 'Few learners; explanations offered with an unreviewed label, no UI.' },
  ro: { ui: 'none', explanations: 'none', reason: 'Removed from claims; one saved account, no reviewer.' },
  fa: { ui: 'none', explanations: 'none', reason: 'Requested in the groups but not planned for launch; needs a native reviewer before it is scheduled.' },
};

/** Languages the UI may list in Settings (in this order). */
export function settingsLanguages(): DecisionLang[] {
  return (Object.keys(LANGUAGE_DECISION) as DecisionLang[]).filter((l) => LANGUAGE_DECISION[l].ui !== 'none');
}

/** Languages AI explanations may be translated into (excludes the German original). */
export function explanationTargets(): DecisionLang[] {
  return (Object.keys(LANGUAGE_DECISION) as DecisionLang[]).filter((l) => {
    const e = LANGUAGE_DECISION[l].explanations;
    return e === 'claimed' || e === 'unreviewed-label' || e === 'pending-[name]';
  });
}
