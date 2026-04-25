"use client";

/**
 * error.tsx — App-level error boundary for Next.js 15 App Router.
 *
 * Catches thrown errors inside the `/` segment tree (everything under
 * src/app/). Unlike `global-error.tsx`, this boundary is wrapped by the
 * root layout so the user keeps the ThemeProvider, ToastProvider, and
 * CSS tokens. Branded, bilingual (DE primary + EN secondary), dark-mode
 * aware via CSS vars, and ships every error to Sentry.
 *
 * Written 2026-04-21 as part of the launch-readiness error-handling
 * pass — previously any thrown render error would fall through to
 * `global-error.tsx` (inline-styled, un-branded) or a blank white
 * screen in production.
 *
 * Special-case: if the error is a 401/auth failure bubbled up from a
 * deeper client boundary, we redirect to /login with a `?next=` param
 * rather than show a generic error. Everything else renders the branded
 * recovery card with "Try again", "Home", and "Report issue" actions.
 */

import { useEffect } from "react";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { AlertTriangle, RefreshCw, Home, MessageSquarePlus } from "lucide-react";

interface ErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Is this an auth-expiry error masquerading as a render error?
 * Our client-side `authFetch` wrapper throws a plain Error with a
 * specific message on 401 responses; deeper components that read that
 * throw propagate up to here. We want those to redirect to /login, not
 * show a generic crash screen.
 */
function isSessionExpiredError(error: Error): boolean {
  if (!error?.message) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("unauthorized") ||
    msg.includes("session expired") ||
    msg.includes("missing x-user-id") ||
    msg.includes("unknown user")
  );
}

export default function AppErrorBoundary({ error, reset }: ErrorBoundaryProps) {
  useEffect(() => {
    // Always ship the error to Sentry first. Even if we redirect the
    // user away from this page, we still want telemetry for the bug
    // that got us here.
    Sentry.captureException(error, {
      tags: { boundary: "app-root" },
      extra: { digest: error.digest },
    });

    // Session-expiry short-circuit: send the user to /login with a
    // return URL so they come right back to what they were doing.
    if (isSessionExpiredError(error) && typeof window !== "undefined") {
      const next = encodeURIComponent(
        window.location.pathname + window.location.search
      );
      window.location.href = `/login?next=${next}`;
    }
  }, [error]);

  return (
    <div className="min-h-screen bg-[var(--mp-surface-sunken)] flex items-center justify-center p-4">
      <div
        className="mp-card w-full max-w-md p-8 text-center"
        role="alert"
        aria-live="assertive"
      >
        <div className="flex justify-center mb-4">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{
              background: "rgba(214, 69, 69, 0.1)",
              color: "var(--mp-error, #D64545)",
            }}
            aria-hidden
          >
            <AlertTriangle size={28} />
          </div>
        </div>

        <h1 className="mp-h2 mb-2" style={{ color: "var(--mp-fg)" }}>
          Etwas ist schiefgelaufen
        </h1>
        <p className="mp-body mb-1" style={{ color: "var(--mp-fg-subtle)" }}>
          Ein unerwarteter Fehler ist aufgetreten. Unser Team wurde automatisch
          benachrichtigt.
        </p>
        <p
          className="mp-small mb-6"
          style={{ color: "var(--mp-fg-muted)", fontStyle: "italic" }}
        >
          Something went wrong. Our team has been notified.
        </p>

        {error.digest && (
          <div
            className="mp-small font-mono mb-6 px-3 py-2 rounded-md inline-block"
            style={{
              background: "var(--mp-surface-sunken)",
              color: "var(--mp-fg-muted)",
              border: "1px solid var(--mp-border-subtle)",
            }}
          >
            Ref: {error.digest}
          </div>
        )}

        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <button
            type="button"
            onClick={reset}
            className="mp-btn mp-btn--primary flex items-center justify-center gap-2"
          >
            <RefreshCw size={16} aria-hidden />
            Erneut versuchen
          </button>
          <Link
            href="/"
            className="mp-btn mp-btn--secondary flex items-center justify-center gap-2"
          >
            <Home size={16} aria-hidden />
            Zur Startseite
          </Link>
          <a
            href={`mailto:user-b7e46e80@example.com?subject=Fehlerbericht${
              error.digest ? ` (Ref: ${error.digest})` : ""
            }&body=${encodeURIComponent(
              `Beschreibung: \n\nFehler: ${error.message}${
                error.digest ? `\nRef: ${error.digest}` : ""
              }\nURL: ${
                typeof window !== "undefined" ? window.location.href : ""
              }`
            )}`}
            className="mp-btn mp-btn--secondary flex items-center justify-center gap-2"
          >
            <MessageSquarePlus size={16} aria-hidden />
            Problem melden
          </a>
        </div>
      </div>
    </div>
  );
}
