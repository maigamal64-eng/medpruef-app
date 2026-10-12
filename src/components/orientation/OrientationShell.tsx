"use client";

import EnglishVersionNotice from "@/components/guidance/EnglishVersionNotice";
import React, { useEffect, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";
import LanguageToggle from "@/components/LanguageToggle";
import { getUiLang, setLang } from "@/lib/i18n";
import { orientationCopy } from "@/lib/i18n-lb-orientation";
import type { GuidanceLang } from "@/lib/guidance/facts";

export default function OrientationShell({ pageId, lang, children }: {
  pageId: "decoder" | "scope"; lang: GuidanceLang; children: ReactNode;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const c = orientationCopy[lang];
  useEffect(() => {
    if (search.has("lang")) return;
    try {
      if (getUiLang() !== "de") {
        const params = new URLSearchParams(search.toString());
        params.set("lang", "en");
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      }
    } catch { /* The URL works when browser storage is unavailable. */ }
  }, [pathname, router, search]);
  return <div lang={lang} className="min-h-screen bg-[var(--mp-surface)] text-[var(--mp-fg)]">
    <header className="border-b border-[var(--mp-border)]">
      <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-5 py-4">
        <Link className="min-w-0 text-sm font-semibold underline underline-offset-4" href={`/wien-route?lang=${lang}`}>{c.back}</Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LanguageToggle lang={lang} onChange={(next) => {
            const params = new URLSearchParams(search.toString());
            params.set("lang", next);
            try { setLang(next); } catch { /* Language selection still works through the URL. */ }
            router.replace(`${pathname}?${params.toString()}`, { scroll: false });
          }} />
        </div>
      </div>
    </header>
    <main className="mx-auto min-w-0 max-w-4xl px-5 py-10 sm:py-14">
      <EnglishVersionNotice lang={lang} />
      <p className="text-sm font-semibold text-[var(--mp-viridian)]">{c.kicker}</p>
      <h1 className="mt-3 break-words text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">{pageId === "decoder" ? c.decoderTitle : c.scopeTitle}</h1>
      <p className="mt-4 max-w-2xl text-lg leading-relaxed text-[var(--mp-fg-muted)]">{pageId === "decoder" ? c.decoderLede : c.scopeLede}</p>
      <div className="mt-8 text-[var(--mp-fg)]">{children}</div>
    </main>
  </div>;
}
