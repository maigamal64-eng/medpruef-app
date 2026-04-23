"use client";

import { AdminPageShell, ComingSoonCard } from "../_components/AdminPageShell";

export default function AdminExperimentsPage() {
  return (
    <AdminPageShell
      title="Experiments"
      description="A/B tests — assignment counts and results."
      freshness="cached"
    >
      <ComingSoonCard title="Experiment console">
        The <code>experiments</code> and <code>experiment_assignments</code>{" "}
        tables are live. [name] can seed experiments via{" "}
        <code>/admin/sql</code>. The in-UI create/start/stop + results panel
        ships in a follow-up with the flags UI.
      </ComingSoonCard>
    </AdminPageShell>
  );
}
