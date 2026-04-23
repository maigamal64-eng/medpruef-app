"use client";

import { AdminPageShell, ComingSoonCard } from "../_components/AdminPageShell";

export default function AdminDeploysPage() {
  return (
    <AdminPageShell
      title="Deploys"
      description="Recent Vercel deployments + status."
      freshness="cached"
    >
      <ComingSoonCard title="Vercel deploys">
        Server-side fetch of{" "}
        <code>business-ops.vercel_deployments</code> (cached 30s) lands next.
        For now, see{" "}
        <a
          href="https://vercel.com/team/medpruef-app/deployments"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          vercel.com
        </a>
        .
      </ComingSoonCard>
    </AdminPageShell>
  );
}
