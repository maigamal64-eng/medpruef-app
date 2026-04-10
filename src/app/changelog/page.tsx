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
    color: "text-[#007B5F]",
    bg: "bg-[#007B5F]/10",
  },
  improvement: {
    icon: Wrench,
    label: { de: "Verbessert", en: "Improved" },
    color: "text-[#003A8C]",
    bg: "bg-[#003A8C]/10",
  },
  fix: {
    icon: Bug,
    label: { de: "Behoben", en: "Fixed" },
    color: "text-[#F4A261]",
    bg: "bg-[#F4A261]/10",
  },
  admin: {
    icon: Wrench,
    label: { de: "Admin", en: "Admin" },
    color: "text-[#A0AEC0]",
    bg: "bg-[#A0AEC0]/10",
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

      <main className="main-content safe-area-top safe-area-bottom bg-[#F7F9FC]">
        {/* Header */}
        <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between border-b border-[#E4E9F0]">
          <Link href="/" className="flex items-center gap-1.5 text-[#A0AEC0] hover:text-[#1A2B3C] text-sm transition-colors">
            <ArrowLeft className="w-4 h-4" />
            {lang === "de" ? "Zurück" : "Back"}
          </Link>
          <h1 className="text-base font-bold text-[#1A2B3C] flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#007B5F]" />
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
            <h2 className="text-2xl md:text-3xl font-black text-[#1A2B3C] font-display mb-2">
              {lang === "de" ? "Was ist neu in MedPrüf?" : "What's new in MedPrüf?"}
            </h2>
            <p className="text-sm text-[#A0AEC0]">
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
                <div className="flex items-center gap-2 mb-3 sticky top-0 bg-[#F7F9FC] py-2 z-10">
                  <Calendar className="w-4 h-4 text-[#A0AEC0]" />
                  <h3 className="text-sm font-semibold text-[#4A5568]">
                    {formatDate(date, lang)}
                  </h3>
                </div>

                {/* Entries */}
                <div className="space-y-2.5 pl-6 border-l-2 border-[#E4E9F0]">
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
                        <h4 className="text-sm font-semibold text-[#1A2B3C] mb-1">
                          {entry.title[lang]}
                        </h4>
                        <p className="text-xs text-[#4A5568] leading-relaxed">
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
          <div className="text-center mt-12 pt-8 border-t border-[#E4E9F0]">
            <p className="text-xs text-[#A0AEC0]">
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
