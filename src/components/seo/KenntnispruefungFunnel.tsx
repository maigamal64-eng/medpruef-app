"use client";

import PublicStudyLink from "@/components/PublicStudyLink";
import FreeOfferDisclosure from "@/components/FreeOfferDisclosure";
import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { ArrowRight, Check, Globe, ShieldCheck, Sparkles } from "lucide-react";
import { getLang, setLang } from "@/lib/i18n";
import { trackFunnelIntent } from "@/lib/conversion-events";
import { trackFunnelEvent } from "@/lib/funnel-events";

/**
 * /kenntnispruefung-wien: high-intent paid-acquisition magnet.
 *
 * Single goal: send every visitor to the free registration flow
 * (`/login?mode=register`). The "free trial" in this product is the
 * free tier: no card, no Whop checkout: so the CTA is pure
 * registration, not a payment step.
 *
 * Bilingual DE/EN: every string has a DE + EN variant. The header
 * language toggle uses the same `setLang()` rail the rest of the app
 * uses and re-renders on the broadcast `medpruef-lang-change` event,
 * so the choice persists across navigation. The toggle NEVER
 * navigates, it stays on `/kenntnispruefung-wien` and only swaps the
 * visible strings.
 */

type Lang = "de" | "en";

const COPY = {
  navCta: { de: "Kostenlos registrieren", en: "Register for free" },
  navLogin: { de: "Einloggen", en: "Sign in" },
  eyebrow: { de: "Österreich · Wien · Kenntnisprüfung", en: "Austria · Vienna · Kenntnisprüfung" },
  heroTitle: {
    de: "Kenntnisprüfung Wien: klinisches Wissen üben.",
    en: "Kenntnisprüfung Vienna: practise clinical knowledge.",
  },
  heroSub: {
    de: "Trainiere klinisches Wissen, erkenne deine Lücken und lerne jeden Tag genau das, was dich der Prüfung näher bringt. Starte in unter 60 Sekunden: kostenlos und ohne Kreditkarte.",
    en: "Train your clinical knowledge, spot your weak spots, and study exactly what moves you closer to the exam every day. Start in under 60 seconds: free, no credit card.",
  },
  heroCta: {
    de: "Kostenlos registrieren und starten",
    en: "Register for free and start",
  },
  heroLogin: {
    de: "Du hast schon ein Konto? Einloggen",
    en: "Already have an account? Sign in",
  },
  trust: [
    { de: "150 Fragen gratis", en: "150 free questions" },
    { de: "Keine Kreditkarte", en: "No credit card" },
    { de: "Sofortiger Zugang", en: "Instant access" },
  ],
  stats: [
    ["7.500+", { de: "kuratierte Übungsfragen", en: "curated practice questions" }],
    ["10", { de: "Fachgebiete", en: "specialties" }],
    ["7+", { de: "Sprachen", en: "languages" }],
    ["24/7", { de: "verfügbar", en: "available" }],
  ],
  howEyebrow: { de: "WIE ES FUNKTIONIERT", en: "HOW IT WORKS" },
  howTitle: {
    de: "Drei Schritte. Keine Vorbereitungs-Orgie.",
    en: "Three steps. No all-nighter cramming.",
  },
  howLead: {
    de: "Wir wissen, wie groß der Berg wirkt. Deshalb führen wir dich vom ersten Login bis zum Prüfungstag, ohne Entscheidungsstress, ohne Marketing-Fallen.",
    en: "We know how big the mountain looks. So we guide you from first login to exam day, no decision fatigue, no marketing traps.",
  },
  steps: [
    {
      n: "1",
      title: { de: "Kostenlos registrieren", en: "Register for free" },
      detail: {
        de: "Nur E-Mail und Passwort. Keine Kreditkarte, kein Abo, keine Verpflichtung.",
        en: "Just an email and a password. No credit card, no subscription, no commitment.",
      },
    },
    {
      n: "2",
      title: { de: "Prüfungsdatum wählen", en: "Pick your exam date" },
      detail: {
        de: "Du sagst uns, wann deine Kenntnisprüfung stattfindet. Wir bauen deinen Plan.",
        en: "Tell us when your Kenntnisprüfung is. We build your study plan around it.",
      },
    },
    {
      n: "3",
      title: { de: "Jeden Tag 15–30 Minuten trainieren", en: "Practice 15–30 minutes a day" },
      detail: {
        de: "Tagesplan, Schwächen-Radar und 150 Gratisfragen zum direkten Einstieg.",
        en: "Daily plan, weakness radar and 150 free questions to start right away.",
      },
    },
  ],
  featuresEyebrow: { de: "WAS DU BEKOMMST", en: "WHAT YOU GET" },
  featuresTitle: {
    de: "Nicht einfach mehr lernen. Richtig lernen.",
    en: "Not just more studying. Right studying.",
  },
  featuresLead: {
    de: "MedPrüf zeigt dir deine Schwächen, erklärt dir das Warum und baut daraus eine tägliche Routine. So bleibt dein Fortschritt sichtbar und du weißt immer, was als Nächstes kommt.",
    en: "MedPrüf surfaces your weak spots, explains the why, and turns it into a daily routine. Your progress stays visible, so you always know what's next.",
  },
  featuresCta: { de: "Jetzt kostenlos starten", en: "Start for free now" },
  features: [
    {
      title: {
        de: "Klinische MCQ-Übungen aus der Wiener Bank",
        en: "Clinical MCQ practice from the Vienna bank",
      },
      detail: {
        de: "Über 7.500 kuratierte Multiple-Choice-Übungen mit SIP4a/SIP5a-Quellen. Keine Simulation der postgradualen ÖÄK-Arztprüfung Allgemeinmedizin.",
        en: "Over 7,500 curated multiple-choice exercises with SIP4a/SIP5a sources. Not a simulation of the postgraduate ÖÄK general medicine exam.",
      },
    },
    {
      title: {
        de: "Verständliche Erklärungen statt nur richtig/falsch",
        en: "Real explanations, not just right/wrong",
      },
      detail: {
        de: "Jede Antwort erklärt das Warum, mit Bezug auf ERC, ESC, ÖDG, Herold und Amboss.",
        en: "Every answer explains the why, citing ERC, ESC, ÖDG, Herold and Amboss.",
      },
    },
    {
      title: {
        de: "Spaced Repetition + persönlicher Lernplan",
        en: "Spaced repetition + a personal study plan",
      },
      detail: {
        de: "Du siehst täglich genau das, was du noch nicht sicher kannst, kein Stoff, den du schon beherrschst.",
        en: "You see exactly what you're not sure about every day, no re-drilling material you already know.",
      },
    },
  ],
  faqTitle: { de: "Häufige Fragen", en: "Frequently asked questions" },
  faqLead: {
    de: "Die drei Fragen, die uns am häufigsten gestellt werden.",
    en: "The three questions we get most often.",
  },
  faq: [
    {
      q: { de: "Muss ich für die Probephase zahlen?", en: "Do I need to pay for the trial?" },
      a: {
        de: "Nein. Du startest sofort mit 150 kostenlosen Fragen. Keine Kreditkarte, kein Whop-Checkout, keine versteckten Kosten.",
        en: "No. You start with 150 free questions immediately. No credit card, no Whop checkout, no hidden costs.",
      },
    },
    {
      q: {
        de: "Was übe ich in der Wiener Fragenbank?",
        en: "What do I practise in the Vienna question bank?",
      },
      a: {
        de: "Du übst klinisches Wissen mit SIP4a/SIP5a-basierten Multiple-Choice-Fragen. Diese universitären Quellen sind von der postgradualen ÖÄK-Arztprüfung Allgemeinmedizin zu unterscheiden. MedPrüf bildet offizielle Prüfungsformate und Bewertung nicht vollständig nach.",
        en: "You practise clinical knowledge with SIP4a/SIP5a-based multiple-choice questions. These university sources are distinct from the postgraduate ÖÄK general medicine exam. MedPrüf does not reproduce official exam formats and scoring in full.",
      },
    },
    {
      q: { de: "Was passiert nach den 150 Gratisfragen?", en: "What happens after the 150 free questions?" },
      a: {
        de: "Du entscheidest selbst, ob du den vollen Zugang willst. Du gehst keine Verpflichtung ein.",
        en: "You decide for yourself whether you want full access. You make no commitment.",
      },
    },
  ],
  finalTitle: {
    de: "Bereit für deinen ersten Schritt?",
    en: "Ready for your first step?",
  },
  finalLead: {
    de: "In unter 60 Sekunden bist du registriert und trainierst die ersten Fragen. Keine Kreditkarte, kein Abo, jederzeit löschbar.",
    en: "In under 60 seconds you're registered and training on the first questions. No credit card, no subscription, deletable anytime.",
  },
  finalCta: { de: "Kostenlos registrieren und starten", en: "Register for free and start" },
  finalNote: {
    de: "Funktioniert auf Handy und Desktop. Erklärungen auf Deutsch, Englisch, Arabisch, Russisch, Französisch, Türkisch, Ukrainisch, Serbisch.",
    en: "Works on phone and desktop. Explanations in German, English, Arabic, Russian, French, Turkish, Ukrainian, Serbian.",
  },
  langLabel: { de: "Sprache", en: "Language" },
} as const;

export default function KenntnispruefungFunnel() {
  const [lang, setLangState] = useState<Lang>("de");

  useEffect(() => {
    setLangState(getLang());
    const onLang = (event: Event) => {
      const next = (event as CustomEvent<"de" | "en">).detail;
      if (next === "de" || next === "en") setLangState(next);
    };
    window.addEventListener("medpruef-lang-change", onLang);
    return () => window.removeEventListener("medpruef-lang-change", onLang);
  }, []);

  useEffect(() => {
    trackFunnelEvent("landing_view", { exam: "kenntnispruefung" }, { once: true });
  }, []);

  function switchLang(next: Lang) {
    setLang(next);
    setLangState(next);
  }

  function fireIntent() {
    trackFunnelEvent("cta_click", { exam: "kenntnispruefung", cta: "register" });
    trackFunnelIntent("kenntnispruefung-wien-cta");
  }

  const L = lang;
  function pick(key: keyof typeof COPY): string {
    const value = COPY[key] as { readonly de: string; readonly en: string };
    return value[L];
  }

  return (
    <main className="min-h-screen bg-[var(--mp-surface-sunken)] text-[var(--mp-fg)]">
      <header className="border-b border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)]">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 lg:px-8">
          <Link href="/landing" className="flex items-center gap-2 font-display text-lg font-bold">
            <Image src="/brand/logomark.svg" width={28} height={28} alt="" aria-hidden />
            MedPrüf
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/pricing" className="inline-flex min-h-11 items-center text-sm underline">{L === "de" ? "Preise" : "Pricing"}</Link>
            <PublicStudyLink
              href="/quiz?examSource=kenntnispruefung&practiceMode=unseen"
              onClick={fireIntent}
              className="hidden text-sm font-semibold text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] sm:inline"
            >
              {COPY.navCta[L]}
            </PublicStudyLink>
            <Link
              href="/login?mode=login"
              className="rounded-lg border border-[var(--mp-border)] px-3 py-1.5 text-sm font-semibold hover:border-[var(--mp-viridian)]"
            >
              {COPY.navLogin[L]}
            </Link>
            <div
              className="flex items-center gap-1 rounded-lg border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] p-0.5 text-xs"
              role="group"
              aria-label={pick("langLabel")}
            >
              <Globe className="ml-1 h-3.5 w-3.5 text-[var(--mp-fg-subtle)]" aria-hidden />
              {(["de", "en"] as const).map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => switchLang(code)}
                  aria-pressed={L === code}
                  className={`min-h-[28px] rounded px-2.5 font-semibold transition-colors ${
                    L === code
                      ? "bg-[var(--mp-viridian)] text-white"
                      : "text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]"
                  }`}
                >
                  {code.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-[radial-gradient(circle_at_78%_18%,rgba(0,123,95,.18),transparent_34%),linear-gradient(135deg,rgba(0,58,140,.10),transparent_58%)]"
          aria-hidden
        />
        <div className="relative mx-auto max-w-5xl px-4 py-14 text-center lg:px-8 lg:py-20">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full bg-[var(--mp-success-bg)] px-3 py-1 text-xs font-bold uppercase tracking-wide text-[var(--mp-viridian)]">
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            {COPY.eyebrow[L]}
          </p>
          <h1 className="mp-h1 mx-auto max-w-3xl text-[40px] leading-[1.04] sm:text-[54px] lg:text-[64px]">
            {COPY.heroTitle[L]}
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[var(--mp-fg-muted)]">
            {COPY.heroSub[L]}
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <PublicStudyLink
              href="/quiz?examSource=kenntnispruefung&practiceMode=unseen"
              onClick={fireIntent}
              className="mp-btn mp-btn--success inline-flex min-h-[56px] items-center gap-2 px-8 text-base font-bold shadow-[0_10px_30px_rgba(0,123,95,.25)]"
            >
              {COPY.heroCta[L]}
              <ArrowRight className="h-5 w-5" aria-hidden />
            </PublicStudyLink>
            <Link
              href="/login?mode=login"
              onClick={fireIntent}
              className="text-sm font-semibold text-[var(--mp-fg-muted)] underline-offset-4 hover:text-[var(--mp-fg)] hover:underline"
            >
              {COPY.heroLogin[L]}
            </Link>
          </div>

          <ul className="mx-auto mt-7 flex max-w-xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm font-semibold text-[var(--mp-fg-muted)]">
            {COPY.trust.map((item) => (
              <li key={item.de} className="flex items-center gap-2">
                <Check className="h-4 w-4 text-[var(--mp-viridian)]" aria-hidden />
                {item[L]}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16 lg:px-8">
        <div className="grid gap-4 sm:grid-cols-4">
          {COPY.stats.map(([value, label]) => (
            <div
              key={value}
              className="rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-5 text-left"
            >
              <p className="font-display text-3xl font-bold">{value}</p>
              <p className="mt-1 text-sm text-[var(--mp-fg-muted)]">{label[L]}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16 lg:px-8" aria-labelledby="wien-registration-heading">
        <div className="rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-6">
          <h2 id="wien-registration-heading" className="font-display text-xl font-bold">
            {L === "de" ? "Anmeldung an der MedUni Wien" : "Registering at MedUni Vienna"}
          </h2>
          <p className="mt-2 text-sm text-[var(--mp-fg-muted)]">
            {L === "de"
              ? "Anmeldefristen, Formulare und Regeln für SIP4a, SIP5a, Rezeptierkunde und Gerichtsmedizin, jeweils mit offizieller Quelle und Prüfdatum."
              : "Registration deadlines, forms and rules for SIP4a, SIP5a, Rezeptierkunde and Gerichtsmedizin, each with its official source and check date."}
          </p>
          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm font-semibold">
            <Link href="/wien-route/sip-anmeldung" className="text-[var(--mp-viridian)] underline-offset-4 hover:underline">
              {L === "de" ? "SIP4a und SIP5a anmelden" : "Register for SIP4a and SIP5a"}
            </Link>
            <Link href="/wien-route" className="text-[var(--mp-viridian)] underline-offset-4 hover:underline">
              {L === "de" ? "Prüfungsweg Wien" : "Vienna exam pathway"}
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16 lg:px-8">
        <div className="grid gap-10 md:grid-cols-2 md:items-center">
          <div>
            <p className="text-sm font-bold text-[var(--mp-viridian)]">{COPY.howEyebrow[L]}</p>
            <h2 className="mp-h2 mt-3 text-3xl">{COPY.howTitle[L]}</h2>
            <p className="mt-4 leading-relaxed text-[var(--mp-fg-muted)]">{COPY.howLead[L]}</p>
          </div>
          <ol className="space-y-4">
            {COPY.steps.map((step) => (
              <li
                key={step.n}
                className="flex gap-4 rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-5"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--mp-success-bg)] font-display text-lg font-bold text-[var(--mp-viridian)]">
                  {step.n}
                </span>
                <div>
                  <p className="text-base font-bold">{step.title[L]}</p>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--mp-fg-muted)]">{step.detail[L]}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16 lg:px-8">
        <div className="rounded-[28px] border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-6 sm:p-10">
          <div className="grid gap-10 md:grid-cols-2 md:items-center">
            <div>
              <p className="text-sm font-bold text-[var(--mp-viridian)]">{COPY.featuresEyebrow[L]}</p>
              <h2 className="mp-h2 mt-3 text-3xl">{COPY.featuresTitle[L]}</h2>
              <p className="mt-4 leading-relaxed text-[var(--mp-fg-muted)]">{COPY.featuresLead[L]}</p>
              <PublicStudyLink
                href="/quiz?examSource=kenntnispruefung&practiceMode=unseen"
                onClick={fireIntent}
                className="mp-btn mp-btn--primary mt-6 inline-flex min-h-[50px] items-center gap-2 px-6"
              >
                {COPY.featuresCta[L]}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </PublicStudyLink>
            </div>
            <ul className="space-y-3">
              {COPY.features.map((feature) => (
                <li
                  key={feature.title.de}
                  className="flex gap-3 rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-sunken)] p-4"
                >
                  <ShieldCheck className="h-5 w-5 shrink-0 text-[var(--mp-viridian)]" aria-hidden />
                  <div>
                    <p className="text-sm font-bold">{feature.title[L]}</p>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--mp-fg-muted)]">{feature.detail[L]}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 pb-16 lg:px-8">
        <h2 className="mp-h2 text-3xl">{COPY.faqTitle[L]}</h2>
        <p className="mt-2 text-sm text-[var(--mp-fg-muted)]">{COPY.faqLead[L]}</p>
        <div className="mt-6 space-y-3">
          {COPY.faq.map((item) => (
            <details
              key={item.q.de}
              className="rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-5 [&_summary]:cursor-pointer [&_summary]:list-none"
            >
              <summary className="text-base font-semibold">{item.q[L]}</summary>
              <p className="mt-3 text-sm leading-relaxed text-[var(--mp-fg-muted)]">{item.a[L]}</p>
            </details>
          ))}
        </div>
        <a href="https://www.meduniwien.ac.at/web/en/studium-weiterbildung/nostrifizierung/pruefungen/" target="_blank" rel="noopener noreferrer" className="mt-5 inline-block text-sm text-[var(--mp-viridian)] hover:underline">
          {L === "de" ? "MedUni Wien: universitäre Prüfungsinformationen" : "MedUni Vienna: university exam information"}
        </a>
        <FreeOfferDisclosure lang={L} className="mt-4" />
      </section>

      <section className="mx-auto max-w-4xl px-4 pb-24 text-center lg:px-8">
        <h2 className="mp-h2 text-[32px] sm:text-[40px]">{COPY.finalTitle[L]}</h2>
        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-[var(--mp-fg-muted)]">{COPY.finalLead[L]}</p>
        <PublicStudyLink
          href="/quiz?examSource=kenntnispruefung&practiceMode=unseen"
          onClick={fireIntent}
          className="mp-btn mp-btn--success mt-6 inline-flex min-h-[56px] items-center gap-2 px-8 text-base font-bold shadow-[0_10px_30px_rgba(0,123,95,.25)]"
        >
          {COPY.finalCta[L]}
          <ArrowRight className="h-5 w-5" aria-hidden />
        </PublicStudyLink>
        <p className="mt-3 text-xs text-[var(--mp-fg-subtle)]">{COPY.finalNote[L]}</p>
      </section>
    <div className="max-w-5xl mx-auto px-4 pb-8"><FreeOfferDisclosure lang={L} /></div>
    </main>
  );
}
