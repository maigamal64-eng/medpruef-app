"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import LanguagePicker from "@/components/LanguagePicker";
import FreeOfferDisclosure from "@/components/FreeOfferDisclosure";
import { billingAuthContext } from "@/lib/billing-copy";
import SupportContactForm from "@/components/SupportContactForm";
import { TIER_FOR_ACTION, planFacts } from "@/app/pricing/_parts/plans";
import { t } from "@/lib/i18n";
import { completeAuthEntry } from "@/lib/auth-entry-completion";
import { selftestCopy, selftestLang } from "@/lib/public-selftest/copy";
import { authFetch } from "@/lib/authFetch";
import { authDestination, initialAuthMode, persistAuthEntry, readAuthEntry, signInReasonLine } from "@/lib/auth-entry";
import { safeStorage } from "@/lib/safe-storage";
import Link from "next/link";
import { getLang, useLang, renderLang } from "@/lib/i18n";
import { getStoredSession, storeSession, setSessionToken, getSessionToken } from "@/lib/auth";
import { trackRegistration } from "@/lib/conversion-events";
import { trackFunnelEvent } from "@/lib/funnel-events";
import { getStoredAttribution } from "@/lib/attribution";
import { codeAtSignupSurfaceEnabled, normalizeTypedCode } from "@/lib/code-entry";
import { codeEntryCopy } from "@/lib/code-entry/copy";
import { readPendingCode, rememberTypedCode } from "@/lib/code-entry/client";
import { getStoredExamSource, setStoredExamSource } from "@/lib/topics";
import { getKnownAccounts, rememberKnownAccount, type KnownAccount } from "@/lib/known-accounts";
import { BrandedLoader } from "@/components/Logo";
import { Alert, TextField } from "@/components/ui";
import ThemeToggle from "@/components/ThemeToggle";
import { ArrowLeft, Eye, EyeOff, KeyRound, Info, ClipboardPaste } from "lucide-react";
import { extractLoginCode, looksLikeLoginCode } from "@/lib/telegram-login";
import { goBack } from "@/lib/go-back";
import { announce } from "@/lib/announce";
import { FREE_TIER } from "@/lib/content-truth";
import { marketingConsentEnabled } from "@/lib/marketing-consent";
import { marketingConsentCopy } from "@/lib/marketing-consent/copy";
import {
  classifyAuthFailure, classifyAuthResponse, FIELD_ORDER, LOGIN_ERROR_KEY, validateLogin,
  type FieldErrors, type FieldName, type LoginError,
} from "@/lib/login-errors";

type Lang = "de" | "en";
type AuthMode = "login" | "register";

// Telegram bot deep link (F10: the language suffix makes the bot answer in the reader's language).
const TELEGRAM_DEEP_LINK_BASE = "https://t.me/MedPruefBot?start=web_login";
function getTelegramDeepLink(lang: string): string {
  return `${TELEGRAM_DEEP_LINK_BASE}_${lang === "de" ? "de" : "en"}`;
}

/**
 * UX-ONB-56: until React hydrates, a tap on submit must not trigger a native
 * GET submit (which would reload the page and lose the typed values). This
 * tiny capture-phase listener runs as the server HTML is parsed; it cancels
 * submits of guarded forms and marks the page so CSS shows the pending look.
 * The learner taps again after hydration (nothing is replayed). The forms
 * also use method="post", so even if this script fails nothing reaches a URL.
 */
const PREHYDRATION_GUARD = `(function(){try{document.addEventListener('submit',function(e){var f=e.target;if(window.__mpLoginReady||!f||!f.closest||!f.closest('[data-prehydration-guard]'))return;e.preventDefault();document.documentElement.classList.add('mp-submit-waiting');},true);}catch(_){}})();`;
const PREHYDRATION_STYLE = `.mp-submit-waiting [data-prehydration-guard] [type=submit]{opacity:.7;cursor:progress}`;

/** Referral code from ?ref= survives the auth round trip in storage (src/lib/referrals.ts). */
const REF_CODE_KEY = "medpruef_ref_code";

async function claimStoredReferralCode(): Promise<void> {
  if (typeof window === "undefined") return;
  const code = safeStorage.getItem(REF_CODE_KEY);
  if (!code) return;
  const token = getSessionToken();
  if (!token) return; // the home-page fallback retries
  const r = await authFetch("/api/referrals/claim", {
    method: "POST",
    headers: { "content-type": "application/json", "x-session-token": token },
    body: JSON.stringify({ referralCode: code }),
  });
  if (r.ok || r.status === 404 || r.status === 409) safeStorage.removeItem(REF_CODE_KEY);
}

const SLOW_NOTICE_MS = 8_000;
const REQUEST_TIMEOUT_MS = 15_000;

function LoginPage() {
  const router = useRouter();
  const [lang, setLangState] = useState<Lang>("de");
  const uiLang = useLang();
  useEffect(() => { setLangState(renderLang(uiLang)); }, [uiLang]);
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<AuthMode>(() => initialAuthMode(new URLSearchParams(searchParams.toString()), getKnownAccounts().length > 0));
  const [reason, setReason] = useState(() => searchParams.get('reason') || '');
  const entry = readAuthEntry(new URLSearchParams(searchParams.toString()));
  // A paid plan chosen on /pricing travels in `next` (UX-ACC-02): name it.
  const checkoutPlan = (() => {
    try {
      const action = new URL(entry.next, "https://medpruf.com").searchParams.get("action");
      return action ? TIER_FOR_ACTION[action] ?? null : null;
    } catch { return null; }
  })();
  const [trialTerms, setTrialTerms] = useState<{ trialDays: number; priceAfterCents: number }>();
  useEffect(() => {
    if (entry.intent !== 'trial') return;
    const controller = new AbortController();
    void authFetch('/api/trial/status', { signal: controller.signal, timeoutMs: 8_000, skipAuthRedirect: true })
      .then(async response => response.ok ? response.json() : null)
      .then(data => {
        if (!controller.signal.aborted && data?.enabled && data.currency === 'EUR' && Number.isFinite(data.price_after_cents) && Number.isFinite(data.trial_days))
          setTrialTerms({ trialDays: data.trial_days, priceAfterCents: data.price_after_cents });
      }).catch(() => {});
    return () => controller.abort();
  }, [entry.intent]);

  const [showPassword, setShowPassword] = useState(false);
  // a-intercom-marketing-consent: unticked until the learner ticks it; sent only on register.
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const consentOffered = marketingConsentEnabled();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");

  // Submit lifecycle (UX-ONB-13): the card stays mounted, a ref guards double
  // submits, the button carries the pending label, and a redirect never
  // re-shows the filled form.
  const [pending, setPending] = useState<null | "login" | "register" | "code">(null);
  const submitting = useRef(false);
  const redirecting = useRef(false);
  const [slow, setSlow] = useState(false);
  const [formError, setFormError] = useState<LoginError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const fieldRefs = { firstName: useRef<HTMLInputElement>(null), email: useRef<HTMLInputElement>(null), password: useRef<HTMLInputElement>(null) };
  const formErrorRef = useRef<HTMLDivElement>(null);

  // Typed code before signup (a-code-front-door): its own field, apart from the Telegram code below.
  const [typedCode, setTypedCode] = useState("");
  const [typedCodeError, setTypedCodeError] = useState("");
  const typedCodeRef = useRef<HTMLInputElement>(null);
  const codeEntryOn = codeAtSignupSurfaceEnabled();
  const codeCopy = codeEntryCopy(lang);
  useEffect(() => { if (codeEntryOn) { const pending = readPendingCode(); if (pending) setTypedCode(pending); } }, [codeEntryOn]);

  // Telegram code entry (FB-08, UX-ONB-23).
  const [showCodeField, setShowCodeField] = useState(false);
  const [tgCode, setTgCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const codeInputRef = useRef<HTMLInputElement>(null);
  const tgExpiredRef = useRef<HTMLDivElement>(null);
  const [tgExpired, setTgExpired] = useState(false);

  const [knownAccounts, setKnownAccounts] = useState<KnownAccount[]>([]);

  // Hydrated: the pre-hydration submit guard steps aside.
  useEffect(() => {
    (window as unknown as { __mpLoginReady?: boolean }).__mpLoginReady = true;
    document.documentElement.classList.remove("mp-submit-waiting");
  }, []);

  useEffect(() => {
    setLangState(getLang());
    setKnownAccounts(getKnownAccounts());
    const params = new URLSearchParams(window.location.search);
    const arrival = readAuthEntry(params);
    persistAuthEntry(arrival);
    if (arrival.exam) setStoredExamSource(arrival.exam);
    const expired = params.get('reason') === 'telegram_expired';
    if (expired || params.get('code') === '1') setShowCodeField(true);
    if (expired) { setTgExpired(true); setReason(''); }
    const clean = new URL(window.location.href);
    clean.searchParams.delete('reason');
    clean.searchParams.delete('code');
    window.history.replaceState(window.history.state, '', clean.pathname + clean.search);

    try {
      const ref = params.get("ref");
      if (ref) {
        const normalized = ref.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (normalized.length >= 4 && normalized.length <= 16) safeStorage.setItem(REF_CODE_KEY, normalized);
      }
    } catch { /* storage blocked */ }

    // A legacy guest session is not signed in here (UX-ONB-41).
    const session = getStoredSession();
    if (session?.user && !session.user.id.startsWith("guest_")) {
      window.location.replace(authDestination(readAuthEntry(new URLSearchParams(window.location.search))));
    }
  }, []);

  // The Telegram failure was not caused by the learner: focus the explanation once.
  useEffect(() => { if (tgExpired) tgExpiredRef.current?.focus(); }, [tgExpired]);

  useEffect(() => {
    if (mode === "register") trackFunnelEvent("registration_view", { source: getStoredExamSource() }, { once: true });
  }, [mode]);

  // 429 countdown: announced at start and when the button is available again, never every second.
  useEffect(() => {
    if (!waitUntil) return;
    const id = setInterval(() => {
      const n = Date.now();
      setNow(n);
      if (n >= waitUntil) { setWaitUntil(null); setFormError(null); announce(t("a22_login_wait_over", uiLang)); }
    }, 1000);
    return () => clearInterval(id);
  }, [waitUntil, uiLang]);
  const waitSeconds = waitUntil ? Math.max(0, Math.ceil((waitUntil - now) / 1000)) : 0;

  const startPending = (kind: "login" | "register" | "code") => {
    submitting.current = true;
    setPending(kind);
    setSlow(false);
    const timer = setTimeout(() => { setSlow(true); announce(t("a22_login_slow", uiLang)); }, SLOW_NOTICE_MS);
    return () => clearTimeout(timer);
  };
  const endPending = () => {
    if (redirecting.current) return;
    submitting.current = false;
    setPending(null);
    setSlow(false);
  };

  const showFormError = useCallback((err: LoginError) => {
    setFormError(err);
    if (err.kind === "rate_limited" && err.retryAfter) {
      setWaitUntil(Date.now() + err.retryAfter * 1000);
      setNow(Date.now());
    }
    requestAnimationFrame(() => {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      formErrorRef.current?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
      formErrorRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const finishSignIn = async (data: { user: { id?: string; email?: string }; gamification: unknown; sessionToken: string; existing?: boolean }, kind: AuthMode | "code") => {
    storeSession({ user: data.user, gamification: data.gamification } as Parameters<typeof storeSession>[0]);
    setSessionToken(data.sessionToken);
    rememberKnownAccount(data.user?.email || (kind === "code" ? undefined : email));
    if (kind === "register" && !data.existing) {
      trackRegistration(data.user?.id);
      trackFunnelEvent("registration_success", { source: entry.exam || getStoredExamSource(), intent: entry.intent || "free", method: "email", entry_page: "/login" }, { once: true });
    }
    // The referral claim never blocks or fails the sign-in; Home retries it.
    if (data.user?.id) void claimStoredReferralCode().catch(() => {});
    redirecting.current = true;
    window.location.replace(await completeAuthEntry(new URLSearchParams(window.location.search)));
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current || waitUntil) return;
    const errors = validateLogin(mode, { firstName, email, password });
    setFieldErrors(errors);
    setFormError(null);
    const firstInvalid = FIELD_ORDER.find((f) => errors[f]);
    if (firstInvalid) { fieldRefs[firstInvalid].current?.focus(); return; }
    if (mode === "register" && codeEntryOn && typedCode.trim()) {
      // Kept for after sign-in and made the first touch before the register call reads the attribution.
      if (!rememberTypedCode(typedCode, "register")) { setTypedCodeError(codeCopy.fieldInvalid); typedCodeRef.current?.focus(); return; }
    }

    const stop = startPending(mode);
    try {
      const payload = mode === "login"
        ? { emailLogin: { email: email.trim(), password } }
        : { emailRegister: { email: email.trim(), password, firstName: firstName.trim(), lastName: lastName.trim(), attribution: getStoredAttribution() ?? undefined, ...(consentOffered ? { marketingOptIn } : {}) } };
      const res = await authFetch("/api/auth", {
        method: "POST", timeoutMs: REQUEST_TIMEOUT_MS, skipAuthRedirect: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.sessionToken) {
        const err = res.ok ? { kind: "unknown" as const } : classifyAuthResponse(res.status, data);
        if (err.kind === "exists") { setMode("login"); setPassword(""); }
        showFormError(err);
        return;
      }
      await finishSignIn(data, mode);
    } catch (err) {
      showFormError(classifyAuthFailure(err, typeof navigator === "undefined" ? true : navigator.onLine));
    } finally {
      stop();
      endPending();
    }
  };

  const handleCodeAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    setCodeError("");
    const code = extractLoginCode(tgCode);
    if (!looksLikeLoginCode(code)) {
      setCodeError(t("a22_login_code_invalid", uiLang));
      codeInputRef.current?.focus();
      return;
    }
    const stop = startPending("code");
    try {
      const res = await authFetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenExchange: code, attribution: getStoredAttribution() ?? undefined }), timeoutMs: REQUEST_TIMEOUT_MS, skipAuthRedirect: true,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.sessionToken) {
        const msg = typeof data?.error === "string" ? data.error : "";
        setCodeError(t(
          res.status === 429 ? "a22_login_err_rate_short"
            : msg === "Token already used" ? "a22_login_code_used"
            : msg === "Token expired" ? "a22_login_code_expired"
            : res.status === 401 ? "a22_login_code_unknown" : "a22_login_err_unknown",
          uiLang,
        ));
        codeInputRef.current?.focus();
        return;
      }
      await finishSignIn(data, "code");
    } catch (err) {
      setCodeError(t(classifyAuthFailure(err, navigator.onLine).kind === "timeout" ? "a22_login_err_timeout" : "a22_login_err_offline", uiLang));
    } finally {
      stop();
      endPending();
    }
  };

  const pasteCode = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) { setTgCode(text); setCodeError(""); codeInputRef.current?.focus(); }
    } catch { codeInputRef.current?.focus(); /* permission denied: manual paste still works */ }
  };
  const [canReadClipboard, setCanReadClipboard] = useState(false);
  useEffect(() => { setCanReadClipboard(typeof navigator !== "undefined" && !!navigator.clipboard?.readText); }, []);

  const mostRecentKnownAccount = knownAccounts[0];
  const showKnownAccountHint = mode === "register" && !!mostRecentKnownAccount
    && mostRecentKnownAccount.email.toLowerCase() !== email.trim().toLowerCase();

  const pendingLabel = pending === "login" ? t("a22_login_pending_login", uiLang)
    : pending === "register" ? t("a22_login_pending_register", uiLang)
    : pending === "code" ? t("a22_login_pending_code", uiLang) : null;
  const submitBlocked = !!pending || !!waitUntil;
  const errorText = formError
    ? formError.kind === "rate_limited" ? t("a22_login_err_rate", uiLang).replace("{n}", String(waitSeconds || formError.retryAfter || 60))
      : t(LOGIN_ERROR_KEY[formError.kind], uiLang)
    : null;
  const fieldError = (f: FieldName) => (fieldErrors[f] ? t(fieldErrors[f]!, uiLang) : undefined);
  const clearField = (f: FieldName) => { if (fieldErrors[f]) setFieldErrors((e) => ({ ...e, [f]: undefined })); };

  return (
    <div className="min-h-dvh bg-[var(--mp-surface-sunken)] safe-area-top safe-area-bottom pb-64 md:pb-40 flex flex-col">
      <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: PREHYDRATION_GUARD }} />
      <style suppressHydrationWarning dangerouslySetInnerHTML={{ __html: PREHYDRATION_STYLE }} />
      <div className="px-4 pt-4 pb-2 flex items-center justify-between gap-2">
        <Link
          href="/landing"
          onClick={(e) => { e.preventDefault(); goBack(router, false); }}
          className="inline-flex min-h-11 items-center gap-1.5 px-1 text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg)] text-sm transition-colors mp-focusable"
        >
          <ArrowLeft className="w-4 h-4 rtl:rotate-180" aria-hidden />
          {t("login_back", uiLang)}
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LanguagePicker />
        </div>
      </div>

      <main className="flex-1 flex items-start sm:items-center justify-center px-4 py-3 sm:py-6">
        <div className="w-full max-w-md">
          {reason && <Alert variant="info" onClose={() => setReason('')} className="mb-4">{reason === 'signin_required' && signInReasonLine(searchParams.get('next'), lang) || t(reason === 'expired' || reason === 'refresh_required' ? 'session_expired' : 'signin_required', lang)}</Alert>}

          {/* UX-ONB-22: a rejected Telegram link explains itself and offers both ways back. */}
          {tgExpired && (
            <div ref={tgExpiredRef} tabIndex={-1} role="alert" className="mb-4 rounded-[var(--mp-r-card)] border border-[var(--mp-error)]/30 bg-[var(--mp-surface-raised)] p-4 outline-none" data-testid="tg-expired">
              <p className="text-sm text-[var(--mp-fg)]">{t("a22_login_tg_expired", uiLang)}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <a href={getTelegramDeepLink(lang)} target="_blank" rel="noopener noreferrer" className="mp-btn mp-btn--secondary min-h-11">{t("a22_login_open_telegram", uiLang)}</a>
                <button type="button" className="mp-btn mp-btn--secondary min-h-11" onClick={() => { setMode("login"); fieldRefs.email.current?.focus(); }}>{t("a22_login_use_email", uiLang)}</button>
              </div>
            </div>
          )}

          <div className="text-center mb-3">
            <h1 className="text-2xl font-display font-extrabold text-[var(--mp-fg)] mb-1 tracking-tight">MedPr&uuml;f</h1>
            <p className="text-sm text-[var(--mp-fg-muted)]" style={{ hyphens: "auto" }}>{t("a22_login_tagline", uiLang)}</p>
          </div>

          <div className="card rounded-2xl p-4 sm:p-6 space-y-3 sm:space-y-4">
            {/* Sign in / register: two pressed buttons over the same form (no tab roles). */}
            <div className="mp-tabs w-full" role="group" aria-label={t("login_email_sign_in_or_register", uiLang)}>
              {(["login", "register"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={mode === m}
                  className={`mp-tabs__tab flex-1 min-h-11 ${mode === m ? "mp-tabs__tab--active" : ""}`}
                  onClick={() => { setMode(m); setFormError(null); setFieldErrors({}); }}
                >
                  {t(m === "login" ? "login_sign_in" : "login_register", uiLang)}
                </button>
              ))}
            </div>

            {!entry.intent && !checkoutPlan && (
              <p className="text-[14px] text-[var(--mp-fg-muted)]">{t(mode === "login" ? "a22_login_context_login" : "a22_login_context_register", uiLang)}</p>
            )}
            {checkoutPlan && !entry.intent && <Alert variant="info" className="bg-[var(--mp-surface-sunken)] text-sm">
              <span role="status">{t("a22_login_checkout_context", uiLang).replace("{plan}", planFacts(checkoutPlan, lang).name).replace("{price}", planFacts(checkoutPlan, lang).price)}</span>
            </Alert>}
            {entry.intent && <Alert variant="info" className="bg-[var(--mp-surface-sunken)] text-sm">
              {billingAuthContext(lang, entry.intent === 'trial' ? 'trial' : 'free', trialTerms)}
              {entry.intent === 'selftest' && <span className="block mt-1" data-testid="login-selftest-line">{selftestCopy('login_line', selftestLang(lang))}</span>}
              {entry.intent === 'trial' && <Link href="/faq#cancellation" className="inline-flex min-h-11 items-center underline">{t('auth_cancel', uiLang)}</Link>}
            </Alert>}

            <form
              method="post"
              action="/login"
              noValidate
              data-prehydration-guard
              aria-busy={!!pending}
              onSubmit={handleEmailAuth}
              className="space-y-3"
            >
              {mode === "register" && (
                <div className="grid grid-cols-1 min-[430px]:grid-cols-2 gap-3">
                  <TextField
                    ref={fieldRefs.firstName}
                    label={t("login_first_name", uiLang)}
                    name="given-name"
                    type="text"
                    autoComplete="given-name"
                    autoCapitalize="words"
                    enterKeyHint="next"
                    required
                    value={firstName}
                    error={fieldError("firstName")}
                    onChange={(e) => { setFirstName(e.target.value); clearField("firstName"); }}
                  />
                  <TextField
                    label={t("login_last_name", uiLang)}
                    name="family-name"
                    type="text"
                    autoComplete="family-name"
                    autoCapitalize="words"
                    enterKeyHint="next"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>
              )}

              <TextField
                ref={fieldRefs.email}
                label={t("login_email", uiLang)}
                name="email"
                type="email"
                inputMode="email"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                required
                value={email}
                error={fieldError("email")}
                onChange={(e) => { setEmail(e.target.value); clearField("email"); }}
              />

              <TextField
                ref={fieldRefs.password}
                id="login-password"
                label={t("login_password", uiLang)}
                name="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                enterKeyHint="go"
                value={password}
                error={fieldError("password")}
                helper={mode === "register" ? t("login_at_least_8_characters", uiLang) : undefined}
                onChange={(e) => { setPassword(e.target.value); clearField("password"); }}
                end={
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={t("login_show_password", uiLang)}
                    aria-pressed={showPassword}
                    aria-controls="login-password"
                    className="flex h-11 w-11 items-center justify-center rounded-lg text-[var(--mp-fg-subtle)] hover:text-[var(--mp-fg-muted)] mp-focusable"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" aria-hidden /> : <Eye className="w-4 h-4" aria-hidden />}
                  </button>
                }
              />

              {mode === "register" && codeEntryOn && (
                <TextField
                  ref={typedCodeRef}
                  id="register-code"
                  label={codeCopy.fieldLabel}
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={40}
                  value={typedCode}
                  error={typedCodeError || undefined}
                  helper={typedCodeError ? undefined : codeCopy.fieldHelper}
                  onChange={(e) => { setTypedCode(e.target.value); setTypedCodeError(""); }}
                />
              )}

              {mode === "register" && consentOffered && (
                <label htmlFor="login-marketing-opt-in" className="flex items-start gap-3 min-h-11 py-1 text-[14px] leading-snug text-[var(--mp-fg-muted)] cursor-pointer" data-testid="register-marketing-consent">
                  <input
                    id="login-marketing-opt-in"
                    name="marketing-opt-in"
                    type="checkbox"
                    checked={marketingOptIn}
                    onChange={(e) => setMarketingOptIn(e.target.checked)}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--mp-cta-blue)] mp-focusable"
                  />
                  <span>{marketingConsentCopy(uiLang).checkbox}</span>
                </label>
              )}

              {showKnownAccountHint && mostRecentKnownAccount && (
                <div className="flex items-start gap-2.5 rounded-xl border px-3.5 py-3 text-sm" style={{ background: "var(--mp-info-bg)", borderColor: "rgba(58,124,165,.3)", color: "var(--mp-info)" }} role="status">
                  <Info className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden />
                  <div className="flex-1 min-w-0">
                    <p>{t("a22_login_known_account", uiLang).split("{email}")[0]}<strong>{mostRecentKnownAccount.email}</strong>{t("a22_login_known_account", uiLang).split("{email}")[1] ?? ""}</p>
                    <button type="button" onClick={() => { setMode("login"); setEmail(mostRecentKnownAccount.email); setFormError(null); }} className="mt-1.5 min-h-11 font-semibold underline underline-offset-2">
                      {t("a22_login_known_account_action", uiLang)}
                    </button>
                  </div>
                </div>
              )}

              {(entry.intent === 'free' || entry.intent === 'selftest') && <FreeOfferDisclosure lang={lang} />}
              <button
                type="submit"
                aria-disabled={submitBlocked}
                aria-busy={!!pending}
                className={`mp-btn mp-btn--primary w-full justify-center min-h-11 ${submitBlocked ? "opacity-70 pointer-events-none" : ""}`}
              >
                {pendingLabel ?? (mode === "login" ? t("login_sign_in_with_email", uiLang) : t("login_create_account", uiLang))}
              </button>
              <p className="sr-only" role="status" aria-live="polite">{slow ? t("a22_login_slow", uiLang) : ""}</p>
              {slow && <p className="text-[13px] text-[var(--mp-fg-muted)]" aria-hidden>{t("a22_login_slow", uiLang)}</p>}
              {errorText && (
                <div ref={formErrorRef} tabIndex={-1} role="alert" className="rounded-xl border border-[var(--mp-error)]/30 bg-[var(--mp-surface-raised)] px-4 py-3 text-sm text-[var(--mp-fg)] outline-none" data-testid="login-error">
                  <p>{errorText}</p>
                  {formError?.kind === "telegram_only" && (
                    <a href={getTelegramDeepLink(lang)} target="_blank" rel="noopener noreferrer" className="mt-2 mp-btn mp-btn--secondary min-h-11">{t("a22_login_telegram_cta", uiLang)}</a>
                  )}
                </div>
              )}
              {mode === "register" && (
                <p className="text-[13px] text-[var(--mp-fg-muted)]">
                  {t("a22_login_terms_before", uiLang)}{" "}
                  <Link href="/terms" className="inline-block min-h-6 underline underline-offset-2">{t("a22_login_terms", uiLang)}</Link>{" "}
                  {t("a22_login_terms_and", uiLang)}{" "}
                  <Link href="/privacy" className="inline-block min-h-6 underline underline-offset-2">{t("a22_login_privacy", uiLang)}</Link>{t("a22_login_terms_after", uiLang)}
                </p>
              )}
              {entry.intent !== 'free' && entry.intent !== 'selftest' && (
                <p className="text-[13px] text-[var(--mp-fg-muted)]">{t("a22_login_free_line", uiLang).replace("{n}", String(FREE_TIER.questions_per_exam_type))}</p>
              )}
            </form>
            {mode === 'register' && <button type="button" className="min-h-11 text-sm text-[var(--mp-accent-text)] underline" onClick={() => setMode('login')}>{t('auth_existing', uiLang)}</button>}

            <div className="flex items-center gap-3" aria-hidden="true">
              <span className="flex-1 h-px bg-[var(--mp-border)]" />
              <span className="text-xs text-[var(--mp-fg-subtle)]">{t("login_or", uiLang)}</span>
              <span className="flex-1 h-px bg-[var(--mp-border)]" />
            </div>

            {/* Telegram stays a quiet secondary (MPDS-PICKS B.4). */}
            <a
              href={getTelegramDeepLink(lang)}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full min-h-11 flex items-center justify-center gap-2.5 mp-btn mp-btn--ghost text-[var(--mp-fg-muted)] hover:text-[var(--mp-fg)]"
            >
              <svg viewBox="0 0 24 24" className="w-5 h-5 fill-[#229ED9]" aria-hidden="true">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.447 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.12l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.833.941z" />
              </svg>
              {t("a22_login_telegram_cta", uiLang)}
            </a>
            <p className="text-center text-[13px] text-[var(--mp-fg-muted)] leading-snug">{t("a22_login_telegram_helper", uiLang)}</p>

            {/* Telegram code (UX-ONB-23): a 44 px outline button, open on arrival from the hand-off or a failed link. */}
            <div className="pt-1">
              {!showCodeField ? (
                <button
                  type="button"
                  onClick={() => { setShowCodeField(true); setCodeError(""); requestAnimationFrame(() => codeInputRef.current?.focus()); }}
                  aria-expanded={false}
                  className="mp-btn mp-btn--secondary w-full min-h-11 justify-center"
                >
                  <KeyRound className="w-4 h-4" aria-hidden />
                  {t("a22_login_have_code", uiLang)}
                </button>
              ) : (
                <form method="post" action="/login" noValidate data-prehydration-guard onSubmit={handleCodeAuth} className="space-y-2" aria-busy={pending === "code"}>
                  <TextField
                    ref={codeInputRef}
                    label={t("login_telegram_code", uiLang)}
                    name="one-time-code"
                    type="text"
                    inputMode="text"
                    autoComplete="one-time-code"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    value={tgCode}
                    onChange={(e) => { setTgCode(e.target.value); if (codeError) setCodeError(""); }}
                    helper={t("a22_login_code_helper", uiLang)}
                    error={codeError || undefined}
                  />
                  {canReadClipboard && (
                    <button type="button" onClick={() => void pasteCode()} className="mp-btn mp-btn--ghost min-h-11">
                      <ClipboardPaste className="w-4 h-4" aria-hidden />
                      {t("a22_login_paste", uiLang)}
                    </button>
                  )}
                  <button type="submit" aria-disabled={!!pending} aria-busy={pending === "code"} className={`mp-btn mp-btn--secondary w-full justify-center min-h-11 ${pending ? "opacity-70 pointer-events-none" : ""}`}>
                    {pending === "code" ? t("a22_login_pending_code", uiLang) : t("login_redeem_code_sign_in", uiLang)}
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* Contact without a session (LX-31): the form shows only while it can be sent. */}
          <SupportContactForm lang={lang} defaultTopic="access" className="mt-6" />
        </div>
      </main>
    </div>
  );
}

export default function LoginRoute() { return <Suspense fallback={<BrandedLoader />}><LoginPage /></Suspense>; }
