"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import { getPublicChangelogEntries, type ChangelogEntry, type ChangelogTag } from "@/lib/changelog";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import { AppLayout } from "@/components/ui";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import { ArrowLeft, Sparkles, Wrench, Bug, Calendar } from "lucide-react";

type Lang = "de" | "en";

const TAG_CONFIG: Record<ChangelogTag, { icon: typeof Sparkles; label: { de: string; en: string }; color: string; bg: string }> = {
  feature: {
    icon: Sparkles,
    label: { de: "Neu", en: "New" },
    color: "text-[var(--mp-viridian)]",
    bg: "bg-[var(--mp-viridian)]/10",
  },
  improvement: {
    icon: Wrench,
    label: { de: "Verbessert", en: "Improved" },
    color: "text-[var(--mp-cta-blue)]",
    bg: "bg-[var(--mp-cta-blue)]/10",
  },
  fix: {
    icon: Bug,
    label: { de: "Behoben", en: "Fixed" },
    color: "text-[var(--mp-fg-muted)]",
    bg: "bg-[var(--mp-fg-subtle)]/10",
  },
  admin: {
    icon: Wrench,
    label: { de: "Admin", en: "Admin" },
    color: "text-[var(--mp-fg-subtle)]",
    bg: "bg-[var(--mp-fg-subtle)]/10",
  },
};

const PAGE_SIZE = 10;
const PAGE_COPY = {
  de: {
    notice: "Einträge beschreiben den Stand zum jeweiligen Datum und können überholt sein. Aktuelle Bedingungen stehen unter Preise und in den AGB.",
    more: (n: number) => `Ältere anzeigen (${n} weitere)`,
    suggest: "Haben Sie einen Vorschlag? Melden Sie ihn direkt an einer Frage.",
  },
  en: {
    notice: "Entries describe what applied on their date and may have been superseded. Current terms are on Pricing and in the Terms.",
    more: (n: number) => `Show older (${n} more)`,
    suggest: "Have a suggestion? Report it directly on a question.",
  },
} as const;

function formatDate(iso: string, lang: Lang): string {
  const d = new Date(iso);
  return d.toLocaleDateString(lang === "de" ? "de-AT" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export default function ChangelogPage() {
  const [lang, setLangState] = useState<Lang>("de");
  const [userId, setUserId] = useState<string>("");
  const [visible, setVisible] = useState(PAGE_SIZE);

  useEffect(() => {
    setLangState(getLang());
    const session = getStoredSession();
    if (session?.user) setUserId(session.user.id);
  }, []);

  const switchLang = (l: Lang) => {
    setLangState(l);
  };

  // Keep admin-only operational changes out of the customer-facing history.
  // Only the latest entries render; older ones load on tap (UX-PUB-36).
  const allEntries = getPublicChangelogEntries();
  const userEntries = allEntries.slice(0, visible);

  // Group by date
  const grouped: Record<string, ChangelogEntry[]> = {};
  for (const entry of userEntries) {
    if (!grouped[entry.date]) grouped[entry.date] = [];
    grouped[entry.date].push(entry);
  }
  const dates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  return (
    <AppLayout
      mode={userId ? "standard" : "public"}
      sidebar={<Sidebar lang={lang} userId={userId} />}
      bottomNav={<BottomNav lang={lang} userId={userId} />}
    >
      <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-surface-sunken)]">
        {/* Header */}
        <div className="px-4 lg:px-8 pt-4 pb-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-[var(--mp-border)]">
          <Link href={userId ? "/" : "/landing"} className="flex items-center gap-1.5 min-h-11 text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-sm transition-colors">
            <ArrowLeft className="w-4 h-4" />
            {lang === "de" ? "Zurück" : "Back"}
          </Link>
          <h1 className="ml-auto text-base font-bold text-[var(--mp-fg)] flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[var(--mp-viridian)]" />
            {lang === "de" ? "Neuigkeiten" : "What's New"}
          </h1>
          {/* a-header-375: the two auto margins place the title exactly as justify-between does on one line; when the row does not fit, the controls wrap to a second row, right-aligned. */}
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        {/* Content */}
        <div className="max-w-3xl mx-auto px-4 lg:px-8 py-6">
          {/* Hero */}
          <div className="text-center mb-8">
            <h2 className="text-2xl md:text-3xl font-black text-[var(--mp-fg)] font-display mb-2">
              {lang === "de" ? "Was ist neu in MedPrüf?" : "What's new in MedPrüf?"}
            </h2>
<p className="text-sm text-[var(--mp-fg-subtle)]">
                {lang === "de"
                  ? "Ein datiertes Änderungsarchiv der für Lernende sichtbaren Änderungen."
                  : "A dated archive of changes learners can see."}
              </p>
              <Link href="/pricing" className="inline-flex mt-3 text-sm text-[var(--mp-viridian)] hover:underline">
                {lang === "de" ? "Aktuelle Preise ansehen" : "See current pricing"}
              </Link>
              <p className="text-xs text-[var(--mp-fg-subtle)] mt-3 max-w-xl mx-auto leading-relaxed">{PAGE_COPY[lang].notice}</p>
          </div>

          {/* Timeline */}
          <div className="space-y-8">
            {dates.map((date) => (
              <section key={date}>
                {/* Date header */}
                <div className="flex items-center gap-2 mb-3 sticky top-0 bg-[var(--mp-surface-sunken)] py-2 z-10">
                  <Calendar className="w-4 h-4 text-[var(--mp-fg-subtle)]" />
                  <h3 className="text-sm font-semibold text-[var(--mp-fg-muted)]">
                    {formatDate(date, lang)}
                  </h3>
                </div>

                {/* Entries */}
                <div className="space-y-2.5 pl-6 border-l-2 border-[var(--mp-border)]">
                  {grouped[date].map((entry, i) => {
                    const config = TAG_CONFIG[entry.tag];
                    const Icon = config.icon;
                    return (
                      <div key={`${date}-${i}`} className="card rounded-xl p-4 relative -ml-6 pl-10">
                        {/* Timeline dot */}
                        <div className={`absolute left-3 top-5 w-3 h-3 rounded-full ${config.bg} border-2 border-white flex-shrink-0`}>
                          <div className={`w-full h-full rounded-full ${config.color.replace('text', 'bg')}`} />
                        </div>

                        <div className="flex items-start gap-2 mb-1.5">
                          <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${config.bg} ${config.color}`}>
                            <Icon className="w-3 h-3" />
                            {config.label[lang]}
                          </span>
                        </div>
                        <h4 className="text-sm font-semibold text-[var(--mp-fg)] mb-1">
                          {entry.title[lang]}
                        </h4>
                        <p className="text-xs text-[var(--mp-fg-muted)] leading-relaxed">
                          {entry.description[lang]}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          {allEntries.length > visible && (
            <div className="text-center mt-8">
              <button type="button" onClick={() => setVisible((v) => v + PAGE_SIZE * 2)} className="mp-btn mp-btn--secondary min-h-11">
                {PAGE_COPY[lang].more(allEntries.length - visible)}
              </button>
            </div>
          )}

          {/* Footer */}
          <div className="text-center mt-12 pt-8 border-t border-[var(--mp-border)]">
            <p className="text-xs text-[var(--mp-fg-subtle)]">{PAGE_COPY[lang].suggest}</p>
          </div>
        </div>
      </main>
    </AppLayout>
  );
}
