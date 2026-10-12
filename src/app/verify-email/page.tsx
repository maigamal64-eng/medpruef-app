"use client";

import { useEffect, useState } from "react";
import { t } from "@/lib/i18n";
import LanguagePicker from "@/components/LanguagePicker";
import { authDestination, readAuthEntry, buildAuthHref } from "@/lib/auth-entry";
import Link from "next/link";
import { getLang, useLang, renderLang } from "@/lib/i18n";
import { isUiLanguage, type UiLanguage } from "@/lib/language-model";
import { BrandedLoader } from "@/components/Logo";
import { getSessionToken } from "@/lib/auth";
import { CheckCircle, XCircle, AlertCircle } from "lucide-react";

// Mirror of SESSION_HEADER from lib/session.ts — inlined to avoid
// importing the node:crypto-dependent session module in a client component.
const SESSION_HEADER = "x-session-token";

type State =
  | "loading"
  | "success"
  | "already_linked"
  | "invalid_token"
  | "token_expired"
  | "token_already_used"
  | "email_taken"
  | "session_mismatch"
  | "error";

/**
 * /verify-email?token=<rawToken>
 *
 * Reads the token from the URL, calls the verify route, and shows
 * a success or error state. The verify route is intentionally session-optional
 * (the link may open on a different device), so we send the session token as
 * an optional hint but do NOT gate on it.
 *
 * IMPORTANT: uses a plain fetch (not authFetch) so the 401 interceptor in
 * authFetch does not redirect the user to /login before the verify completes.
 */
export default function VerifyEmailPage() {
  const uiLang = useLang();
  const [mailLang, setMailLang] = useState<UiLanguage | null>(null);
  const lang = renderLang(mailLang || uiLang);
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('lang');
    const l = isUiLanguage(requested) ? renderLang(requested) : getLang();
    if (isUiLanguage(requested)) setMailLang(requested);

    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    if (!token) {
      setState("invalid_token");
      return;
    }

    // Plain fetch — intentionally NOT authFetch so we avoid the 401 redirect
    // interceptor bouncing a cross-device open back to /login.
    const sessionToken = getSessionToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (sessionToken) {
      headers[SESSION_HEADER] = sessionToken;
    }

    fetch(`/api/user/link-email/verify?token=${encodeURIComponent(token)}&lang=${l}`, {
      method: "GET",
      signal: AbortSignal.timeout(15_000),
      headers,
    })
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) {
          setState(data.already_linked ? "already_linked" : "success");
        } else {
          const errCode = data.error as string;
          const mapped: Record<string, State> = {
            invalid_token: "invalid_token",
            token_expired: "token_expired",
            token_already_used: "token_already_used",
            email_taken: "email_taken",
            session_mismatch: "session_mismatch",
          };
          setState(mapped[errCode] ?? "error");
        }
      })
      .catch(() => setState("error"));
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = 'ltr';
  }, [lang]);

  if (state === "loading") {
    return (
      <div className="flex flex-col items-center justify-center gap-6 min-h-screen bg-[var(--mp-surface-sunken)]">
        <LanguagePicker preferredLanguage={mailLang || undefined} onChange={() => setMailLang(null)} />
        <BrandedLoader size="lg" />
      </div>
    );
  }

  const content = getContent(state, lang);
  const entry = readAuthEntry(typeof window === 'undefined' ? undefined : new URLSearchParams(window.location.search));
  if (state === 'success' || state === 'already_linked') content.ctaHref = getSessionToken() ? authDestination(entry) : buildAuthHref(entry);
  if (state === 'success' || state === 'already_linked') content.ctaLabel = lang === 'de' ? 'Weiter' : 'Continue';

  return (
    <div className="min-h-screen bg-[var(--mp-surface-sunken)] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <LanguagePicker className="mb-4" preferredLanguage={mailLang || undefined} onChange={() => setMailLang(null)} />
        <div className="mp-card p-8 text-center space-y-5">
          <div className="flex justify-center">{content.icon}</div>
          <div>
            <h1 className="mp-h3 mb-2">{content.title}</h1>
            <p className="mp-small">{content.body}</p>
          </div>
          <Link
            href={content.ctaHref}
            className="mp-btn mp-btn--primary w-full justify-center"
          >
            {content.ctaLabel}
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── copy ─────────────────────────────────────────────────────────────────────

interface ContentSpec {
  icon: React.ReactNode;
  title: string;
  body: string;
  ctaHref: string;
  ctaLabel: string;
}

function getContent(state: State, lang: "de" | "en"): ContentSpec {

  switch (state) {
    case "success":
      return {
        icon: <CheckCircle className="w-14 h-14 text-[var(--mp-viridian)]" />,
        title: t("verify_email_confirmed", lang),
        body: t("verify_your_email_address_has_been_successfully_linked", lang),
        ctaHref: "/settings",
        ctaLabel: t("verify_go_to_settings", lang),
      };

    case "already_linked":
      return {
        icon: <CheckCircle className="w-14 h-14 text-[var(--mp-viridian)]" />,
        title: t("verify_already_linked", lang),
        body: t("verify_your_account_already_has_an_email_address", lang),
        ctaHref: "/settings",
        ctaLabel: t("verify_go_to_settings", lang),
      };

    case "token_already_used":
      return {
        icon: <AlertCircle className="w-14 h-14 text-[var(--mp-status-warning)]" />,
        title: t("verify_link_already_used", lang),
        body: t("verify_this_confirmation_link_has_already_been_used", lang),
        ctaHref: "/settings",
        ctaLabel: t("verify_try_again", lang),
      };

    case "token_expired":
      return {
        icon: <AlertCircle className="w-14 h-14 text-[var(--mp-status-warning)]" />,
        title: t("verify_link_expired", lang),
        body: t("verify_the_confirmation_link_has_expired_valid_for", lang),
        ctaHref: "/settings",
        ctaLabel: t("verify_request_a_new_link", lang),
      };

    case "email_taken":
      return {
        icon: <XCircle className="w-14 h-14 text-[var(--mp-error)]" />,
        title: t("verify_email_already_in_use", lang),
        body: t("verify_this_email_address_is_already_linked_to", lang),
        ctaHref: "/settings",
        ctaLabel: t("verify_use_a_different_address", lang),
      };

    case "session_mismatch":
      return {
        icon: <XCircle className="w-14 h-14 text-[var(--mp-error)]" />,
        title: t("verify_wrong_account", lang),
        body: t("verify_this_link_belongs_to_a_different_account", lang),
        ctaHref: "/settings",
        ctaLabel: t("verify_go_to_settings", lang),
      };

    case "invalid_token":
    case "error":
    default:
      return {
        icon: <XCircle className="w-14 h-14 text-[var(--mp-error)]" />,
        title: t("verify_invalid_link", lang),
        body: t("verify_this_confirmation_link_is_invalid_or_has", lang),
        ctaHref: "/settings",
        ctaLabel: t("verify_go_to_settings", lang),
      };
  }
}
