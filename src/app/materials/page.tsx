"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { getLang, setLang } from "@/lib/i18n";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import { AppLayout } from "@/components/ui";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import { getStoredSession } from "@/lib/auth";
import {
  AUSTRIAN_RESOURCES,
  type AustrianResource,
  type ResourceCategory,
} from "@/lib/austrian-resources";

type Lang = "de" | "en";

const SECTIONS: { category: ResourceCategory; de: string; en: string }[] = [
  { category: "official",    de: "Offiziell & Anmeldung",  en: "Official & Registration" },
  { category: "guidelines",  de: "Klinische Leitlinien",   en: "Clinical Guidelines"     },
  { category: "reference",   de: "Nachschlagen & Sprache", en: "Reference & Language"    },
];

function routeLabel(route: AustrianResource["route"], lang: Lang): string {
  if (route === "A")    return "Route A: Kenntnisprüfung";
  if (route === "B")    return lang === "de" ? "Route B: Nostrifizierung" : "Route B: Nostrification";
  return lang === "de" ? "Beide Wege" : "Both Routes";
}

function routeBadgeClass(route: AustrianResource["route"]): string {
  if (route === "A")   return "bg-[var(--mp-viridian)]/15 text-[var(--mp-viridian)]";
  if (route === "B")   return "bg-[var(--mp-accent-teal)]/12 text-[var(--mp-accent-teal)]";
  return "bg-[var(--mp-fg-muted)]/10 text-[var(--mp-fg-muted)]";
}

export default function MaterialsPage() {
  const [lang, setLangState] = useState<Lang>("de");
  const [userId, setUserId] = useState("");
  const [userName, setUserName] = useState("");

  useEffect(() => {
    setLangState(getLang());
    const session = getStoredSession();
    if (session) {
      setUserId(session.user.id);
      setUserName(session.user.first_name);
    }
  }, []);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  return (
    <AppLayout
      sidebar={<Sidebar lang={lang} userId={userId} userName={userName} />}
      bottomNav={<BottomNav lang={lang} userId={userId} />}
    >
      <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-surface-sunken)]">
        {/* Page header */}
        <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between border-b border-[var(--mp-border)]">
          <Link
            href="/"
            className="text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-sm transition-colors"
          >
            ← {lang === "de" ? "Zurück" : "Back"}
          </Link>
          <h1 className="text-base font-bold text-[var(--mp-fg)]">
            {lang === "de" ? "Ressourcen" : "Resources"}
          </h1>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        <div className="px-4 lg:px-8 py-4 max-w-2xl mx-auto">
          {/* Hero */}
          <div className="card rounded-2xl p-5 mb-6">
            <div className="flex items-center gap-4">
              <div className="text-4xl">🇦🇹</div>
              <div>
                <h2 className="text-base font-semibold text-[var(--mp-fg)] mb-1">
                  {lang === "de" ? "Österreichische Ressourcen" : "Austrian Resources"}
                </h2>
                <p className="text-sm text-[var(--mp-fg-subtle)]">
                  {lang === "de"
                    ? "Geprüfte Links zu offiziellen Quellen, Leitlinien und Referenzwerken."
                    : "Verified links to official sources, guidelines, and reference tools."}
                </p>
              </div>
            </div>
          </div>

          {/* Three library sections */}
          {SECTIONS.map(({ category, de, en }) => {
            const items = AUSTRIAN_RESOURCES.filter((r) => r.category === category);
            return (
              <section key={category} className="mb-8">
                <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--mp-fg-muted)] mb-3 px-1">
                  {lang === "de" ? de : en}
                </h2>

                <div className="space-y-3 stagger">
                  {items.map((resource) => (
                    <a
                      key={resource.id}
                      href={resource.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="card-interactive rounded-2xl p-4 flex flex-col gap-2 border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] hover:border-[var(--mp-viridian)]/40 transition-colors"
                    >
                      {/* Title row + badges */}
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-sm font-semibold text-[var(--mp-fg)] leading-snug flex-1">
                          {resource.title}
                        </p>
                        <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                          {resource.route && (
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded font-medium whitespace-nowrap ${routeBadgeClass(resource.route)}`}
                            >
                              {routeLabel(resource.route, lang)}
                            </span>
                          )}
                          {resource.freemium && (
                            <span className="text-[10px] px-2 py-0.5 rounded font-medium whitespace-nowrap bg-[var(--mp-status-warning)]/15 text-[var(--mp-status-warning)]">
                              Freemium
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Description */}
                      <p className="text-sm text-[var(--mp-fg-muted)] leading-relaxed">
                        {lang === "de" ? resource.deOneLiner : resource.enOneLiner}
                      </p>

                      {/* External link affordance */}
                      <span className="inline-flex items-center gap-1 text-xs text-[var(--mp-viridian)] mt-0.5">
                        <ExternalLink className="w-3.5 h-3.5" />
                        {lang === "de" ? "Öffnen" : "Open"}
                      </span>
                    </a>
                  ))}
                </div>
              </section>
            );
          })}

          {/* Understated note — no vaporware placeholders */}
          <p className="text-xs text-[var(--mp-fg-subtle)] text-center pb-6">
            {lang === "de"
              ? "Eigene MedPrüf-Guides folgen."
              : "MedPrüf's own guides are on the way."}
          </p>
        </div>
      </main>
    </AppLayout>
  );
}
