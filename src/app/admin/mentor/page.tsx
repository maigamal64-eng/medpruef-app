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
import { TrendsHeader } from "./TrendsHeader";
import type { MentorAdminTimezone } from "@/lib/mentor/admin-trends";
import { ControlsSection } from "./ControlsSection";
import { BetaSection } from "./BetaSection";
import { FreeCreditsSection } from "./FreeCreditsSection";
import { OperationsSection } from "./OperationsSection";
import { RevenueSection } from "./RevenueSection";
import { QualitySection } from "./QualitySection";
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
  const [timezone, setTimezone] = useState<MentorAdminTimezone>("Europe/Vienna");
  const [range,setRange] = useState("month");
  const [tab, setTab] = useState("Cost");
  useEffect(()=>{const sync=()=>setTab(new URLSearchParams(window.location.search).get("tab")??"Cost");const select=(event:Event)=>setTab((event as CustomEvent<string>).detail);sync();window.addEventListener("popstate",sync);window.addEventListener("mentor-admin-tab",select);return()=>{window.removeEventListener("popstate",sync);window.removeEventListener("mentor-admin-tab",select);};},[]);
  const [state, setState] = useState<Load>({ kind: "loading" });

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await fetch(`/api/mentor/admin/summary?timezone=${encodeURIComponent(timezone)}`);
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
  }, [timezone]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = state.kind === "ok" ? state.summary : null;

  return (
    <AdminPageShell
      title="AI Mentor"
      description={
        summary
          ? `Spend and breaker for UTC ${summary.month}. Daily trends: ${summary.timezone ?? "UTC"}. Read-only. Updated ${summary.generated_at.slice(0, 16).replace("T", " ")} UTC.`
          : "Spend, credits and the breaker for the AI mentor. Read-only."
      }
      loadState={state.kind === "not_applied" ? undefined : { loading: state.kind === "loading", error: state.kind !== "loading" && state.kind !== "ok" }}
      actions={state.kind === "not_applied" ? <span className="rounded border border-[var(--mp-border-subtle)] px-2 py-1 text-xs">Not installed</span> : undefined}
      onRefresh={load}
    >
      {tab === "Facts" && <OperationsSection view="facts" />}
      {tab === "Readiness" && <><OperationsSection view="readiness" /><ControlsSection /></>}
      {tab === "Beta" && <BetaSection />}
      {tab === "Free credits" && <FreeCreditsSection />}
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
          body="The credits and cost tables arrive with release train R3 (migration 20261022100000). The cost view becomes available after installation. Current spend cannot be determined from this view."
        />
      )}

      {state.kind === "error" && (
        <Alert variant="error" title="Could not load the mentor cost view">
          {state.message}
        </Alert>
      )}

      {summary && tab === "Quality" && summary.quality && <QualitySection quality={summary.quality} />}
      {summary && tab === "Cost" && (
        <div className="space-y-6">
          <TrendsHeader summary={summary} />
          <div className="flex gap-3 flex-wrap"><label className="text-xs">Daily timezone <select aria-label="Daily timezone" value={timezone} onChange={e=>setTimezone(e.target.value as MentorAdminTimezone)} className="ml-2 min-h-11 bg-[var(--mp-surface-raised)] rounded border border-[var(--mp-border-subtle)] px-2"><option value="Europe/Vienna">Vienna</option><option value="UTC">UTC</option></select></label><label className="text-xs">Trend range <select aria-label="Trend range" value={range} onChange={e=>setRange(e.target.value)} className="ml-2 min-h-11 bg-[var(--mp-surface-raised)] rounded border border-[var(--mp-border-subtle)] px-2"><option value="today">Today</option><option value="7">7 days</option><option value="month">Month</option></select></label></div>
          <BreakerCard summary={summary} />
          <StateChips state={summary.state} />
          <Tiles summary={summary} />
          <Section title="Revenue next to cost" hint="Mentor payments per currency, refunds subtracted. Read-only.">
            <RevenueSection />
          </Section>

          <Section title="Spend per day" hint={`True API cost of settled calls, ${timezone === "UTC" ? "UTC" : "Vienna"} days. Last 14 daily bars shown.`}>
            <SpendByDay timezone={timezone} rows={summary.by_day.slice(range==="today"?-1:range==="7"?-7:-14)} />
          </Section>
          <Section title="Credits sold vs consumed" hint="Lifetime, per package. 1 credit = $0.005 of API cost.">
            <PackagesTable rows={summary.lots_by_package} />
          </Section>
          <Section title="Top users this month" hint="By amount billed. Open a learner support panel from the id.">
            <TopUsersTable rows={summary.top_users} />
          </Section>
          <Section title="By model">
            <ModelsTable rows={summary.by_model} />
          </Section>
          <Section title="Stuck holds" hint="Open reservations older than the sweep age; the cron records house cost without a learner debit.">
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
