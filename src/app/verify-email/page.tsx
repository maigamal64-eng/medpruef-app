"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getLang } from "@/lib/i18n";
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
  const [lang, setLangState] = useState<"de" | "en">("de");
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    const l = getLang();
    setLangState(l);

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

  if (state === "loading") {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[var(--mp-surface-sunken)]">
        <BrandedLoader size="lg" />
      </div>
    );
  }

  const content = getContent(state, lang);

  return (
    <div className="min-h-screen bg-[var(--mp-surface-sunken)] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
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
  const de = lang === "de";

  switch (state) {
    case "success":
      return {
        icon: <CheckCircle className="w-14 h-14 text-[var(--mp-viridian)]" />,
        title: de ? "E-Mail bestätigt" : "Email confirmed",
        body: de
          ? "Ihre E-Mail-Adresse wurde erfolgreich mit Ihrem Konto verknüpft. Sie können sich jetzt auch mit E-Mail und Passwort anmelden."
          : "Your email address has been successfully linked to your account. You can now also sign in with email and password.",
        ctaHref: "/settings",
        ctaLabel: de ? "Zu den Einstellungen" : "Go to settings",
      };

    case "already_linked":
      return {
        icon: <CheckCircle className="w-14 h-14 text-[var(--mp-viridian)]" />,
        title: de ? "Bereits verknüpft" : "Already linked",
        body: de
          ? "Ihr Konto hat bereits eine E-Mail-Adresse."
          : "Your account already has an email address.",
        ctaHref: "/settings",
        ctaLabel: de ? "Zu den Einstellungen" : "Go to settings",
      };

    case "token_already_used":
      return {
        icon: <AlertCircle className="w-14 h-14 text-[var(--mp-status-warning)]" />,
        title: de ? "Link bereits verwendet" : "Link already used",
        body: de
          ? "Dieser Bestätigungslink wurde bereits eingelöst. Falls die Verknüpfung nicht geklappt hat, starten Sie den Vorgang bitte erneut."
          : "This confirmation link has already been used. If the link did not work, please start the process again.",
        ctaHref: "/settings",
        ctaLabel: de ? "Erneut versuchen" : "Try again",
      };

    case "token_expired":
      return {
        icon: <AlertCircle className="w-14 h-14 text-[var(--mp-status-warning)]" />,
        title: de ? "Link abgelaufen" : "Link expired",
        body: de
          ? "Der Bestätigungslink ist abgelaufen (Gültigkeit: 24 Stunden). Bitte fordern Sie über die Einstellungen einen neuen Link an."
          : "The confirmation link has expired (valid for 24 hours). Please request a new link from your settings.",
        ctaHref: "/settings",
        ctaLabel: de ? "Neuen Link anfordern" : "Request a new link",
      };

    case "email_taken":
      return {
        icon: <XCircle className="w-14 h-14 text-[var(--mp-error)]" />,
        title: de ? "E-Mail bereits vergeben" : "Email already in use",
        body: de
          ? "Diese E-Mail-Adresse ist bereits einem anderen Konto zugeordnet. Bitte verwenden Sie eine andere Adresse."
          : "This email address is already linked to another account. Please use a different address.",
        ctaHref: "/settings",
        ctaLabel: de ? "Andere Adresse wählen" : "Use a different address",
      };

    case "session_mismatch":
      return {
        icon: <XCircle className="w-14 h-14 text-[var(--mp-error)]" />,
        title: de ? "Falsches Konto" : "Wrong account",
        body: de
          ? "Der Link gehört zu einem anderen Konto. Bitte melden Sie sich mit dem richtigen Konto an und öffnen Sie den Link erneut."
          : "This link belongs to a different account. Please sign in with the correct account and open the link again.",
        ctaHref: "/settings",
        ctaLabel: de ? "Zu den Einstellungen" : "Go to settings",
      };

    case "invalid_token":
    case "error":
    default:
      return {
        icon: <XCircle className="w-14 h-14 text-[var(--mp-error)]" />,
        title: de ? "Ungültiger Link" : "Invalid link",
        body: de
          ? "Dieser Bestätigungslink ist ungültig oder wurde bereits verwendet. Bitte fordern Sie einen neuen Link an."
          : "This confirmation link is invalid or has already been used. Please request a new link.",
        ctaHref: "/settings",
        ctaLabel: de ? "Zu den Einstellungen" : "Go to settings",
      };
  }
}
