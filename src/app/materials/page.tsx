"use client";

/**
 * Materials / Materialien — MPDS v3 "Clinical Nocturne" resource library.
 *
 * Reimplementation 2026-06-26 (build loop): rebuilt the PRESENTATION to the
 * approved `reviews/reimplementation-2026-06-26/design/09-settings-materials.html`
 * mockup (right frame) + SPECS §11. The data layer is unchanged.
 *
 * WHAT THIS SURFACE IS (locked by A.0(c), reviews/uiux-overhaul-2026-06-25/
 * A0-austrian-resources.md): a curated library of LINKS to legitimately-free
 * Austrian/German-relevant resources, plus MedPrüf's OWN guides. It NEVER
 * rehosts third-party / competitor / copyrighted content.
 *
 *   - The mockup's "Leitlinien & Downloads" cards (SIP Fragenkatalog,
 *     Rezeptierkunde PDF) are illustrative chrome, NOT literal content: those
 *     are imported third-party source PDFs (community Anki deck / KoalaMed /
 *     Rezeptierkunde) we hold no redistribution rights to. Per the A0 locked
 *     decision + the task's "NO rehosted third-party content" rule, we do NOT
 *     ship download cards for them. We keep the mockup's VISUAL grammar (hero
 *     gradient + sectioned shelf + doc/org/link icon tints + the
 *     download-vs-external affordance) and populate it with the A0-correct
 *     content instead.
 *   - Shelf 1 "Hier starten / Start here" = MedPrüf's OWN guides (A0 §3,
 *     Guide 1-5). They are not authored yet ([name] writes v1), so they show an
 *     honest "Bald verfügbar / Coming soon" state — never faked as available
 *     (same honesty discipline as /pricing's "Demnächst" tiers). No dead link.
 *   - Shelves 2-4 = the curated external links from the data layer, grouped by
 *     category exactly as A0 §4 prescribes (Official & registration /
 *     Clinical guidelines / Reference & language). Each external link opens in
 *     a new tab with an external-link affordance; Route A/B + Freemium are
 *     visible badges (A0 surface rules), so the SoT's route-conflation risk
 *     cannot resurface in the UI and freemium is never hidden.
 *
 * Data CONTRACT preserved (no new network calls, no DB, no API):
 *   - `AUSTRIAN_RESOURCES` from `@/lib/austrian-resources` is the single source
 *     of truth for the link set (12 verified rows, 3 categories). Dead links
 *     are fixed THERE, never hardcoded here. Exam dates stay code-owned
 *     (`exam-dates.ts`) — this surface never states a date.
 *   - `getStoredSession()` hydrates user id + name so the Sidebar user card
 *     stays populated (the Sidebar fetches its own gamification from userId).
 *   - Theme + language are client/localStorage via the shared toggles.
 *
 * Brand preserved: Inter + Plus Jakarta Sans, oxford/viridian, the one
 * sanctioned hero gradient, the spark stays OFF this surface (no
 * progress/active/live here) — SPECS §11 + the spark-discipline note.
 *
 * Scope: ONLY this file. Strings inlined (de/en) per the build-loop convention
 * so a parallel sibling-surface fleet can't merge-conflict on shared i18n.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  Landmark,
  GraduationCap,
  Stethoscope,
  BookOpen,
  Compass,
  Map as MapIcon,
  ClipboardList,
  CalendarCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
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
  type ResourceRoute,
} from "@/lib/austrian-resources";

type Lang = "de" | "en";

/* ── MedPrüf's own guides (A0 §3) — not authored yet, shown honestly ──────
   Titles + one-liners are from the A0 deliverable. No URLs: each is "Bald
   verfügbar / Coming soon" until [name] ships v1. These are MedPrüf-authored
   (no rehosting), and stand apart from the curated external links below. */
interface OwnGuide {
  id: string;
  icon: LucideIcon;
  de: { title: string; sub: string };
  en: { title: string; sub: string };
}

const OWN_GUIDES: OwnGuide[] = [
  {
    id: "kenntnispruefung",
    icon: Compass,
    de: { title: "Die Kenntnisprüfung Wien, ehrlich erklärt", sub: "Route A · Ablauf, Anmeldung, Bestehen" },
    en: { title: "The Kenntnisprüfung Wien, honestly explained", sub: "Route A · format, registration, passing" },
  },
  {
    id: "nostrifizierung",
    icon: MapIcon,
    de: { title: "Nostrifizierung Schritt für Schritt", sub: "Route B · Stichprobentest, Ergänzungsprüfungen" },
    en: { title: "Nostrifizierung, step by step", sub: "Route B · Stichprobentest, supplementary exams" },
  },
  {
    id: "high-yield",
    icon: ClipboardList,
    de: { title: "Wo die Punkte liegen: der High-Yield-Plan", sub: "Welche Fächer am meisten zählen" },
    en: { title: "Where the points are: the high-yield map", sub: "Which subjects carry the most weight" },
  },
  {
    id: "exam-day",
    icon: CalendarCheck,
    de: { title: "Checkliste für den Prüfungstag", sub: "Unterlagen, Ablauf, ruhig bleiben" },
    en: { title: "Exam-day checklist", sub: "Documents, format, staying calm" },
  },
  {
    id: "how-to-use",
    icon: Sparkles,
    de: { title: "So bereitest du dich mit MedPrüf vor", sub: "Prüfung wählen, Lernplan, der Lern-Loop" },
    en: { title: "How to prepare with MedPrüf", sub: "Pick your exam, the plan, the study loop" },
  },
];

/* ── Section metadata for the three curated-link shelves (A0 §4 order) ───── */
const SECTIONS: {
  category: ResourceCategory;
  icon: LucideIcon;
  de: string;
  en: string;
}[] = [
  { category: "official",   icon: Landmark,    de: "Offiziell & Anmeldung",  en: "Official & Registration" },
  { category: "guidelines", icon: Stethoscope, de: "Klinische Leitlinien",   en: "Clinical Guidelines"     },
  { category: "reference",  icon: BookOpen,    de: "Nachschlagen & Sprache", en: "Reference & Language"    },
];

/* Per-category icon tint, mirroring the mockup's doc/org/link variants:
   official = org/viridian, guidelines = doc/brand-blue, reference = link/teal. */
function categoryTint(category: ResourceCategory): { wrap: string; fg: string } {
  if (category === "official")
    return { wrap: "bg-[var(--mp-tint-viridian)]", fg: "text-[var(--mp-viridian)]" };
  if (category === "guidelines")
    return { wrap: "bg-[var(--mp-tint-brand)]", fg: "text-[var(--mp-cta-blue)]" };
  return { wrap: "bg-[var(--mp-tint-teal)]", fg: "text-[var(--mp-accent-teal)]" };
}

function resourceIcon(resource: AustrianResource): LucideIcon {
  // MedUni / academy pages read as study institutions; chambers/portals as orgs.
  if (resource.category === "official") {
    if (/MedUni|Innsbruck|Graz|Wien|Akademie|Arztakademie/i.test(resource.title))
      return GraduationCap;
    return Landmark;
  }
  if (resource.category === "guidelines") return Stethoscope;
  return BookOpen;
}

function routeLabel(route: ResourceRoute, lang: Lang): string {
  if (route === "A") return "Route A: Kenntnisprüfung";
  if (route === "B")
    return lang === "de" ? "Route B: Nostrifizierung" : "Route B: Nostrification";
  return lang === "de" ? "Beide Wege" : "Both routes";
}

function routeBadgeClass(route: ResourceRoute): string {
  if (route === "A")
    return "bg-[var(--mp-tint-viridian)] text-[var(--mp-viridian)]";
  if (route === "B")
    return "bg-[var(--mp-tint-teal)] text-[var(--mp-accent-teal)]";
  return "bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)]";
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
      <main className="main-content safe-area-top safe-area-bottom flex flex-col min-h-screen bg-[var(--mp-bg)]">
        {/* ── Header: back · title · theme + language ──────────────────── */}
        <div className="flex items-center gap-3 px-4 lg:px-8 pt-4 pb-3 flex-shrink-0 border-b border-[var(--mp-border-soft)]">
          <Link
            href="/"
            aria-label={lang === "de" ? "Zurück" : "Back"}
            className="w-9 h-9 rounded-[10px] border border-[var(--mp-border-soft)] bg-[var(--mp-surface)] flex items-center justify-center text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] transition-colors flex-shrink-0"
          >
            <ArrowLeft className="w-[18px] h-[18px]" />
          </Link>
          <h1 className="flex-1 font-display text-base font-extrabold text-[var(--mp-fg)]">
            {lang === "de" ? "Materialien" : "Materials"}
          </h1>
          <div className="flex items-center gap-2 flex-shrink-0">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        <div className="flex-1 w-full px-4 lg:px-8 py-5">
          <div className="max-w-3xl mx-auto">
            {/* ── Hero (the one sanctioned gradient) ───────────────────── */}
            <div
              className="relative overflow-hidden rounded-[var(--mp-r-card)] p-5 mb-7"
              style={{
                background:
                  "linear-gradient(118deg, var(--mp-hero-from, var(--mp-fg)), var(--mp-hero-to, var(--mp-cta-blue)))",
                boxShadow: "var(--mp-shadow-hover)",
              }}
            >
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  background:
                    "radial-gradient(160px 160px at 88% 14%, var(--mp-hero-glow, var(--mp-spark-glow)), transparent 70%)",
                }}
                aria-hidden="true"
              />
              <h2 className="relative font-display text-lg font-extrabold text-white">
                {lang === "de" ? "Geprüfte Ressourcen" : "Verified resources"}
              </h2>
              <p className="relative mt-1.5 text-[13px] leading-relaxed text-white/80 max-w-xl">
                {lang === "de"
                  ? "Eigene MedPrüf-Leitfäden und geprüfte Links zu offiziellen österreichischen Quellen. Wir verlinken Originalquellen, wir hosten nichts nach."
                  : "MedPrüf's own guides and verified links to official Austrian sources. We link to the originals, we never rehost them."}
              </p>
            </div>

            {/* ── Shelf 1: MedPrüf's own guides (honest "coming soon") ──── */}
            <section className="mb-9">
              <h3 className="font-display text-[15px] font-bold text-[var(--mp-fg)] mb-1">
                {lang === "de" ? "Hier starten" : "Start here"}
              </h3>
              <p className="text-[12.5px] text-[var(--mp-fg-subtle)] mb-3.5">
                {lang === "de"
                  ? "Unsere eigenen Leitfäden für deinen Weg. Bald verfügbar."
                  : "Our own guides for your path. Coming soon."}
              </p>

              <div className="space-y-2.5">
                {OWN_GUIDES.map((guide) => {
                  const copy = lang === "de" ? guide.de : guide.en;
                  const Icon = guide.icon;
                  return (
                    <div
                      key={guide.id}
                      className="flex items-center gap-3.5 rounded-[var(--mp-r-card)] border border-[var(--mp-border-soft)] bg-[var(--mp-surface)] p-3.5 shadow-[var(--mp-shadow-card)] opacity-90"
                    >
                      <div className="w-11 h-11 rounded-[12px] flex items-center justify-center flex-shrink-0 bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)]">
                        <Icon className="w-[21px] h-[21px]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-bold text-[var(--mp-fg)] leading-snug">
                          {copy.title}
                        </div>
                        <div className="text-xs text-[var(--mp-fg-subtle)] mt-0.5 truncate">
                          {copy.sub}
                        </div>
                      </div>
                      <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-[0.04em] text-[var(--mp-fg-muted)] bg-[var(--mp-surface-sunken)] border border-[var(--mp-border-soft)] px-2.5 py-1 rounded-full whitespace-nowrap">
                        {lang === "de" ? "Bald" : "Soon"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* ── Shelves 2-4: curated external links by category ──────── */}
            {SECTIONS.map(({ category, de, en }) => {
              const items = AUSTRIAN_RESOURCES.filter(
                (r) => r.category === category,
              );
              if (items.length === 0) return null;
              const tint = categoryTint(category);

              return (
                <section key={category} className="mb-9">
                  <h3 className="font-display text-[15px] font-bold text-[var(--mp-fg)] mb-3.5">
                    {lang === "de" ? de : en}
                  </h3>

                  <div className="space-y-2.5">
                    {items.map((resource) => {
                      const Icon = resourceIcon(resource);
                      return (
                        <a
                          key={resource.id}
                          href={resource.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group flex items-start gap-3.5 rounded-[var(--mp-r-card)] border border-[var(--mp-border-soft)] bg-[var(--mp-surface)] p-3.5 shadow-[var(--mp-shadow-card)] transition-colors hover:border-[var(--mp-viridian)]/40 focus-visible:outline-none focus-visible:[box-shadow:var(--mp-focus-ring)]"
                        >
                          <div
                            className={`w-11 h-11 rounded-[12px] flex items-center justify-center flex-shrink-0 ${tint.wrap} ${tint.fg}`}
                          >
                            <Icon className="w-[21px] h-[21px]" />
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-bold text-[var(--mp-fg)] leading-snug">
                              {resource.title}
                            </div>
                            <p className="text-[12.5px] text-[var(--mp-fg-muted)] leading-relaxed mt-1">
                              {lang === "de"
                                ? resource.deOneLiner
                                : resource.enOneLiner}
                            </p>

                            {(resource.route || resource.freemium) && (
                              <div className="flex items-center gap-1.5 flex-wrap mt-2">
                                {resource.route && (
                                  <span
                                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${routeBadgeClass(resource.route)}`}
                                  >
                                    {routeLabel(resource.route, lang)}
                                  </span>
                                )}
                                {resource.freemium && (
                                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap bg-[var(--mp-warning-bg)] text-[var(--mp-status-warning)]">
                                    {lang === "de"
                                      ? "Teils kostenlos"
                                      : "Freemium"}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>

                          {/* External-link affordance (opens in a new tab) */}
                          <span
                            className="w-9 h-9 rounded-[10px] border border-[var(--mp-border-soft)] flex items-center justify-center text-[var(--mp-fg-subtle)] flex-shrink-0 transition-colors group-hover:text-[var(--mp-viridian)] group-hover:border-[var(--mp-viridian)]/40"
                            aria-hidden="true"
                          >
                            <ExternalLink className="w-4 h-4" />
                          </span>
                        </a>
                      );
                    })}
                  </div>
                </section>
              );
            })}

            {/* Honest footer — links open externally, nothing is rehosted. */}
            <p className="text-xs text-[var(--mp-fg-subtle)] text-center pb-6">
              {lang === "de"
                ? "Alle Links öffnen die Originalseiten in einem neuen Tab."
                : "All links open the original pages in a new tab."}
            </p>
          </div>
        </div>
      </main>
    </AppLayout>
  );
}
