"use client";

/**
 * Admin route error boundary (UX-ADM-01).
 *
 * Next.js nests this inside src/app/admin/layout.tsx, so a page that throws
 * keeps the admin shell and sidebar mounted instead of falling through to
 * the app-level error page. Retry re-renders the segment.
 */

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { handleChunkLoadError } from "@/lib/master-pwa/chunk-recovery";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // A failed chunk/module load after a deploy: one guarded reload fixes it
    // (src/lib/master-pwa/chunk-recovery.ts reports only a blocked repeat).
    if (handleChunkLoadError(error) !== "ignored") return;
    Sentry.captureException(error, { tags: { boundary: "admin" } });
  }, [error]);

  return (
    <div className="p-4 sm:p-6">
      <div role="alert" className="mx-auto max-w-xl rounded-xl border border-[var(--mp-error)]/40 bg-[var(--mp-surface-raised)] p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--mp-error)]" aria-hidden />
          <div className="min-w-0">
            <h1 className="text-base font-semibold text-[var(--mp-fg)]">This page could not be displayed.</h1>
            <p className="mt-1 text-sm text-[var(--mp-fg-muted)]">
              The rest of the admin still works. Retry the page, or use the sidebar to open another one.
            </p>
            {error.digest ? (
              <p className="mt-2 font-mono text-xs text-[var(--mp-fg-subtle)]">Reference: {error.digest}</p>
            ) : null}
            <button type="button" onClick={reset} className="mp-btn mp-btn--primary mp-btn--sm mt-4 inline-flex min-h-11 items-center gap-2">
              <RefreshCw className="h-4 w-4" aria-hidden /> Retry
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
