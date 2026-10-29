/**
 * Referral prompt strings (a-referral-prompt-1029, Lektor APPROVE 29 Oct). Formal Sie, no dashes, no
 * exclamation marks, no reward and no price: the invite text, its disclosure
 * and the reward conditions stay in referral-copy.ts (one owner, SoT 2.x) and
 * appear under the share controls and on /referrals. ru, uk, tr and ar fall
 * back to English until native review.
 */
import type { ReferralMoment } from "@/lib/referral-prompt";
import { referralSurfaceLang } from "@/lib/referral-surface-copy";

export type ReferralPromptLang = "de" | "en";

const COPY = {
  title_strong_session: ["Eine starke Lerneinheit.", "A strong session."],
  title_fixed_mistakes: ["Frühere Fehler, jetzt richtig beantwortet.", "Earlier mistakes, now answered correctly."],
  body: [
    "Bereitet sich eine Kollegin oder ein Kollege auf dieselbe Prüfung vor? Teilen Sie MedPrüf mit Ihrem persönlichen Link.",
    "Is a colleague preparing for the same exam? Share MedPrüf with your personal link.",
  ],
  terms_link: ["Bedingungen der Empfehlung", "Referral conditions"],
  dismiss_forever: ["Nicht mehr fragen", "Don't ask again"],
  close_aria: ["Hinweis ausblenden", "Hide this"],
} as const satisfies Record<string, readonly [string, string]>;

export type ReferralPromptKey = keyof typeof COPY;

const INDEX: Record<ReferralPromptLang, 0 | 1> = { de: 0, en: 1 };

/** German only for "de"; every other language reads English (same rule as the referral surfaces). */
export function referralPromptLang(lang: string | null | undefined): ReferralPromptLang {
  return referralSurfaceLang(lang);
}

export function rpT(key: ReferralPromptKey, lang: string | null | undefined): string {
  return COPY[key][INDEX[referralPromptLang(lang)]];
}

const TITLE: Record<ReferralMoment, ReferralPromptKey> = {
  strong_session: "title_strong_session",
  fixed_mistakes: "title_fixed_mistakes",
};

export function referralPromptTitle(moment: ReferralMoment, lang: string | null | undefined): string {
  return rpT(TITLE[moment], lang);
}

/** Every string, for the copy guard test. */
export const REFERRAL_PROMPT_COPY = COPY;
