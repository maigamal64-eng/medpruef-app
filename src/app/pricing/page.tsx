"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Sparkles,
  Users,
  Crown,
  Clock,
  Send,
} from "lucide-react";
import { getLang, setLang } from "@/lib/i18n";
import { getStoredSession } from "@/lib/auth";
import { authFetch as fetch } from "@/lib/authFetch";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import LanguageToggle from "@/components/LanguageToggle";
import ThemeToggle from "@/components/ThemeToggle";

type Lang = "de" | "en";
type TierInterest = "pro" | "group";

/**
 * /pricing — public pricing page.
 *
 * Context: Abobaker asked what Pro costs and how to get it. There was
 * no pricing visibility inside the app, only on the marketing landing
 * page. This page is reachable from Sidebar → Preise, Settings →
 * Konto section, and the landing footer. Open to logged-out visitors
 * (auth layout still shows Sidebar + BottomNav when logged in).
 *
 * Tiers:
 *   - Free (current)          — live, links to /login
 *   - Pro (coming soon)       — waitlist signup
 *   - Group (coming soon)     — waitlist signup
 *
 * Waitlist signups POST to /api/waitlist with email + tier.
 */
export default function PricingPage() {
  const [lang, setLangState] = useState<Lang>("de");
  const [mounted, setMounted] = useState(false);
  const [session, setSession] = useState<ReturnType<typeof getStoredSession>>(null);

  useEffect(() => {
    setLangState(getLang());
    setSession(getStoredSession());
    setMounted(true);
  }, []);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  if (!mounted) {
    return <div className="min-h-screen bg-[#F7F9FC]" />;
  }

  const user = session?.user;

  return (
    <div className="app-layout">
      <Sidebar lang={lang} userId={user?.id} userName={user?.first_name} />

      <main className="main-content safe-area-top safe-area-bottom bg-[#F7F9FC]">
        {/* Header */}
        <div className="px-4 lg:px-8 pt-4 pb-2 flex items-center justify-between border-b border-[#E4E9F0]">
          <Link
            href={user ? "/" : "/landing"}
            className="flex items-center gap-1.5 text-[#A0AEC0] hover:text-[#1A2B3C] text-sm transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {lang === "de" ? "Zurück" : "Back"}
          </Link>
          <h1 className="text-base font-bold text-[#1A2B3C] flex items-center gap-2">
            <Crown className="w-4 h-4 text-[#007B5F]" />
            {lang === "de" ? "Preise" : "Pricing"}
          </h1>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <LanguageToggle lang={lang} onChange={switchLang} />
          </div>
        </div>

        {/* Hero */}
        <div className="max-w-5xl mx-auto px-4 lg:px-8 pt-8 pb-4 text-center">
          <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#007B5F]/10 text-[#007B5F] text-xs font-semibold mb-4">
            <Sparkles className="w-3.5 h-3.5" />
            {lang === "de" ? "Transparente Preise" : "Transparent pricing"}
          </span>
          <h2 className="text-3xl md:text-4xl font-black text-[#1A2B3C] font-display mb-3 leading-tight">
            {lang === "de" ? "Lerne jetzt. Bezahle, wenn es sich lohnt." : "Study now. Pay when it's worth it."}
          </h2>
          <p className="text-sm md:text-base text-[#4A5568] max-w-2xl mx-auto leading-relaxed">
            {lang === "de"
              ? "MedPrüf ist heute komplett kostenlos. Pro und Gruppentarife kommen bald — melde dich vor, und wir benachrichtigen dich mit den endgültigen Preisen."
              : "MedPrüf is fully free today. Pro and Group plans are coming soon — sign up now and we'll notify you with the final pricing."}
          </p>
        </div>

        {/* Tiers */}
        <div className="max-w-6xl mx-auto px-4 lg:px-8 py-6 pb-28">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-5">
            <FreeTier lang={lang} loggedIn={!!user} />
            <ProTier lang={lang} userId={user?.id} userEmail={user?.email} />
            <GroupTier lang={lang} userId={user?.id} userEmail={user?.email} />
          </div>

          {/* FAQ-lite */}
          <div className="mt-10 max-w-3xl mx-auto">
            <h3 className="text-lg font-bold text-[#1A2B3C] mb-4 font-display">
              {lang === "de" ? "Häufige Fragen" : "Common questions"}
            </h3>
            <div className="space-y-3">
              <FAQRow
                q={
                  lang === "de"
                    ? "Was bekomme ich heute, kostenlos?"
                    : "What do I get for free today?"
                }
                a={
                  lang === "de"
                    ? "Zugriff auf alle 10.993 Fragen (Kenntnisprüfung Wien, KMP Innsbruck, Pharmakologie), Quiz- und Karteikartenmodus, Fortschrittstracking, Prüfungssimulation und PWA-Installation. Keine Kreditkarte nötig."
                    : "Access to all 10,993 questions (Kenntnisprüfung Vienna, KMP Innsbruck, Pharmakologie), quiz + flashcard modes, progress tracking, exam simulation, and PWA install. No credit card required."
                }
              />
              <FAQRow
                q={lang === "de" ? "Wann kommt Pro?" : "When does Pro launch?"}
                a={
                  lang === "de"
                    ? "Wir zielen auf Q2/Q3 2026. Trag dich ein — du bekommst den endgültigen Preis und den Launch-Termin per E-Mail, bevor wir es öffentlich ankündigen."
                    : "We're targeting Q2/Q3 2026. Sign up — you'll receive final pricing and the launch date by email before we announce publicly."
                }
              />
              <FAQRow
                q={lang === "de" ? "Was ist der Gruppentarif?" : "What is the Group plan?"}
                a={
                  lang === "de"
                    ? "Für Krankenhäuser, Lerngruppen oder Kliniken, die 5+ Lizenzen brauchen. Geteiltes Fortschritts-Dashboard, Rabatt und persönlicher Onboarding-Support."
                    : "For hospitals, study groups, or clinics that need 5+ licenses. Shared progress dashboard, volume discount, and personal onboarding support."
                }
              />
              <FAQRow
                q={
                  lang === "de"
                    ? "Ändert sich etwas für mich, wenn Pro kommt?"
                    : "Will anything change for me when Pro launches?"
                }
                a={
                  lang === "de"
                    ? "Nein. Der kostenlose Zugang bleibt erhalten. Pro wird nur neue Funktionen freischalten (erweiterter KI-Chat, Offline-Modus, unbegrenzte Simulationen)."
                    : "No. Your free access stays. Pro only unlocks new features (extended AI chat, offline mode, unlimited simulations)."
                }
              />
            </div>
          </div>

          {/* Fine print */}
          <p className="text-center text-xs text-[#A0AEC0] mt-10">
            {lang === "de"
              ? "Preise in Euro, inkl. österreichischer USt. wo anwendbar. Kein Vertrag, jederzeit kündbar. Hosted in der EU."
              : "Prices in Euro, incl. Austrian VAT where applicable. No contract, cancel any time. Hosted in the EU."}
          </p>
        </div>
      </main>

      <BottomNav lang={lang} userId={user?.id} />
    </div>
  );
}

/* ═════════════════════════ Tier cards ═════════════════════════ */

function FreeTier({ lang, loggedIn }: { lang: Lang; loggedIn: boolean }) {
  const features = [
    {
      de: "Zugriff auf alle 10.993 Fragen (3 Prüfungstypen)",
      en: "Access to all 10,993 questions (3 exam types)",
    },
    { de: "Quiz- und Karteikartenmodus", en: "Quiz and flashcard modes" },
    { de: "Fortschrittstracking + Schwächen-Analyse", en: "Progress tracking + weakness analytics" },
    { de: "Gespeicherte KI-Erklärungen", en: "Cached AI explanations" },
    { de: "Prüfungssimulation", en: "Exam simulation" },
    { de: "PWA: als App installierbar, offline-fähig", en: "PWA: installable app, works offline" },
  ];

  return (
    <div className="relative rounded-2xl border-2 border-[#E4E9F0] bg-white p-6 flex flex-col h-full transition-all hover:border-[#007B5F]/40 hover:shadow-lg">
      <div className="absolute -top-3 left-6 bg-[#007B5F] text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full shadow">
        {lang === "de" ? "Aktuell" : "Current"}
      </div>
      <div className="flex items-center gap-2 mb-2">
        <Sparkles className="w-5 h-5 text-[#007B5F]" />
        <h3 className="text-xl font-bold text-[#1A2B3C] font-display">
          {lang === "de" ? "Kostenlos" : "Free"}
        </h3>
      </div>
      <p className="text-xs text-[#A0AEC0] mb-4">
        {lang === "de" ? "Für alle, die jetzt anfangen wollen." : "For anyone starting today."}
      </p>

      <div className="flex items-baseline gap-1 mb-5">
        <span className="text-4xl font-black font-display text-[#1A2B3C]">€0</span>
        <span className="text-sm text-[#A0AEC0]">{lang === "de" ? "/ immer" : "/ forever"}</span>
      </div>

      <ul className="space-y-2 mb-6 flex-1">
        {features.map((f) => (
          <li key={f.en} className="flex items-start gap-2 text-sm text-[#4A5568]">
            <Check className="w-4 h-4 text-[#007B5F] flex-shrink-0 mt-0.5" />
            <span>{f[lang]}</span>
          </li>
        ))}
      </ul>

      <Link
        href={loggedIn ? "/" : "/login"}
        className="block text-center py-3 rounded-xl font-semibold text-sm bg-[#F7F9FC] hover:bg-[#E4E9F0] text-[#1A2B3C] border border-[#E4E9F0] transition-colors"
      >
        {loggedIn
          ? lang === "de"
            ? "Zum Dashboard"
            : "Go to dashboard"
          : lang === "de"
            ? "Kostenlos starten"
            : "Start free"}
      </Link>
    </div>
  );
}

function ProTier({
  lang,
  userId,
  userEmail,
}: {
  lang: Lang;
  userId?: string;
  userEmail?: string;
}) {
  const features = [
    {
      de: "Erweiterter KI-Chat — 50 eigene Fragen pro Tag",
      en: "Extended AI chat — 50 custom follow-ups per day",
    },
    { de: "Unbegrenzte Prüfungssimulationen", en: "Unlimited exam simulations" },
    { de: "Streak-Schutz (Freeze Tokens)", en: "Streak freeze tokens" },
    {
      de: "Offline-Modus (sobald veröffentlicht)",
      en: "Offline mode (when shipped)",
    },
    { de: "Prioritäts-Support per E-Mail", en: "Priority email support" },
    {
      de: "Alle zukünftigen Pro-Funktionen inklusive",
      en: "All future Pro features included",
    },
  ];

  return (
    <TierCard
      lang={lang}
      tier="pro"
      icon={<Crown className="w-5 h-5 text-[#00A896]" />}
      name={{ de: "Pro", en: "Pro" }}
      tagline={{
        de: "Für den ernsthaften Prüfungs-Endspurt.",
        en: "For the serious exam run-up.",
      }}
      priceLine={{
        de: "Bald verfügbar",
        en: "Coming soon",
      }}
      priceHint={{
        de: "ab ~€15/Monat — finaler Preis wird kommuniziert",
        en: "from ~€15/month — final pricing TBC",
      }}
      features={features}
      highlight
      userId={userId}
      userEmail={userEmail}
    />
  );
}

function GroupTier({
  lang,
  userId,
  userEmail,
}: {
  lang: Lang;
  userId?: string;
  userEmail?: string;
}) {
  const features = [
    { de: "Ab 5 Nutzer:innen", en: "5+ users" },
    { de: "Geteiltes Fortschritts-Dashboard", en: "Shared progress dashboard" },
    { de: "Mengenrabatt (je mehr, desto günstiger)", en: "Volume discount (more seats, lower price)" },
    { de: "Persönliches Onboarding", en: "Hands-on onboarding" },
    { de: "Zentrale Abrechnung", en: "Central billing" },
    { de: "SLA + Prioritäts-Support", en: "SLA + priority support" },
  ];

  return (
    <TierCard
      lang={lang}
      tier="group"
      icon={<Users className="w-5 h-5 text-[#003A8C]" />}
      name={{ de: "Gruppe", en: "Group" }}
      tagline={{
        de: "Für Kliniken, Kurse und Lerngruppen.",
        en: "For clinics, courses, and study groups.",
      }}
      priceLine={{ de: "Bald verfügbar", en: "Coming soon" }}
      priceHint={{
        de: "Individuelles Angebot — Preise nach Team-Größe",
        en: "Custom quote — priced by team size",
      }}
      features={features}
      userId={userId}
      userEmail={userEmail}
    />
  );
}

/* ═══════════════════════ TierCard (shared) ═══════════════════════ */

interface TierCardProps {
  lang: Lang;
  tier: TierInterest;
  icon: React.ReactNode;
  name: { de: string; en: string };
  tagline: { de: string; en: string };
  priceLine: { de: string; en: string };
  priceHint: { de: string; en: string };
  features: Array<{ de: string; en: string }>;
  highlight?: boolean;
  userId?: string;
  userEmail?: string;
}

function TierCard({
  lang,
  tier,
  icon,
  name,
  tagline,
  priceLine,
  priceHint,
  features,
  highlight = false,
  userId,
  userEmail,
}: TierCardProps) {
  const [formOpen, setFormOpen] = useState(false);
  const [email, setEmail] = useState(userEmail || "");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "ok" | "err">("idle");
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => {
    if (userEmail && !email) setEmail(userEmail);
  }, [userEmail, email]);

  const submit = async () => {
    const e = email.trim();
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      setStatus("err");
      setErrMsg(
        lang === "de" ? "Bitte gültige E-Mail eingeben." : "Please enter a valid email."
      );
      return;
    }
    setStatus("sending");
    setErrMsg("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: e,
          tierInterest: tier,
          note: note.trim() || undefined,
          userId,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error || `HTTP ${res.status}`);
      }
      setStatus("ok");
      setNote("");
    } catch (err) {
      console.error("[waitlist submit]", err);
      setStatus("err");
      setErrMsg(
        lang === "de"
          ? "Etwas ist schiefgelaufen. Bitte später erneut versuchen."
          : "Something went wrong. Please try again later."
      );
    }
  };

  const cardStyles = highlight
    ? "bg-gradient-to-br from-[#001B3D] to-[#003A8C] text-white border-[#00A896] shadow-xl md:scale-[1.02]"
    : "bg-white border-[#E4E9F0] text-[#1A2B3C]";

  return (
    <div
      className={`relative rounded-2xl border-2 p-6 flex flex-col h-full transition-all ${cardStyles}`}
    >
      {highlight && (
        <div className="absolute -top-3 left-6 bg-[#00A896] text-[#001B3D] text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full shadow-md">
          {lang === "de" ? "Am beliebtesten" : "Most popular"}
        </div>
      )}
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <h3 className={`text-xl font-bold font-display ${highlight ? "text-white" : "text-[#1A2B3C]"}`}>
          {name[lang]}
        </h3>
      </div>
      <p className={`text-xs mb-4 ${highlight ? "text-white/70" : "text-[#A0AEC0]"}`}>
        {tagline[lang]}
      </p>

      <div className="mb-1 flex items-center gap-2">
        <Clock className={`w-4 h-4 ${highlight ? "text-[#00A896]" : "text-[#F4A261]"}`} />
        <span className={`text-sm font-bold ${highlight ? "text-[#00A896]" : "text-[#F4A261]"}`}>
          {priceLine[lang]}
        </span>
      </div>
      <p className={`text-xs mb-5 ${highlight ? "text-white/60" : "text-[#A0AEC0]"}`}>
        {priceHint[lang]}{" "}
        <span className={`uppercase tracking-wider font-bold ${highlight ? "text-[#00A896]" : "text-[#F4A261]"}`}>
          TBC
        </span>
      </p>

      <ul className="space-y-2 mb-6 flex-1">
        {features.map((f) => (
          <li
            key={f.en}
            className={`flex items-start gap-2 text-sm ${highlight ? "text-white/90" : "text-[#4A5568]"}`}
          >
            <Check
              className={`w-4 h-4 flex-shrink-0 mt-0.5 ${highlight ? "text-[#00A896]" : "text-[#007B5F]"}`}
            />
            <span>{f[lang]}</span>
          </li>
        ))}
      </ul>

      {/* Waitlist form */}
      {status === "ok" ? (
        <div
          className={`rounded-xl px-4 py-5 text-center ${
            highlight ? "bg-white/10 border border-white/20" : "bg-[#00A896]/10 border border-[#00A896]/30"
          }`}
        >
          <Check
            className={`w-6 h-6 mx-auto mb-2 ${highlight ? "text-[#00A896]" : "text-[#00A896]"}`}
          />
          <p className={`text-sm font-semibold ${highlight ? "text-white" : "text-[#1A2B3C]"}`}>
            {lang === "de"
              ? "Danke! Wir melden uns, sobald verfügbar."
              : "Thanks! We'll reach out as soon as it's available."}
          </p>
        </div>
      ) : !formOpen ? (
        <button
          onClick={() => setFormOpen(true)}
          className={`block w-full text-center py-3 rounded-xl font-semibold text-sm transition-all ${
            highlight
              ? "bg-[#00A896] hover:bg-[#00C0AB] text-[#001B3D] shadow-lg hover:shadow-xl"
              : "bg-[#001B3D] hover:bg-[#003A8C] text-white"
          }`}
        >
          {lang === "de" ? "Interesse anmelden" : "Notify me"}
        </button>
      ) : (
        <div className="space-y-2">
          <label
            className={`block text-[11px] font-semibold uppercase tracking-wider ${
              highlight ? "text-white/70" : "text-[#A0AEC0]"
            }`}
          >
            {lang === "de" ? "Deine E-Mail" : "Your email"}
          </label>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={`w-full px-3 py-2.5 rounded-lg text-sm border focus:outline-none transition-colors ${
              highlight
                ? "bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-[#00A896]"
                : "bg-white border-[#E4E9F0] text-[#1A2B3C] placeholder:text-[#A0AEC0] focus:border-[#007B5F]"
            }`}
          />
          {tier === "group" && (
            <>
              <label
                className={`block text-[11px] font-semibold uppercase tracking-wider pt-1 ${
                  highlight ? "text-white/70" : "text-[#A0AEC0]"
                }`}
              >
                {lang === "de" ? "Team-Größe (optional)" : "Team size (optional)"}
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={lang === "de" ? "z.B. 10 Ärzt:innen" : "e.g. 10 doctors"}
                className={`w-full px-3 py-2.5 rounded-lg text-sm border focus:outline-none transition-colors ${
                  highlight
                    ? "bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-[#00A896]"
                    : "bg-white border-[#E4E9F0] text-[#1A2B3C] placeholder:text-[#A0AEC0] focus:border-[#007B5F]"
                }`}
              />
            </>
          )}
          {status === "err" && errMsg && (
            <p className="text-[11px] text-[#F4A261]">{errMsg}</p>
          )}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={submit}
              disabled={status === "sending"}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                highlight
                  ? "bg-[#00A896] hover:bg-[#00C0AB] text-[#001B3D]"
                  : "bg-[#001B3D] hover:bg-[#003A8C] text-white"
              }`}
            >
              <Send className="w-3.5 h-3.5" />
              {status === "sending"
                ? lang === "de"
                  ? "Senden…"
                  : "Sending…"
                : lang === "de"
                  ? "Absenden"
                  : "Submit"}
            </button>
            <button
              onClick={() => {
                setFormOpen(false);
                setStatus("idle");
                setErrMsg("");
              }}
              className={`px-3 py-2.5 rounded-lg font-medium text-xs transition-colors ${
                highlight
                  ? "text-white/70 hover:text-white hover:bg-white/10"
                  : "text-[#A0AEC0] hover:text-[#4A5568] hover:bg-[#F7F9FC]"
              }`}
            >
              {lang === "de" ? "Abbrechen" : "Cancel"}
            </button>
          </div>
          <p
            className={`text-[10px] pt-1 ${highlight ? "text-white/50" : "text-[#A0AEC0]"}`}
          >
            {lang === "de"
              ? "Wir senden nur eine E-Mail, wenn der Tarif verfügbar ist. Kein Spam."
              : "We'll only email you when the plan is live. No spam."}
          </p>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════ FAQ row ═══════════════════════ */

function FAQRow({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-[#F7F9FC]/60 transition-colors"
      >
        <span className="text-sm font-semibold text-[#1A2B3C] pr-4">{q}</span>
        <span
          className={`text-[#007B5F] text-lg transition-transform flex-shrink-0 ${open ? "rotate-45" : ""}`}
        >
          +
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 -mt-1 text-sm text-[#4A5568] leading-relaxed">
          {a}
        </div>
      )}
    </div>
  );
}
