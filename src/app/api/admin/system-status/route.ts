import { NextResponse } from "next/server";
import { adminRouteShell } from "@/lib/admin/shell";
import { fetchSentryIssues, fetchVercelDeployments } from "@/lib/admin/opsExternal";
import { currentProductionDeploy } from "@/lib/admin/deploy-rules";
import { readKillSwitches } from "@/lib/admin/kill-switches";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/system-status (a19, UX-ADM-09 "System status" row, ADM-12 B).
 *
 * The production deploy serving medpruf.com and its age, the number of
 * unresolved Sentry issues (14 days) and the kill switches. Vercel and
 * Sentry each have an 8 s timeout; an upstream that is not configured or
 * fails comes back as its own `{ ok: false, reason }`, never as zero.
 * Loaded by Today separately from the overview snapshot, so a slow upstream
 * never holds the Today page.
 */
export const GET = adminRouteShell(
  async () => {
    const [deploys, sentry] = await Promise.all([fetchVercelDeployments(20), fetchSentryIssues("14d", 0)]);
    const production = deploys.configured && deploys.ok ? currentProductionDeploy(deploys.deployments) : null;
    return NextResponse.json(
      {
        deploy: !deploys.configured
          ? { ok: false, reason: `Set ${deploys.missing} to show the production deploy.` }
          : !deploys.ok
            ? { ok: false, reason: deploys.reason }
            : production
              ? { ok: true, sha: production.shaShort, created_at: production.createdAt, summary: production.commitSummary }
              : { ok: false, reason: "No ready production deploy in the latest 20." },
        sentry: !sentry.configured
          ? { ok: false, reason: `Set ${sentry.missing} to show Sentry issues.` }
          : !sentry.ok
            ? { ok: false, reason: sentry.reason }
            : { ok: true, unresolved: sentry.total },
        kill_switches: readKillSwitches(),
        generated_at: new Date().toISOString(),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  },
  { route: "/api/admin/system-status", rateLimit: { limit: 60, windowMs: 60_000 } }
);
