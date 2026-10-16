"use client";

/**
 * /admin/subscriptions — the paid roster (ADM-10 option A, a14 2026-10-12).
 *
 * Who pays, who renews by itself and who loses Pro soon: one row per
 * learner from GET /api/admin/subscriptions, default view "Ending soon,
 * will not renew". Pending checkout rows live under their own view so the
 * Overview "Stuck pending" tile (?status=pending) lands on something real
 * (UX-ADM-08). Read-only: no renewal nudge is sent from here.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";
import { AdminPageShell } from "../_components/AdminPageShell";
import { UserLink } from "../_components/UserLink";
import { formatEuroFromCents, formatInt } from "../_components/primitives";

type Cadence = "auto_renews" | "one_time" | "unknown";

interface RosterRow {
  user_id: string;
  label: string | null;
  status: "paying" | "trial" | "ended";
  plan: string;
  tier: string | null;
  cadence: Cadence;
  paid_to_date_cents: number;
  access_ends: string | null;
  days_left: number | null;
}

interface PendingRow {
  id: string;
  user_id: string | null;
  label: string | null;
  tier: string | null;
  provider: string | null;
  amount_cents: number | null;
  currency: string | null;
  created_at: string;
  age_hours: number;
}

interface Roster {
  generated_at: string;
  names_visible: boolean;
  kpis: {
    paying: number;
    paying_by_cadence: { renews: number; one_time: number; unknown: number };
    in_trial: number;
    lose_7d: number;
    lose_30d: number;
    renew_30d: number;
    ended_30d: number;
    lifetime_gross_cents: number;
    stuck_pending_24h: number;
    /** a-seed-seats: live seed seats, never in the paying count (absent before the change). */
    seed_seats?: number;
  };
  rows: RosterRow[];
  seats?: Array<{ user_id: string; label: string | null; seat_ends: string | null; days_left: number | null }>;
  pending: PendingRow[];
  basis: Record<string, string>;
}

const VIEWS = [
  { key: "ending", label: "Ending soon, will not renew" },
  { key: "all", label: "All payers" },
  { key: "renewing", label: "Renewing" },
  { key: "trial", label: "In trial" },
  { key: "ended", label: "Ended (30 days)" },
  { key: "pending", label: "Pending checkouts" },
] as const;
type View = (typeof VIEWS)[number]["key"];

function viewFromUrl(): View {
  if (typeof window === "undefined") return "ending";
  const params = new URLSearchParams(window.location.search);
  if (params.get("status") === "pending") return "pending";
  const v = params.get("view");
  return (VIEWS.find((x) => x.key === v)?.key ?? "ending") as View;
}

function filterRows(rows: RosterRow[], view: View): RosterRow[] {
  switch (view) {
    case "ending":
      return rows.filter((r) => r.status === "paying" && r.cadence !== "auto_renews" && r.days_left != null && r.days_left <= 30);
    case "all":
      return rows.filter((r) => r.status === "paying");
    case "renewing":
      return rows.filter((r) => r.status === "paying" && r.cadence === "auto_renews");
    case "trial":
      return rows.filter((r) => r.status === "trial");
    case "ended":
      return rows.filter((r) => r.status === "ended");
    default:
      return [];
  }
}

const CADENCE_LABEL: Record<Cadence, string> = { auto_renews: "Renews", one_time: "One-time", unknown: "Unknown" };

function dateOnly(iso: string | null): string {
  if (!iso) return "No end date";
  return new Date(iso).toLocaleDateString("de-AT", { timeZone: "Europe/Vienna", day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function AdminSubscriptionsPage() {
  const { can, loading: accessLoading } = useAdminPermissions();
  const [data, setData] = useState<Roster | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [view, setView] = useState<View>("ending");

  useEffect(() => setView(viewFromUrl()), []);

  const chooseView = (next: View) => {
    setView(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("status");
      if (next === "ending") url.searchParams.delete("view");
      else url.searchParams.set("view", next);
      window.history.replaceState(null, "", url.toString());
    } catch {
      /* URL sync is a convenience only */
    }
  };

  const load = useCallback(async () => {
    if (!can("revenue.read")) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/subscriptions", { cache: "no-store" });
      if (!res.ok) throw new Error(`Could not load the paid roster (HTTP ${res.status}).`);
      setData((await res.json()) as Roster);
      setUpdatedAt(new Date().toISOString());
    } catch (e) {
      setError((e as Error).message || "Could not load the paid roster.");
    } finally {
      setLoading(false);
    }
  }, [can]);

  useEffect(() => {
    if (accessLoading) return;
    if (can("revenue.read")) void load();
    else setLoading(false);
  }, [accessLoading, can, load]);


  const counts = useMemo(() => {
    const rows = data?.rows ?? [];
    return Object.fromEntries(VIEWS.map((v) => [v.key, v.key === "pending" ? data?.pending.length ?? 0 : filterRows(rows, v.key).length])) as Record<View, number>;
  }, [data]);
  const shown = data ? filterRows(data.rows, view) : [];
  const k = data?.kpis;

  return (
    <AdminPageShell
      title="Subscriptions"
      description="Who pays, who renews and who loses Pro. One row per paying learner, by access end."
      loadState={{ loading, error }}
      onRefresh={load}
    >
      {error && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-[var(--mp-error)]/30 bg-[var(--mp-error-bg)] px-4 py-3 text-sm text-[var(--mp-error)]">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p>{error}</p>
            {data && <p className="mt-1 text-xs">Showing the last successful snapshot from {updatedAt ? new Date(updatedAt).toLocaleString() : "an earlier load"}.</p>}
          </div>
          <button type="button" onClick={load} className="mp-btn mp-btn--secondary mp-btn--sm inline-flex shrink-0 items-center gap-1" disabled={loading}>
            <RefreshCw size={12} aria-hidden="true" /> Retry
          </button>
        </div>
      )}
      {!accessLoading && !can("revenue.read") && (
        <div role="alert" className="rounded-xl border border-[var(--mp-error)]/30 bg-[var(--mp-error-bg)] px-4 py-3 text-sm text-[var(--mp-error)]">
          You do not have permission to view subscription operations.
        </div>
      )}
      {can("revenue.read") && !data && loading && (
        <div role="status" className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-4 py-8 text-center text-sm text-[var(--mp-fg-muted)]">Loading the paid roster…</div>
      )}
      {can("revenue.read") && data && k && <>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="roster-kpis">
          <Kpi label="Paying learners" value={formatInt(k.paying)} sub={`${k.paying_by_cadence.one_time} one-time, ${k.paying_by_cadence.renews} renew${k.paying_by_cadence.unknown ? `, ${k.paying_by_cadence.unknown} unknown` : ""} · ${k.in_trial} in trial`} />
          <Kpi label="Lose Pro in 7 days" value={formatInt(k.lose_7d)} sub="one-time or unknown plan, will not renew by itself" warn={k.lose_7d > 0} />
          <Kpi label="Lose Pro in 30 days" value={formatInt(k.lose_30d)} sub={`plus ${k.renew_30d} renewal${k.renew_30d === 1 ? "" : "s"} due`} />
          <Kpi label="Paid to date (gross)" value={formatEuroFromCents(k.lifetime_gross_cents)} sub="all EUR payments, before fees and refunds" />
        </div>

        {(k.seed_seats ?? 0) > 0 && (
          <section data-testid="roster-seed-seats" aria-labelledby="seed-seats-title" className="rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4">
            <h2 id="seed-seats-title" className="text-sm font-semibold text-[var(--mp-fg)]">Seed seats: {formatInt(k.seed_seats ?? 0)} live, not counted as paying</h2>
            <p className="mt-1 text-xs text-[var(--mp-fg-muted)]">{data.basis.seed_seats}</p>
            <ul className="mt-3 flex flex-col gap-1 text-sm">
              {(data.seats ?? []).map((s) => (
                <li key={s.user_id} className="flex flex-wrap justify-between gap-2">
                  <UserLink id={s.user_id} label={s.label ?? undefined} />
                  <span className="text-[var(--mp-fg-muted)]">{s.days_left == null ? "no end" : `${s.days_left} day${s.days_left === 1 ? "" : "s"} left`}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)]">
          <div role="tablist" aria-label="Roster views" className="flex flex-wrap gap-2 border-b border-[var(--mp-border-subtle)] p-3">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                role="tab"
                type="button"
                aria-selected={view === v.key}
                onClick={() => chooseView(v.key)}
                className={`min-h-[36px] rounded-full border px-3 py-1 text-xs font-medium ${
                  view === v.key
                    ? "border-[var(--mp-fg)] bg-[var(--mp-fg)] text-[var(--mp-bg)]"
                    : "border-[var(--mp-border-subtle)] text-[var(--mp-fg)] hover:bg-[var(--mp-surface-sunken)]"
                }`}
              >
                {v.label} <span className="tabular-nums opacity-80">{counts[v.key]}</span>
              </button>
            ))}
          </div>

          {view === "pending" ? (
            <PendingList rows={data.pending} />
          ) : (
            <>
              {view === "ending" && (
                <p className="border-b border-[var(--mp-border-subtle)] bg-[var(--mp-info-bg,transparent)] px-4 py-2 text-xs text-[var(--mp-fg-muted)]">
                  Payers on a one-time or unknown plan whose access ends within 30 days. {k.lose_7d > 0 ? `${k.lose_7d} end within 7 days.` : "None ends within 7 days."}
                </p>
              )}
              {shown.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-[var(--mp-fg-muted)]">No learner in this view.</p>
              ) : (
                <>
                  <ul className="divide-y divide-[var(--mp-border-subtle)] md:hidden" data-testid="roster-cards">
                    {shown.map((r) => <RosterCard key={r.user_id} row={r} />)}
                  </ul>
                  <div className="hidden md:block">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-[var(--mp-border-subtle)] text-left text-[10px] uppercase tracking-wider text-[var(--mp-fg-muted)]">
                          <th className="px-4 py-2.5 font-medium">Learner</th>
                          <th className="px-3 py-2.5 font-medium">Plan</th>
                          <th className="px-3 py-2.5 font-medium">Renews?</th>
                          <th className="px-3 py-2.5 text-right font-medium">Paid to date</th>
                          <th className="px-3 py-2.5 font-medium">Access ends</th>
                          <th className="px-3 py-2.5 text-right font-medium">Days left</th>
                          <th className="px-4 py-2.5"><span className="sr-only">Open</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((r) => (
                          <tr key={r.user_id} className="border-b border-[var(--mp-border-subtle)]/60 last:border-0">
                            <td className="px-4 py-2.5"><LearnerName row={r} /></td>
                            <td className="px-3 py-2.5 text-[var(--mp-fg)]">{r.plan}</td>
                            <td className="px-3 py-2.5"><CadenceChip cadence={r.cadence} /></td>
                            <td className="px-3 py-2.5 text-right font-mono tabular-nums">{formatEuroFromCents(r.paid_to_date_cents)}</td>
                            <td className="px-3 py-2.5 font-mono tabular-nums">{dateOnly(r.access_ends)}</td>
                            <td className="px-3 py-2.5 text-right"><DaysLeft row={r} /></td>
                            <td className="px-4 py-2.5 text-right">
                              <Link href={`/admin/users/${r.user_id}`} className="text-xs font-semibold text-[var(--mp-viridian)]">Open learner</Link>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
          <p className="border-t border-[var(--mp-border-subtle)] px-4 py-3 text-[11px] leading-relaxed text-[var(--mp-fg-muted)]">
            {data.basis.paid_to_date} {data.basis.cadence} Staff and test accounts are left out.
            {!data.names_visible && " Learner names need the users.read permission."}
          </p>
        </section>
      </>}
    </AdminPageShell>
  );
}

function Kpi({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${warn ? "border-[var(--mp-warning)]/60 bg-[color-mix(in_srgb,var(--mp-warning)_10%,transparent)]" : "border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)]"}`}>
      <div className="text-[11px] uppercase tracking-wider text-[var(--mp-fg-muted)]">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-[var(--mp-fg)]">{value}</div>
      <div className="mt-0.5 text-xs text-[var(--mp-fg-muted)]">{sub}</div>
    </div>
  );
}

function LearnerName({ row }: { row: RosterRow }) {
  return (
    <span className="block min-w-0 break-words font-medium text-[var(--mp-fg)]">
      <UserLink id={row.user_id} />
    </span>
  );
}

function CadenceChip({ cadence }: { cadence: Cadence }) {
  const tone = cadence === "auto_renews" ? "var(--mp-viridian)" : cadence === "one_time" ? "var(--mp-warning)" : "var(--mp-fg-muted)";
  return (
    <span className="inline-flex rounded border px-1.5 py-0.5 text-[11px] font-medium text-[var(--mp-fg)]" style={{ borderColor: tone }}>
      {CADENCE_LABEL[cadence]}
    </span>
  );
}

function DaysLeft({ row }: { row: RosterRow }) {
  if (row.days_left == null) return <span className="text-xs text-[var(--mp-fg-muted)]">—</span>;
  const urgent = row.status === "paying" && row.cadence !== "auto_renews" && row.days_left <= 7;
  return (
    <span className={`inline-flex min-w-[2rem] justify-center rounded px-1.5 py-0.5 font-mono text-xs tabular-nums ${urgent ? "bg-[var(--mp-error-bg)] text-[var(--mp-error)]" : "text-[var(--mp-fg)]"}`}>
      {row.days_left < 0 ? `${Math.abs(row.days_left)} ago` : row.days_left}
    </span>
  );
}

function RosterCard({ row }: { row: RosterRow }) {
  return (
    <li className="space-y-1.5 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <LearnerName row={row} />
        <DaysLeft row={row} />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--mp-fg-muted)]">
        <span>{row.plan}</span>
        <CadenceChip cadence={row.cadence} />
        <span className="font-mono tabular-nums">{formatEuroFromCents(row.paid_to_date_cents)}</span>
        <span>ends {dateOnly(row.access_ends)}</span>
      </div>
      <Link href={`/admin/users/${row.user_id}`} className="inline-block text-xs font-semibold text-[var(--mp-viridian)]">Open learner</Link>
    </li>
  );
}

function PendingList({ rows }: { rows: PendingRow[] }) {
  const stuck = rows.filter((r) => r.age_hours >= 24).length;
  return (
    <div>
      <p className="border-b border-[var(--mp-border-subtle)] px-4 py-2 text-xs text-[var(--mp-fg-muted)]">
        {stuck > 0
          ? `${stuck} checkout${stuck === 1 ? " has" : "s have"} been pending for more than 24 hours. Stuck checkouts need a manual reconcile: ask the ops agent or run the reconcile job. Nothing on this page changes them.`
          : "No checkout has been pending for more than 24 hours."}
      </p>
      {rows.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-[var(--mp-fg-muted)]">No pending checkouts.</p>
      ) : (
        <ul className="divide-y divide-[var(--mp-border-subtle)]">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2.5 text-xs">
              <span className="min-w-0 break-words text-[var(--mp-fg)]">
                {r.user_id ? <UserLink id={r.user_id} /> : "No learner"}
              </span>
              <span className="text-[var(--mp-fg-muted)]">{r.provider ?? "unknown rail"} · {r.tier ?? "no tier"}</span>
              <span className="font-mono tabular-nums text-[var(--mp-fg-muted)]">
                {r.amount_cents != null ? `${(r.currency ?? "EUR").toUpperCase()} ${(r.amount_cents / 100).toFixed(2)}` : "no amount"}
              </span>
              <span className={`font-mono tabular-nums ${r.age_hours >= 24 ? "font-semibold text-[var(--mp-fg)]" : "text-[var(--mp-fg-muted)]"}`}>
                {r.age_hours >= 48 ? `${Math.floor(r.age_hours / 24)} days` : `${r.age_hours} h`} pending
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
