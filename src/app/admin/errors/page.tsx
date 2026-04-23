"use client";

import { ExternalLink } from "lucide-react";
import { AdminPageShell, ComingSoonCard } from "../_components/AdminPageShell";

export default function AdminErrorsPage() {
  return (
    <AdminPageShell
      title="Errors"
      description="Sentry issue stream for medpruf (javascript-nextjs)."
      freshness="cached"
      actions={
        <a
          href="https://medpruf.sentry.io/issues/?project=javascript-nextjs"
          target="_blank"
          rel="noopener noreferrer"
          className="mp-btn mp-btn--primary mp-btn--sm flex items-center gap-1.5"
        >
          Open in Sentry
          <ExternalLink size={12} />
        </a>
      }
    >
      <ComingSoonCard title="Mirrored error feed">
        We deliberately don&apos;t mirror Sentry into Supabase — keeps the
        signal in one source of truth. The Sentry link above jumps
        straight to the project feed.
      </ComingSoonCard>
    </AdminPageShell>
  );
}
