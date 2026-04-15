"use client";

import { useEffect, useState } from "react";
import CookieBanner from "@/components/CookieBanner";
import { getLang } from "@/lib/i18n";

/**
 * Thin client wrapper that reads the stored language and mounts
 * CookieBanner. Required because `layout.tsx` is a server component
 * and CookieBanner needs a `lang` prop.
 *
 * Rendered from layout.tsx as part of the ePrivacy/TTDSG compliance
 * fix (2026-04-15 audit — the banner existed but was never mounted).
 */
export default function CookieBannerMount() {
  const [lang, setLang] = useState<"de" | "en">("de");
  useEffect(() => {
    setLang(getLang());
  }, []);
  return <CookieBanner lang={lang} />;
}
