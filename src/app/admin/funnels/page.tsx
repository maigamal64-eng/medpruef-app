"use client";

import { AdminPageShell, ComingSoonCard } from "../_components/AdminPageShell";

export default function AdminFunnelsPage() {
  return (
    <AdminPageShell
      title="Funnels"
      description="Onboarding completion and exam-selection drop-off."
      freshness="cached"
    >
      <ComingSoonCard title="Funnel view">
        Step-level drop-off (signup → onboarding → first answer → 50Q → 150Q
        cap → subscribe) lands in a follow-up. Overview already tracks
        day-level paywall hits + 7d conversion.
      </ComingSoonCard>
    </AdminPageShell>
  );
}
