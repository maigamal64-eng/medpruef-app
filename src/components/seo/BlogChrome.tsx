"use client";

/**
 * BlogChrome — shared header/footer for blog pages. Owns:
 *   - Top bar with MedPrüf wordmark + theme/language toggle
 *   - Breadcrumb back-to-blog link
 *   - Minimal footer with legal links
 *
 * Blog index + post pages wrap their own content with this.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft } from "lucide-react";
import { getLang } from "@/lib/i18n";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";

type Lang = "de" | "en";

export default function BlogChrome({
  children,
  backHref,
  backLabel,
}: {
  children: (lang: Lang) => React.ReactNode;
  backHref?: string;
  backLabel?: { de: string; en: string };
}) {
  const [lang, setLangState] = useState<Lang>("de");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setLangState(getLang());
    setMounted(true);
  }, []);

  const switchLang = (l: Lang) => {
    setLangState(l);
  };

  const L: Lang = mounted ? lang : "de";

  return (
    <div className="min-h-screen bg-[var(--mp-surface-sunken)]">
      <header className="sticky top-0 z-30 bg-[var(--mp-surface-raised)] border-b border-[var(--mp-border-subtle)]">
        <div className="max-w-5xl mx-auto px-4 lg:px-8 py-3 flex items-center justify-between gap-3">
          <Link
            href="/blog"
            className="flex items-center gap-2 text-[var(--mp-fg)] hover:opacity-80 transition-opacity"
            aria-label="MedPrüf Blog"
          >
            <Image
              src="/brand/logomark.svg"
              width={28}
              height={28}
              alt=""
              aria-hidden
              className="flex-shrink-0"
            />
            <span className="font-display font-bold text-lg tracking-tight">
              MedPrüf <span className="text-[var(--mp-viridian)]">Blog</span>
            </span>
          </Link>
          <div className="flex items-center gap-2">
            <Link
              href="/pricing"
              className="text-sm text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] transition-colors hidden sm:inline"
            >
              {L === "de" ? "Preise" : "Pricing"}
            </Link>
            <ThemeToggle />
            <LanguageToggle lang={L} onChange={switchLang} />
          </div>
        </div>
      </header>

      {backHref && (
        <div className="max-w-5xl mx-auto px-4 lg:px-8 pt-5">
          <Link
            href={backHref}
            className="inline-flex items-center gap-1 text-sm text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden />
            {(backLabel ?? { de: "Zurück", en: "Back" })[L]}
          </Link>
        </div>
      )}

      {children(L)}

      <footer className="border-t border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] mt-16">
        <div className="max-w-5xl mx-auto px-4 lg:px-8 py-6 text-xs text-[var(--mp-fg-muted)] flex flex-col sm:flex-row gap-4 sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Image src="/brand/logomark.svg" width={20} height={20} alt="" aria-hidden />
            <span>MedPrüf · [name] · Wien, Österreich</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/impressum" className="hover:text-[var(--mp-fg)]">
              Impressum
            </Link>
            <Link href="/privacy" className="hover:text-[var(--mp-fg)]">
              {L === "de" ? "Datenschutz" : "Privacy"}
            </Link>
            <Link href="/terms" className="hover:text-[var(--mp-fg)]">
              {L === "de" ? "AGB" : "Terms"}
            </Link>
            <Link href="/faq" className="hover:text-[var(--mp-fg)]">
              FAQ
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
