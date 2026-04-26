"use client";

/**
 * RootErrorBoundary — global React error boundary mounted at app root.
 *
 * Catches React's "NotFoundError: Failed to execute 'removeChild' /
 * 'insertBefore' on 'Node'" crashes (Sentry issue, review-2026-04-26-B3)
 * which most commonly happen when:
 *
 *   1. Browser translation extensions (Google Translate, Edge / iOS
 *      Safari translate, Microsoft Edge built-in) rewrite text nodes
 *      that React then tries to unmount → reconciliation diff
 *      doesn't find the node it expects.
 *   2. Portal-rendered modal cleanup race (Dialog removed twice on
 *      rapid open/close).
 *   3. Suspense boundary fallback swap during data fetch.
 *
 * On catch:
 *   - For NotFoundError specifically → render a calm "Etwas glitcht.
 *     Lade neu …" toast for 2s, then `window.location.reload()`.
 *     The error is almost always non-recoverable in the React tree
 *     because the tree's understanding of the DOM is now wrong;
 *     reload is the cleanest fix.
 *   - For everything else → render a minimal inline error card with
 *     a "Reload" button. No white-screen-of-death.
 *
 * Sentry capture happens in both paths via the existing global
 * Sentry boot in instrumentation.ts.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { addBreadcrumb, captureServerError } from "@/lib/sentry-capture";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorName: string | null;
  reloadInFlight: boolean;
}

const RELOAD_DELAY_MS = 2000;

export default class RootErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorName: null, reloadInFlight: false };

  static getDerivedStateFromError(err: Error): State {
    return {
      hasError: true,
      errorName: err.name || "Error",
      reloadInFlight: false,
    };
  }

  componentDidCatch(err: Error, info: ErrorInfo): void {
    // Tag the breadcrumb so we can filter by error type in Sentry.
    addBreadcrumb({
      category: "react",
      message: "root_boundary_catch",
      level: "error",
      data: {
        name: err.name,
        message: err.message?.slice(0, 200),
        componentStack: info.componentStack?.slice(0, 500),
      },
    });
    captureServerError(err, {
      route: "client/root-boundary",
      errorName: err.name,
    });

    // For NotFoundError specifically (the Translate-extension crash
    // family), schedule a reload so the user isn't stuck on a broken
    // tree. The 2s delay lets the toast render so the experience
    // doesn't feel like a black-box refresh.
    if (err.name === "NotFoundError" && typeof window !== "undefined") {
      this.setState({ reloadInFlight: true });
      setTimeout(() => {
        try {
          window.location.reload();
        } catch {
          /* noop */
        }
      }, RELOAD_DELAY_MS);
    }
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.state.errorName === "NotFoundError" || this.state.reloadInFlight) {
      // Calm toast — short copy, no buttons. Reload happens
      // automatically.
      return (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-[var(--mp-surface-sunken)]"
          role="status"
          aria-live="polite"
        >
          <div className="max-w-sm mx-4 rounded-2xl bg-[var(--mp-surface-raised)] border border-[var(--mp-border)] shadow-lg p-6 text-center">
            <p className="text-sm font-semibold text-[var(--mp-fg)] mb-1">
              Kurz aussetzen …
            </p>
            <p className="text-xs text-[var(--mp-fg-muted)]">
              Wir laden die Seite gleich neu.
            </p>
          </div>
        </div>
      );
    }

    // Generic error card — gives the user a button instead of an
    // automatic reload, so they can copy any context first.
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-[var(--mp-surface-sunken)] p-4">
        <div className="max-w-md w-full rounded-2xl bg-[var(--mp-surface-raised)] border border-[var(--mp-border)] shadow-lg p-6">
          <h2 className="mp-h2 mb-2">Es ist etwas schiefgelaufen.</h2>
          <p className="text-sm text-[var(--mp-fg-muted)] mb-4">
            Wir haben den Fehler aufgezeichnet. Lade die Seite neu, um
            weiterzulernen. Bei wiederholtem Auftreten:{" "}
            <a
              href="mailto:user-b7e46e80@example.com"
              className="text-[var(--mp-cta-blue)] underline"
            >
              user-b7e46e80@example.com
            </a>
            .
          </p>
          <button
            type="button"
            className="mp-btn mp-btn--primary w-full"
            onClick={() => {
              try {
                window.location.reload();
              } catch {
                /* noop */
              }
            }}
          >
            Seite neu laden
          </button>
        </div>
      </div>
    );
  }
}
