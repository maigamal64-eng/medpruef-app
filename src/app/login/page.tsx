"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getLang, setLang } from "@/lib/i18n";
import { getStoredSession, storeSession } from "@/lib/auth";
import { BrandedLoader } from "@/components/Logo";
import TelegramLoginWidget, { type TelegramWidgetUser } from "@/components/TelegramLoginWidget";
import ThemeToggle from "@/components/ThemeToggle";
import { ArrowLeft, User, Shield, Zap, BookOpen, Mail, Eye, EyeOff } from "lucide-react";

type Lang = "de" | "en";
type AuthMode = "login" | "register";

export default function LoginPage() {
  const [lang, setLangState] = useState<Lang>("de");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<AuthMode>("login");
  const [showPassword, setShowPassword] = useState(false);

  // Form fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  useEffect(() => {
    setLangState(getLang());
    const session = getStoredSession();
    if (session?.user) {
      window.location.href = "/";
    }
  }, []);

  const switchLang = (l: Lang) => {
    setLang(l);
    setLangState(l);
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const payload = mode === "login"
        ? { emailLogin: { email, password } }
        : { emailRegister: { email, password, firstName, lastName } };

      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        const errorMessages: Record<string, Record<string, string>> = {
          de: {
            "Invalid credentials": "E-Mail oder Passwort falsch",
            "Email already registered": "E-Mail bereits registriert",
            "Password must be at least 6 characters": "Passwort muss mindestens 6 Zeichen lang sein",
            "This account uses Telegram login": "Dieses Konto verwendet Telegram-Login",
          },
          en: {},
        };
        const msg = data.error || "Error";
        setError(lang === "de" ? (errorMessages.de[msg] || msg) : msg);
        return;
      }

      storeSession({ user: data.user, gamification: data.gamification });
      window.location.href = "/";
    } catch {
      setError(lang === "de" ? "Verbindungsfehler" : "Connection error");
    } finally {
      setLoading(false);
    }
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
        setError(lang === "de" ? "Telegram-Anmeldung fehlgeschlagen" : "Telegram login failed");
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
            <button onClick={() => switchLang("de")} className={`px-2 py-1 rounded-l font-medium transition-all ${lang === "de" ? "bg-[#007B5F] text-white" : "text-[#A0AEC0] bg-[#F7F9FC] border border-[#E4E9F0]"}`}>DE</button>
            <button onClick={() => switchLang("en")} className={`px-2 py-1 rounded-r font-medium transition-all ${lang === "en" ? "bg-[#007B5F] text-white" : "text-[#A0AEC0] bg-[#F7F9FC] border border-[#E4E9F0]"}`}>EN</button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center px-4 py-6">
        <div className="w-full max-w-md">
          {/* Logo + title */}
          <div className="text-center mb-6">
            <div className="w-16 h-16 rounded-xl border border-[#007B5F]/30 bg-[#007B5F]/10 flex items-center justify-center mx-auto mb-4">
              <img src="/brand/logomark.svg" alt="MedPrüf" className="w-12 h-12" />
            </div>
            <h1 className="text-2xl font-bold text-[#1A2B3C] mb-1">
              {mode === "login"
                ? (lang === "de" ? "Anmelden" : "Sign In")
                : (lang === "de" ? "Konto erstellen" : "Create Account")}
            </h1>
            <p className="text-sm text-[#A0AEC0]">
              {lang === "de"
                ? "Österreichische Kenntnisprüfung Vorbereitung"
                : "Austrian Kenntnisprüfung Preparation"}
            </p>
          </div>

          {/* Auth card */}
          <div className="card rounded-2xl p-6 space-y-5">
            {error && (
              <div className="bg-[#D64545]/10 border border-[#D64545]/25 text-[#D64545] text-sm rounded-xl px-4 py-3 text-center animate-fade-in">
                {error}
              </div>
            )}

            {/* Email/Password Form */}
            <form onSubmit={handleEmailAuth} className="space-y-3">
              {mode === "register" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-[#A0AEC0] mb-1.5">{lang === "de" ? "Vorname" : "First Name"} *</label>
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      required
                      className="w-full bg-[#F7F9FC] border border-[#E4E9F0] rounded-xl px-3 py-3 text-sm text-[#1A2B3C] placeholder-[#A0AEC0] focus:outline-none focus:border-[#007B5F]/50 transition-colors"
                      placeholder={lang === "de" ? "Vorname" : "First name"}
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-[#A0AEC0] mb-1.5">{lang === "de" ? "Nachname" : "Last Name"}</label>
                    <input
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      className="w-full bg-[#F7F9FC] border border-[#E4E9F0] rounded-xl px-3 py-3 text-sm text-[#1A2B3C] placeholder-[#A0AEC0] focus:outline-none focus:border-[#007B5F]/50 transition-colors"
                      placeholder={lang === "de" ? "Nachname" : "Last name"}
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs text-[#A0AEC0] mb-1.5">E-Mail *</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#A0AEC0]" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full bg-[#F7F9FC] border border-[#E4E9F0] rounded-xl pl-10 pr-3 py-3 text-sm text-[#1A2B3C] placeholder-[#A0AEC0] focus:outline-none focus:border-[#007B5F]/50 transition-colors"
                    placeholder="name@example.com"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-[#A0AEC0] mb-1.5">{lang === "de" ? "Passwort" : "Password"} *</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    className="w-full bg-[#F7F9FC] border border-[#E4E9F0] rounded-xl px-3 py-3 pr-10 text-sm text-[#1A2B3C] placeholder-[#A0AEC0] focus:outline-none focus:border-[#007B5F]/50 transition-colors"
                    placeholder={mode === "register" ? (lang === "de" ? "Min. 6 Zeichen" : "Min. 6 characters") : "••••••••"}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#A0AEC0] hover:text-[#4A5568] transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="w-full btn-primary py-3.5 text-sm rounded-xl"
              >
                {mode === "login"
                  ? (lang === "de" ? "Anmelden" : "Sign In")
                  : (lang === "de" ? "Konto erstellen" : "Create Account")}
              </button>
            </form>

            {/* Toggle login/register */}
            <p className="text-center text-sm text-[#A0AEC0]">
              {mode === "login" ? (
                <>
                  {lang === "de" ? "Noch kein Konto?" : "No account yet?"}{" "}
                  <button onClick={() => { setMode("register"); setError(""); }} className="text-[#007B5F] font-semibold hover:underline">
                    {lang === "de" ? "Registrieren" : "Register"}
                  </button>
                </>
              ) : (
                <>
                  {lang === "de" ? "Bereits ein Konto?" : "Already have an account?"}{" "}
                  <button onClick={() => { setMode("login"); setError(""); }} className="text-[#007B5F] font-semibold hover:underline">
                    {lang === "de" ? "Anmelden" : "Sign In"}
                  </button>
                </>
              )}
            </p>

            <div className="flex items-center gap-3">
              <div className="flex-1 h-px bg-[#E4E9F0]" />
              <span className="text-xs text-[#A0AEC0]">{lang === "de" ? "oder" : "or"}</span>
              <div className="flex-1 h-px bg-[#E4E9F0]" />
            </div>

            {/* Telegram login */}
            <a
              href="https://t.me/MedPruefBot?start=web_login"
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-3 bg-[#229ED9] hover:bg-[#1e8fc0] text-white px-5 py-3 rounded-xl font-semibold text-sm transition-all active:scale-[0.98]"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-current" aria-hidden="true">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z"/>
              </svg>
              {lang === "de" ? "Mit Telegram anmelden" : "Sign in with Telegram"}
            </a>

            {/* Guest mode */}
            <button
              onClick={handleGuestContinue}
              className="w-full flex items-center justify-center gap-2 border border-[#E4E9F0] hover:border-[#007B5F]/40 text-[#4A5568] px-5 py-3 rounded-xl font-medium text-sm transition-all active:scale-[0.98]"
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
