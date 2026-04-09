"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getLang, setLang } from "@/lib/i18n";
import { getStoredSession, storeSession } from "@/lib/auth";
import { BrandedLoader } from "@/components/Logo";
import TelegramLoginWidget, { type TelegramWidgetUser } from "@/components/TelegramLoginWidget";
import ThemeToggle from "@/components/ThemeToggle";
import { ArrowLeft, User, Shield, Zap, BookOpen } from "lucide-react";

type Lang = "de" | "en";

export default function LoginPage() {
  const [lang, setLangState] = useState<Lang>("de");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setLangState(getLang());
    // If already logged in, redirect to home
    const session = getStoredSession();
    if (session?.user) {
      window.location.href = "/";
    }
  }, []);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  const handleWidgetAuth = async (wu: TelegramWidgetUser) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ widgetData: wu }),
      });
      if (!res.ok) {
        setError(lang === "de" ? "Anmeldung fehlgeschlagen" : "Login failed");
        return;
      }
      const data = await res.json();
      storeSession({ user: data.user, gamification: data.gamification });
      window.location.href = "/";
    } catch {
      setError(lang === "de" ? "Verbindungsfehler" : "Connection error");
    } finally {
      setLoading(false);
    }
  };

  const handleGuestContinue = () => {
    const guestId = `guest_${Date.now()}`;
    storeSession({
      user: {
        id: guestId,
        telegram_id: 0,
        first_name: lang === "de" ? "Gast" : "Guest",
        xp_total: 0,
        streak_count: 0,
        daily_goal: 20,
      },
      gamification: {
        total_xp: 0,
        current_streak: 0,
        total_questions_answered: 0,
        total_correct: 0,
        daily_questions_today: 0,
      },
    });
    window.location.href = "/";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#F7F9FC]">
        <BrandedLoader size="lg" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7F9FC] safe-area-top safe-area-bottom flex flex-col">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <Link href="/landing" className="flex items-center gap-1.5 text-[#A0AEC0] hover:text-[#1A2B3C] text-sm transition-colors">
          <ArrowLeft className="w-4 h-4" />
          {lang === "de" ? "Zurück" : "Back"}
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <div className="flex text-xs">
            <button
              onClick={() => switchLang("de")}
              className={`px-2 py-1 rounded-l font-medium transition-all ${lang === "de" ? "bg-[#007B5F] text-white" : "text-[#A0AEC0] bg-[#F7F9FC] border border-[#E4E9F0]"}`}
            >
              DE
            </button>
            <button
              onClick={() => switchLang("en")}
              className={`px-2 py-1 rounded-r font-medium transition-all ${lang === "en" ? "bg-[#007B5F] text-white" : "text-[#A0AEC0] bg-[#F7F9FC] border border-[#E4E9F0]"}`}
            >
              EN
            </button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          {/* Logo + title */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-xl border border-[#007B5F]/30 bg-[#007B5F]/10 flex items-center justify-center mx-auto mb-4">
              <img src="/brand/logomark.svg" alt="MedPrüf" className="w-12 h-12" />
            </div>
            <h1 className="text-2xl font-bold text-[#1A2B3C] mb-1">
              {lang === "de" ? "Willkommen bei MedPrüf" : "Welcome to MedPrüf"}
            </h1>
            <p className="text-sm text-[#A0AEC0]">
              {lang === "de"
                ? "Melde dich an, um deinen Fortschritt zu speichern"
                : "Sign in to save your progress"}
            </p>
          </div>

          {/* Auth options */}
          <div className="card rounded-2xl p-6 space-y-4">
            {error && (
              <div className="bg-[#D64545]/10 border border-[#D64545]/25 text-[#D64545] text-sm rounded-xl px-4 py-3 text-center">
                {error}
              </div>
            )}

            {/* Telegram Login Widget (primary — web/desktop) */}
            <div className="flex justify-center">
              <TelegramLoginWidget
                botName="MedPruefBot"
                onAuth={handleWidgetAuth}
                buttonSize="large"
                cornerRadius={12}
              />
            </div>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-[#E4E9F0]" />
              <span className="text-xs text-[#A0AEC0]">{lang === "de" ? "oder" : "or"}</span>
              <div className="flex-1 h-px bg-[#E4E9F0]" />
            </div>

            {/* Telegram deep link (mobile / in-app) */}
            <a
              href="https://t.me/MedPruefBot?start=web_login"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-3 bg-[#229ED9] hover:bg-[#1e8fc0] text-white px-5 py-3.5 rounded-xl font-semibold text-sm transition-all active:scale-[0.98]"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden="true">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/>
              </svg>
              {lang === "de" ? "Mit Telegram anmelden" : "Sign in with Telegram"}
            </a>

            {/* Guest mode */}
            <button
              onClick={handleGuestContinue}
              className="w-full flex items-center justify-center gap-2 bg-[#FFFFFF] border border-[#E4E9F0] hover:border-[#007B5F]/40 text-[#4A5568] px-5 py-3.5 rounded-xl font-medium text-sm transition-all active:scale-[0.98]"
            >
              <User className="w-4 h-4 flex-shrink-0" />
              {lang === "de" ? "Als Gast fortfahren" : "Continue as Guest"}
            </button>

            <p className="text-center text-[10px] text-[#A0AEC0]/60">
              {lang === "de"
                ? "Gastmodus speichert Fortschritt lokal — kein Konto nötig"
                : "Guest mode saves progress locally — no account needed"}
            </p>
          </div>

          {/* Benefits */}
          <div className="mt-6 grid grid-cols-3 gap-3">
            <div className="text-center">
              <div className="w-10 h-10 rounded-xl bg-[#007B5F]/10 flex items-center justify-center mx-auto mb-2">
                <BookOpen className="w-5 h-5 text-[#007B5F]" />
              </div>
              <p className="text-[11px] text-[#4A5568] font-medium">7.725 {lang === "de" ? "Fragen" : "Questions"}</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 rounded-xl bg-[#F4A261]/10 flex items-center justify-center mx-auto mb-2">
                <Zap className="w-5 h-5 text-[#F4A261]" />
              </div>
              <p className="text-[11px] text-[#4A5568] font-medium">{lang === "de" ? "XP & Serien" : "XP & Streaks"}</p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 rounded-xl bg-[#003A8C]/10 flex items-center justify-center mx-auto mb-2">
                <Shield className="w-5 h-5 text-[#003A8C]" />
              </div>
              <p className="text-[11px] text-[#4A5568] font-medium">{lang === "de" ? "Prüfungsmodus" : "Exam Mode"}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
