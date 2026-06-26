"use client";

import { useEffect, useState } from "react";
import { getLang } from "@/lib/i18n";
import FindYourPath from "@/components/FindYourPath";

type Lang = "de" | "en";

/**
 * /find-your-path — the public, anon-safe guided orientation flow.
 *
 * Reachable from the landing CTA ("Not sure where to start? Find your
 * path") and by any first-run / confused user. No auth required: the
 * whole flow + the "Your Path" output run client-side (see
 * FindYourPath.tsx). We read the stored language on mount (SSR-safe:
 * default "de" until hydration), then hand off.
 */
export default function FindYourPathPage() {
  const [lang, setLang] = useState<Lang>("de");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setLang(getLang());
    setMounted(true);
  }, []);

  // Avoid a DE-then-EN flash for EN users: hold the shell until we've
  // read the stored language. (Matches the landing page's mount gate.)
  if (!mounted) {
    return <div className="min-h-screen bg-[var(--mp-surface-sunken)]" />;
  }

  return <FindYourPath initialLang={lang} />;
}
