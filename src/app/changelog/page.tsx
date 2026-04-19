"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getLang, setLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import { CHANGELOG, type ChangelogEntry, type ChangelogTag } from "@/lib/changelog";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
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
    color: "text-[var(--mp-status-warning)]",
    bg: "bg-[var(--mp-status-warning)]/10",
  },
  admin: {
    icon: Wrench,
    label: { de: "Admin", en: "Admin" },
    color: "text-[var(--mp-fg-subtle)]",
    bg: "bg-[var(--mp-fg-subtle)]/10",
  },
};

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

  useEffect(() => {
    setLangState(getLang());
    const session = getStoredSession();
    if (session?.user) setUserId(session.user.id);
  }, []);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  // Filter out admin-only entries for user changelog
  const userEntries = CHANGELOG.filter((e) => e.tag !== "admin");

  // Group by date
  const grouped: Record<string, ChangelogEntry[]> = {};
  for (const entry of userEntries) {
    if (!grouped[entry.date]) grouped[entry.date] = [];
    grouped[entry.date].push(entry);
  }
  const dates = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  return (
    <div className="app-layout">
      <Sidebar lang={lang} userId={userId} />

      <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-surface-sunken)]">
        {/* Header */}
        <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between border-b border-[var(--mp-border)]">
          <Link href="/" className="flex items-center gap-1.5 text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-sm transition-colors">
            <ArrowLeft className="w-4 h-4" />
            {lang === "de" ? "Zurück" : "Back"}
          </Link>
          <h1 className="text-base font-bold text-[var(--mp-fg)] flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[var(--mp-viridian)]" />
            {lang === "de" ? "Neuigkeiten" : "What's New"}
          </h1>
          <div className="flex items-center gap-2">
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
                ? "Wir arbeiten ständig daran, MedPrüf zu verbessern. Hier sind alle Updates."
                : "We're constantly working to improve MedPrüf. Here are all the updates."}
            </p>
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
                          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${config.bg} ${config.color}`}>
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

          {/* Footer */}
          <div className="text-center mt-12 pt-8 border-t border-[var(--mp-border)]">
            <p className="text-xs text-[var(--mp-fg-subtle)]">
              {lang === "de"
                ? "Hast du einen Vorschlag? Melde ihn direkt in einer Frage."
                : "Have a suggestion? Report it directly on a question."}
            </p>
          </div>
        </div>
      </main>

      <BottomNav lang={lang} userId={userId} />
    </div>
  );
}
