"use client";

/**
 * /admin/payments — money in, payment health and the resolve queue.
 *
 * Rebuilt 2026-10-12 (a14: ADM-01 A, ADM-02 A, OW-31, UX-ADM-04):
 *   1. One diagnosis line, the same function as the Overview failures tile.
 *      ALARM only when signed-looking deliveries failed for 7 days with none
 *      processed; unsigned probes are a neutral count.
 *   2. Money in per Vienna month, cash basis, gross with Whop fees and net
 *      where Whop reported both amounts.
 *   3. Payment failures: the Unresolved payments queue (paid, never granted)
 *      never ages out and offers Link to learner, Mark as test, Mark not ours.
 *   4. Trace one payment end to end.
 *   5. The funnel in distinct sessions and payments, refunds (90 days) with
 *      access outcome, Whop deliveries (absorbs /admin/webhooks) and the feed.
 *
 * Boundary: imports only presentational primitives and the mirrored TYPES;
 * the computation lives server-side in @/lib/admin/paymentFunnelMetrics.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Inbox,
  RotateCcw,
  ShieldAlert,
  TrendingDown,
  Wallet,
  Webhook,
} from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";
import { AdminPageShell } from "../_components/AdminPageShell";
import { FormatInt, SectionHeading, StatusDot, formatInt } from "../_components/primitives";
import { ResolveDialog, type ResolveAction } from "./_parts/ResolveDialog";
import { PaymentTrace } from "./_parts/PaymentTrace";
import { money, monthLabel, when, type PaymentsMetrics, type UnresolvedPaymentRow } from "./_parts/types";

export default function AdminPaymentsPage() {
  const { can, loading: accessLoading } = useAdminPermissions();
  const [metrics, setMetrics] = useState<PaymentsMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [resolving, setResolving] = useState<{ payment: UnresolvedPaymentRow; action: ResolveAction } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const hydrate = useCallback(async () => {
    if (!can("revenue.read")) return;
    try {
      const res = await fetch("/api/stats/admin/payments", { cache: "no-store" });
      if (!res.ok) throw new Error(`Could not load payments (HTTP ${res.status}).`);
      setMetrics((await res.json()) as PaymentsMetrics);
      setUpdatedAt(new Date().toISOString());
      setError(null);
    } catch (e) {
      setError((e as Error).message || "Could not load payments.");
    } finally {
      setLoading(false);
    }
  }, [can]);

  useEffect(() => {
    if (accessLoading) return;
    if (can("revenue.read")) void hydrate();
    else setLoading(false);
  }, [accessLoading, can, hydrate]);

  const freshness = error ? (metrics ? "cached" : "disconnected") : loading ? "cached" : "live";

  return (
    <AdminPageShell
      title="Payments"
      description={
        <span>
          Money in, payments that did not grant, and every Whop delivery.{" "}
          {metrics && <span className="font-mono text-[var(--mp-fg-muted)]">Snapshot {new Date(metrics.generated_at).toLocaleTimeString()}</span>}
        </span>
      }
      freshness={freshness}
      onRefresh={hydrate}
    >
      {!accessLoading && !can("revenue.read") && (
        <div role="alert" className="rounded-xl border border-[var(--mp-error)]/30 bg-[var(--mp-error-bg)] px-4 py-3 text-sm text-[var(--mp-error)]">
          You do not have permission to view payment operations.
        </div>
      )}
      {can("revenue.read") && <>
        {error && (
          <div role="alert" className="flex items-start gap-2 rounded-md border border-[var(--mp-error)]/40 bg-[var(--mp-error-bg)] px-3 py-2 text-xs text-[var(--mp-error)]">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            <span className="min-w-0 flex-1">{error}{metrics && updatedAt ? ` Showing the snapshot from ${new Date(updatedAt).toLocaleString()}.` : ""}</span>
            <button type="button" className="underline" onClick={() => void hydrate()}>Retry</button>
          </div>
        )}
        {notice && (
          <div role="status" className="flex items-start gap-2 rounded-md border border-[var(--mp-viridian)]/40 px-3 py-2 text-xs text-[var(--mp-fg)]">
            <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-[var(--mp-viridian)]" />
            <span className="min-w-0 flex-1">{notice}</span>
            <button type="button" className="underline" onClick={() => setNotice(null)}>Dismiss</button>
          </div>
        )}
        {!metrics && !loading && (
          <div role="status" className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-4 py-8 text-center text-sm text-[var(--mp-fg-muted)]">
            Payment data is unavailable. Retry before treating missing activity as zero.
          </div>
        )}
        {loading && !metrics && (
          <div role="status" className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-4 py-3 text-sm text-[var(--mp-fg-muted)]">Reading payments…</div>
        )}
        {metrics && <>
          <DiagnosisBanner metrics={metrics} />
          <MoneySection metrics={metrics} />
          <FailuresSection
            metrics={metrics}
            canManage={can("revenue.manage")}
            onResolve={(payment, action) => { setNotice(null); setResolving({ payment, action }); }}
          />
          <PaymentTrace />
          <FunnelSection metrics={metrics} />
          <RefundsSection metrics={metrics} />
          <DeliveriesSection metrics={metrics} />
          <FeedSection metrics={metrics} />
        </>}
        <ResolveDialog
          payment={resolving?.payment ?? null}
          action={resolving?.action ?? "test"}
          onClose={() => setResolving(null)}
          onDone={(message) => { setResolving(null); setNotice(message); void hydrate(); }}
        />
      </>}
    </AdminPageShell>
  );
}

// ── Diagnosis ───────────────────────────────────────────────────────────

function DiagnosisBanner({ metrics }: { metrics: PaymentsMetrics }) {
  const level = metrics.health.level;
  const tone = level === "alarm"
    ? { border: "var(--mp-error)", bg: "color-mix(in srgb, var(--mp-error) 10%, transparent)", Icon: ShieldAlert, fg: "var(--mp-error)" }
    : level === "attention"
      ? { border: "var(--mp-warning)", bg: "color-mix(in srgb, var(--mp-warning) 10%, transparent)", Icon: AlertTriangle, fg: "var(--mp-fg)" }
      : level === "ok"
        ? { border: "var(--mp-viridian)", bg: "color-mix(in srgb, var(--mp-viridian) 8%, transparent)", Icon: CheckCircle2, fg: "var(--mp-viridian)" }
        : { border: "var(--mp-border-subtle)", bg: "var(--mp-surface-raised)", Icon: AlertCircle, fg: "var(--mp-fg-muted)" };
  const Icon = tone.Icon;
  return (
    <div data-testid="payments-diagnosis" className="flex items-start gap-3 rounded-xl border px-4 py-3" style={{ borderColor: tone.border, backgroundColor: tone.bg }}>
      <Icon size={18} style={{ color: tone.fg }} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-1 text-sm leading-relaxed text-[var(--mp-fg)]">
        <p className="break-words">{metrics.health.diagnosis}</p>
        <p className="text-xs text-[var(--mp-fg-muted)]">
          Last 7 days: {formatInt(metrics.health.processed_7d)} processed, {formatInt(metrics.health.suspected_mismatch_7d)} rejected with a signature header, {formatInt(metrics.health.probes_7d)} unsigned probe{metrics.health.probes_7d === 1 ? "" : "s"}.
        </p>
      </div>
    </div>
  );
}

// ── Money in ────────────────────────────────────────────────────────────

function MoneySection({ metrics }: { metrics: PaymentsMetrics }) {
  const m = metrics.money;
  const months = [...m.months].reverse();
  return (
    <section id="money" className="scroll-mt-20 space-y-3">
      <SectionHeading title="Money in" icon={Wallet} hint="Cash basis, Vienna days" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="This month (cash)" value={money(m.month_to_date.cash_cents)} sub={`${money(m.month_to_date.gross_cents)} paid, ${money(m.month_to_date.refunds_cents)} refunded`} />
        <Stat label="Today (cash)" value={money(m.today.cash_cents)} sub={`${money(m.today.gross_cents)} paid, ${money(m.today.refunds_cents)} refunded`} />
        <Stat label="Lifetime (gross)" value={money(m.lifetime_gross_cents)} sub="all EUR payments, before fees and refunds" />
      </div>
      <div className="overflow-hidden rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--mp-border-subtle)] text-left text-[10px] uppercase tracking-wider text-[var(--mp-fg-muted)]">
                <th className="px-3 py-2.5 font-medium">Month</th>
                <th className="px-3 py-2.5 text-right font-medium">Paid</th>
                <th className="px-3 py-2.5 text-right font-medium">Gross</th>
                <th className="px-3 py-2.5 text-right font-medium">Whop fees (known)</th>
                <th className="px-3 py-2.5 text-right font-medium">Refunds</th>
                <th className="px-3 py-2.5 text-right font-medium">Cash in</th>
                <th className="px-3 py-2.5 text-right font-medium">Trial starts</th>
              </tr>
            </thead>
            <tbody>
              {months.map((row) => (
                <tr key={row.month} className="border-b border-[var(--mp-border-subtle)]/60 last:border-0">
                  <td className="px-3 py-2 text-[var(--mp-fg)]">{monthLabel(row.month)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatInt(row.paid_payments)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{money(row.gross_cents)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--mp-fg-muted)]">
                    {row.payments_with_fee_known > 0 ? `${money(row.fees_known_cents)} (${row.payments_with_fee_known} of ${row.paid_payments})` : "not reported"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{row.refunds > 0 ? `-${money(row.refunds_cents)}` : money(0)}</td>
                  <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">{money(row.cash_cents)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-[var(--mp-fg-muted)]">{formatInt(row.trial_starts)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="space-y-1 border-t border-[var(--mp-border-subtle)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--mp-fg-muted)]">
          <p>{m.basis}</p>
          <p>Whop sometimes reports a payment after its fee: a 19.00 EUR charge can arrive as 17.72 EUR. Gross is the charge; the fee column shows only what Whop reported, never a guess.</p>
          {m.other_currencies.length > 0 && (
            <p>Not in EUR and not converted: {m.other_currencies.map((o) => `${o.paid_payments} payment${o.paid_payments === 1 ? "" : "s"}, ${money(o.gross_cents, o.currency)}${o.refunds_cents ? `, refunds ${money(o.refunds_cents, o.currency)}` : ""}`).join("; ")}.</p>
          )}
          {m.refunds_without_amount > 0 && <p>{m.refunds_without_amount} refund{m.refunds_without_amount === 1 ? "" : "s"} arrived without an amount and are not subtracted.</p>}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub: string }) {
  return (
    <div className="rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4">
      <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--mp-fg-muted)]">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-[var(--mp-fg)]">{value}</div>
      <div className="mt-0.5 text-xs text-[var(--mp-fg-muted)]">{sub}</div>
    </div>
  );
}

// ── Failures + Unresolved queue ─────────────────────────────────────────

function FailuresSection({
  metrics,
  canManage,
  onResolve,
}: {
  metrics: PaymentsMetrics;
  canManage: boolean;
  onResolve: (payment: UnresolvedPaymentRow, action: ResolveAction) => void;
}) {
  const rows = metrics.unresolved;
  return (
    <section id="failures" className="scroll-mt-20 space-y-3">
      <SectionHeading title="Payment failures" icon={AlertTriangle} hint="Paid but never granted; never ages out" />
      {!metrics.resolutions_available && (
        <p className="rounded-xl border border-dashed border-[var(--mp-border-subtle)] px-4 py-3 text-xs text-[var(--mp-fg-muted)]">
          The resolve actions are switched off until the a14 database changeset is applied. The queue below is still accurate.
        </p>
      )}
      <div id="unresolved" className="overflow-hidden rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--mp-border-subtle)] px-4 py-2.5">
          <span className="text-sm font-semibold text-[var(--mp-fg)]">Unresolved payments <span className="tabular-nums text-[var(--mp-fg-muted)]">{rows.length}</span></span>
          <span className="text-[11px] text-[var(--mp-fg-muted)]">Signature-header rejections (7 days): {formatInt(metrics.health.suspected_mismatch_7d)}</span>
        </div>
        {rows.length === 0 ? (
          <p className="px-4 py-6 text-center text-xs text-[var(--mp-fg-muted)]">Every paid payment granted access or was resolved.</p>
        ) : (
          <ul className="divide-y divide-[var(--mp-border-subtle)]">
            {rows.map((r) => (
              <li key={r.payment_id} className="space-y-2 px-4 py-3 text-xs" data-testid="unresolved-row">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="text-base font-semibold tabular-nums text-[var(--mp-fg)]">{money(r.gross_cents, r.currency)}</span>
                  <span className="font-mono text-[var(--mp-fg-muted)]">{when(r.paid_at)} · {r.age_days} day{r.age_days === 1 ? "" : "s"} open</span>
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-[var(--mp-fg-muted)]">
                  <span className="break-all font-mono">{r.payment_id}</span>
                  <span>plan {r.plan_id ?? "unknown"}{r.linkable_tier ? ` (${r.linkable_tier})` : ", not a MedPrüf Pro plan"}</span>
                  {r.failure_reasons.length > 0 && <span>reason: {r.failure_reasons.join(", ")}</span>}
                  {r.learner && <Link className="text-[var(--mp-viridian)] underline" href={`/admin/users/${r.learner.id}`}>{r.learner.label ?? `learner ${r.learner.id.slice(0, 8)}`}</Link>}
                </div>
                {canManage && metrics.resolutions_available && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="mp-btn mp-btn--primary mp-btn--sm"
                      disabled={!r.linkable_tier}
                      title={r.linkable_tier ? undefined : "Only payments for a MedPrüf Pro plan can be linked."}
                      onClick={() => onResolve(r, "link")}
                    >
                      Link to learner
                    </button>
                    <button type="button" className="mp-btn mp-btn--secondary mp-btn--sm" onClick={() => onResolve(r, "test")}>Mark as test</button>
                    <button type="button" className="mp-btn mp-btn--secondary mp-btn--sm" onClick={() => onResolve(r, "not_ours")}>Mark not ours</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {metrics.failure_reasons.length > 0 && (
        <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)]">
          <p className="border-b border-[var(--mp-border-subtle)] px-3 py-2 text-[10px] uppercase tracking-wider text-[var(--mp-fg-muted)]">Failure log rows, last {metrics.window_days} days (a retried payment repeats here)</p>
          <div className="divide-y divide-[var(--mp-border-subtle)]/60">
            {metrics.failure_reasons.map((r) => (
              <div key={r.reason} className="flex items-center justify-between px-3 py-2 text-xs">
                <span className="font-mono text-[var(--mp-fg)]">{r.reason}</span>
                <span className="tabular-nums text-[var(--mp-fg-muted)]">{formatInt(r.count)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {metrics.resolved_recent.length > 0 && (
        <details className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-4 py-2.5 text-xs">
          <summary className="cursor-pointer font-medium text-[var(--mp-fg)]">Resolved in the last 90 days ({metrics.resolved_recent.length})</summary>
          <ul className="mt-2 space-y-1.5">
            {metrics.resolved_recent.map((r) => (
              <li key={r.payment_id} className="flex flex-wrap gap-x-3 text-[var(--mp-fg-muted)]">
                <span className="font-medium text-[var(--mp-fg)]">{r.kind.replace("_", " ")}</span>
                <span>{money(r.gross_cents, r.currency)}</span>
                <span className="break-all font-mono">{r.payment_id}</span>
                <span>{when(r.resolved_at)}</span>
                <span className="break-words">{r.reason}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

// ── Funnel ──────────────────────────────────────────────────────────────

function FunnelSection({ metrics }: { metrics: PaymentsMetrics }) {
  const top = metrics.funnel[0]?.count ?? 0;
  return (
    <section className="space-y-3">
      <SectionHeading title="The funnel" icon={CreditCard} hint={`Distinct sessions and payments, last ${metrics.window_days} days`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.funnel.map((step, i) => {
          const prev = i === 0 ? null : metrics.funnel[i - 1]?.count ?? null;
          const dropPct = prev && prev > 0 ? Math.round(((prev - step.count) / prev) * 100) : null;
          const widthPct = top > 0 ? Math.max(4, Math.round((step.count / top) * 100)) : 0;
          return (
            <div key={step.key} className="flex flex-col rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-[var(--mp-fg-muted)]">
                <span className="font-mono">{i + 1}</span>
                <span>{step.label}</span>
              </div>
              <div className="mt-2 text-3xl font-semibold tabular-nums text-[var(--mp-fg)]"><FormatInt value={step.count} /></div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--mp-surface-sunken)]">
                <div className="h-full rounded-full" style={{ width: `${widthPct}%`, backgroundColor: step.key === "grant_succeeded" ? "var(--mp-viridian)" : "var(--mp-info)" }} aria-hidden />
              </div>
              <div className="mt-1.5 text-[10px] text-[var(--mp-fg-subtle)]">{step.hint}{step.rows !== step.count ? ` · ${step.rows} log rows` : ""}</div>
              {dropPct != null && dropPct > 0 && (
                <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--mp-fg-subtle)]"><TrendingDown size={11} />{dropPct}% drop from previous</div>
              )}
            </div>
          );
        })}
      </div>
      {metrics.totals.checkout_failed > 0 && (
        <p className="text-xs text-[var(--mp-fg-muted)]">{formatInt(metrics.totals.checkout_failed)} checkout session{metrics.totals.checkout_failed === 1 ? "" : "s"} failed before reaching Whop in this window.</p>
      )}
    </section>
  );
}

// ── Refunds ─────────────────────────────────────────────────────────────

function RefundsSection({ metrics }: { metrics: PaymentsMetrics }) {
  const r = metrics.refunds_90d;
  const amounts = Object.entries(r.amount_by_currency);
  return (
    <section id="refunds" className="scroll-mt-20 space-y-3">
      <SectionHeading title="Refunds (90 days)" icon={RotateCcw} hint="Booked on the refund date; access outcome now" />
      <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-4 py-3 text-xs">
        <p className="text-sm text-[var(--mp-fg)]">
          {r.refund_count === 0 ? "No refund in the last 90 days." : `${r.refund_count} refund${r.refund_count === 1 ? "" : "s"}, ${amounts.map(([c, v]) => money(v, c)).join(", ") || "amount not reported"}.`}
          {r.dispute_count > 0 && ` ${r.dispute_count} dispute${r.dispute_count === 1 ? "" : "s"} (shown, not subtracted).`}
        </p>
        {r.refunds.length > 0 && (
          <ul className="mt-2 space-y-1 text-[var(--mp-fg-muted)]">
            {r.refunds.map((x) => (
              <li key={x.refund_id} className="flex flex-wrap gap-x-3">
                <span>{when(x.refunded_at)}</span>
                <span className="font-medium text-[var(--mp-fg)]">{x.kind}</span>
                <span className="font-mono">{money(x.amount_cents, x.currency)}</span>
                <span className="break-all font-mono">{x.refund_id}</span>
              </li>
            ))}
          </ul>
        )}
        {r.refunded_access.length > 0 && (
          <div className="mt-3 border-t border-[var(--mp-border-subtle)] pt-2">
            <p className="mb-1 text-[10px] uppercase tracking-wider text-[var(--mp-fg-muted)]">Refunded subscription rows and what the learner holds now</p>
            <ul className="space-y-1">
              {r.refunded_access.map((a) => (
                <li key={a.subscription_id} className="flex flex-wrap gap-x-3 text-[var(--mp-fg-muted)]">
                  <span>{when(a.refunded_at)}</span>
                  <span>{a.tier ?? "no tier"}</span>
                  <span className="font-medium text-[var(--mp-fg)]">{a.access_now}</span>
                  {a.learner && <Link className="text-[var(--mp-viridian)] underline" href={`/admin/users/${a.learner.id}`}>{a.learner.label ?? `learner ${a.learner.id.slice(0, 8)}`}</Link>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Deliveries (absorbs /admin/webhooks) ────────────────────────────────

function DeliveriesSection({ metrics }: { metrics: PaymentsMetrics }) {
  const d = metrics.deliveries;
  return (
    <section id="deliveries" className="scroll-mt-20 space-y-3">
      <SectionHeading title="Webhook deliveries" icon={Webhook} hint={`Every inbound delivery, last ${d.window_days} days`} />
      <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-4 py-3">
        {d.by_provider.length === 0 ? (
          <p className="text-xs text-[var(--mp-fg-muted)]">No webhook delivery in the last {d.window_days} days.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {d.by_provider.map((g) => (
              <span key={`${g.provider}:${g.result}`} className="inline-flex items-center gap-1.5 rounded border border-[var(--mp-border-subtle)] px-2 py-1 text-[11px] text-[var(--mp-fg)]">
                <StatusDot tone={g.result === "processed" ? "success" : g.result === "dup" || g.result === "sig_invalid" ? "neutral" : g.result === "user_not_found" ? "warn" : "danger"} size={6} />
                {g.provider} · {g.result} <span className="tabular-nums text-[var(--mp-fg-muted)]">{g.rows}{g.distinct_events && g.distinct_events !== g.rows ? ` (${g.distinct_events} distinct)` : ""}</span>
              </span>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] text-[var(--mp-fg-muted)]">
          sig_invalid is split in the list below: a probe has no signature header and is ignored; a rejection that carried a header points at the webhook secret.
        </p>
      </div>
      {d.recent.length > 0 && (
        <ul className="divide-y divide-[var(--mp-border-subtle)] rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] text-xs">
          {d.recent.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
              <span className="font-mono text-[var(--mp-fg-muted)]">{when(r.received_at)}</span>
              <span className="text-[var(--mp-fg)]">{r.provider}</span>
              <span className={r.kind === "mismatch" ? "font-semibold text-[var(--mp-error)]" : "text-[var(--mp-fg)]"}>
                {r.kind === "probe" ? "unsigned probe" : r.kind === "mismatch" ? "rejected with signature header" : r.result}
              </span>
              {r.event_id && <span className="break-all font-mono text-[var(--mp-fg-muted)]">{r.event_id}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Feed ────────────────────────────────────────────────────────────────

function FeedSection({ metrics }: { metrics: PaymentsMetrics }) {
  const rows = metrics.recent_events;
  return (
    <section className="space-y-3">
      <SectionHeading title="Recent payment events" icon={Inbox} hint="Newest first, latest 50 log rows" />
      <div className="overflow-hidden rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)]">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-xs">
            <thead>
              <tr className="border-b border-[var(--mp-border-subtle)] text-left text-[10px] uppercase tracking-wider text-[var(--mp-fg-muted)]">
                <th className="px-3 py-2.5 font-medium">When</th>
                <th className="px-3 py-2.5 font-medium">Event</th>
                <th className="px-3 py-2.5 text-right font-medium">Amount</th>
                <th className="px-3 py-2.5 font-medium">Reason</th>
                <th className="px-3 py-2.5 font-medium">Payment / session</th>
                <th className="px-3 py-2.5 font-medium">Learner</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-[var(--mp-fg-muted)]">No payment events recorded yet.</td></tr>
              ) : rows.map((r) => {
                const fail = r.event === "grant_failed" || r.event === "checkout_failed";
                const ok = r.event === "grant_succeeded";
                const ref = r.payment_id ?? r.checkout_session_id;
                return (
                  <tr key={r.id} className="border-b border-[var(--mp-border-subtle)]/60 last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[10px] text-[var(--mp-fg-muted)]">{when(r.created_at)}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 font-medium text-[var(--mp-fg)]">
                        <StatusDot tone={ok ? "success" : fail ? "danger" : "neutral"} size={6} />
                        {r.event}{r.whop_event && r.event === "webhook_received" ? ` · ${r.whop_event}` : ""}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-mono">{r.amount_cents != null ? money(r.amount_cents, (r.currency ?? "eur").toUpperCase()) : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-[10px] text-[var(--mp-fg-muted)]">{r.reason ?? "—"}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-[var(--mp-fg-muted)]">{ref ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-[10px]">
                      {r.user_id ? <Link className="text-[var(--mp-viridian)] underline" href={`/admin/users/${r.user_id}`}>{r.user_id.slice(0, 8)}</Link> : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
