"use client";

import { useEffect, useRef, useState } from "react";
import { t, getLang, useLang, renderLang } from "@/lib/i18n";
import LanguagePicker from "@/components/LanguagePicker";
import { authDestination, readAuthEntry, buildAuthHref } from "@/lib/auth-entry";
import Link from "next/link";
import { isUiLanguage, type UiLanguage } from "@/lib/language-model";
import { getSessionToken } from "@/lib/auth";
import { verifyContent, type VerifyState } from "@/lib/verify-email-content";

// Mirror of SESSION_HEADER from lib/session.ts (node:crypto stays out of the client).
const SESSION_HEADER = "x-session-token";


/**
 * /verify-email?token=<rawToken> (UX-ONB-40)
 *
 * The page reads the token once, removes it from the address bar, and waits
 * for "E-Mail bestätigen": confirmation is a POST, so mail scanners that open
 * the link cannot use the single-use token. The result's next step depends
 * on whether THIS browser has a session (the mail app's browser usually does
 * not share the Telegram or installed-app session).
 */
export default function VerifyEmailPage() {
  const uiLang = useLang();
  const [mailLang, setMailLang] = useState<UiLanguage | null>(null);
  const lang = renderLang(mailLang || uiLang);
  const [state, setState] = useState<VerifyState>("ready");
  const [linkedEmail, setLinkedEmail] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const tokenRef = useRef("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('lang');
    if (isUiLanguage(requested)) setMailLang(requested);
    tokenRef.current = params.get("token") ?? "";
    setSignedIn(!!getSessionToken());
    if (!tokenRef.current) setState("invalid_token");
    // The raw token never stays in the address bar or travels further.
    if (params.has("token")) {
      params.delete("token");
      const qs = params.toString();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = 'ltr';
  }, [lang]);

  // Errors move focus to the heading; success is announced by the status region.
  useEffect(() => {
    if (state !== "ready" && state !== "loading" && state !== "success" && state !== "already_linked") headingRef.current?.focus();
  }, [state]);

  const confirm = async () => {
    if (inFlight.current || !tokenRef.current) return;
    inFlight.current = true;
    setState("loading");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const sessionToken = getSessionToken();
    if (sessionToken) headers[SESSION_HEADER] = sessionToken;
    try {
      // Plain fetch: authFetch's 401 redirect must not bounce a cross-device open.
      const res = await fetch("/api/user/link-email/verify", {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers,
        body: JSON.stringify({ token: tokenRef.current, lang: getLang() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setLinkedEmail(typeof data.email === "string" ? data.email : null);
        setState(data.already_linked ? "already_linked" : "success");
        return;
      }
      const mapped: Record<string, VerifyState> = {
        invalid_token: "invalid_token", token_expired: "token_expired", token_already_used: "token_already_used",
        email_taken: "email_taken", session_mismatch: "session_mismatch",
      };
      setState(mapped[data.error as string] ?? "error");
    } catch {
      setState("error");
    } finally {
      inFlight.current = false;
    }
  };

  const entry = readAuthEntry(typeof window === 'undefined' ? undefined : new URLSearchParams(window.location.search));
  const signInHref = buildAuthHref({ ...entry, next: "/settings" });
  const content = verifyContent(state, lang, { signedIn, linkedEmail, signInHref, continueHref: signedIn ? authDestination(entry) : signInHref });

  return (
    <div className="min-h-dvh bg-[var(--mp-surface-sunken)] flex items-center justify-center px-4 py-8">
      <main className="w-full max-w-md">
        <div className="mb-4 flex items-center justify-between gap-3">
          <Link href="/" className="inline-flex min-h-11 items-center font-display text-lg font-extrabold text-[var(--mp-fg)] mp-focusable" aria-label={t("a22_verify_home", lang)}>
            MedPr&uuml;f
          </Link>
          <LanguagePicker preferredLanguage={mailLang || undefined} onChange={() => setMailLang(null)} />
        </div>
        <div className="mp-card p-6 sm:p-8 text-center space-y-5">
          <div className="flex justify-center">{content.icon}</div>
          <div>
            <h1 ref={headingRef} tabIndex={-1} className="mp-h3 mb-2 outline-none">{content.title}</h1>
            <p className="mp-small">{content.body}</p>
            {content.extra && <p className="mp-small mt-2">{content.extra}</p>}
          </div>
          <p className="sr-only" role="status" aria-live="polite">{state === "success" || state === "already_linked" ? content.title : state === "loading" ? t("a22_verify_checking", lang) : ""}</p>
          {state === "ready" || state === "loading" ? (
            <button
              type="button"
              onClick={() => void confirm()}
              aria-busy={state === "loading"}
              aria-disabled={state === "loading"}
              className="mp-btn mp-btn--primary w-full justify-center min-h-11"
            >
              {state === "loading" ? t("a22_verify_checking", lang) : t("a22_verify_confirm", lang)}
            </button>
          ) : (
            <>
              <Link href={content.ctaHref} className="mp-btn mp-btn--primary w-full justify-center min-h-11">{content.ctaLabel}</Link>
              {content.secondary && (
                <a href={content.secondary.href} className="inline-flex min-h-11 items-center justify-center text-sm font-semibold text-[var(--mp-cta-blue)] underline underline-offset-2">
                  {content.secondary.label}
                </a>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
