/**
 * Gate sentence for the entitlements matrix (UX-GLOBAL-19). Client copy, kept
 * apart from entitlements.ts so API routes read the matrix without the client
 * i18n module.
 */
import { t, type Lang, type TranslationKey } from './i18n';
import type { Feature } from './entitlements';

/** One gate sentence for every surface: '{Funktion} ist Teil von Pro.' (i18n keys a12_feature_*). */
export function gateSentence(feature: Feature, lang: string): string {
  return t('a12_gate_sentence', lang as Lang).replace('{name}', t(`a12_feature_${feature}` as TranslationKey, lang as Lang));
}

