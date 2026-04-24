"use client";

import CookieBanner from "@/components/CookieBanner";
import { useLang } from "@/lib/i18n";

/**
 * Thin client wrapper that reads the stored language and mounts
 * CookieBanner. Required because `layout.tsx` is a server component
 * and CookieBanner needs a `lang` prop.
 *
 * Rendered from layout.tsx as part of the ePrivacy/TTDSG compliance
 * fix (2026-04-15 audit — the banner existed but was never mounted).
 *
 * Uses the `useLang` hook so that in-session language toggles update
 * the banner copy immediately without a page reload.
 */
export default function CookieBannerMount() {
  const lang = useLang();
  return <CookieBanner lang={lang} />;
}
