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
 *   - a26 (UX-PUB-35, G27): official links come first, followed by the
 *     official documents (projected server-side from the sourced exam-format
 *     record with their check dates) and MedPrüf's live guidance pages. The
 *     former "Bald" guide cards are gone; the one unwritten guide is a muted
 *     "In Arbeit" line.
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
  type LucideIcon,
} from "lucide-react";
import { getLang } from "@/lib/i18n";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import { AppLayout } from "@/components/ui";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import { getStoredSession } from "@/lib/auth";
import { guidanceLink, withLang, type PublicLink } from "@/lib/guidance/public-links";
import {
  AUSTRIAN_RESOURCES,
  type AustrianResource,
  type ResourceCategory,
  type ResourceRoute,
} from "@/lib/austrian-resources";

type Lang = "de" | "en";

export interface OfficialDoc { id: string; url: string; label: string; verifiedOn: string }

/* ── MedPrüf's own guides (UX-PUB-35): only pages that exist today ────────
   Each links a live guidance page or blog guide; the unwritten app guide is
   one muted "In Arbeit" line, never a card. Labels come from the guidance
   registry where the page is registered. */
const GUIDE_PATHS = ["/wien-route", "/was-ist-was", "/pruefungskalender", "/exam-formats", "/exam-formats/pruefungsraum", "/wien-route/nach-dem-stichprobentest", "/graz-innsbruck", "/umfang"] as const;
const BLOG_GUIDE = { href: "/blog/kenntnispruefung-wien-vollstaendiges-handbuch", label: { de: "Handbuch SIP4a / SIP5a Wien (Blog)", en: "SIP4a / SIP5a Vienna handbook (blog)" } };

const PAGE_COPY = {
  de: {
    heroTitle: "Offizielle Quellen und Leitfäden",
    heroText: "Links zu den offiziellen österreichischen Seiten und Dokumenten sowie die Leitfäden von MedPrüf. Wir verlinken Originalquellen und hosten nichts nach.",
    docsTitle: "Offizielle Dokumente",
    docsText: "Die Seiten und PDFs, auf denen Termine, Fristen und Regeln stehen. Prüfen Sie immer die aktuelle Fassung.",
    checked: "Zuletzt geprüft am",
    guidesTitle: "Leitfäden von MedPrüf",
    guidesText: "Jede Seite nennt Quelle und Prüfdatum ihrer Angaben.",
    pending: "In Arbeit: eine Anleitung, wie Sie mit MedPrüf lernen.",
    footer: "Externe Links öffnen die Originalseiten in einem neuen Tab.",
  },
  en: {
    heroTitle: "Official sources and guides",
    heroText: "Links to the official Austrian pages and documents, plus MedPrüf's own guides. We link to the originals and never rehost them.",
    docsTitle: "Official documents",
    docsText: "The pages and PDFs that publish dates, deadlines and rules. Always check the current version.",
    checked: "Last checked on",
    guidesTitle: "MedPrüf guides",
    guidesText: "Every page names the source and check date of its facts.",
    pending: "In progress: a guide to studying with MedPrüf.",
    footer: "External links open the original pages in a new tab.",
  },
} as const;
const DATE_LOCALE: Record<Lang, string> = { de: "de-AT", en: "en-GB" };

/* ── Section metadata for the three curated-link shelves (A0 §4 order) ───── */
const SECTIONS: {
  category: ResourceCategory;
  icon: LucideIcon;
  de: string;
  en: string;
}[] = [
  { category: "official",   icon: Landmark,    de: "Offiziell und Anmeldung",  en: "Official and registration" },
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
  if (route === "A") return lang === "de" ? "ÖÄK-Informationen, Geltungsbereich prüfen" : "ÖÄK information, check applicability";
  if (route === "B")
    return lang === "de" ? "Universitäre Informationen" : "University information";
  return lang === "de" ? "Übergreifende Informationen" : "General information";
}

function routeBadgeClass(route: ResourceRoute): string {
  if (route === "A")
    return "bg-[var(--mp-tint-viridian)] text-[var(--mp-viridian)]";
  if (route === "B")
    return "bg-[var(--mp-tint-teal)] text-[var(--mp-accent-teal)]";
  return "bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)]";
}

export default function MaterialsClient({ officialDocs }: { officialDocs: OfficialDoc[] }) {
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
    setLangState(l);
  };

  return (
    <AppLayout
      mode={userId ? "standard" : "public"}
      sidebar={<Sidebar lang={lang} userId={userId} userName={userName} />}
      bottomNav={<BottomNav lang={lang} userId={userId} />}
    >
      <main className="main-content safe-area-top safe-area-bottom flex flex-col min-h-screen bg-[var(--mp-bg)]">
        {/* ── Header: back · title · theme + language ──────────────────── */}
        <div className="flex flex-wrap items-center gap-3 px-4 lg:px-8 pt-4 pb-3 flex-shrink-0 border-b border-[var(--mp-border-soft)]">
          <Link
            href={userId ? "/" : "/landing"}
            aria-label={lang === "de" ? "Zurück" : "Back"}
            className="w-9 h-9 rounded-[10px] border border-[var(--mp-border-soft)] bg-[var(--mp-surface)] flex items-center justify-center text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] transition-colors flex-shrink-0"
          >
            <ArrowLeft className="w-[18px] h-[18px]" />
          </Link>
          <h1 className="flex-1 font-display text-base font-extrabold text-[var(--mp-fg)]">
            {lang === "de" ? "Materialien" : "Materials"}
          </h1>
          {/* a-header-375: the title keeps its word width, so the controls wrap to a right-aligned second row instead of covering it. */}
          <div className="ml-auto flex items-center gap-2 min-w-0 max-w-full">
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
                {PAGE_COPY[lang].heroTitle}
              </h2>
              <p className="relative mt-1.5 text-[13px] leading-relaxed text-white/80 max-w-xl">
                {PAGE_COPY[lang].heroText}
              </p>
            </div>

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
                  {category === "official" && (
                    <>
                      <section aria-labelledby="official-docs" className="mt-9">
                        <h3 id="official-docs" className="font-display text-[15px] font-bold text-[var(--mp-fg)] mb-1">{PAGE_COPY[lang].docsTitle}</h3>
                        <p className="text-[13px] text-[var(--mp-fg-subtle)] mb-3.5">{PAGE_COPY[lang].docsText}</p>
                        <ul className="space-y-2">
                          {officialDocs.map((doc) => (
                            <li key={doc.id} className="rounded-[var(--mp-r-card)] border border-[var(--mp-border-soft)] bg-[var(--mp-surface)] p-3.5">
                              <a href={doc.url} target="_blank" rel="noopener noreferrer" className="block min-h-11 py-2 text-sm font-bold text-[var(--mp-fg)] underline underline-offset-4 [overflow-wrap:anywhere]">
                                {doc.label}
                                <ExternalLink className="ml-1 inline w-3.5 h-3.5 align-[-2px]" aria-hidden />
                              </a>
                              <p className="text-xs text-[var(--mp-fg-muted)]">{PAGE_COPY[lang].checked}{" "}<time dateTime={doc.verifiedOn}>{new Intl.DateTimeFormat(DATE_LOCALE[lang], { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${doc.verifiedOn}T12:00:00Z`))}</time></p>
                            </li>
                          ))}
                        </ul>
                      </section>
                      <section aria-labelledby="medpruef-guides" className="mt-9">
                        <h3 id="medpruef-guides" className="font-display text-[15px] font-bold text-[var(--mp-fg)] mb-1">{PAGE_COPY[lang].guidesTitle}</h3>
                        <p className="text-[13px] text-[var(--mp-fg-subtle)] mb-3.5">{PAGE_COPY[lang].guidesText}</p>
                        <ul className="grid gap-2 sm:grid-cols-2">
                          {[...GUIDE_PATHS.map(guidanceLink).filter((l): l is PublicLink => l !== null), BLOG_GUIDE].map((l) => (
                            <li key={l.href}>
                              <Link href={withLang(l.href, lang)} className="flex min-h-12 items-center rounded-[var(--mp-r-card)] border border-[var(--mp-border-soft)] bg-[var(--mp-surface)] px-3.5 py-2 text-sm font-semibold text-[var(--mp-fg)] hover:border-[var(--mp-viridian)]/40">
                                {l.label[lang]}
                              </Link>
                            </li>
                          ))}
                        </ul>
                        <p className="mt-3 text-[13px] text-[var(--mp-fg-subtle)]">{PAGE_COPY[lang].pending}</p>
                      </section>
                    </>
                  )}
                </section>
              );
            })}

            {/* Honest footer — links open externally, nothing is rehosted. */}
            <p className="text-xs text-[var(--mp-fg-subtle)] text-center pb-6">
              {PAGE_COPY[lang].footer}
            </p>
          </div>
        </div>
      </main>
    </AppLayout>
  );
}
