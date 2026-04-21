"use client";

/**
 * global-error.tsx — Last-resort error boundary for Next.js App Router.
 *
 * Catches rendering errors in the root `layout.tsx` itself (before
 * ThemeProvider, ToastProvider, CSS tokens load). Must render its own
 * <html>+<body> because at this level nothing else has mounted.
 *
 * This file has NO access to MPDS tokens (globals.css may not have loaded),
 * so it uses hardcoded brand colours. Kept minimal on purpose — just
 * enough to not scare the user and get a Sentry report on the way out.
 *
 * 99% of render errors will be caught by `error.tsx` (branded, themed,
 * with toast + back/retry/report). Only root-layout-level crashes
 * (ThemeProvider imploding, layout.tsx throwing at the top level)
 * bubble up here.
 *
 * 2026-04-21: added graceful degradation — light-mode colors with an
 * explicit prefers-color-scheme dark override so stuck-in-dark users
 * don't get a blinding white screen. Also added Sentry captureException
 * (previously only ran once on mount but the original shipped with
 * that hook, which was fine; we keep it).
 */

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: { boundary: "global-root" },
      extra: { digest: error.digest, origin: "global-error.tsx" },
    });
  }, [error]);

  return (
    <html lang="de">
      <head>
        <title>Fehler — MedPrüf</title>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width,initial-scale=1"
        />
        <style>{`
          :root {
            --bg: #F7F9FC;
            --surface: #FFFFFF;
            --fg: #1A2B3C;
            --fg-muted: #4A5568;
            --viridian: #007B5F;
            --oxford: #001B3D;
            --border: #E4E9F0;
            --error-tint: rgba(214, 69, 69, .1);
            --error: #D64545;
          }
          @media (prefers-color-scheme: dark) {
            :root {
              --bg: #0F172A;
              --surface: #1E293B;
              --fg: #E2E8F0;
              --fg-muted: #94A3B8;
              --border: #334155;
            }
          }
          *, *::before, *::after { box-sizing: border-box; }
          body {
            margin: 0;
            font-family: Inter, -apple-system, BlinkMacSystemFont,
              "Segoe UI", Roboto, sans-serif;
            background: var(--bg);
            color: var(--fg);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 1rem;
          }
          .ge-card {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 2rem;
            max-width: 420px;
            width: 100%;
            text-align: center;
            box-shadow: 0 4px 24px rgba(0, 0, 0, .05);
          }
          .ge-badge {
            width: 64px; height: 64px;
            border-radius: 50%;
            background: var(--error-tint);
            color: var(--error);
            display: inline-flex;
            align-items: center;
            justify-content: center;
            margin-bottom: 1rem;
            font-size: 2rem;
          }
          .ge-title {
            font-size: 1.375rem;
            font-weight: 700;
            margin: 0 0 .5rem;
            color: var(--fg);
          }
          .ge-body {
            color: var(--fg-muted);
            font-size: .95rem;
            margin: 0 0 1.5rem;
            line-height: 1.5;
          }
          .ge-ref {
            font-family: "JetBrains Mono", ui-monospace, monospace;
            font-size: .75rem;
            color: var(--fg-muted);
            background: var(--bg);
            border: 1px solid var(--border);
            border-radius: 6px;
            padding: .375rem .625rem;
            display: inline-block;
            margin-bottom: 1rem;
          }
          .ge-actions {
            display: flex;
            flex-direction: column;
            gap: .5rem;
          }
          .ge-btn {
            font-family: inherit;
            font-size: .875rem;
            font-weight: 600;
            border: 1px solid transparent;
            border-radius: 10px;
            padding: .6875rem 1rem;
            cursor: pointer;
            text-decoration: none;
            display: inline-block;
            transition: background .15s ease, border-color .15s ease;
          }
          .ge-btn--primary {
            background: var(--viridian);
            color: #fff;
          }
          .ge-btn--primary:hover { background: var(--oxford); }
          .ge-btn--secondary {
            background: transparent;
            color: var(--fg);
            border-color: var(--border);
          }
          .ge-btn--secondary:hover { background: var(--bg); }
          @media (min-width: 480px) {
            .ge-actions { flex-direction: row; justify-content: center; }
          }
        `}</style>
      </head>
      <body>
        <div className="ge-card" role="alert" aria-live="assertive">
          <div className="ge-badge" aria-hidden>
            !
          </div>
          <h1 className="ge-title">Etwas ist schiefgelaufen</h1>
          <p className="ge-body">
            Ein unerwarteter Fehler ist aufgetreten. Unser Team wurde
            automatisch benachrichtigt.
            <br />
            <em style={{ fontSize: ".85rem" }}>
              Something went wrong. Our team has been notified.
            </em>
          </p>
          {error.digest && (
            <div className="ge-ref">Ref: {error.digest}</div>
          )}
          <div className="ge-actions">
            <button
              type="button"
              onClick={reset}
              className="ge-btn ge-btn--primary"
            >
              Erneut versuchen
            </button>
            {/*
              global-error.tsx renders OUTSIDE the Next.js app shell
              (its own <html><body> tree), so we can't use <Link />
              from next/link. The plain <a> is the only valid option.
              Disabling the lint rule per-occurrence, not file-wide.
            */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/" className="ge-btn ge-btn--secondary">
              Zur Startseite
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
