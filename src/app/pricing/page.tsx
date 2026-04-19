"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Crown,
  Users,
  Sparkles,
  ChevronDown,
} from "lucide-react";
import { getLang, setLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import { authFetch as fetch } from "@/lib/authFetch";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";
import { Dialog, TextField, useToast } from "@/components/ui";

type Lang = "de" | "en";
type WaitlistTier = "pro" | "group";

/**
 * /pricing — MPDS v2 "Pricing-B" redesign.
 *
 * Alternative picked: Featured Pro + slim secondary rows. Pro is THE
 * product (the revenue path), Free and Group are supporting cast. See
 * design-system/preview/alt-pricing.html for the visual spec.
 *
 * Layout:
 *   1. Hero — value claim + waitlist framing
 *   2. Pro card (featured, elevated, viridian accent) + Coming Soon badge
 *      → primary CTA opens MPDS <Dialog> with email <TextField>
 *   3. Free slim row — live, links to /login
 *   4. Group slim row — coming soon, same waitlist dialog, tier="group"
 *   5. FAQ/details — plain <details> blocks
 *   6. Final pro-waitlist CTA
 *
 * Price placeholder: "€15–30 / Monat" — TBD, [name] sets final before launch.
 */
export default function PricingPage() {
  const [lang, setLangState] = useState<Lang>("de");
  const [mounted, setMounted] = useState(false);
  const [session, setSession] = useState<ReturnType<typeof getStoredSession>>(null);

  // Waitlist dialog state (shared between Pro + Group + final CTA)
  const [waitOpen, setWaitOpen] = useState(false);
  const [waitTier, setWaitTier] = useState<WaitlistTier>("pro");
  const [email, setEmail] = useState("");
  const [emailErr, setEmailErr] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  useEffect(() => {
    setLangState(getLang());
    const s = getStoredSession();
    setSession(s);
    if (s?.user?.email) setEmail(s.user.email);
    setMounted(true);
  }, []);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  const openWaitlist = (tier: WaitlistTier) => {
    setWaitTier(tier);
    setEmailErr(undefined);
    setWaitOpen(true);
  };

  const submitWaitlist = async () => {
    const e = email.trim();
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      setEmailErr(
        lang === "de" ? "Bitte gültige E-Mail eingeben." : "Please enter a valid email."
      );
      return;
    }
    setEmailErr(undefined);
    setSubmitting(true);
    try {
      const r = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: e, tierInterest: waitTier }),
      });
      if (r.ok) {
        toast.success(
          lang === "de" ? "Du bist auf der Warteliste!" : "You're on the waitlist!",
          lang === "de"
            ? "Wir melden uns, sobald Pro startet."
            : "We'll reach out as soon as Pro launches."
        );
        setWaitOpen(false);
      } else {
        toast.error(
          lang === "de" ? "Konnte nicht eintragen" : "Could not sign up",
          lang === "de"
            ? "Bitte versuche es später nochmal."
            : "Please try again later."
        );
      }
    } catch {
      toast.error(
        lang === "de" ? "Netzwerkfehler" : "Network error",
        lang === "de" ? "Keine Verbindung zum Server." : "No connection to server."
      );
    }
    setSubmitting(false);
  };

  if (!mounted) {
    return <div className="min-h-screen bg-[var(--mp-surface-sunken)]" />;
  }

  const user = session?.user;
  const isPro = waitTier === "pro";

  /* Pro feature bullets — the "clinical expert" pitch */
  const proFeatures: Array<{ de: string; en: string }> = [
    {
      de: "Alle 10.993 Fragen ohne Limits",
      en: "All 10,993 questions, no limits",
    },
    {
      de: "Klinische KI-Erklärungen in 7 Sprachen (unbegrenzt)",
      en: "Clinical AI explanations in 7 languages (unlimited)",
    },
    {
      de: "Persönlicher Lernplan bis zum Prüfungsdatum",
      en: "Personal study plan up to your exam date",
    },
    {
      de: "Spaced-Repetition-Algorithmus (SM-2)",
      en: "Spaced-repetition algorithm (SM-2)",
    },
    {
      de: "Prüfungssimulation (4 Stunden, realistisch)",
      en: "Exam simulation (4 hours, realistic)",
    },
    {
      de: "Streak Freeze (einen Tag pro Woche)",
      en: "Streak Freeze (one day per week)",
    },
    {
      de: "Priorisierter Support",
      en: "Priority support",
    },
    {
      de: "Früher Zugang zu neuen Prüfungsmodulen (Zahnmedizin in Planung)",
      en: "Early access to new exam modules (dentistry in the pipeline)",
    },
  ];

  return (
    <div className="app-layout">
      <Sidebar lang={lang} userId={user?.id} userName={user?.first_name} />

      <main className="main-content safe-area-top safe-area-bottom bg-[var(--mp-surface-sunken)]">
        {/* ══════════ Header ══════════ */}
        <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between border-b border-[var(--mp-border)] bg-[var(--mp-surface-raised)]">
          <Link
            href={user ? "/" : "/landing"}
            className="flex items-center gap-1.5 text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-sm transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {lang === "de" ? "Zurück" : "Back"}
          </Link>
          <h1 className="text-base font-bold text-[var(--mp-fg)] flex items-center gap-2">
            <Crown className="w-4 h-4 text-[var(--mp-viridian)]" />
            {lang === "de" ? "Preise" : "Pricing"}
          </h1>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        {/* ══════════ Hero ══════════ */}
        <section className="max-w-5xl mx-auto px-4 lg:px-8 pt-12 pb-6 text-center">
          <span className="mp-caption inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[var(--mp-success-bg)] text-[var(--mp-viridian)] mb-5 normal-case tracking-[0.08em]">
            <Sparkles className="w-3.5 h-3.5" />
            {lang === "de" ? "Transparente Preise" : "Transparent pricing"}
          </span>
          <h2 className="mp-h1 mb-4 leading-[1.05]">
            {lang === "de"
              ? "Lerne jetzt. Bezahle, wenn es sich lohnt."
              : "Study now. Pay when it's worth it."}
          </h2>
          <p className="mp-body text-[var(--mp-fg-muted)] max-w-2xl mx-auto">
            {lang === "de"
              ? "Alle Funktionen kostenlos testen. Pro-Features kommen bald — trage dich in die Warteliste ein."
              : "Try every feature for free. Pro features are coming soon — join the waitlist."}
          </p>
        </section>

        {/* ══════════ Featured Pro Card + slim secondary rows ══════════ */}
        <section className="max-w-5xl mx-auto px-4 lg:px-8 pb-10">
          <ProFeaturedCard
            lang={lang}
            features={proFeatures}
            onWaitlist={() => openWaitlist("pro")}
          />

          <div className="mt-6 space-y-3">
            <FreeRow lang={lang} loggedIn={!!user} />
            <GroupRow lang={lang} onWaitlist={() => openWaitlist("group")} />
          </div>

          {/* Fine print */}
          <p className="text-center mp-small text-[var(--mp-fg-subtle)] mt-8">
            {lang === "de"
              ? "Preise in Euro, inkl. österreichischer USt. wo anwendbar. Kein Vertrag, jederzeit kündbar. Hosted in der EU."
              : "Prices in Euro, incl. Austrian VAT where applicable. No contract, cancel any time. Hosted in the EU."}
          </p>
        </section>

        {/* ══════════ FAQ ══════════ */}
        <section className="max-w-3xl mx-auto px-4 lg:px-8 pb-12">
          <h3 className="mp-h2 mb-5 text-center">
            {lang === "de" ? "Häufige Fragen" : "Common questions"}
          </h3>
          <div className="space-y-3">
            <FAQItem
              q={
                lang === "de"
                  ? "Muss ich Pro jetzt kaufen?"
                  : "Do I need to buy Pro now?"
              }
              a={
                lang === "de"
                  ? "Nein. Alles, was du für deine Prüfung brauchst, ist heute in der kostenlosen Version enthalten. Pro startet später als optionales Upgrade für Power-User."
                  : "No. Everything you need for your exam is currently in the free version. Pro will launch later as an optional upgrade for power users."
              }
            />
            <FAQItem
              q={lang === "de" ? "Was kostet es genau?" : "What exactly will Pro cost?"}
              a={
                lang === "de"
                  ? "Preisgestaltung: €15–30 / Monat (noch nicht final). Du zahlst nichts, bis Pro offiziell startet — Wartelisten-Mitglieder erhalten einen Einführungsrabatt."
                  : "Pricing: €15–30 / month (not yet final). You pay nothing until Pro officially launches — waitlist members get an introductory discount."
              }
            />
            <FAQItem
              q={lang === "de" ? "Kann ich kündigen?" : "Can I cancel?"}
              a={
                lang === "de"
                  ? "Jederzeit, mit einem Klick, ohne Begründung. Wir nutzen monatliche Abrechnung — kein langer Vertrag, kein Small Print."
                  : "Any time, one click, no explanation needed. We use monthly billing — no long-term contract, no small print."
              }
            />
            <FAQItem
              q={lang === "de" ? "Ist meine Zahlung sicher?" : "Is payment secure?"}
              a={
                lang === "de"
                  ? "Zahlung läuft über Stripe (in Vorbereitung). Wir speichern keine Kartendaten. Alle Transaktionen sind PCI-DSS-konform verschlüsselt."
                  : "Payments are processed through Stripe (in preparation). We never store your card data. All transactions are PCI-DSS-compliant encrypted."
              }
            />
            <FAQItem
              q={lang === "de" ? "Gibt es eine Rückerstattung?" : "Is there a refund?"}
              a={
                lang === "de"
                  ? "Ja — 14-tägige Rückerstattung ohne Rückfragen. Wenn Pro nicht das hält, was du dir vorgestellt hast, schreibst du uns an user-b7e46e80@example.com und das Geld ist am nächsten Werktag zurück."
                  : "Yes — 14-day no-questions-asked refund. If Pro isn't what you expected, email user-b7e46e80@example.com and your money will be back on the next business day."
              }
            />
            <FAQItem
              q={
                lang === "de"
                  ? "Ändert sich etwas am kostenlosen Zugang, wenn Pro startet?"
                  : "Will the free tier change when Pro launches?"
              }
              a={
                lang === "de"
                  ? "Der kostenlose Zugang bleibt erhalten — 200 Fragen + 1 vollständige Prüfung, keine Kreditkarte nötig. Pro schaltet lediglich zusätzliche Funktionen frei."
                  : "Free access stays — 200 questions + 1 full exam, no credit card required. Pro simply unlocks additional features."
              }
            />
          </div>
        </section>

        {/* ══════════ Final CTA ══════════ */}
        <section className="max-w-3xl mx-auto px-4 lg:px-8 pb-28">
          <div
            className="relative rounded-[var(--mp-r-card)] overflow-hidden p-8 md:p-10 text-center"
            style={{
              background:
                "linear-gradient(135deg, var(--mp-oxford-blue), var(--mp-cta-blue))",
              boxShadow: "var(--mp-shadow-elev)",
            }}
          >
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  "radial-gradient(circle at 85% 100%, rgba(0,168,150,0.28), transparent 60%)",
              }}
              aria-hidden
            />
            <div className="relative">
              <h3 className="mp-h2 text-white mb-3">
                {lang === "de"
                  ? "Sei der Erste, der Pro bekommt."
                  : "Be first in line for Pro."}
              </h3>
              <p className="mp-body text-white/80 max-w-xl mx-auto mb-6">
                {lang === "de"
                  ? "Warteliste-Mitglieder bekommen einen Einführungsrabatt und eine persönliche E-Mail, sobald Pro startet."
                  : "Waitlist members receive an introductory discount and a personal email as soon as Pro launches."}
              </p>
              <button
                type="button"
                onClick={() => openWaitlist("pro")}
                className="mp-btn mp-btn--lg inline-flex items-center gap-2"
                style={{
                  background: "var(--mp-accent-teal)",
                  color: "var(--mp-oxford-blue-dk)",
                }}
              >
                {lang === "de" ? "Auf die Pro-Warteliste" : "Join the Pro waitlist"}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </section>
      </main>

      <BottomNav lang={lang} userId={user?.id} />

      {/* ══════════ Waitlist dialog (shared) ══════════ */}
      <Dialog
        open={waitOpen}
        onOpenChange={setWaitOpen}
        title={
          isPro
            ? lang === "de"
              ? "Auf die Pro-Warteliste"
              : "Join the Pro waitlist"
            : lang === "de"
              ? "Auf die Gruppen-Warteliste"
              : "Join the Group waitlist"
        }
        description={
          isPro
            ? lang === "de"
              ? "Wir mailen dir, sobald Pro verfügbar ist — plus einen Einführungsrabatt."
              : "We'll email you as soon as Pro is live — plus an introductory discount."
            : lang === "de"
              ? "Wir melden uns mit Preisdetails für Teams und Lerngruppen."
              : "We'll reach out with pricing details for teams and study groups."
        }
        footer={
          <>
            <button
              type="button"
              className="mp-btn mp-btn--secondary"
              onClick={() => setWaitOpen(false)}
              disabled={submitting}
            >
              {lang === "de" ? "Abbrechen" : "Cancel"}
            </button>
            <button
              type="button"
              className="mp-btn mp-btn--success"
              onClick={submitWaitlist}
              disabled={submitting}
            >
              {submitting
                ? lang === "de"
                  ? "Senden…"
                  : "Sending…"
                : lang === "de"
                  ? "Auf die Warteliste"
                  : "Join waitlist"}
            </button>
          </>
        }
      >
        <TextField
          label={lang === "de" ? "Deine E-Mail" : "Your email"}
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="user-6e2c059a@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={emailErr}
          helper={
            lang === "de"
              ? "Wir mailen nur den Launch — kein Spam, keine Newsletter."
              : "We only email the launch — no spam, no newsletters."
          }
        />
      </Dialog>
    </div>
  );
}

/* ═══════════════════════ Featured Pro card ═══════════════════════ */

function ProFeaturedCard({
  lang,
  features,
  onWaitlist,
}: {
  lang: Lang;
  features: Array<{ de: string; en: string }>;
  onWaitlist: () => void;
}) {
  return (
    <article
      className="relative rounded-[var(--mp-r-card)] overflow-hidden"
      style={{
        background: "var(--mp-surface-raised)",
        border: "2px solid var(--mp-viridian)",
        boxShadow: "var(--mp-shadow-elev)",
      }}
    >
      {/* Soft viridian glow from top-right */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "radial-gradient(circle at 95% 0%, rgba(0,168,150,0.10), transparent 55%)",
        }}
        aria-hidden
      />

      {/* Coming Soon badge */}
      <div className="absolute top-5 right-5 z-10">
        <span
          className="mp-caption inline-flex items-center gap-1.5 px-3 py-1 rounded-full"
          style={{
            background: "rgba(0,168,150,0.12)",
            color: "var(--mp-accent-teal)",
            border: "1px solid rgba(0,168,150,0.28)",
            letterSpacing: "0.08em",
            fontSize: "10px",
          }}
        >
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: "var(--mp-accent-teal)" }}
            aria-hidden
          />
          {lang === "de" ? "Bald verfügbar" : "Coming soon"}
        </span>
      </div>

      <div className="relative p-6 md:p-8 grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-8 items-start">
        {/* LEFT: Title, description, feature list */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Crown className="w-5 h-5 text-[var(--mp-viridian)]" />
            <span className="mp-caption text-[var(--mp-viridian)] normal-case tracking-[0.12em]">
              {lang === "de" ? "Empfohlen" : "Recommended"}
            </span>
          </div>
          <h3 className="mp-h2 mb-3">MedPrüf Pro</h3>
          <p className="mp-body text-[var(--mp-fg-muted)] mb-6 max-w-xl">
            {lang === "de"
              ? "Alles, was du für die österreichische Kenntnisprüfung brauchst — klinische KI-Erklärungen, 4-Stunden-Simulation, persönlicher Lernplan, unbegrenzte Fragen."
              : "Everything you need for the Austrian Kenntnisprüfung — clinical AI explanations, 4-hour simulation, personal study plan, unlimited questions."}
          </p>

          <ul className="space-y-2.5">
            {features.map((f) => (
              <li key={f.en} className="flex items-start gap-2.5">
                <span
                  className="flex-shrink-0 mt-0.5 inline-flex items-center justify-center rounded-full"
                  style={{
                    width: "18px",
                    height: "18px",
                    background: "rgba(0,123,95,0.12)",
                    color: "var(--mp-viridian)",
                  }}
                  aria-hidden
                >
                  <Check className="w-3 h-3" strokeWidth={3} />
                </span>
                <span className="text-sm text-[var(--mp-fg)] leading-relaxed">
                  {f[lang]}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* RIGHT: Price + CTA — sticky-feeling column on desktop */}
        <div
          className="rounded-[12px] p-5 lg:sticky lg:top-4 flex flex-col gap-3"
          style={{
            background: "var(--mp-surface-sunken)",
            border: "1px solid var(--mp-border-subtle)",
          }}
        >
          <div>
            <div className="flex items-baseline gap-1.5">
              {/* TBD — [name] will set the final price before launch. Keep the
                  range here so waitlist members understand the direction. */}
              <span className="mp-num font-display font-black text-[var(--mp-fg)] text-[34px] leading-none">
                €15–30
              </span>
              <span className="text-sm text-[var(--mp-fg-muted)]">
                {lang === "de" ? "/ Monat" : "/ month"}
              </span>
            </div>
            <p className="mp-small text-[var(--mp-fg-subtle)] mt-2">
              {lang === "de"
                ? "Finaler Preis wird mit Launch bekanntgegeben. Wartelisten-Mitglieder erhalten einen Einführungsrabatt."
                : "Final price announced at launch. Waitlist members get an introductory discount."}
            </p>
          </div>

          <button
            type="button"
            onClick={onWaitlist}
            className="mp-btn mp-btn--success mp-btn--lg w-full inline-flex items-center justify-center gap-2"
          >
            {lang === "de" ? "Auf die Warteliste" : "Join waitlist"}
            <ArrowRight className="w-4 h-4" />
          </button>

          <p className="mp-small text-[var(--mp-fg-subtle)] text-center">
            {lang === "de"
              ? "Keine Zahlung heute. Jederzeit kündbar."
              : "No payment today. Cancel anytime."}
          </p>
        </div>
      </div>
    </article>
  );
}

/* ═══════════════════════ Free row (slim) ═══════════════════════ */

function FreeRow({ lang, loggedIn }: { lang: Lang; loggedIn: boolean }) {
  return (
    <div
      className="rounded-[var(--mp-r-card)] p-5 md:p-6 flex flex-col md:flex-row md:items-center gap-4 md:gap-6"
      style={{
        background: "var(--mp-surface-raised)",
        border: "1px solid var(--mp-border-subtle)",
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <Sparkles className="w-4 h-4 text-[var(--mp-viridian)]" />
          <h4 className="mp-h3 text-[18px]">Free</h4>
          <span
            className="mp-caption inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full normal-case tracking-[0.08em]"
            style={{
              background: "var(--mp-success-bg)",
              color: "var(--mp-viridian)",
              fontSize: "10px",
            }}
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: "var(--mp-viridian)" }}
              aria-hidden
            />
            {lang === "de" ? "Aktuell live" : "Live now"}
          </span>
        </div>
        <p className="text-sm text-[var(--mp-fg-muted)]">
          {lang === "de"
            ? "200 Fragen + 1 Prüfung gratis, kein Paywall aktiv. Nutze jetzt."
            : "200 questions + 1 exam free, no paywall enforced. Use it now."}
        </p>
      </div>

      <div className="flex items-center gap-3 md:gap-4 md:ml-auto">
        <div className="text-right">
          <div className="mp-num font-display font-black text-[var(--mp-fg)] text-[22px] leading-none">
            €0
          </div>
          <div className="mp-small text-[var(--mp-fg-subtle)]">
            {lang === "de" ? "/ immer" : "/ forever"}
          </div>
        </div>
        <Link
          href={loggedIn ? "/" : "/login"}
          className="mp-btn mp-btn--secondary inline-flex items-center gap-1.5 whitespace-nowrap"
        >
          {loggedIn
            ? lang === "de"
              ? "Zum Dashboard"
              : "Go to dashboard"
            : lang === "de"
              ? "Kostenlos starten"
              : "Start free"}
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}

/* ═══════════════════════ Group row (slim) ═══════════════════════ */

function GroupRow({
  lang,
  onWaitlist,
}: {
  lang: Lang;
  onWaitlist: () => void;
}) {
  return (
    <div
      className="rounded-[var(--mp-r-card)] p-5 md:p-6 flex flex-col md:flex-row md:items-center gap-4 md:gap-6"
      style={{
        background: "var(--mp-surface-raised)",
        border: "1px solid var(--mp-border-subtle)",
      }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1.5">
          <Users className="w-4 h-4 text-[var(--mp-info)]" />
          <h4 className="mp-h3 text-[18px]">Group</h4>
          <span
            className="mp-caption inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full normal-case tracking-[0.08em]"
            style={{
              background: "var(--mp-warning-bg)",
              color: "var(--mp-warning-dk)",
              fontSize: "10px",
            }}
          >
            <span
              className="inline-block w-1.5 h-1.5 rounded-full"
              style={{ background: "var(--mp-warning-dk)" }}
              aria-hidden
            />
            {lang === "de" ? "In Planung" : "Planned"}
          </span>
        </div>
        <p className="text-sm text-[var(--mp-fg-muted)]">
          {lang === "de"
            ? "Lernen mit deinen Kolleg:innen. Gemeinsame Statistiken, geteilte Fragensammlungen."
            : "Study with your colleagues. Shared stats, shared question collections."}
        </p>
      </div>

      <div className="flex items-center gap-3 md:gap-4 md:ml-auto">
        <div className="text-right">
          <div className="mp-num font-display font-black text-[var(--mp-fg)] text-[18px] leading-none">
            {lang === "de" ? "Ab €49" : "From €49"}
          </div>
          <div className="mp-small text-[var(--mp-fg-subtle)]">
            {lang === "de" ? "/ Team / Monat" : "/ team / month"}
          </div>
        </div>
        <button
          type="button"
          onClick={onWaitlist}
          className="mp-btn mp-btn--secondary inline-flex items-center gap-1.5 whitespace-nowrap"
        >
          {lang === "de" ? "Interesse zeigen" : "Show interest"}
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════ FAQ item ═══════════════════════ */

function FAQItem({ q, a }: { q: string; a: string }) {
  return (
    <details
      className="group rounded-[var(--mp-r-card)] overflow-hidden"
      style={{
        background: "var(--mp-surface-raised)",
        border: "1px solid var(--mp-border-subtle)",
      }}
    >
      <summary
        className="flex items-center justify-between gap-4 px-5 py-4 cursor-pointer list-none hover:bg-[var(--mp-surface-sunken)] transition-colors"
        style={{ userSelect: "none" }}
      >
        <span className="text-sm font-semibold text-[var(--mp-fg)] pr-2">{q}</span>
        <ChevronDown
          className="w-4 h-4 flex-shrink-0 text-[var(--mp-viridian)] transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="px-5 pb-5 -mt-1 text-sm text-[var(--mp-fg-muted)] leading-relaxed">
        {a}
      </div>
    </details>
  );
}
