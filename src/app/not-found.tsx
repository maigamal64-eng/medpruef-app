/**
 * not-found.tsx — Branded 404 for Next.js 15 App Router.
 *
 * Renders inside the root layout (ThemeProvider + MPDS tokens), so the
 * user stays in the app shell — no white-screen jolt. Written
 * 2026-04-21 as part of the launch-readiness pass; previously the route
 * fell back to Next.js's generic "This page could not be found." Courier
 * page, which is off-brand and un-localised.
 *
 * Bilingual (DE primary, EN secondary), dark-mode via CSS vars. Offers
 * three recovery paths: back home, start a quiz, or search.
 *
 * Not a client component because we don't need hooks here — Next.js
 * can statically pre-render the 404 HTML which is faster for crawlers.
 */

import Link from "next/link";
import { FileQuestion, Home, PlayCircle, Search } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-[var(--mp-surface-sunken)] flex items-center justify-center p-4">
      <div className="mp-card w-full max-w-md p-8 text-center">
        <div className="flex justify-center mb-4">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center"
            style={{
              background: "rgba(0, 123, 95, 0.1)",
              color: "var(--mp-viridian)",
            }}
            aria-hidden
          >
            <FileQuestion size={28} />
          </div>
        </div>

        <div
          className="mp-hero-num mb-2"
          style={{
            fontSize: "3rem",
            lineHeight: 1,
            color: "var(--mp-viridian)",
            fontFamily: "var(--font-display, 'Plus Jakarta Sans')",
          }}
        >
          404
        </div>

        <h1 className="mp-h2 mb-2" style={{ color: "var(--mp-fg)" }}>
          Seite nicht gefunden
        </h1>
        <p className="mp-body mb-1" style={{ color: "var(--mp-fg-subtle)" }}>
          Die Seite, die du suchst, existiert nicht mehr oder wurde verschoben.
        </p>
        <p
          className="mp-small mb-6"
          style={{ color: "var(--mp-fg-muted)", fontStyle: "italic" }}
        >
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>

        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <Link
            href="/"
            className="mp-btn mp-btn--primary flex items-center justify-center gap-2"
          >
            <Home size={16} aria-hidden />
            Zur Startseite
          </Link>
          <Link
            href="/quiz"
            className="mp-btn mp-btn--secondary flex items-center justify-center gap-2"
          >
            <PlayCircle size={16} aria-hidden />
            Quiz starten
          </Link>
          <Link
            href="/?search=1"
            className="mp-btn mp-btn--secondary flex items-center justify-center gap-2"
          >
            <Search size={16} aria-hidden />
            Suchen
          </Link>
        </div>
      </div>
    </div>
  );
}
