/**
 * Additive translation overlay for languages beyond the de/en base
 * (src/lib/i18n.ts). Populated 2026-07-03 from the Sonnet translator fleet,
 * one flat { key: value } object per language. Any key absent here falls
 * back (in i18n.ts `t()`) to English, then German, then the raw key, so a
 * partial overlay never renders blank.
 *
 * These are generated files: to refresh a language, re-run the translator
 * over the current `translations` map and replace the object below. Keep
 * de/en OUT of this file (they are the authored source of truth).
 *
 * `ar` is intentionally NOT wired until [name] signs off on the Arabic wording
 * (standing rule: all Arabic validated with [name] before going live). When it
 * is approved, add it here and to LIVE_LANGS in i18n.ts.
 */
import type { TranslationKey } from './i18n'

// Populated after the translator fleet + [name]'s review land. Empty overlays
// mean those languages currently fall back to English (safe, not blank).
export const EXTRA_TRANSLATIONS: Partial<
  Record<'ru' | 'uk' | 'tr' | 'ar', Partial<Record<TranslationKey, string>>>
> = {
  ru: {},
  uk: {},
  tr: {},
}

export const RTL_LANGS: readonly ('de' | 'en' | 'ru' | 'uk' | 'tr' | 'ar')[] = ['ar']
