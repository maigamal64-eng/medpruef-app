"use client";

/**
 * dashboard/error.tsx — Error boundary for the authenticated dashboard
 * tree (everything under `/dashboard/*`).
 *
 * Scope (post-soft-launch §1.4.6.4):
 *
 *   1. Catches `session_expired` / 401 errors bubbling up from deeper
 *      client components (`authFetch` throws on 401 today). Redirects
 *      to `/login?reason=session_expired&next=<current path>` so the
 *      login page can show a toast explaining WHY the user was bounced
 *      (rather than appearing to arbitrarily log them out).
 *   2. For any other thrown error, renders a branded recovery card
 *      mirroring `src/app/error.tsx` — same CTAs, same tone, same
 *      Sentry tagging. We don't reuse `src/app/error.tsx` directly
 *      because its session-expiry redirect goes to `/login?next=...`
 *      without the `reason` param, and the dashboard needs the reason
 *      to render the UX clearly.
 *
 * Next.js App Router semantics: an `error.tsx` at a segment catches
 * thrown errors in that segment's subtree BEFORE they propagate to
 * parent `error.tsx` boundaries. So this catches any crash under
 * `/dashboard/*` without interfering with the site-wide boundary.
 */

import { useEffect } from "react";
import { safeNext } from "@/lib/auth-entry";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { handleChunkLoadError } from "@/lib/master-pwa/chunk-recovery";
import { AlertTriangle, RefreshCw, Home, MessageSquarePlus } from "lucide-react";

interface ErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
}

function isSessionExpiredError(error: Error): boolean {
  if (!error?.message) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes("unauthorized") ||
    msg.includes("session expired") ||
    msg.includes("missing x-user-id") || // legacy pre-S-1 wording
    msg.includes("missing or invalid session") ||
    msg.includes("unknown user") ||
    msg.includes("401")
  );
}

export default function DashboardErrorBoundary({ error, reset }: ErrorBoundaryProps) {
  useEffect(() => {
    // A failed chunk/module load after a deploy: one guarded reload fixes it
    // (src/lib/master-pwa/chunk-recovery.ts reports only a blocked repeat).
    if (handleChunkLoadError(error) !== "ignored") return;
    Sentry.captureException(error, {
      tags: { boundary: "dashboard", path: typeof window !== "undefined" ? window.location.pathname : "" },
      extra: { digest: error.digest },
    });

    if (isSessionExpiredError(error) && typeof window !== "undefined") {
      const next = encodeURIComponent(
        safeNext(window.location.pathname + window.location.search)
      );
      // reason=session_expired so /login can surface a toast explaining
      // the bounce instead of appearing to arbitrarily log the user out.
      window.location.replace(`/login?reason=expired&next=${next}`);
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
