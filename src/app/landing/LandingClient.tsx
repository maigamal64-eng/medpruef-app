"use client";

import CodeEntry from "@/components/code-entry/CodeEntry";
import { billingAmount, billingSurfaceText } from "@/lib/billing-copy";
import { pricingV2Enabled, reverseTrialCopyEnabled } from "@/lib/pricing-v2/flag";
import { v2LandingPreview } from "@/lib/pricing-v2/landing-preview";
import type { V2Readiness } from "@/lib/pricing-v2/readiness";

import { CTA_SUBTITLE_SAMPLE, REVERSE_TRIAL_LANDING } from "./reverse-trial-copy";
import { COMPANY, FREE_TIER, TIERS } from "@/lib/content-truth";


import { useEffect, useMemo, useRef, useState } from "react";
import TrialRibbon from "@/components/TrialRibbon";
import Image from "next/image";
import Link from "next/link";
import { getLang, useLang, renderLang } from "@/lib/i18n";
import { getStoredExamSource, type ExamSourceId } from "@/lib/topics";
import UpcomingExams from "@/components/UpcomingExams";
import { LandingGuides } from "@/components/answer-pages/GuideLinks";
import PublicStudyLink, { useTrialAvailable } from "@/components/PublicStudyLink";
import FreeOfferDisclosure from "@/components/FreeOfferDisclosure";
import { buildAuthHref } from "@/lib/auth-entry";
import LanguagePicker from "@/components/LanguagePicker";

// Free-tier CTAs default to the user's stored exam preference. SSR returns
// kenntnispruefung (the safest default — biggest cohort) so the link resolves
// instantly; on hydration we re-read localStorage and adjust if different.
function freeQuizHref(exam: ExamSourceId | null): string {
  const e = exam ?? "kenntnispruefung";
  return buildAuthHref({ intent: "free", exam: e, next: `/quiz?examSource=${e}&practiceMode=unseen` });
}
function trialEntryHref(exam: ExamSourceId): string {
  return reverseTrialCopyEnabled() ? buildAuthHref({ exam, next: "/" }) : buildAuthHref({ intent: "trial", exam });
}
import {
  ArrowRight,
  Baby,
  CalendarDays,
  ListChecks,
  Smartphone,
  Timer,
  Brain,
  ChevronRight,
  Clock,
  Compass,
  Dna,
  Ear,
  Eye,
  Globe,
  HeartPulse,
  Languages,
  Menu,
  MessageCircle,
  Pill,
  Scissors,
  ShieldCheck,
  Sparkles,
  Layers,
  NotebookPen,
  Stethoscope,
  Target,
  Users,
  X,
  Zap,
  FlaskConical,
} from "lucide-react";
import { selftestHref } from "@/lib/public-selftest";
import { publicSelftestLinksEnabled } from "@/lib/public-selftest/flag";
import { selftestCopy } from "@/lib/public-selftest/copy";
import { claimsFor, claimText, claimTitle } from "@/lib/learning-claims";
import { orientationLinks, withLang } from "@/lib/guidance/public-links";

type Lang = "de" | "en";

/* ─────────────────────────────────────────────────────────────
   MedPrüf landing — "clinical exam-record" direction (2026-06-04
   brand sweep). The design language is a doctor's exam record: a
   mono lab-header voice, hairline rules, a provenance stamp, big
   tabular figures, precision cards with a registration-tick, and
   quiet reveal-on-scroll. All visual primitives live in the
   `.lp-*` layer in globals.css; this page consumes them inside a
   single `.lp-root` scope. The two-tone wordmark SVGs replace the
   old logomark + invert-filter pattern.

   Customer-facing claims describe curated practice content and clearly
   distinguish question banks from official exam formats.
   ───────────────────────────────────────────────────────────── */
const COPY = {
  nav: {
    features: { de: "Funktionen", en: "Features" },
    how: { de: "So funktioniert's", en: "How it works" },
    dates: { de: "Termine", en: "Dates" },
    pricing: { de: "Preise", en: "Pricing" },
    login: { de: "Anmelden", en: "Sign in" },
  },
  hero: {
    // Existing bank labels, without assigning them to recognition routes.
    eyebrow: {
      de: "Österreich · SIP4a / SIP5a Wien · Stichprobentest · Rezeptierkunde",
      en: "Austria · SIP4a / SIP5a Vienna · Stichprobentest · Rezeptierkunde",
    },
    stamp: {
      de: "Kuratierte Übungsfragen für Österreichs Prüfungen",
      en: "Curated practice questions for Austrian exams",
    },
    // Headline re-directed to [name]'s (WO! Studio) signature beat (2026-07-01):
    // "you were never unqualified, only unproven", in Sie since the a21 register
    // pass (pick-copy-register B). title_mid is the italic teal accent.
    // title_line2 leads with the free sample (pick-ux-pub-14 A); the Cohort
    // is no longer featured in the hero (pick-offer-order A).
    title_pre: { de: "Sie waren nie unqualifiziert.", en: "You were never unqualified." },
    title_mid: { de: "Nur ungeprüft.", en: "Only unproven." },
    title_line2: {
      de: `Starten Sie mit der kostenlosen Probe: ${FREE_TIER.questions_per_exam_type} Fragen pro Fragenbank, ohne Karte. Tarife und Bedingungen finden Sie bei den Preisen.`,
      en: `Start with the free sample: ${FREE_TIER.questions_per_exam_type} questions per question bank, no card. Plans and conditions are on the pricing page.`,
    },
    // Advertised entry repositioned 2026-06-24 ([name]'s call, decisions.json
    // medpruef-landing-entry-price-19eur-2026-06-24): the advertised entry is
    // now the 19 €/month single-month tier (first_month_19), un-hidden on
    // /pricing in the same pass. All three live prices: 19/1mo, 49/3mo,
    // 129/6mo Cohort (updated 2026-06-25, decisions.json Wave-0 price lock).
    // The lead-with price below and the tertiary CTA both quote 19 €/month.
    // SoT §2 + §9.
    subtitle: {
      de: billingSurfaceText("surface_0", "de"),
      en: billingSurfaceText("surface_1", "en"),
    },
    cta_primary: { de: "Kostenlose Probe starten", en: "Start the free sample" },
    cta_primary_sub: {
      de: "150 Fragen je Prüfung · keine Karte",
      en: "150 questions per exam · no card",
    },
    cta_tertiary: {
      de: billingSurfaceText("surface_2", "de"),
      en: billingSurfaceText("surface_3", "en"),
    },
    cta_tertiary_sub: {
      de: billingSurfaceText("surface_4", "de"),
      en: billingSurfaceText("surface_5", "en"),
    },
    cta_note: {
      de: "Lernmaterial, keine Originalfragen der Prüfung.",
      en: "Study material, not original exam questions.",
    },
    // Orientation entry for the confused lead (the Instagram DM who does
    // not yet know which recognition route is theirs). Routes to the
    // public /find-your-path flow. No em dashes.
    find_path_label: {
      de: "Nicht sicher, wo Sie anfangen sollen?",
      en: "Not sure where to start?",
    },
    find_path_cta: {
      de: "Ihren Weg finden",
      en: "Find your path",
    },
    // Free-first hero ([name] 2026-10-11, UX-PUB-14 option A): the no-card
    // sample leads; the card trial follows at lower weight with its terms.
    // Glossary (UX-ACC-26): button "Pro 7 Tage testen", noun "Pro-Test".
    cta_trial_second: { de: "Pro 7 Tage testen", en: "Try Pro for 7 days" },
    cta_trial_terms: {
      de: `Karte nötig, heute ${billingAmount(0, "de")}. Danach ${billingAmount(TIERS.first_month_19.price_cents, "de")} pro Monat automatisch, außer Sie kündigen vor der ersten Abbuchung bei Whop.`,
      en: `Card required, ${billingAmount(0, "en")} today. Then ${billingAmount(TIERS.first_month_19.price_cents, "en")} per month automatically unless you cancel at Whop before the first charge.`,
    },
    explain_label: { de: "Erklärung in Ihrer Sprache", en: "Explanation in your language" },
  },
  stats: [
    {
      // Use a durable rounded public count to avoid stale snapshots.
      value: "10.000+",
      value_en: "10,000+",
      label: { de: "Fragen", en: "Questions" },
      sub: { de: "alle aktiv", en: "all active" },
    },
    {
      value: "3",
      value_en: "3",
      label: { de: "Prüfungen", en: "Exam types" },
      sub: { de: "Wien · Innsbruck · Pharma", en: "Vienna · Innsbruck · Pharma" },
    },
    {
      value: "7",
      value_en: "7",
      label: { de: "Sprachen", en: "Languages" },
      sub: { de: "in Erklärungen", en: "in explanations" },
    },
    {
      // Rows with two or more correct options (2,261 on 2026-10-11, CNT-24); a durable floor, never a snapshot.
      value: "2.000+",
      value_en: "2,000+",
      label: { de: "Mehrfachantworten", en: "Multi-correct" },
      sub: { de: "streng bewertet", en: "strictly graded" },
    },
  ],
  how: {
    index: "02 / 04",
    eyebrow: { de: "So funktioniert's", en: "How it works" },
    title: { de: "In drei Schritten zur Prüfungsreife", en: "Exam-ready in three steps" },
    steps: [
      {
        n: "01",
        title: { de: "Prüfung wählen", en: "Choose your exam" },
        body: {
          de: "Wählen Sie SIP4a / SIP5a Wien, Stichprobentest (Innsbruck) oder Pharmakologie / Rezeptierkunde und üben Sie nach den Fachgebieten der jeweiligen Fragenbank.",
          en: "Choose SIP4a / SIP5a Vienna, Stichprobentest (Innsbruck) or Pharmacology / Rezeptierkunde and practise by the topics in that question bank.",
        },
      },
      {
        n: "02",
        title: { de: "Täglich üben", en: "Practice daily" },
        body: {
          de: "20 bis 50 Fragen pro Tag mit Spaced Repetition. Der Lernplan passt sich Ihrem Prüfungsdatum an.",
          en: "20 to 50 questions per day with spaced repetition. The study plan adapts to your exam date.",
        },
      },
      {
        n: "03",
        title: { de: "Simulieren", en: "Simulate" },
        body: {
          de: "MCQ-Übung mit Timer, Themen-Navigator und Bewertung am Ende. Nur vollständig richtige Antworten erhalten einen Punkt, sonst null. Offizielle Formate und Bewertung werden nicht vollständig nachgebildet.",
          en: "Timed MCQ practice with a topic navigator and grading at the end. Fully correct answers earn one point, otherwise zero. Official formats and scoring are not reproduced in full.",
        },
      },
    ],
  },
  features: {
    index: "03 / 04",
    eyebrow: { de: "Was MedPrüf anders macht", en: "What makes MedPrüf different" },
    title: {
      de: "Nicht noch eine Karteikarten-App.",
      en: "Not another flashcard app.",
    },
    subtitle: {
      de: "Angeführt von Flash-Notes und Ihrer persönlichen Library.",
      en: "Led by flash-notes and your personal Library.",
    },
    // Each card renders from the claims register (LX-30, learning-claims.copy.json).
    items: ([
      [NotebookPen, "landing.flash-notes"],
      [Layers, "landing.library"],
      [Brain, "landing.ai-explanations"],
      [Globe, "landing.languages"],
      [HeartPulse, "landing.spaced-repetition"],
      [Clock, "landing.exam-simulation"],
      [Target, "landing.study-plan"],
      [Sparkles, "landing.report-fix"],
    ] as const).map(([icon, id]) => {
      const claim = claimsFor("landing.features").find((c) => c.id === id)!;
      return { icon, tag: claim.tag ?? "", title: claimTitle(id), body: claimText(id) };
    }),
  },
  subjects: {
    eyebrow: { de: "Fachgebiete", en: "Specialties" },
    title: {
      de: "Klinisches Wissen in drei Fragenbanken üben.",
      en: "Practise clinical knowledge across three question banks.",
    },
    subtitle: {
      de: "Die Fragenbanken enthalten kuratierte Übungen aus unterschiedlichen Quellen, keine Sammlung offizieller oder geleakter Prüfungsfragen. Die Wiener Bank enthält SIP4a/SIP5a-basierte MCQ-Übungen. Diese universitären Quellen sind von der postgradualen ÖÄK-Arztprüfung Allgemeinmedizin zu unterscheiden.",
      en: "The banks contain curated exercises from different sources, not a collection of official or leaked exam questions. The Vienna bank contains SIP4a/SIP5a-based MCQ exercises. These university sources are distinct from the postgraduate ÖÄK general medicine exam.",
    },
    items: [
      { icon: HeartPulse, name: { de: "Innere Medizin", en: "Internal Medicine" } },
      { icon: Scissors, name: { de: "Chirurgie", en: "Surgery" } },
      { icon: Brain, name: { de: "Neurologie", en: "Neurology" } },
      { icon: MessageCircle, name: { de: "Psychiatrie", en: "Psychiatry" } },
      { icon: Eye, name: { de: "Augenheilkunde", en: "Ophthalmology" } },
      { icon: Ear, name: { de: "HNO", en: "ENT" } },
      { icon: Baby, name: { de: "Pädiatrie", en: "Pediatrics" } },
      { icon: Users, name: { de: "Gynäkologie", en: "Gynecology" } },
      { icon: Zap, name: { de: "Notfallmedizin", en: "Emergency" } },
      { icon: Dna, name: { de: "Dermatologie", en: "Dermatology" } },
      { icon: Pill, name: { de: "Pharmakologie", en: "Pharmacology" } },
      { icon: Stethoscope, name: { de: "Kinder- und Jugendpsychiatrie", en: "Child and adolescent psychiatry" } },
    ],
  },
  pricing: {
    index: "01 / 04",
    eyebrow: { de: "Preise", en: "Pricing" },
    title: {
      de: "Kostenlos starten. Pro freischalten, wenn Sie bereit sind.",
      en: "Start free. Unlock Pro when you are ready.",
    },
    subtitle: {
      de: "Jeder bezahlte Tarif enthält alle drei Prüfungstypen. Pass-Until-You-Pass-Garantie auf der Prüfungs-Kohorte.",
      en: "Every paid tier unlocks all three exam types. Pass-Until-You-Pass guarantee on the Exam Cohort.",
    },
    tiers: [
      {
        name: { de: "Kostenlos", en: "Free" },
        price: billingSurfaceText("surface_8", "de"),
        period: { de: "dauerhaft", en: "forever" },
        pitch: {
          de: "150 Fragen × 3 Prüfungstypen · keine Karte",
          en: "150 questions × 3 exam types · no card",
        },
        status: "live",
        cta: { de: "Kostenlos starten", en: "Start free" },
        href: "/quiz?exam=pharma&free=1",
        featured: false,
        useFreeHref: true,
      },
      {
        name: { de: "Pro-Test", en: "Pro trial" },
        price: billingSurfaceText("surface_10", "de"),
        period: { de: "heute", en: "today" },
        pitch: {
          de: billingSurfaceText("surface_11", "de"),
          en: billingSurfaceText("surface_12", "en"),
        },
        status: "live",
        cta: { de: "Pro 7 Tage testen", en: "Try Pro for 7 days" },
        href: buildAuthHref({ intent: "trial", next: "/pricing#pro-test" }),
        featured: false,
        useFreeHref: false,
      },
      {
        // Empfohlen moves to the 3-month plan ([name] 2026-10-11).
        name: { de: "3 Monate", en: "3 months" },
        price: billingAmount(TIERS.first_3mo_27.price_cents, "de"),
        period: { de: "90 Tage", en: "90 days" },
        pitch: {
          de: "Alle 3 Prüfungen · alle Pro-Funktionen · verlängert sich automatisch alle 90 Tage",
          en: "All 3 exams · all Pro features · renews automatically every 90 days",
        },
        status: "live",
        cta: { de: "3-Monats-Tarif ansehen", en: "See the 3-month plan" },
        href: "/pricing#first-month",
        featured: true,
        useFreeHref: false,
      },
      {
        name: { de: "Prüfungs-Kohorte", en: "Exam Cohort" },
        price: billingSurfaceText("surface_9", "de"),
        period: { de: "6 Monate", en: "6 months" },
        pitch: {
          de: "Über 10.000 Fragen · Pass-Until-You-Pass · Karten-Checkout live",
          en: "Over 10,000 questions · Pass-Until-You-Pass · live card checkout",
        },
        status: "live",
        cta: { de: "Zur Kohorte", en: "See the Cohort" },
        href: "/pricing",
        featured: false,
        useFreeHref: false,
      },
    ],
    link: { de: "Alle Preise vergleichen", en: "Compare all plans" },
    comingSoon: { de: "Bald", en: "Soon" },
    featuredTag: { de: "Empfohlen", en: "Recommended" },
  },
  proof: {
    index: "04 / 04",
    eyebrow: { de: "Inhalt & Qualität", en: "Content & quality" },
    title: {
      de: "Über 10.000 kuratierte Übungsfragen.",
      en: "Over 10,000 curated practice questions.",
    },
    quote: {
      de: "Die Fragebanken dienen der Vorbereitung. Ihre Quellen und Formate unterscheiden sich je nach Prüfungsweg; sie versprechen keine identischen Prüfungsfragen.",
      en: "The question banks are for preparation. Their sources and formats differ by exam pathway; they do not promise identical exam questions.",
    },
    breakdown: [
      {
        n: "7.500+",
        n_en: "7,500+",
        label: { de: "Wien", en: "Vienna" },
        sub: { de: "seit 2016", en: "since 2016" },
      },
      {
        n: "2.700+",
        n_en: "2,700+",
        label: { de: "Stichprobentest", en: "Stichprobentest" },
        sub: { de: "Innsbruck-Curriculum", en: "Innsbruck curriculum" },
      },
      {
        n: "300+",
        n_en: "300+",
        label: { de: "Pharmakologie", en: "Pharmacology" },
        sub: { de: "Rezeptierkunde", en: "Rezeptierkunde" },
      },
    ],
  },
  cta: {
    title: { de: "Bereit, es zu beweisen?", en: "Ready to prove it?" },
    subtitle: {
      de: CTA_SUBTITLE_SAMPLE.de,
      en: CTA_SUBTITLE_SAMPLE.en,
    },
    button_free: { de: "Kostenlose Probe starten · keine Karte", en: "Start the free sample · no card" },
    trust: {
      de: "Konto- und Lerndaten in Frankfurt (EU) gespeichert",
      en: "Account and study data stored in Frankfurt (EU)",
    },
  },
  footer: {
    // Reframed 2026-06-04: was "gebaut von und für ausländische
    // Ärzt:innen / built by and for foreign doctors" — the "von …
    // Ärzt:innen / by … doctors" half is falsifiable (engineer
    // founder). "Für ausländische Ärzt:innen / for foreign doctors"
    // is true and stays.
    tagline: {
      de: "Vorbereitung auf österreichische Ärzteprüfungen mit kuratierten Übungsfragen.",
      en: "Austrian medical exam preparation with curated practice questions.",
    },
    product: { de: "Produkt", en: "Product" },
    legal: { de: "Rechtliches", en: "Legal" },
    orientation: { de: "Orientierung", en: "Orientation" },
    rights: { de: "Alle Rechte vorbehalten.", en: "All rights reserved." },
    // Founder facts (pick-founder-facts A): one person, from Cairo.
    operator: {
      de: `Betrieben von ${COMPANY.founder}, ${COMPANY.location.de}`,
      en: `Run by ${COMPANY.founder}, ${COMPANY.location.en}`,
    },
  },
  // LX-18: four points for people coming from a free flashcard deck. Each
  // renders from the claims register (surface "landing.switch").
  switchBlock: {
    eyebrow: { de: "Schon mit Karteikarten gelernt?", en: "Studied with flashcards before?" },
    title: { de: "Was Sie bei MedPrüf zusätzlich bekommen", en: "What MedPrüf adds" },
    items: claimsFor("landing.switch").map((c) => ({ id: c.id, title: claimTitle(c.id), body: claimText(c.id) })),
  },
};

/* ─────────────────────────────────────────────────────────────
   Wordmark — drop-in two-tone SVG. `variant="dark"` on ink
   grounds (nav-over-hero, footer); `variant="light"` (tight crop)
   on paper. Replaces the old logomark + brightness(0) invert(1)
   filter, which flattened the teal "Prüf".
   ───────────────────────────────────────────────────────────── */
function Wordmark({
  variant,
  className = "",
  height = 22,
}: {
  variant: "dark" | "light";
  className?: string;
  height?: number;
}) {
  const src = variant === "dark" ? "/brand/wordmark-dark.svg" : "/brand/wordmark-tight.svg";
  // viewBox is 393×86 → keep aspect ratio when sizing by height.
  const width = Math.round((393 / 86) * height);
  return (
    <Image
      src={src}
      alt="MedPrüf"
      width={width}
      height={height}
      priority
      className={className}
      style={{ height, width: "auto" }}
    />
  );
}

/* ─────────────────────────────────────────────────────────────
   Reveal-on-scroll hook — CRITICAL: `.lp-reveal` is opacity:0 in
   CSS and only `.is-in` (or reduced-motion) reveals it. Without
   this observer the page builds green but renders blank. We add
   `.is-in` as elements enter the viewport; reduced-motion users
   are already handled by the CSS media query, but we also reveal
   immediately on mount as a belt-and-braces fallback so nothing
   can ever stay hidden (e.g. if IO is unavailable).
   ───────────────────────────────────────────────────────────── */
function useReveal(active: boolean) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    // `active` flips true only after the page mounts and renders the REAL
    // tree (the pre-mount return is an empty shell with no ref attached).
    // Gating on it guarantees this effect re-runs once ref.current points
    // at the live DOM — otherwise it runs once against a null ref and the
    // whole page stays opacity:0 (the blank-page trap).
    if (!active) return;
    const root = ref.current;
    if (!root) return;
    const targets = Array.from(root.querySelectorAll<HTMLElement>(".lp-reveal"));
    if (targets.length === 0) return;

    // Fallback: if IntersectionObserver is missing, reveal everything now.
    if (typeof IntersectionObserver === "undefined") {
      targets.forEach((t) => t.classList.add("is-in"));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-in");
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    targets.forEach((t) => io.observe(t));

    // Any element already in view on first paint (above the fold) should
    // reveal without waiting for a scroll.
    requestAnimationFrame(() => {
      targets.forEach((t) => {
        const r = t.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) t.classList.add("is-in");
      });
    });

    return () => io.disconnect();
  }, [active]);
  return ref;
}

// Same localStorage key login/page.tsx writes to, so a code captured
// here on a bare `/?ref=CODE` → /landing redirect (middleware fix,
// 2026-07-11) is still there when the visitor later reaches Login/
// Register and claims it via /api/referrals/claim.
const REF_CODE_KEY = "medpruef_ref_code";

/* ─────────────────────────────────────────────────────────────
   Page
   ───────────────────────────────────────────────────────────── */
// a-v2-readiness-surfaces-1020: v2Ready is computed on the server (page.tsx); the readiness flags are server-only env.
export default function LandingClient({ reserveTrial = false, renderedAt, lernplanLink = false, v2Ready }: { reserveTrial?: boolean; renderedAt: string; lernplanLink?: boolean; v2Ready?: V2Readiness }) {
  const [lang, setLangState] = useState<Lang>("de");
  const uiLang = useLang();
  useEffect(() => { setLangState(renderLang(uiLang)); }, [uiLang]);
  const [mounted, setMounted] = useState(false);
  const [examSource, setExamSource] = useState<ExamSourceId>("kenntnispruefung");
  const revealRoot = useReveal(mounted);

  useEffect(() => {
    setLangState(getLang());
    setExamSource(getStoredExamSource());
    setMounted(true);

    // Capture ?ref=<code> the same way login/page.tsx does, so a
    // logged-out visitor who lands here via a bare `medpruf.com/?ref=`
    // share link (forwarded by the middleware fix) still has the code
    // stashed once they click through to Login/Register.
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get("ref");
      if (ref) {
        const normalized = ref
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "");
        if (normalized.length >= 4 && normalized.length <= 16) {
          localStorage.setItem(REF_CODE_KEY, normalized);
        }
      }
    } catch {
      // localStorage may be blocked in private mode — non-fatal.
    }
  }, []);

  const switchLang = (l: Lang) => {
    setLangState(l);
  };

  const freeHref = useMemo(() => freeQuizHref(examSource), [examSource]);
  // a-landing-418-fix: links read the stored exam through state (set on mount), never storage during render.
  const trialHref = useMemo(() => trialEntryHref(examSource), [examSource]);

  return (
    <div
      ref={revealRoot as React.RefObject<HTMLDivElement>}
      style={{ paddingTop: "var(--mp-ribbon-h, 0px)" }}
      className="lp-root min-h-screen overflow-x-clip bg-[var(--mp-surface-raised)] text-[var(--mp-fg)]"
    >
      {/* The ribbon waits for the cookie choice (UX-ACC-27): the head script
          marks a pending choice with .mp-consent-pending, so the desktop
          reservation and the server-rendered bar apply only after it. */}
      <style>{`:root { --mp-ribbon-h: 0px; } @media (min-width: 768px) { :root:not(.mp-consent-pending) { --mp-ribbon-h: ${reserveTrial ? 64 : 0}px; } } .mp-consent-pending .mp-trial-ribbon { display: none; } #termine { scroll-margin-top: calc(var(--mp-ribbon-h, 0px) + 64px); }`}</style>
      <TrialRibbon lang={lang === "en" ? "en" : "de"} initiallyEnabled={reserveTrial} />
      <Nav lang={lang} onLangChange={switchLang} freeHref={freeHref} />
      <Hero lang={lang} freeHref={freeHref} trialHref={trialHref} />
      {/* UX-PUB-16: the calendar sits directly under the hero, the pricing
          teaser follows it, nothing in between. */}
      <div id="termine">
        {/* a-home-lernplan-link-1018: the calendar closes with the /lernplan entry while that page is on. */}
        <UpcomingExams lang={lang} renderedAt={renderedAt} planEntry={lernplanLink} />
      </div>
      <PricingPreview lang={lang} freeHref={freeHref} trialEnabled={reserveTrial} v2Ready={v2Ready} />
      <HowItWorks lang={lang} />
      <Features lang={lang} />
      <Subjects lang={lang} />
      <SourceProof lang={lang} />
      <SwitchBlock lang={lang} />
      <StatsStrip lang={lang} />
      <LandingGuides lang={lang} />
      <FinalCTA lang={lang} freeHref={freeHref} trialHref={trialHref} />
      {/* a-landing-418-fix: the year follows the server render until mount. */}
      <Footer lang={lang} year={new Date(mounted ? Date.now() : renderedAt).getUTCFullYear()} />
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Nav — transparent over hero, inverts to paper on scroll.
   Wordmark swaps dark→light variant on scroll. Desktop inline
   links; mobile hamburger sheet.
   ───────────────────────────────────────────────────────────── */
function Nav({ lang, onLangChange, freeHref }: { lang: Lang; onLangChange: (l: Lang) => void; freeHref: string }) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 480);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Lock body scroll when the mobile sheet is open
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);

  return (
    <>
      <nav
        style={{ top: "var(--mp-ribbon-h, 0px)" }}
        className={`fixed left-0 right-0 z-50 transition-all duration-300 ${
          scrolled
            ? "bg-[var(--mp-surface-raised)]/92 backdrop-blur-xl border-b border-[var(--mp-border-subtle)] shadow-sm"
            : "bg-transparent"
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-1 sm:gap-2">
          <Link
            href="/landing"
            className="flex items-center shrink-0"
            aria-label="MedPrüf home"
          >
            {/* Wordmark swaps dark→light on scroll. Two nodes, one
                visible at a time, so there's no filter flash. */}
            <Wordmark variant="dark" height={22} className={`max-[380px]:!h-[18px] ${scrolled ? "hidden" : "block"}`} />
            <Wordmark variant="light" height={22} className={`max-[380px]:!h-[18px] ${scrolled ? "block" : "hidden"}`} />
          </Link>

          {/* Desktop inline links */}
          <div
            className={`hidden lg:flex items-center gap-5 xl:gap-7 text-sm font-medium ${
              scrolled ? "text-[var(--mp-fg-muted)]" : "text-white/70"
            }`}
          >
            <a
              href="#termine"
              className={`transition-colors ${
                scrolled ? "hover:text-[var(--mp-oxford-blue)]" : "hover:text-white"
              }`}
            >
              {COPY.nav.dates[lang]}
            </a>
            <a
              href="#how"
              className={`transition-colors ${
                scrolled ? "hover:text-[var(--mp-oxford-blue)]" : "hover:text-white"
              }`}
            >
              {COPY.nav.how[lang]}
            </a>
            <a
              href="#features"
              className={`transition-colors ${
                scrolled ? "hover:text-[var(--mp-oxford-blue)]" : "hover:text-white"
              }`}
            >
              {COPY.nav.features[lang]}
            </a>
            <a
              href="#pricing"
              className={`transition-colors ${
                scrolled ? "hover:text-[var(--mp-oxford-blue)]" : "hover:text-white"
              }`}
            >
              {COPY.nav.pricing[lang]}
            </a>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Compact on the public header so logo, language and the start button fit at 375 px; the helper stays for screen readers. */}
            <LanguagePicker compact onChange={onLangChange} />

            {/* Sign in (desktop only) */}
            <Link
              href="/login?mode=login"
              className={`hidden lg:inline-flex items-center gap-1.5 text-sm font-semibold transition-colors px-3 py-2 ${
                scrolled
                  ? "text-[var(--mp-fg-muted)] hover:text-[var(--mp-oxford-blue)]"
                  : "text-white/80 hover:text-white"
              }`}
            >
              {COPY.nav.login[lang]}
            </Link>

            {/* Start CTA — always visible */}
            <PublicStudyLink
              href={freeHref}
              aria-label={lang === "de" ? "Registrieren" : "Register"}
              className={`lp-cta inline-flex items-center gap-1.5 text-sm max-[380px]:text-xs font-bold px-3 max-[380px]:px-2 sm:px-4 py-2 rounded-xl transition-all shadow-sm hover:shadow-md focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--mp-accent-teal)] ${
                scrolled
                  ? "bg-[var(--mp-oxford-blue)] hover:bg-[var(--mp-cta-blue)] text-white"
                  : "bg-[var(--mp-accent-teal)] hover:brightness-110 text-[var(--mp-oxford-blue-dk)]"
              }`}
            >
              <span className="hidden min-[401px]:inline">{lang === "de" ? "Registrieren" : "Register"}</span>
              <span className="inline min-[401px]:hidden">{lang === "de" ? "Registrieren" : "Register"}</span>
              <ArrowRight className="w-3.5 h-3.5 max-[340px]:w-4 max-[340px]:h-4" aria-hidden="true" />
            </PublicStudyLink>

            {/* Hamburger — mobile only */}
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label={lang === "de" ? "Menü öffnen" : "Open menu"}
              aria-expanded={menuOpen}
              aria-controls="mobile-landing-nav"
              className={`lg:hidden inline-flex items-center justify-center rounded-lg p-2 transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--mp-accent-teal)] ${
                scrolled
                  ? "text-[var(--mp-fg)] hover:bg-[var(--mp-surface-sunken)]"
                  : "text-white hover:bg-white/10"
              }`}
            >
              <Menu className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile menu sheet */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-[60] lg:hidden"
          role="dialog"
          aria-modal="true"
          id="mobile-landing-nav"
          aria-label={lang === "de" ? "Navigation" : "Navigation"}
        >
          <button
            type="button"
            aria-label={lang === "de" ? "Menü schließen" : "Close menu"}
            onClick={closeMenu}
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
          />
          <div
            className="absolute right-0 top-0 bottom-0 w-[min(320px,88vw)] bg-[var(--mp-surface-raised)] border-l border-[var(--mp-border-subtle)] shadow-2xl flex flex-col"
            style={{ paddingTop: "env(safe-area-inset-top)" }}
          >
            <div className="h-16 px-4 flex items-center justify-between border-b border-[var(--mp-border-subtle)]">
              <Wordmark variant="light" height={20} />
              <button
                type="button"
                onClick={closeMenu}
                aria-label={lang === "de" ? "Schließen" : "Close"}
                className="rounded-lg p-2 text-[var(--mp-fg-muted)] hover:bg-[var(--mp-surface-sunken)] focus:outline-none focus:ring-2 focus:ring-[var(--mp-accent-teal)]"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-2 py-3">
              <a
                href="#termine"
                onClick={closeMenu}
                className="flex items-center gap-3 px-3 py-3 rounded-xl text-[var(--mp-fg)] text-base font-semibold hover:bg-[var(--mp-surface-sunken)] transition-colors"
              >
                <CalendarDays className="w-4 h-4 text-[var(--mp-viridian)]" aria-hidden="true" />
                {COPY.nav.dates[lang]}
              </a>
              <a
                href="#how"
                onClick={closeMenu}
                className="flex items-center gap-3 px-3 py-3 rounded-xl text-[var(--mp-fg)] text-base font-semibold hover:bg-[var(--mp-surface-sunken)] transition-colors"
              >
                <Target className="w-4 h-4 text-[var(--mp-viridian)]" aria-hidden="true" />
                {COPY.nav.how[lang]}
              </a>
              <a
                href="#features"
                onClick={closeMenu}
                className="flex items-center gap-3 px-3 py-3 rounded-xl text-[var(--mp-fg)] text-base font-semibold hover:bg-[var(--mp-surface-sunken)] transition-colors"
              >
                <Sparkles className="w-4 h-4 text-[var(--mp-viridian)]" aria-hidden="true" />
                {COPY.nav.features[lang]}
              </a>
              <a
                href="#pricing"
                onClick={closeMenu}
                className="flex items-center gap-3 px-3 py-3 rounded-xl text-[var(--mp-fg)] text-base font-semibold hover:bg-[var(--mp-surface-sunken)] transition-colors"
              >
                <ShieldCheck className="w-4 h-4 text-[var(--mp-viridian)]" aria-hidden="true" />
                {COPY.nav.pricing[lang]}
              </a>
              <Link
                href="/find-your-path"
                onClick={closeMenu}
                className="flex items-center gap-3 px-3 py-3 rounded-xl text-[var(--mp-fg)] text-base font-semibold hover:bg-[var(--mp-surface-sunken)] transition-colors"
              >
                <Compass className="w-4 h-4 text-[var(--mp-viridian)]" aria-hidden="true" />
                {COPY.hero.find_path_cta[lang]}
              </Link>
              <Link
                href="/faq"
                onClick={closeMenu}
                className="flex items-center gap-3 px-3 py-3 rounded-xl text-[var(--mp-fg)] text-base font-semibold hover:bg-[var(--mp-surface-sunken)] transition-colors"
              >
                <MessageCircle className="w-4 h-4 text-[var(--mp-viridian)]" aria-hidden="true" />
                FAQ
              </Link>
              <div className="my-2 h-px bg-[var(--mp-border-subtle)]" />
              <Link
                href="/login?mode=login"
                onClick={closeMenu}
                className="flex items-center gap-3 px-3 py-3 rounded-xl text-[var(--mp-fg-muted)] text-base font-semibold hover:bg-[var(--mp-surface-sunken)] transition-colors"
              >
                {COPY.nav.login[lang]}
              </Link>
            </nav>
            <div className="p-4 border-t border-[var(--mp-border-subtle)]">
              <PublicStudyLink
                href={freeHref}
                onClick={closeMenu}
                className="mp-btn mp-btn--success mp-btn--lg w-full justify-center"
              >
                {lang === "de" ? "Registrieren" : "Register"}
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </PublicStudyLink>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ─────────────────────────────────────────────────────────────
   Hero — clinical exam-record ground. Deep navy, lab-header
   eyebrow, provenance stamp, big tabular headline, dashed ruler
   baseline. Right rail = a stylized "exam record" card.
   ───────────────────────────────────────────────────────────── */
function Hero({ lang, freeHref, trialHref }: { lang: Lang; freeHref: string; trialHref: string }) {
  const trialAvailable = useTrialAvailable();
  return (
    <section
      className="relative overflow-hidden text-white"
      style={{ background: "var(--mp-oxford-blue-dk)" }}
    >
      {/* Teal radial glow — top-right */}
      <div
        aria-hidden="true"
        className="absolute pointer-events-none"
        style={{
          top: "-160px",
          right: "-160px",
          width: "640px",
          height: "640px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(0,168,150,0.26), transparent 65%)",
        }}
      />
      {/* CTA blue glow — bottom-left */}
      <div
        aria-hidden="true"
        className="absolute pointer-events-none"
        style={{
          bottom: "-200px",
          left: "-160px",
          width: "540px",
          height: "540px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(0,58,140,0.32), transparent 65%)",
        }}
      />
      {/* Faint grid — like ruled exam paper */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.05] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-32 pb-20 md:pt-36 md:pb-24">
        <div className="grid lg:grid-cols-[1.15fr_0.85fr] gap-12 lg:gap-10 items-center">
          {/* ── Left column ── */}
          <div className="lp-reveal">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3 mb-7">
              <p className="lp-eyebrow" style={{ color: "var(--lp-teal-br)" }}>
                {COPY.hero.eyebrow[lang]}
              </p>
              <span className="lp-stamp">
                <span className="lp-stamp__pulse" aria-hidden="true" />
                {COPY.hero.stamp[lang]}
              </span>
            </div>

            <h1
              className="font-display font-black tracking-tight text-white mb-6"
              style={{
                fontSize: "clamp(38px, 6.4vw, 74px)",
                lineHeight: "1.02",
                letterSpacing: "-0.035em",
              }}
            >
              {COPY.hero.title_pre[lang]}
              <br />
              <em
                className="font-black"
                style={{ color: "var(--lp-teal-br)", fontStyle: "italic" }}
              >
                {COPY.hero.title_mid[lang]}
              </em>
            </h1>

            {/* PUYP sub-headline, scoped to the Cohort tier (not free-forever) */}
            <p
              className="font-display font-semibold text-white/90 mb-5 max-w-xl"
              style={{
                fontSize: "clamp(17px, 2.1vw, 22px)",
                lineHeight: 1.3,
                textWrap: "balance" as const,
              }}
            >
              {COPY.hero.title_line2[lang]}
            </p>

            <p
              className="text-white/70 mb-9 max-w-xl"
              style={{
                fontSize: "clamp(14px, 1.5vw, 16px)",
                lineHeight: 1.6,
                textWrap: "balance" as const,
              }}
            >
              {COPY.hero.subtitle[lang]}
            </p>

            {/* CTAs, free-first ([name] 2026-10-11, UX-PUB-14 option A): the
                no-card sample is the primary; the card trial is a visibly
                lighter secondary that states its card terms. */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-start gap-3 mb-4 w-full sm:w-auto sm:flex-wrap">
              <PublicStudyLink
                href={freeHref}
                className="lp-cta inline-flex flex-col items-center justify-center gap-0.5 bg-[var(--mp-accent-teal)] hover:brightness-110 text-[var(--mp-oxford-blue-dk)] font-extrabold px-6 sm:px-7 py-3 sm:py-3.5 rounded-xl transition-all shadow-lg hover:shadow-xl hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--mp-accent-teal)] focus:ring-offset-[var(--mp-oxford-blue-dk)] w-full sm:w-auto"
                style={{ fontSize: "15px" }}
              >
                <span className="flex items-center gap-2 whitespace-nowrap">
                  {COPY.hero.cta_primary[lang]}
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </span>
                <span className="text-[11px] font-semibold text-[var(--mp-oxford-blue-dk)]/70 whitespace-nowrap">
                  {COPY.hero.cta_primary_sub[lang]}
                </span>
              </PublicStudyLink>
              <div className="flex flex-col gap-1 w-full sm:w-auto sm:max-w-[18rem]">
                <PublicStudyLink
                  href={trialHref}
                  className="inline-flex items-center justify-center gap-2 bg-transparent text-white border border-white/25 hover:border-white/60 hover:bg-white/5 font-semibold px-6 sm:px-7 py-3 sm:py-3.5 rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-white focus:ring-offset-[var(--mp-oxford-blue-dk)] w-full sm:w-auto whitespace-nowrap"
                  style={{ fontSize: "15px" }}
                >
                  {reverseTrialCopyEnabled() ? REVERSE_TRIAL_LANDING.button[lang] : COPY.hero.cta_trial_second[lang]}
                  <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </PublicStudyLink>
                {reverseTrialCopyEnabled()
                  ? <p className="text-[11px] leading-snug text-white/65" data-reverse-trial-terms>{REVERSE_TRIAL_LANDING.terms[lang]}</p>
                  : trialAvailable && <p className="text-[11px] leading-snug text-white/65">{COPY.hero.cta_trial_terms[lang]}</p>}
              </div>
              {reverseTrialCopyEnabled() && (
                <p className="w-full text-[12px] font-semibold leading-snug text-white/80" data-reverse-trial-hero-line>{REVERSE_TRIAL_LANDING.heroLine[lang]}</p>
              )}
              <FreeOfferDisclosure lang={lang} tone="onDark" className="w-full max-w-md" />
            </div>

            {/* Orientation entry — the confused lead (Instagram DM) who
                does not yet know which recognition route is theirs.
                Routes to the public /find-your-path flow. */}
            <Link
              href="/find-your-path"
              className="group mb-5 inline-flex items-center gap-2.5 rounded-xl border border-white/20 bg-white/[0.06] px-4 py-2.5 transition-all hover:border-[var(--mp-accent-teal)]/60 hover:bg-white/[0.1] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--mp-accent-teal)] focus:ring-offset-[var(--mp-oxford-blue-dk)]"
            >
              <span
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                style={{ background: "rgba(0,168,150,0.16)" }}
                aria-hidden="true"
              >
                <Compass className="h-4 w-4" style={{ color: "var(--lp-teal-br)" }} />
              </span>
              <span className="text-left leading-tight">
                <span className="block text-white/60" style={{ fontSize: "11px" }}>
                  {COPY.hero.find_path_label[lang]}
                </span>
                <span className="block font-semibold text-white" style={{ fontSize: "13.5px" }}>
                  {COPY.hero.find_path_cta[lang]}
                </span>
              </span>
              <ChevronRight
                className="ml-1 h-4 w-4 text-white/40 transition-transform group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </Link>

            {/* a-public-selftest: the no-account self-check (build mirror of PUBLIC_SELFTEST_ENABLED). */}
            {publicSelftestLinksEnabled() && (
              <Link
                href={`${selftestHref(undefined, lang)}${lang === "en" ? "&" : "?"}from=landing`}
                data-testid="selftest-entry"
                className="group mb-5 ml-0 sm:ml-2 inline-flex items-center gap-2.5 rounded-xl border border-white/20 bg-white/[0.06] px-4 py-2.5 transition-all hover:border-[var(--mp-accent-teal)]/60 hover:bg-white/[0.1] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--mp-accent-teal)] focus:ring-offset-[var(--mp-oxford-blue-dk)]"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: "rgba(0,168,150,0.16)" }} aria-hidden="true">
                  <FlaskConical className="h-4 w-4" style={{ color: "var(--lp-teal-br)" }} />
                </span>
                <span className="text-left leading-tight">
                  <span className="block text-white/60" style={{ fontSize: "11px" }}>{selftestCopy("entry_hint", lang)}</span>
                  <span className="block font-semibold text-white" style={{ fontSize: "13.5px" }}>{selftestCopy("entry_link", lang)}</span>
                </span>
                <ChevronRight className="ml-1 h-4 w-4 text-white/40 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            )}

            {/* Tertiary monthly entry link (amount from billing-copy) */}
            <p className="mb-6">
              <Link
                href="/pricing#first-month"
                className="lp-link text-white/70 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-white focus:ring-offset-[var(--mp-oxford-blue-dk)] rounded"
                style={{ fontSize: "13px" }}
              >
                <span className="font-semibold">{COPY.hero.cta_tertiary[lang]}</span>
                <span className="text-white/50" style={{ fontSize: "12px" }}>
                  , {COPY.hero.cta_tertiary_sub[lang]}
                </span>
              </Link>
            </p>

            <CodeEntry surface="landing" tone="dark" className="mb-5" />

            <div className="lp-ruler max-w-md mb-4" aria-hidden="true" />
            <span className="text-white/55 block" style={{ fontSize: "12px", letterSpacing: "0.01em" }}>
              {COPY.hero.cta_note[lang]}
            </span>
          </div>

          {/* ── Right column — "exam record" card ── */}
          <div className="lp-reveal hidden lg:block">
            <ExamRecordCard lang={lang} />
          </div>
        </div>
      </div>
    </section>
  );
}

/* A decorative, on-brand "exam record" card — reinforces the
   clinical-record concept. Not a real screenshot; a designed
   abstraction (a question stem, four options, one correct,
   a mono record header). */
function ExamRecordCard({ lang }: { lang: Lang }) {
  const options = [
    { k: "A", t: { de: "Aortendissektion", en: "Aortic dissection" }, correct: false },
    { k: "B", t: { de: "Lungenembolie", en: "Pulmonary embolism" }, correct: true },
    { k: "C", t: { de: "Pneumothorax", en: "Pneumothorax" }, correct: false },
    { k: "D", t: { de: "Perikarditis", en: "Pericarditis" }, correct: false },
  ];

  // Interactive language demo (2026-07-03): the STEM stays in German, as it
  // is on exam day, while the AI explanation flips into the candidate's own
  // language. This is the single most important differentiator for the
  // immigrant-physician ICP, so we let the visitor feel it before signup.
  // These are the demo's showcase strings only (one question); the live app
  // translates on demand via /api/translate. Arabic wording is pending
  // [name]'s sign-off (standing rule) but shown so persona #1 sees the value.
  type DemoLang = "de" | "en" | "ar" | "ru" | "uk" | "tr";
  const DEMO_LANGS: { code: DemoLang; label: string }[] = [
    { code: "de", label: "DE" },
    { code: "en", label: "EN" },
    { code: "ar", label: "AR" },
    { code: "ru", label: "RU" },
    { code: "uk", label: "UK" },
    { code: "tr", label: "TR" },
  ];
  const EXPLAIN: Record<DemoLang, string> = {
    de: "Wells-Score hoch, daher CTPA. D-Dimer nur bei niedriger Vortestwahrscheinlichkeit. Ref: ESC 2019.",
    en: "High Wells score, so CTPA. D-dimer only at low pretest probability. Ref: ESC 2019.",
    ar: "درجة ويلز مرتفعة، لذلك يُجرى تصوير الأوعية الرئوية المقطعي المحوسب (CTPA). D-dimer فقط عند انخفاض احتمالية ما قبل الاختبار. المرجع: ESC 2019.",
    ru: "Высокий балл Уэллса, поэтому КТ-ангиография (CTPA). D-димер только при низкой предтестовой вероятности. Ref: ESC 2019.",
    uk: "Високий бал Уеллса, тому КТ-ангіографія (CTPA). D-димер лише за низької передтестової ймовірності. Ref: ESC 2019.",
    tr: "Yüksek Wells skoru, bu yüzden CTPA. D-dimer yalnızca düşük ön test olasılığında. Ref: ESC 2019.",
  };
  const [explainLang, setExplainLang] = useState<DemoLang>(lang === "de" ? "de" : "en");
  const rtl = explainLang === "ar";

  return (
    <div
      className="rounded-2xl border p-5 shadow-2xl"
      style={{
        background: "linear-gradient(180deg, rgba(6,41,79,0.92), rgba(0,16,40,0.92))",
        borderColor: "var(--lp-line-ink)",
        backdropFilter: "blur(8px)",
      }}
    >
      {/* Record header */}
      <div
        className="flex items-center justify-between pb-3 mb-4 border-b"
        style={{ borderColor: "var(--lp-line-ink)" }}
      >
        <span className="lp-examtab" style={{ color: "var(--lp-teal-br)" }}>
          SIP4a · Innere
        </span>
        <span className="lp-examtab text-white/45">№ 4127</span>
      </div>

      {/* Stem — always German, as on exam day */}
      <p className="text-white/90 mb-1.5" style={{ fontSize: "14px", lineHeight: 1.5 }} dir="ltr">
        Akute Dyspnoe, Tachykardie und einseitiger Pleuraschmerz nach Langstreckenflug. Wahrscheinlichste Diagnose?
      </p>
      <p className="text-white/70 mb-4" style={{ fontSize: "10.5px" }}>
        {lang === "de"
          ? "Frage bleibt auf Deutsch, wie in der Prüfung."
          : "Question stays in German, as on exam day."}
      </p>

      {/* Options */}
      <div className="space-y-2 mb-4">
        {options.map((o) => (
          <div
            key={o.k}
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 border transition-colors"
            style={{
              borderColor: o.correct ? "rgba(31,194,166,0.55)" : "var(--lp-line-ink)",
              background: o.correct ? "rgba(31,194,166,0.10)" : "rgba(255,255,255,0.02)",
            }}
          >
            <span
              className="lp-examtab flex items-center justify-center rounded-md shrink-0"
              style={{
                width: 22,
                height: 22,
                color: o.correct ? "var(--mp-oxford-blue-dk)" : "rgba(255,255,255,0.6)",
                background: o.correct ? "var(--lp-teal-br)" : "rgba(255,255,255,0.06)",
              }}
            >
              {o.k}
            </span>
            <span
              className="text-white/85"
              style={{ fontSize: "13px", fontWeight: o.correct ? 600 : 400 }}
            >
              {o.t[lang === "de" ? "de" : "en"]}
            </span>
            {o.correct && (
              <span
                className="ml-auto lp-examtab"
                style={{ color: "var(--lp-teal-br)", fontSize: "10px" }}
              >
                ✓ {lang === "de" ? "richtig" : "correct"}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* AI explanation peek — language flips live */}
      <div
        className="rounded-lg p-3 border"
        style={{ borderColor: "var(--lp-line-ink)", background: "rgba(255,255,255,0.02)" }}
      >
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <Brain className="w-3.5 h-3.5" style={{ color: "var(--lp-teal-br)" }} aria-hidden="true" />
            <span className="lp-examtab" style={{ color: "var(--lp-teal-br)" }}>
              {COPY.hero.explain_label[lang]}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1 mb-2.5">
          {DEMO_LANGS.map((l) => {
            const active = l.code === explainLang;
            return (
              <button
                key={l.code}
                type="button"
                onClick={() => setExplainLang(l.code)}
                aria-pressed={active}
                className="lp-examtab rounded-md px-2 py-1 transition-colors"
                style={{
                  fontSize: "10px",
                  color: active ? "var(--mp-oxford-blue-dk)" : "rgba(255,255,255,0.6)",
                  background: active ? "var(--lp-teal-br)" : "rgba(255,255,255,0.06)",
                }}
              >
                {l.label}
              </button>
            );
          })}
        </div>
        <p
          className="text-white/70"
          style={{ fontSize: "11.5px", lineHeight: 1.6 }}
          dir={rtl ? "rtl" : "ltr"}
          lang={explainLang}
        >
          {EXPLAIN[explainLang]}
        </p>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Stats strip — quiet KPI row at the edge of the hero, mono
   labels. 2 cols on phones, 4 on md+.
   ───────────────────────────────────────────────────────────── */
function StatsStrip({ lang }: { lang: Lang }) {
  return (
    <section className="relative text-white" style={{ background: "var(--mp-oxford-blue-dk)" }}>
      <div className="relative max-w-6xl mx-auto px-4 sm:px-6">
        <div
          className="grid grid-cols-2 md:grid-cols-4 border-t border-b divide-x divide-white/10 md:divide-x-0"
          style={{ borderColor: "rgba(255,255,255,0.1)" }}
        >
          {COPY.stats.map((s, i) => {
            const isTopRowOnPhone = i < 2;
            const isLastOnDesktop = i === COPY.stats.length - 1;
            return (
              <div
                key={i}
                className={`flex flex-col items-start justify-center py-5 sm:py-7 px-4 md:px-6 min-w-0 ${
                  isTopRowOnPhone ? "border-b md:border-b-0 border-white/10" : ""
                } ${!isLastOnDesktop ? "md:border-r md:border-white/10" : ""}`}
              >
                <div
                  className="lp-figure text-white"
                  style={{ fontSize: "clamp(28px, 3.6vw, 40px)" }}
                >
                  {lang === "en" ? s.value_en : s.value}
                </div>
                <div
                  className="mt-2 text-white/70 font-bold leading-snug"
                  style={{ fontSize: "11px", letterSpacing: "0.1em", textTransform: "uppercase" }}
                >
                  {s.label[lang]}
                </div>
                {s.sub && (
                  <div
                    className="mt-1 text-white/70 leading-snug"
                    style={{
                      fontSize: "10.5px",
                      fontFamily: "var(--lp-mono)",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {s.sub[lang]}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* Section header — shared lab-header treatment: mono index, a
   hairline rule, eyebrow + heading. */
function SectionHead({
  index,
  eyebrow,
  title,
  subtitle,
  center = false,
}: {
  index?: string;
  eyebrow: string;
  title: string;
  subtitle?: string;
  center?: boolean;
}) {
  return (
    <div className={`lp-reveal max-w-2xl ${center ? "mx-auto text-center" : ""}`}>
      {index && (
        <div
          className={`flex items-center gap-3 mb-4 ${center ? "justify-center" : ""}`}
        >
          <span className="lp-index">{index}</span>
          <span
            className="h-px w-10 bg-[var(--mp-border-subtle)]"
            aria-hidden="true"
            style={{ opacity: 0.8 }}
          />
        </div>
      )}
      <p
        className={`lp-eyebrow mb-3 text-[var(--mp-viridian)] ${center ? "lp-eyebrow--center" : ""}`}
      >
        {eyebrow}
      </p>
      <h2
        className="font-display font-extrabold text-[var(--mp-fg)]"
        style={{ fontSize: "clamp(26px, 3.4vw, 38px)", letterSpacing: "-0.02em", lineHeight: 1.1 }}
      >
        {title}
      </h2>
      {subtitle && (
        <p
          className="mt-3 text-[var(--mp-fg-muted)]"
          style={{ fontSize: "17px", lineHeight: 1.55 }}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   How it works — 3-step, paper theme
   ───────────────────────────────────────────────────────────── */
function HowItWorks({ lang }: { lang: Lang }) {
  return (
    <section id="how" className="py-20 md:py-24 bg-[var(--mp-surface-raised)]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="mb-10 md:mb-14">
          <SectionHead
            index={COPY.how.index}
            eyebrow={COPY.how.eyebrow[lang]}
            title={COPY.how.title[lang]}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
          {COPY.how.steps.map((s, i) => (
            <div key={s.n} className="lp-reveal relative" style={{ transitionDelay: `${i * 70}ms` }}>
              <div className="flex items-baseline gap-3 mb-4">
                <span className="lp-figure" style={{ fontSize: "44px", color: "var(--mp-viridian)" }}>
                  {s.n}
                </span>
                {i < COPY.how.steps.length - 1 && (
                  <span
                    className="hidden md:block h-px flex-1 bg-[var(--mp-border-subtle)] translate-y-[-6px]"
                    aria-hidden="true"
                  />
                )}
              </div>
              <h3 className="font-display font-bold text-[var(--mp-fg)] mb-2" style={{ fontSize: "19px" }}>
                {s.title[lang]}
              </h3>
              <p className="text-[var(--mp-fg-muted)] leading-relaxed" style={{ fontSize: "15px" }}>
                {s.body[lang]}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   Features — 6 precision cards with corner tick + mono tag
   ───────────────────────────────────────────────────────────── */
function Features({ lang }: { lang: Lang }) {
  return (
    <section id="features" className="py-20 md:py-24 bg-[var(--mp-surface-sunken)]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="mb-10 md:mb-12">
          <SectionHead
            index={COPY.features.index}
            eyebrow={COPY.features.eyebrow[lang]}
            title={COPY.features.title[lang]}
            subtitle={COPY.features.subtitle[lang]}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {COPY.features.items.map((f, i) => {
            const Icon = f.icon;
            return (
              <article
                key={f.title.en}
                className="lp-reveal lp-card lp-card--tick p-6"
                style={{ transitionDelay: `${(i % 3) * 70}ms` }}
              >
                <div className="flex items-center justify-between mb-5">
                  <div
                    className="w-11 h-11 rounded-xl flex items-center justify-center"
                    style={{ background: "rgba(0, 123, 95, 0.1)" }}
                  >
                    <Icon className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden="true" />
                  </div>
                  <span
                    className="lp-examtab text-[var(--mp-fg-faint)]"
                    style={{ color: "var(--lp-fg-faint)" }}
                  >
                    {f.tag}
                  </span>
                </div>
                <h3
                  className="font-display font-bold text-[var(--mp-fg)] mb-2"
                  style={{ fontSize: "17px" }}
                >
                  {f.title[lang]}
                </h3>
                <p
                  className="text-[var(--mp-fg-muted)] leading-relaxed"
                  style={{ fontSize: "14px" }}
                >
                  {f.body[lang]}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   Subjects — 16 specialties grid
   ───────────────────────────────────────────────────────────── */
function Subjects({ lang }: { lang: Lang }) {
  return (
    <section className="py-20 md:py-24 bg-[var(--mp-surface-raised)]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="mb-10 md:mb-12">
          <SectionHead
            eyebrow={COPY.subjects.eyebrow[lang]}
            title={COPY.subjects.title[lang]}
            subtitle={COPY.subjects.subtitle[lang]}
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {COPY.subjects.items.map((s, i) => {
            const Icon = s.icon;
            return (
              <div
                key={i}
                className="lp-reveal lp-card flex flex-col items-center justify-center text-center gap-2 p-4 hover:border-[var(--mp-viridian)]/40 transition-colors"
                style={{ transitionDelay: `${(i % 6) * 40}ms` }}
              >
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center"
                  style={{ background: "rgba(0, 123, 95, 0.08)" }}
                >
                  <Icon className="w-5 h-5 text-[var(--mp-viridian)]" aria-hidden="true" />
                </div>
                <span className="text-[var(--mp-fg)] font-semibold" style={{ fontSize: "13px" }}>
                  {s.name[lang]}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   Pricing preview — 3-tier brief, featured card highlighted
   ───────────────────────────────────────────────────────────── */
/** a-pricing-v2: the v2 preview, from the one price source (src/lib/pricing-v2/landing-preview.ts). */

function PricingPreview({ lang, freeHref, trialEnabled, v2Ready }: { lang: Lang; freeHref: string; trialEnabled: boolean; v2Ready?: V2Readiness }) {
  if (pricingV2Enabled()) return <PricingPreviewV2 lang={lang} freeHref={freeHref} v2Ready={v2Ready} />;
  return (
    <section id="pricing" className="py-20 md:py-24 bg-[var(--mp-surface-sunken)]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="mb-10 md:mb-12">
          <SectionHead
            index={COPY.pricing.index}
            eyebrow={COPY.pricing.eyebrow[lang]}
            title={COPY.pricing.title[lang]}
            subtitle={COPY.pricing.subtitle[lang]}
          />
        </div>

        <div className={`grid grid-cols-1 md:grid-cols-2 ${trialEnabled ? "lg:grid-cols-4" : "lg:grid-cols-3"} gap-4 mb-8`}>
          {COPY.pricing.tiers.filter(t => trialEnabled || !t.href.includes("intent=trial")).map((t, i) => {
            const planName = t.name[lang];
            const EntryLink = t.useFreeHref || t.href.includes("intent=trial") ? PublicStudyLink : Link;
            const isSoon = t.status === "soon";
            const featured = t.featured;
            return (
              <div
                key={planName}
                className={`lp-reveal lp-card p-6 relative flex flex-col ${
                  featured ? "lp-card--tick" : ""
                }`}
                style={{
                  transitionDelay: `${i * 70}ms`,
                  ...(featured
                    ? { borderColor: "rgba(0,123,95,0.55)", boxShadow: "var(--mp-shadow-hover)" }
                    : {}),
                }}
              >
                {featured && (
                  <span
                    className="absolute -top-2.5 left-6 lp-examtab px-2 py-0.5 rounded-full text-[var(--mp-fg-on-viridian)]"
                    style={{ background: "var(--mp-viridian)", fontSize: "10px" }}
                  >
                    {COPY.pricing.featuredTag[lang]}
                  </span>
                )}
                {isSoon && (
                  <span
                    className="absolute top-4 right-4 lp-examtab px-2 py-0.5 rounded-full"
                    style={{
                      color: "var(--mp-warning-dk)",
                      background: "var(--mp-warning-bg)",
                      fontSize: "10px",
                    }}
                  >
                    {COPY.pricing.comingSoon[lang]}
                  </span>
                )}
                <h3
                  className="font-display font-bold text-[var(--mp-fg)] mb-1"
                  style={{ fontSize: "18px" }}
                >
                  {planName}
                </h3>
                <div className="flex items-baseline gap-1.5 mb-4">
                  <span className="lp-figure text-[var(--mp-fg)]" style={{ fontSize: "34px" }}>
                    {t.price}
                  </span>
                  <span className="text-[var(--mp-fg-subtle)]" style={{ fontSize: "13px" }}>
                    / {t.period[lang]}
                  </span>
                </div>
                <p className="text-[var(--mp-fg-muted)] flex-1 mb-5" style={{ fontSize: "14px" }}>
                  {t.pitch[lang]}
                </p>
                <EntryLink
                  href={t.useFreeHref ? freeHref : t.href}
                  className={`mp-btn ${
                    isSoon ? "mp-btn--secondary" : "mp-btn--success"
                  } w-full justify-center ${!isSoon ? "lp-cta" : ""}`}
                >
                  {t.cta[lang]}
                </EntryLink>
                {t.useFreeHref && <FreeOfferDisclosure lang={lang} className="mt-2" />}
              </div>
            );
          })}
        </div>

        <div className="lp-reveal text-center">
          <Link
            href="/pricing"
            className="lp-link inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--mp-viridian)] focus:outline-none focus:ring-2 focus:ring-[var(--mp-viridian)] rounded"
          >
            {COPY.pricing.link[lang]}
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   Source proof — provenance band. Credits the documented source
   exams (honest credential) with a sourced breakdown. Reads
   clinical, not hype-y; no claim of physician authorship.
   ───────────────────────────────────────────────────────────── */
function SourceProof({ lang }: { lang: Lang }) {
  return (
    <section className="py-20 md:py-24 bg-[var(--mp-surface-raised)] border-y border-[var(--mp-border-subtle)]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6">
        <div className="mb-10">
          <SectionHead
            index={COPY.proof.index}
            eyebrow={COPY.proof.eyebrow[lang]}
            title={COPY.proof.title[lang]}
            subtitle={COPY.proof.quote[lang]}
            center
          />
        </div>

        {/* Source breakdown — three precision cards, figure + label + provenance sub */}
        <div className="grid grid-cols-3 gap-3 md:gap-6 max-w-3xl mx-auto">
          {COPY.proof.breakdown.map((b, i) => (
            <div
              key={i}
              className="lp-reveal lp-card flex flex-col items-start justify-center p-4 md:p-5 text-left"
              style={{ transitionDelay: `${i * 70}ms` }}
            >
              <div
                className="lp-figure text-[var(--mp-oxford-blue)] dark:text-white"
                style={{ fontSize: "clamp(24px, 3vw, 34px)" }}
              >
                {lang === "en" ? b.n_en : b.n}
              </div>
              <div
                className="mt-2 font-bold text-[var(--mp-fg-muted)] leading-snug"
                style={{ fontSize: "11px", letterSpacing: "0.08em", textTransform: "uppercase" }}
              >
                {b.label[lang]}
              </div>
              <div
                className="mt-0.5 text-[var(--mp-fg-faint)] leading-snug"
                style={{ fontSize: "10.5px", fontFamily: "var(--lp-mono)", color: "var(--lp-fg-faint)" }}
              >
                {b.sub[lang]}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   Switch block (LX-18): four registered claims for visitors who
   studied with a free flashcard deck. No competitor is named and
   nothing is compared; every line comes from the claims register.
   ───────────────────────────────────────────────────────────── */
const SWITCH_ICONS: Record<string, typeof Smartphone> = {
  "landing.switch-iphone": Smartphone,
  "landing.switch-answers": ListChecks,
  "landing.switch-timed": Timer,
  "landing.switch-dates": CalendarDays,
};

function SwitchBlock({ lang }: { lang: Lang }) {
  return (
    <section aria-labelledby="switch-heading" className="py-16 md:py-20 bg-[var(--mp-surface-sunken)]">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="lp-reveal max-w-2xl mb-8 md:mb-10">
          <p className="lp-eyebrow mb-3 text-[var(--mp-viridian)]">{COPY.switchBlock.eyebrow[lang]}</p>
          <h2
            id="switch-heading"
            className="font-display font-extrabold text-[var(--mp-fg)]"
            style={{ fontSize: "clamp(24px, 3vw, 32px)", letterSpacing: "-0.02em", lineHeight: 1.15 }}
          >
            {COPY.switchBlock.title[lang]}
          </h2>
        </div>
        <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {COPY.switchBlock.items.map((item, i) => {
            const Icon = SWITCH_ICONS[item.id] ?? ListChecks;
            return (
              <li
                key={item.id}
                className="lp-reveal lp-card p-5 flex flex-col gap-3"
                style={{ transitionDelay: `${i * 60}ms` }}
              >
                <span className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--mp-success-bg)]" aria-hidden="true">
                  <Icon className="w-5 h-5 text-[var(--mp-viridian)]" />
                </span>
                <h3 className="font-display font-bold text-[var(--mp-fg)]" style={{ fontSize: "16px", lineHeight: 1.3 }}>
                  {item.title[lang]}
                </h3>
                <p className="text-[var(--mp-fg-muted)] leading-relaxed" style={{ fontSize: "14px" }}>
                  {item.body[lang]}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   Final CTA — dark band to match hero
   ───────────────────────────────────────────────────────────── */
/* ─────────────────────────────────────────────────────────────
   ProofSeal — [name]'s "Proof, made into a stamp" motif. Inline SVG
   so it themes + can animate. Pass-signal teal on any ground.
   ───────────────────────────────────────────────────────────── */
function ProofSeal({ className = "", size = 72 }: { className?: string; size?: number }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 72 72" fill="none" aria-hidden="true">
      <circle cx="36" cy="36" r="34" stroke="var(--mp-pass-signal)" strokeWidth="2" />
      <circle cx="36" cy="36" r="27" stroke="var(--mp-pass-signal)" strokeWidth="1" strokeOpacity="0.45" />
      <path d="M25 36.5 l7.5 7.5 L47 29" stroke="var(--mp-pass-signal)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FinalCTA({ lang, freeHref, trialHref }: { lang: Lang; freeHref: string; trialHref: string }) {
  const trialAvailable = useTrialAvailable();
  return (
    <section
      className="relative py-20 md:py-24 text-white overflow-hidden"
      style={{ background: "var(--mp-oxford-blue-dk)" }}
    >
      <div
        aria-hidden="true"
        className="absolute pointer-events-none"
        style={{
          top: "-120px",
          left: "50%",
          transform: "translateX(-50%)",
          width: "700px",
          height: "700px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(0,168,150,0.2), transparent 65%)",
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.045] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }}
      />
      <div className="relative max-w-3xl mx-auto px-4 sm:px-6 text-center lp-reveal">
        <ProofSeal className="mx-auto mb-6" />
        <p className="lp-eyebrow lp-eyebrow--center mb-5" style={{ color: "var(--lp-teal-br)" }}>
          {COPY.hero.eyebrow[lang]}
        </p>
        <h2
          className="font-display font-black text-white mb-5 leading-[1.05]"
          style={{ fontSize: "clamp(32px, 5vw, 56px)", letterSpacing: "-0.03em" }}
        >
          {COPY.cta.title[lang]}
        </h2>
        <p className="text-white/75 mb-9" style={{ fontSize: "17px" }}>
          {reverseTrialCopyEnabled() ? REVERSE_TRIAL_LANDING.subtitle[lang] : COPY.cta.subtitle[lang]}
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <PublicStudyLink
            href={freeHref}
            className="lp-cta inline-flex items-center justify-center gap-2 bg-[var(--mp-accent-teal)] hover:brightness-110 text-[var(--mp-oxford-blue-dk)] font-extrabold px-8 py-4 rounded-xl transition-all shadow-xl hover:shadow-2xl hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[var(--mp-accent-teal)] focus:ring-offset-[var(--mp-oxford-blue-dk)]"
            style={{ fontSize: "16px" }}
          >
            {COPY.cta.button_free[lang]}
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </PublicStudyLink>
          <PublicStudyLink
            href={trialHref}
            className="inline-flex items-center justify-center gap-2 bg-transparent text-white border border-white/25 hover:border-white/60 hover:bg-white/5 font-semibold px-8 py-4 rounded-xl transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-white focus:ring-offset-[var(--mp-oxford-blue-dk)]"
            style={{ fontSize: "16px" }}
          >
            {reverseTrialCopyEnabled() ? REVERSE_TRIAL_LANDING.button[lang] : COPY.hero.cta_trial_second[lang]}
          </PublicStudyLink>
        </div>
        {reverseTrialCopyEnabled()
          ? <p className="mt-3 text-xs text-white/60 max-w-md mx-auto">{REVERSE_TRIAL_LANDING.terms[lang]}</p>
          : trialAvailable && <p className="mt-3 text-xs text-white/60 max-w-md mx-auto">{COPY.hero.cta_trial_terms[lang]}</p>}
        <p className="mt-5 text-xs text-white/50 flex items-center justify-center gap-2 flex-wrap">
          <Languages className="w-3.5 h-3.5" aria-hidden="true" />
          {COPY.cta.trust[lang]}
        </p>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────────────────────
   Footer — uses --mp-oxford-blue (lighter than the CTA band's -dk
   variant) so it reads as a distinct section. Dark wordmark.
   ───────────────────────────────────────────────────────────── */
function Footer({ lang, year }: { lang: Lang; year: number }) {
  return (
    <footer className="bg-[var(--mp-oxford-blue)] text-white pt-14 md:pt-16 pb-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-8 mb-10">
          <div className="md:col-span-2 sm:col-span-2">
            <div className="mb-4">
              <Wordmark variant="dark" height={24} />
            </div>
            <p className="text-sm text-white/70 leading-relaxed max-w-md">
              {COPY.footer.tagline[lang]}
            </p>
          </div>

          <div>
            <p
              className="lp-examtab text-white/50 mb-3"
              style={{ fontSize: "10.5px", letterSpacing: "0.14em" }}
            >
              {COPY.footer.product[lang]}
            </p>
            <ul className="space-y-2 text-sm text-white/80">
              <li>
                <a href="#how" className="hover:text-white transition-colors">
                  {COPY.nav.how[lang]}
                </a>
              </li>
              <li>
                <a href="#features" className="hover:text-white transition-colors">
                  {COPY.nav.features[lang]}
                </a>
              </li>
              <li>
                <Link href="/pricing" className="hover:text-white transition-colors">
                  {COPY.nav.pricing[lang]}
                </Link>
              </li>
              <li>
                <Link href="/faq" className="hover:text-white transition-colors">
                  FAQ
                </Link>
              </li>
              <li>
                <Link href="/changelog" className="hover:text-white transition-colors">
                  Changelog
                </Link>
              </li>
              <li>
                <Link href="/about" className="hover:text-white transition-colors">
                  {lang === "de" ? "Über uns" : "About"}
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p
              className="lp-examtab text-white/50 mb-3"
              style={{ fontSize: "10.5px", letterSpacing: "0.14em" }}
            >
              {lang === "de" ? "Prüfungen" : "Exams"}
            </p>
            <ul className="space-y-2 text-sm text-white/80">
              <li>
                <Link href="/kenntnispruefung-wien" className="hover:text-white transition-colors">
                  SIP4a / SIP5a Wien
                </Link>
              </li>
              <li>
                <Link href="/stichprobentest" className="hover:text-white transition-colors">
                  Stichprobentest (Innsbruck)
                </Link>
              </li>
              <li>
                <Link href="/pharmakologie-pruefung-wien" className="hover:text-white transition-colors">
                  Pharmakologie / Rezeptierkunde
                </Link>
              </li>
              <li>
                <Link href="/wien-route" className="hover:text-white transition-colors">
                  {lang === "de" ? "Prüfungsweg Wien" : "Vienna exam pathway"}
                </Link>
              </li>
              <li>
                <Link href="/blog" className="hover:text-white transition-colors">
                  Blog
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p
              className="lp-examtab text-white/50 mb-3"
              style={{ fontSize: "10.5px", letterSpacing: "0.14em" }}
            >
              {COPY.footer.orientation[lang]}
            </p>
            <ul className="space-y-2 text-sm text-white/80">
              {orientationLinks(["/materials"]).map((l) => (
                <li key={l.href}>
                  <Link href={withLang(l.href, lang)} className="hover:text-white transition-colors">
                    {l.label[lang]}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p
              className="lp-examtab text-white/50 mb-3"
              style={{ fontSize: "10.5px", letterSpacing: "0.14em" }}
            >
              {COPY.footer.legal[lang]}
            </p>
            <ul className="space-y-2 text-sm text-white/80">
              <li>
                <Link href="/privacy" className="hover:text-white transition-colors">
                  {lang === "de" ? "Datenschutz" : "Privacy"}
                </Link>
              </li>
              <li>
                <Link href="/terms" className="hover:text-white transition-colors">
                  {lang === "de" ? "AGB" : "Terms"}
                </Link>
              </li>
              <li>
                <Link href="/impressum" className="hover:text-white transition-colors">
                  Impressum
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="lp-ruler mb-6" aria-hidden="true" style={{ opacity: 0.4 }} />

        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 text-xs text-white/50">
          <p className="font-[var(--lp-mono)]" style={{ fontFamily: "var(--lp-mono)" }}>
            © {year} MedPrüf · [name]. {COPY.footer.rights[lang]}
          </p>
          <p className="flex items-center gap-2" style={{ fontFamily: "var(--lp-mono)" }}>
            <span>medpruf.com</span>
            <span aria-hidden="true">·</span>
            <a href="mailto:user-b7e46e80@example.com" className="hover:text-white transition-colors">
              user-b7e46e80@example.com
            </a>
            <span aria-hidden="true">·</span>
            <span>{COPY.footer.operator[lang]}</span>
          </p>
        </div>
      </div>
    </footer>
  );
}

/* a-pricing-v2: the v2 preview, same card anatomy as PricingPreview. */
function PricingPreviewV2({ lang, freeHref, v2Ready }: { lang: Lang; freeHref: string; v2Ready?: V2Readiness }) {
  const V2_PREVIEW = v2LandingPreview(v2Ready);
  const free = COPY.pricing.tiers[0];
  const cards = [
    { key: "free", name: free.name[lang], price: free.price, period: free.period[lang], pitch: free.pitch[lang], cta: free.cta[lang], href: freeHref, study: true },
    ...V2_PREVIEW.tiers.map((t) => ({ key: t.href + t.name.en, name: t.name[lang], price: t.price, period: t.period[lang], pitch: t.pitch[lang], cta: t.cta[lang], href: t.href, study: false })),
  ];
  return (
    <section id="pricing" className="py-20 md:py-24 bg-[var(--mp-surface-sunken)]">
      <div className="max-w-5xl mx-auto px-4 sm:px-6">
        <div className="mb-10 md:mb-12">
          <SectionHead index={COPY.pricing.index} eyebrow={COPY.pricing.eyebrow[lang]} title={V2_PREVIEW.title[lang]} subtitle={V2_PREVIEW.subtitle[lang]} />
        </div>
        <div className={`grid grid-cols-1 md:grid-cols-2 ${cards.length >= 4 ? "lg:grid-cols-4" : cards.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2"} gap-4 mb-8`} data-pricing-v2>
          {cards.map((c, i) => {
            const EntryLink = c.study ? PublicStudyLink : Link;
            return (
              <div key={c.key} className="lp-reveal lp-card p-6 relative flex flex-col" style={{ transitionDelay: `${i * 70}ms` }}>
                <h3 className="font-display font-bold text-[var(--mp-fg)] mb-1" style={{ fontSize: "18px" }}>{c.name}</h3>
                <div className="flex items-baseline gap-1.5 mb-4">
                  <span className="lp-figure text-[var(--mp-fg)]" style={{ fontSize: "34px" }}>{c.price}</span>
                  <span className="text-[var(--mp-fg-subtle)]" style={{ fontSize: "13px" }}>/ {c.period}</span>
                </div>
                <p className="text-[var(--mp-fg-muted)] flex-1 mb-5" style={{ fontSize: "14px" }}>{c.pitch}</p>
                <EntryLink href={c.href} className="mp-btn mp-btn--success w-full justify-center lp-cta">{c.cta}</EntryLink>
              </div>
            );
          })}
        </div>
        <div className="text-center">
          <Link href="/pricing" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-[var(--mp-accent-text)] hover:underline">{COPY.pricing.link[lang]}</Link>
        </div>
      </div>
    </section>
  );
}
