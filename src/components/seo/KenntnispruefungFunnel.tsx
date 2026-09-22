"use client";

import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Check, ShieldCheck, Sparkles } from "lucide-react";
import { trackFunnelIntent } from "@/lib/conversion-events";

/**
 * /kenntnispruefung-wien — high-intent paid-acquisition magnet.
 *
 * Single goal: send every visitor to the free registration flow
 * (`/login?mode=register`). The "free trial" in this product is the
 * free tier — no card, no Whop checkout — so the CTA is pure
 * registration, not a payment step.
 *
 * Tracking (all consent-gated via existing root-layout pixels):
 *   - Reddit Pixel PageVisit is fired automatically by
 *     ConsentGatedRedditPixel when the visitor accepts cookies
 *     (NEXT_PUBLIC_REDDIT_PIXEL_ID env-gated).
 *   - GA4 + Clarity load on the same accept (ConsentGatedAnalytics).
 *   - CTA click fires `trackFunnelIntent` → Meta Lead +
 *     GA4 generate_lead + Reddit Lead, so the ad-platform optimizers
 *     see intent even if the visitor bounces before completing the
 *     register form (which itself fires `trackRegistration` →
 *     CompleteRegistration / sign_up / SignUp).
 *   - First-touch attribution (utm_* + rdt_cid) is captured by the
 *     root-layout AttributionCapture and forwarded to /api/auth
 *     server-side, so a Reddit-attributed signup is queryable in our
 *     own DB, not only in Reddit Ads Manager.
 */

const FEATURES = [
  { title: "Fragen, die zur Wiener Prüfung passen", detail: "7.566 klinische MCQs aus den 10 prüfungsrelevanten Fachgebieten — nicht irgendein Medizin-Allgemein-Pool." },
  { title: "Verständliche Erklärungen statt nur richtig/falsch", detail: "Jede Antwort erklärt das Warum, mit Bezug auf ERC, ESC, ÖDG, Herold und Amboss." },
  { title: "Spaced Repetition + persönlicher Lernplan", detail: "Du siehst täglich genau das, was du noch nicht sicher kannst — kein Stoff, den du schon beherrschst." },
];

const STEPS = [
  { n: "1", title: "Kostenlos registrieren", detail: "Nur E-Mail und Passwort. Keine Kreditkarte, kein Abo, keine Verpflichtung." },
  { n: "2", title: "Prüfungsdatum wählen", detail: "Du sagst uns, wann deine Kenntnisprüfung stattfindet. Wir bauen deinen Plan." },
  { n: "3", title: "Jeden Tag 15–30 Minuten trainieren", detail: "Tagesplan, Schwächen-Radar und 150 Gratisfragen zum direkten Einstieg." },
];

const FAQ = [
  { q: "Muss ich für die Probephase zahlen?", a: "Nein. Du startest sofort mit 150 kostenlosen Fragen. Keine Kreditkarte, kein Whop-Checkout, keine versteckten Kosten." },
  { q: "Bereitet mich MedPrüf auf die echte Prüfung vor?", a: "Die Kenntnisprüfung Wien ist problemorientiert und arbeitet mit offenen Kurzantwortfragen. Wir trainieren dein klinisches Wissen dafür — und sagen das transparent, statt eine 1:1-Prüfungssimulation vorzuspielen." },
  { q: "Was passiert nach den 150 Gratisfragen?", a: "Du entscheidest selbst, ob du den vollen Zugang willst. Du gehst keine Verpflichtung ein." },
];

export default function KenntnispruefungFunnel() {
  function fireIntent() {
    trackFunnelIntent("kenntnispruefung-wien-cta");
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
            <Link
              href="/login?mode=register"
              onClick={fireIntent}
              className="hidden text-sm font-semibold text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)] sm:inline"
            >
              Kostenlos registrieren
            </Link>
            <Link
              href="/login"
              className="rounded-lg border border-[var(--mp-border)] px-3 py-1.5 text-sm font-semibold hover:border-[var(--mp-viridian)]"
            >
              Einloggen
            </Link>
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
            Österreich · Wien · Kenntnisprüfung
          </p>
          <h1 className="mp-h1 mx-auto max-w-3xl text-[40px] leading-[1.04] sm:text-[54px] lg:text-[64px]">
            Bestehe die Kenntnisprüfung Wien mit einem klaren Plan.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-[var(--mp-fg-muted)]">
            Trainiere klinisches Wissen, erkenne deine Lücken und lerne jeden Tag genau das, was dich der Prüfung näher bringt.
            Starte in unter 60 Sekunden — kostenlos und ohne Kreditkarte.
          </p>

          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/login?mode=register"
              onClick={fireIntent}
              className="mp-btn mp-btn--success inline-flex min-h-[56px] items-center gap-2 px-8 text-base font-bold shadow-[0_10px_30px_rgba(0,123,95,.25)]"
            >
              Kostenlos registrieren und starten
              <ArrowRight className="h-5 w-5" aria-hidden />
            </Link>
            <Link
              href="/login"
              onClick={fireIntent}
              className="text-sm font-semibold text-[var(--mp-fg-muted)] underline-offset-4 hover:text-[var(--mp-fg)] hover:underline"
            >
              Du hast schon ein Konto? Einloggen
            </Link>
          </div>

          <ul className="mx-auto mt-7 flex max-w-xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm font-semibold text-[var(--mp-fg-muted)]">
            <li className="flex items-center gap-2"><Check className="h-4 w-4 text-[var(--mp-viridian)]" aria-hidden /> 150 Fragen gratis</li>
            <li className="flex items-center gap-2"><Check className="h-4 w-4 text-[var(--mp-viridian)]" aria-hidden /> Keine Kreditkarte</li>
            <li className="flex items-center gap-2"><Check className="h-4 w-4 text-[var(--mp-viridian)]" aria-hidden /> Sofortiger Zugang</li>
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16 lg:px-8">
        <div className="grid gap-4 sm:grid-cols-4">
          {[
            ["7.566", "klinische Fragen"],
            ["10", "Fachgebiete"],
            ["7+", "Sprachen"],
            ["24/7", "verfügbar"],
          ].map(([value, label]) => (
            <div
              key={label}
              className="rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-5 text-left"
            >
              <p className="font-display text-3xl font-bold">{value}</p>
              <p className="mt-1 text-sm text-[var(--mp-fg-muted)]">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16 lg:px-8">
        <div className="grid gap-10 md:grid-cols-2 md:items-center">
          <div>
            <p className="text-sm font-bold text-[var(--mp-viridian)]">WIE ES FUNKTIONIERT</p>
            <h2 className="mp-h2 mt-3 text-3xl">Drei Schritte. Keine Vorbereitungs-Orgie.</h2>
            <p className="mt-4 leading-relaxed text-[var(--mp-fg-muted)]">
              Wir wissen, wie groß der Berg wirkt. Deshalb führen wir dich vom ersten Login bis zum Prüfungstag — ohne Entscheidungsstress, ohne Marketing-Fallen.
            </p>
          </div>
          <ol className="space-y-4">
            {STEPS.map((step) => (
              <li
                key={step.n}
                className="flex gap-4 rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-5"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--mp-success-bg)] font-display text-lg font-bold text-[var(--mp-viridian)]">
                  {step.n}
                </span>
                <div>
                  <p className="text-base font-bold">{step.title}</p>
                  <p className="mt-1 text-sm leading-relaxed text-[var(--mp-fg-muted)]">{step.detail}</p>
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
              <p className="text-sm font-bold text-[var(--mp-viridian)]">WAS DU BEKOMMST</p>
              <h2 className="mp-h2 mt-3 text-3xl">Nicht einfach mehr lernen. Richtig lernen.</h2>
              <p className="mt-4 leading-relaxed text-[var(--mp-fg-muted)]">
                MedPrüf zeigt dir deine Schwächen, erklärt dir das Warum und baut daraus eine tägliche Routine.
                So bleibt dein Fortschritt sichtbar und du weißt immer, was als Nächstes kommt.
              </p>
              <Link
                href="/login?mode=register"
                onClick={fireIntent}
                className="mp-btn mp-btn--primary mt-6 inline-flex min-h-[50px] items-center gap-2 px-6"
              >
                Jetzt kostenlos starten
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </div>
            <ul className="space-y-3">
              {FEATURES.map((feature) => (
                <li
                  key={feature.title}
                  className="flex gap-3 rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-sunken)] p-4"
                >
                  <ShieldCheck className="h-5 w-5 shrink-0 text-[var(--mp-viridian)]" aria-hidden />
                  <div>
                    <p className="text-sm font-bold">{feature.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--mp-fg-muted)]">{feature.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 pb-16 lg:px-8">
        <h2 className="mp-h2 text-3xl">Häufige Fragen</h2>
        <p className="mt-2 text-sm text-[var(--mp-fg-muted)]">Die drei Fragen, die uns am häufigsten gestellt werden.</p>
        <div className="mt-6 space-y-3">
          {FAQ.map((item) => (
            <details
              key={item.q}
              className="rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-5 [&_summary]:cursor-pointer [&_summary]:list-none"
            >
              <summary className="text-base font-semibold">{item.q}</summary>
              <p className="mt-3 text-sm leading-relaxed text-[var(--mp-fg-muted)]">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-4 pb-24 text-center lg:px-8">
        <h2 className="mp-h2 text-[32px] sm:text-[40px]">Bereit für deinen ersten Schritt?</h2>
        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-[var(--mp-fg-muted)]">
          In unter 60 Sekunden bist du registriert und trainierst die ersten Fragen. Keine Kreditkarte, kein Abo, jederzeit löschbar.
        </p>
        <Link
          href="/login?mode=register"
          onClick={fireIntent}
          className="mp-btn mp-btn--success mt-6 inline-flex min-h-[56px] items-center gap-2 px-8 text-base font-bold shadow-[0_10px_30px_rgba(0,123,95,.25)]"
        >
          Kostenlos registrieren und starten
          <ArrowRight className="h-5 w-5" aria-hidden />
        </Link>
        <p className="mt-3 text-xs text-[var(--mp-fg-subtle)]">
          Funktioniert auf Handy und Desktop. Erklärungen auf Deutsch, Englisch, Arabisch, Russisch, Französisch, Türkisch, Ukrainisch, Serbisch.
        </p>
      </section>
    </main>
  );
}
