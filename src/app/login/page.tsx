"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getLang, setLang } from "@/lib/i18n";
import { getStoredSession, storeSession, setSessionToken, getSessionToken } from "@/lib/auth";
import { trackRegistration } from "@/lib/conversion-events";
import { trackFunnelEvent } from "@/lib/funnel-events";
import { getStoredAttribution } from "@/lib/attribution";
import { getKnownAccounts, rememberKnownAccount, type KnownAccount } from "@/lib/known-accounts";
import { BrandedLoader } from "@/components/Logo";
import { TextField } from "@/components/ui";
import ThemeToggle from "@/components/ThemeToggle";
import { QUESTIONS } from "@/lib/content-truth";
import {
  ArrowLeft,
  Shield,
  Zap,
  BookOpen,
  Eye,
  EyeOff,
  KeyRound,
  Info,
} from "lucide-react";
import { extractLoginCode, looksLikeLoginCode } from "@/lib/telegram-login";

type Lang = "de" | "en";
type AuthMode = "login" | "register";

// Telegram bot deep-link — keep as a single source of truth.
// F10 fix (2026-04-26): append language suffix so the bot replies in the
// same language the user is already reading. The suffix is appended at
// render time from the current lang state (see getTelegramDeepLink below).
const TELEGRAM_DEEP_LINK_BASE = "https://t.me/MedPruefBot?start=web_login";
function getTelegramDeepLink(lang: string): string {
  return `${TELEGRAM_DEEP_LINK_BASE}_${lang === "de" ? "de" : "en"}`;
}

/**
 * Referral-code capture. We persist the `?ref=<code>` param in
 * localStorage so it survives the Telegram round-trip (user leaves
 * the site, auths, returns) and the email/password form submit. After
 * a successful auth we POST it to /api/referrals/claim and clear the
 * key. See src/lib/referrals.ts for the matching server-side logic.
 */
const REF_CODE_KEY = "medpruef_ref_code";

async function claimStoredReferralCode(): Promise<void> {
  if (typeof window === "undefined") return;
  const code = localStorage.getItem(REF_CODE_KEY);
  if (!code) return;
  // The signed session token must already be stored (setSessionToken runs
  // right after a successful /api/auth). /api/referrals/claim is
  // requireUser-guarded, so it derives the userId from this token (S-1).
  const token = getSessionToken();
  if (!token) return; // no session yet — the home-page fallback retries
  try {
    const r = await fetch("/api/referrals/claim", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-session-token": token,
      },
      body: JSON.stringify({ referralCode: code }),
    });
    // 200 = claimed, 409 = already claimed / self-refer, 404 = bad code.
    // All three are terminal — drop the code either way so we don't
    // keep retrying on every future login.
    if (r.ok || r.status === 404 || r.status === 409) {
      localStorage.removeItem(REF_CODE_KEY);
    }
  } catch {
    // Network error — leave the code in storage so the next session
    // picks it up. No toast here: the user is mid-redirect and won't
    // see one.
  }
}

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

  // Telegram sign-in code (FB-08 mobile-PWA hand-off). The bot hands the
  // user a one-time code; pasting it here exchanges it in THIS storage
  // context (the installed app), so the session persists where the user
  // studies. Collapsed by default so it doesn't clutter the primary
  // email/Telegram flows.
  const [showCodeField, setShowCodeField] = useState(false);
  const [tgCode, setTgCode] = useState("");
  const [codeError, setCodeError] = useState("");

  // "You've signed in on this device before" hint (2026-07-27). Purely
  // local — read once on mount from localStorage via known-accounts.ts.
  // Surfaced on the REGISTER tab when the typed email doesn't match a
  // remembered one, so a returning user doesn't accidentally spin up a
  // second free account instead of signing back into their real one.
  const [knownAccounts, setKnownAccounts] = useState<KnownAccount[]>([]);

  useEffect(() => {
    setLangState(getLang());
    setKnownAccounts(getKnownAccounts());

    // Capture ?ref=<code> and stash it for after signup. We do this
    // BEFORE the session-redirect check so even already-logged-in
    // users (who bounce straight to /) can still claim a ref if they
    // happened to land here with ?ref= — the home page triggers the
    // claim on mount.
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

      // ?mode=register: pre-select the register tab so the guest-funnel
      // deep-link lands on the correct form instead of dead-ending.
      if (params.get("mode") === "register") {
        setMode("register");
        trackFunnelEvent("registration_view", { source: "kenntnispruefung-wien" }, { once: true });
      }
    } catch {
      // localStorage may be blocked in private mode — non-fatal.
    }

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
      const payload =
        mode === "login"
          ? { emailLogin: { email, password } }
          : {
              emailRegister: {
                email,
                password,
                firstName,
                lastName,
                attribution: getStoredAttribution() ?? undefined,
              },
            };

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
            "Password must be at least 6 characters":
              "Passwort muss mindestens 8 Zeichen lang sein",
            "Password must be at least 8 characters":
              "Passwort muss mindestens 8 Zeichen lang sein",
            "This account uses Telegram login":
              "Dieses Konto verwendet Telegram-Login",
          },
          en: {},
        };
        const msg = data.error || "Error";
        setError(lang === "de" ? errorMessages.de[msg] || msg : msg);
        return;
      }

      storeSession({ user: data.user, gamification: data.gamification });
      // Persist the signed session token — THE auth credential authFetch
      // sends on every subsequent request (S-1, 2026-06-02).
      setSessionToken(data.sessionToken);
      // Remember this email as "known on this device" (2026-07-27) so a
      // returning visitor gets the register-tab hint instead of quietly
      // creating a second free account. Device-local only, see
      // src/lib/known-accounts.ts.
      rememberKnownAccount(data.user?.email || email);
      // Paid-ads conversion signal — ONLY on a NEW free registration (not
      // login). Fires fbq('track','CompleteRegistration') + gtag('event',
      // 'sign_up'); both self-gate on cookie consent + tracker presence, so
      // this is a no-op pre-consent or when the Pixel/GA env is unset. The
      // consent-independent ground-truth count is the server register row
      // (user_activity_log). See marketing/campaigns/paid-ads-setup-2026-06-24.md.
      if (mode === "register") {
        // Pass the user id so the client pixel SignUp dedupes against the
        // server-side Reddit CAPI SignUp for the same registration.
        trackRegistration(data.user?.id);
        trackFunnelEvent("registration_success", { source: "kenntnispruefung-wien" }, { once: true });
      }
      // Best-effort referral claim — fire and forget. The home page
      // also has a fallback claim on mount so a failure here is not
      // user-visible.
      if (data.user?.id) {
        await claimStoredReferralCode();
      }
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next && next.startsWith("/") ? next : "/";
    } catch {
      setError(lang === "de" ? "Verbindungsfehler" : "Connection error");
    } finally {
      setLoading(false);
    }
  };

  const handleCodeAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setCodeError("");
    const code = extractLoginCode(tgCode);
    if (!looksLikeLoginCode(code)) {
      setCodeError(
        lang === "de"
          ? "Ungültiger Code. Kopiere den Code aus dem Telegram-Chat und füge ihn hier ein."
          : "Invalid code. Copy the code from the Telegram chat and paste it here.",
      );
      return;
    }
    setLoading(true);
    try {
      // Exchange the one-time token in THIS context so the signed session
      // token is written to this browser/app's localStorage (S-1). Reuses
      // the audited /api/auth tokenExchange path — no new auth surface.
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenExchange: code }),
      });
      const data = await res.json();
      if (!res.ok) {
        const map: Record<string, string> = {
          "Invalid token":
            lang === "de" ? "Code ungültig oder nicht gefunden." : "Code invalid or not found.",
          "Token already used":
            lang === "de" ? "Dieser Code wurde bereits verwendet. Fordere im Bot einen neuen an." : "This code was already used. Request a new one from the bot.",
          "Token expired":
            lang === "de" ? "Code abgelaufen. Fordere im Bot einen neuen an." : "Code expired. Request a new one from the bot.",
        };
        const msg = data.error || "Error";
        setCodeError(map[msg] || (lang === "de" ? "Anmeldung fehlgeschlagen." : "Sign-in failed."));
        setLoading(false);
        return;
      }
      storeSession({ user: data.user, gamification: data.gamification });
      setSessionToken(data.sessionToken);
      // No-ops for Telegram-only accounts with no email on file.
      rememberKnownAccount(data.user?.email);
      if (data.user?.id) {
        await claimStoredReferralCode();
      }
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next && next.startsWith("/") ? next : "/";
    } catch {
      setCodeError(lang === "de" ? "Verbindungsfehler" : "Connection error");
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--mp-surface-sunken)]">
        <BrandedLoader size="lg" />
      </div>
    );
  }

  const tagline =
    lang === "de"
      ? "Österreichische Ärzteprüfung vorbereiten"
      : "Prepare for the Austrian medical exam";

  // "You've signed in on this device before" hint (2026-07-27, see
  // src/lib/known-accounts.ts). Only on the register tab, only when the
  // typed email doesn't already match the most-recently-used known email
  // (an empty field counts as "different", so the hint shows before the
  // user has typed anything too).
  const mostRecentKnownAccount = knownAccounts[0];
  const showKnownAccountHint =
    mode === "register" &&
    !!mostRecentKnownAccount &&
    mostRecentKnownAccount.email.toLowerCase() !== email.trim().toLowerCase();

  return (
    <div className="min-h-screen bg-[var(--mp-surface-sunken)] safe-area-top safe-area-bottom flex flex-col">
      {/* Header */}
      <div className="px-4 pt-4 pb-2 flex items-center justify-between">
        <Link
          href="/landing"
          className="flex items-center gap-1.5 text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-sm transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          {lang === "de" ? "Zurück" : "Back"}
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <div className="flex text-xs">
            <button
              onClick={() => switchLang("de")}
              className={`px-2 py-1 rounded-l font-medium transition-all ${
                lang === "de"
                  ? "bg-[var(--mp-viridian)] text-white"
                  : "text-[var(--mp-fg-subtle)] bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)]"
              }`}
            >
              DE
            </button>
            <button
              onClick={() => switchLang("en")}
              className={`px-2 py-1 rounded-r font-medium transition-all ${
                lang === "en"
                  ? "bg-[var(--mp-viridian)] text-white"
                  : "text-[var(--mp-fg-subtle)] bg-[var(--mp-surface-sunken)] border border-[var(--mp-border)]"
              }`}
            >
              EN
            </button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex items-center justify-center px-4 py-6">
        <div className="w-full max-w-md">
          {/* Hero — wordmark + tagline */}
          <div className="text-center mb-6">
            <div className="w-16 h-16 rounded-xl border border-[var(--mp-viridian)]/30 bg-[var(--mp-viridian)]/10 flex items-center justify-center mx-auto mb-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/logomark.svg"
                alt="MedPrüf"
                className="w-12 h-12"
              />
            </div>
            <h1 className="text-2xl font-display font-extrabold text-[var(--mp-fg)] mb-1 tracking-tight">
              MedPr&uuml;f
            </h1>
            <p className="text-sm text-[var(--mp-fg-subtle)]">{tagline}</p>
          </div>

          {/* Auth card — email-primary (B.4 login cleanup 2026-06-26) */}
          <div className="card rounded-2xl p-6 space-y-4">
            {error && (
              <div className="bg-[var(--mp-error)]/10 border border-[var(--mp-error)]/25 text-[var(--mp-error)] text-sm rounded-xl px-4 py-3 text-center animate-fade-in">
                {error}
              </div>
            )}

            {/* Login / Register segmented control */}
            <div className="mp-tabs w-full" role="tablist" aria-label={lang === "de" ? "E-Mail-Anmeldung oder Registrierung" : "Email sign-in or register"}>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "login"}
                className={`mp-tabs__tab flex-1 ${
                  mode === "login" ? "mp-tabs__tab--active" : ""
                }`}
                onClick={() => {
                  setMode("login");
                  setError("");
                }}
              >
                {lang === "de" ? "Anmelden" : "Sign in"}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "register"}
                className={`mp-tabs__tab flex-1 ${
                  mode === "register" ? "mp-tabs__tab--active" : ""
                }`}
                onClick={() => {
                  setMode("register");
                  setError("");
                }}
              >
                {lang === "de" ? "Registrieren" : "Register"}
              </button>
            </div>

            <div className="rounded-xl border border-[var(--mp-viridian)]/25 bg-[var(--mp-viridian)]/5 px-3.5 py-3 text-sm text-[var(--mp-fg-muted)]">
              <p className="font-semibold text-[var(--mp-fg)]">
                {lang === "de" ? "Empfohlen: mit E-Mail anmelden" : "Recommended: sign in with email"}
              </p>
              <p className="mt-1 text-xs leading-relaxed">
                {lang === "de"
                  ? "Dein Fortschritt bleibt sicher mit einem Konto verbunden, auch wenn du Telegram später nicht öffnest."
                  : "Your progress stays safely connected to one account, even if you do not open Telegram later."}
              </p>
            </div>

            {/* PRIMARY: Email/Password form — always visible */}
            <form onSubmit={handleEmailAuth} className="space-y-3">
              {mode === "register" && (
                <div className="grid grid-cols-2 gap-3">
                  <TextField
                    label={lang === "de" ? "Vorname" : "First name"}
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder={lang === "de" ? "Vorname" : "First name"}
                  />
                  <TextField
                    label={lang === "de" ? "Nachname" : "Last name"}
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder={lang === "de" ? "Nachname" : "Last name"}
                  />
                </div>
              )}

              <TextField
                label={lang === "de" ? "E-Mail" : "Email"}
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
              />

              <div className="relative">
                <TextField
                  label={lang === "de" ? "Passwort" : "Password"}
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={8}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={
                    mode === "register"
                      ? lang === "de"
                        ? "Min. 8 Zeichen"
                        : "Min. 8 characters"
                      : "••••••••"
                  }
                  helper={
                    mode === "register"
                      ? lang === "de"
                        ? "Mindestens 8 Zeichen."
                        : "At least 8 characters."
                      : undefined
                  }
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={
                    showPassword
                      ? lang === "de"
                        ? "Passwort verbergen"
                        : "Hide password"
                      : lang === "de"
                      ? "Passwort anzeigen"
                      : "Show password"
                  }
                  className="absolute right-3 top-[34px] text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg-muted)] transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>

              {showKnownAccountHint && mostRecentKnownAccount && (
                <div
                  className="flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm animate-fade-in"
                  style={{
                    background: "var(--mp-info-bg)",
                    borderColor: "rgba(58,124,165,.3)",
                    color: "var(--mp-info)",
                  }}
                  role="status"
                >
                  <Info className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden />
                  <div className="flex-1 min-w-0">
                    <p>
                      {lang === "de" ? (
                        <>
                          Du hast dich auf diesem Gerät bereits mit{" "}
                          <strong>{mostRecentKnownAccount.email}</strong> angemeldet.
                        </>
                      ) : (
                        <>
                          You have signed in on this device before as{" "}
                          <strong>{mostRecentKnownAccount.email}</strong>.
                        </>
                      )}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setMode("login");
                        setEmail(mostRecentKnownAccount.email);
                        setError("");
                      }}
                      className="mt-1.5 font-semibold underline underline-offset-2 hover:opacity-80 transition-opacity"
                    >
                      {lang === "de"
                        ? "Stattdessen anmelden, um deinen Fortschritt zu behalten"
                        : "Sign in instead to keep your progress"}
                    </button>
                  </div>
                </div>
              )}

              <button
                type="submit"
                className="mp-btn mp-btn--primary w-full justify-center"
              >
                {mode === "login"
                  ? lang === "de"
                    ? "Mit E-Mail anmelden"
                    : "Sign in with email"
                  : lang === "de"
                  ? "Konto erstellen"
                  : "Create account"}
              </button>
            </form>

            {/* Divider */}
            <div className="flex items-center gap-3" aria-hidden="true">
              <span className="flex-1 h-px bg-[var(--mp-border)]" />
              <span className="text-xs text-[var(--mp-fg-subtle)]">
                {lang === "de" ? "oder" : "or"}
              </span>
              <span className="flex-1 h-px bg-[var(--mp-border)]" />
            </div>

            <p className="text-center text-xs text-[var(--mp-fg-subtle)] leading-snug">
              {lang === "de"
                ? "Tipp: E-Mail ist unsere empfohlene Anmeldung. So bleibt dein Lernfortschritt auch ohne Telegram erhalten."
                : "Tip: Email is our recommended sign-in. Your learning progress stays available even without Telegram."}
            </p>

            {/* SECONDARY: Telegram remains available, but is not the primary account path. */}
            <a
              href={getTelegramDeepLink(lang)}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2.5 mp-btn mp-btn--ghost text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]"
            >
              <svg
                viewBox="0 0 24 24"
                className="w-5 h-5 fill-[#229ED9]"
                aria-hidden="true"
              >
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z" />
              </svg>
              {lang === "de"
                ? "Optional: mit Telegram anmelden"
                : "Optional: continue with Telegram"}
            </a>

            {/* Telegram disclosure — Sie form (new security surface, first-touch) */}
            <p className="text-center text-xs text-[var(--mp-fg-subtle)] leading-snug">
              {lang === "de"
                ? "Telegram-Anmeldung: schnell, ohne Passwort. Wir verwenden Ihren Telegram-Namen und Ihr Profilbild."
                : "Telegram sign-in: fast, no password. We use your Telegram name and profile photo."}
            </p>

            {/* Telegram sign-in code (FB-08 mobile-PWA hand-off). On a phone,
               tapping the bot's login button opens Telegram's in-app browser,
               so the session can't reach the installed app. The bot also
               hands the user a code; pasting it HERE (inside the app) mints
               the session in the right place. Collapsed by default. */}
            <div className="pt-1">
              {!showCodeField ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowCodeField(true);
                    setCodeError("");
                  }}
                  className="w-full flex items-center justify-center gap-2 text-xs font-semibold text-[var(--mp-cta-blue)] hover:opacity-80 transition-opacity py-1.5 mp-focusable"
                >
                  <KeyRound className="w-3.5 h-3.5" aria-hidden />
                  {lang === "de" ? "Mit Telegram-Code anmelden" : "Sign in with Telegram code"}
                </button>
              ) : (
                <form onSubmit={handleCodeAuth} className="space-y-2 animate-fade-in">
                  <TextField
                    label={lang === "de" ? "Telegram-Code" : "Telegram code"}
                    type="text"
                    inputMode="text"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={tgCode}
                    onChange={(e) => {
                      setTgCode(e.target.value);
                      if (codeError) setCodeError("");
                    }}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    helper={
                      lang === "de"
                        ? 'Öffne @MedPruefBot, tippe auf „MedPrüf öffnen“ und kopiere den Code aus dem Chat.'
                        : 'Open @MedPruefBot, tap "Open MedPrüf" and copy the code from the chat.'
                    }
                    error={codeError || undefined}
                  />
                  <button
                    type="submit"
                    className="mp-btn mp-btn--secondary w-full justify-center"
                  >
                    {lang === "de" ? "Code einlösen & anmelden" : "Redeem code & sign in"}
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* Benefits */}
          <div className="mt-6 grid grid-cols-3 gap-3">
            <div className="text-center">
              <div className="w-10 h-10 rounded-xl bg-[var(--mp-viridian)]/10 flex items-center justify-center mx-auto mb-2">
                <BookOpen className="w-5 h-5 text-[var(--mp-viridian)]" />
              </div>
              <p className="text-[11px] text-[var(--mp-fg-muted)] font-medium">
                {QUESTIONS.total.toLocaleString(lang === "de" ? "de-AT" : "en-GB")}+ {lang === "de" ? "Fragen" : "Questions"}
              </p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 rounded-xl bg-[var(--mp-status-warning)]/10 flex items-center justify-center mx-auto mb-2">
                <Zap className="w-5 h-5 text-[var(--mp-status-warning)]" />
              </div>
              <p className="text-[11px] text-[var(--mp-fg-muted)] font-medium">
                {lang === "de" ? "XP & Serien" : "XP & Streaks"}
              </p>
            </div>
            <div className="text-center">
              <div className="w-10 h-10 rounded-xl bg-[var(--mp-cta-blue)]/10 flex items-center justify-center mx-auto mb-2">
                <Shield className="w-5 h-5 text-[var(--mp-cta-blue)]" />
              </div>
              <p className="text-[11px] text-[var(--mp-fg-muted)] font-medium">
                {lang === "de" ? "Prüfungsmodus" : "Exam Mode"}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
