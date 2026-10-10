"use client";

/**
 * /admin/mentor: AI mentor cost and credits view (W3-COSTVIEW). Read-only.
 *
 * One fetch of GET /api/mentor/admin/summary (requireAdmin on the server).
 * Spend per day, per user, per model, credits sold vs consumed per package,
 * stuck holds, clawbacks and the global breaker. Money is micro-USD of true
 * API cost, shown here only; learners see credits, never dollars.
 *
 * Until release train R3 applies the mentor ledger migration the API answers
 * 503 ledger_not_applied and this page says so plainly instead of showing
 * zeros that look like real data.
 */

import { useCallback, useEffect, useState } from "react";
import { Database } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import type { MentorAdminSummary } from "@/lib/mentor/contract";
import { Alert, BrandedLoader, EmptyState } from "@/components/ui";
import { AdminPageShell } from "../_components/AdminPageShell";
import { AdminPermissionGate } from "../_components/AdminPermissionGate";
import {
  BreakerCard,
  ClawbacksTable,
  ModelsTable,
  PackagesTable,
  Section,
  SpendByDay,
  StaleTable,
  StateChips,
  Tiles,
  TopUsersTable,
} from "./_parts";

type Load =
  | { kind: "loading" }
  | { kind: "ok"; summary: MentorAdminSummary }
  | { kind: "not_applied" }
  | { kind: "error"; message: string };

const ERROR_COPY: Record<string, string> = {
  row_cap_reached: "The month has more ledger rows than this view will read, so it refuses to show a short total.",
  db_error: "The database read failed. Nothing is shown rather than a partial number.",
};

export default function AdminMentorPage() {
  return (
    <AdminPermissionGate permission="revenue.read">
      <AdminMentorContent />
    </AdminPermissionGate>
  );
}

function AdminMentorContent() {
  const [state, setState] = useState<Load>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/mentor/admin/summary");
      if (res.ok) {
        setState({ kind: "ok", summary: (await res.json()) as MentorAdminSummary });
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.status === 503 && body.error === "ledger_not_applied") {
        setState({ kind: "not_applied" });
        return;
      }
      setState({
        kind: "error",
        message: (body.error && ERROR_COPY[body.error]) || `The cost view could not load (HTTP ${res.status}).`,
      });
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message || "The cost view could not load." });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = state.kind === "ok" ? state.summary : null;

  return (
    <AdminPageShell
      title="Mentor cost"
      description={
        summary
          ? `Spend, credits and the breaker for UTC ${summary.month}. Read-only. Updated ${summary.generated_at.slice(0, 16).replace("T", " ")} UTC.`
          : "Spend, credits and the breaker for the AI mentor. Read-only."
      }
      freshness={state.kind === "loading" ? "cached" : state.kind === "ok" ? "live" : "disconnected"}
      onRefresh={load}
    >
      {state.kind === "loading" && (
        <div className="flex items-center justify-center py-12">
          <BrandedLoader size={48} label="Loading mentor cost…" />
        </div>
      )}

      {state.kind === "not_applied" && (
        <EmptyState
          tone="neutral"
          icon={<Database className="h-10 w-10" aria-hidden />}
          title="The mentor ledger is not installed yet"
          body="The credits and cost tables arrive with release train R3 (migration 20261022100000). Nothing has been spent through the mentor, so there is nothing to show."
        />
      )}

      {state.kind === "error" && (
        <Alert variant="error" title="Could not load the mentor cost view">
          {state.message}
        </Alert>
      )}

      {summary && (
        <div className="space-y-6">
          <BreakerCard summary={summary} />
          <StateChips state={summary.state} />
          <Tiles summary={summary} />
          <Section title="Spend per day" hint="True API cost of settled calls, UTC days.">
            <SpendByDay rows={summary.by_day} />
          </Section>
          <Section title="Credits sold vs consumed" hint="Lifetime, per package. 1 credit = $0.005 of API cost.">
            <PackagesTable rows={summary.lots_by_package} />
          </Section>
          <Section title="Top users this month" hint="By amount billed. Ids only.">
            <TopUsersTable rows={summary.top_users} />
          </Section>
          <Section title="By model">
            <ModelsTable rows={summary.by_model} />
          </Section>
          <Section title="Stuck holds" hint="Open reservations older than the sweep age; the cron settles them at their ceiling.">
            <StaleTable rows={summary.stale_reservations} />
          </Section>
          <Section title="Recent clawbacks" hint="Unspent credit taken back after a refund or dispute.">
            <ClawbacksTable rows={summary.clawbacks} />
          </Section>
        </div>
      )}
    </AdminPageShell>
  );
}
