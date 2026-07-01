"use client";

/**
 * /admin/payments — Payment-funnel observability (Gate 1, 2026-06-24).
 *
 * Proves whether users factually tried to pay and exactly where the flow
 * dropped, and makes a SILENT grant failure (e.g. WHOP_WEBHOOK_SECRET mismatch
 * → every real payment rejected at the door with no grant) loudly visible.
 *
 * Read-only over GET /api/stats/admin/payments:
 *   1. A headline DIAGNOSIS line (0-attempt story vs broken-grant story).
 *   2. The funnel: checkout started → redirected → webhook received → granted.
 *   3. Failed / unmatched webhooks PROMINENT (named reasons + delivery truth).
 *   4. The recent payment-events feed.
 *
 * Boundary (the known server-import-into-client P0): this client page imports
 * ONLY pure presentational primitives + the metrics TYPE (duplicated minimally
 * below). The COMPUTATION lives server-side in @/lib/admin/paymentFunnelMetrics
 * (it pulls getServiceClient) and is reached exclusively via the admin-shelled
 * API route — never imported here. Mirrors /admin/control-plane exactly.
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  CreditCard,
  Inbox,
  ShieldAlert,
  TrendingDown,
  Webhook,
} from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { AdminPageShell } from "../_components/AdminPageShell";
import {
  FormatInt,
  SectionHeading,
  StatusDot,
  formatInt,
} from "../_components/primitives";

// ── Mirror of the API response shape (the server type lives with the
// computation in @/lib/admin/paymentFunnelMetrics; duplicated minimally here
// so a server-only module is never pulled into the client bundle). ──
interface FunnelStep {
  key: string;
  label: string;
  count: number;
}
interface PaymentFeedRow {
  id: number;
  event: string;
  provider: string;
  user_id: string | null;
  tier: string | null;
  payment_id: string | null;
  checkout_session_id: string | null;
  reason: string | null;
  signature_valid: boolean | null;
  matched: boolean | null;
  amount_cents: number | null;
  currency: string | null;
  created_at: string;
}
interface WebhookDeliveryRow {
  id: string;
  result: string;
  signature_valid: boolean | null;
  event_id: string | null;
  error: string | null;
  received_at: string;
}
interface PaymentFunnelMetrics {
  generated_at: string;
  window_days: number;
  funnel: FunnelStep[];
  totals: {
    checkout_failed: number;
    grant_failed: number;
    grant_succeeded: number;
    webhook_received: number;
    webhook_unmatched: number;
  };
  failure_reasons: Array<{ reason: string; count: number }>;
  webhook_deliveries: {
    total: number;
    by_result: Record<string, number>;
    sig_invalid: number;
    recent: WebhookDeliveryRow[];
  };
  recent_events: PaymentFeedRow[];
  diagnosis: string;
}

export default function AdminPaymentsPage() {
  const [metrics, setMetrics] = useState<PaymentFunnelMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const hydrate = useCallback(async () => {
    try {
      const res = await fetch("/api/stats/admin/payments", { cache: "no-store" });
      if (!res.ok) throw new Error(`payments ${res.status}`);
      setMetrics((await res.json()) as PaymentFunnelMetrics);
      setError(null);
    } catch (e) {
      setError((e as Error).message || "Failed to load payment funnel");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const freshness = loading ? "cached" : error ? "disconnected" : "live";
  const sigAlarm = (metrics?.webhook_deliveries.sig_invalid ?? 0) > 0;
  const hasFailures =
    (metrics?.totals.grant_failed ?? 0) > 0 ||
    (metrics?.totals.webhook_unmatched ?? 0) > 0 ||
    (metrics?.totals.checkout_failed ?? 0) > 0;

  return (
    <AdminPageShell
      title="Payment funnel"
      description={
        <span>
          Did a buyer factually try to pay, and where did it drop? Last{" "}
          {metrics?.window_days ?? 30}d.{" "}
          {metrics && (
            <span className="font-mono text-[var(--mp-fg-muted)]">
              Snapshot {new Date(metrics.generated_at).toLocaleTimeString()}
            </span>
          )}
        </span>
      }
      freshness={freshness}
      onRefresh={hydrate}
    >
      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {/* ─── Headline diagnosis ───────────────────────────────────────── */}
      <DiagnosisBanner metrics={metrics} loading={loading} alarm={sigAlarm} />

      {/* ─── The funnel ───────────────────────────────────────────────── */}
      <FunnelSection metrics={metrics} loading={loading} />

      {/* ─── Failures + unmatched (prominent) ─────────────────────────── */}
      <FailuresSection metrics={metrics} loading={loading} hasFailures={hasFailures} />

      {/* ─── Webhook delivery truth ───────────────────────────────────── */}
      <DeliveriesSection metrics={metrics} loading={loading} />

      {/* ─── Recent payment-events feed ───────────────────────────────── */}
      <FeedSection metrics={metrics} loading={loading} />
    </AdminPageShell>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Diagnosis banner — the one-line read
// ═══════════════════════════════════════════════════════════════════

function DiagnosisBanner({
  metrics,
  loading,
  alarm,
}: {
  metrics: PaymentFunnelMetrics | null;
  loading: boolean;
  alarm: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-4 py-3 text-sm text-[var(--mp-fg-muted)]">
        Reading the funnel…
      </div>
    );
  }
  if (!metrics) return null;
  const tone = alarm
    ? {
        border: "var(--mp-error)",
        bg: "color-mix(in srgb, var(--mp-error) 10%, transparent)",
        Icon: ShieldAlert,
        fg: "var(--mp-error)",
      }
    : metrics.totals.grant_succeeded > 0
      ? {
          border: "var(--mp-viridian)",
          bg: "color-mix(in srgb, var(--mp-viridian) 10%, transparent)",
          Icon: CheckCircle2,
          fg: "var(--mp-viridian)",
        }
      : {
          border: "var(--mp-border-subtle)",
          bg: "var(--mp-surface-raised)",
          Icon: AlertCircle,
          fg: "var(--mp-fg-muted)",
        };
  const Icon = tone.Icon;
  return (
    <div
      className="rounded-xl border px-4 py-3 flex items-start gap-3"
      style={{ borderColor: tone.border, backgroundColor: tone.bg }}
    >
      <Icon size={18} style={{ color: tone.fg }} className="mt-0.5 flex-shrink-0" />
      <div className="text-sm text-[var(--mp-fg)] leading-relaxed">
        {metrics.diagnosis}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Funnel — created → redirected → webhook → granted
// ═══════════════════════════════════════════════════════════════════

function FunnelSection({
  metrics,
  loading,
}: {
  metrics: PaymentFunnelMetrics | null;
  loading: boolean;
}) {
  const top = metrics?.funnel[0]?.count ?? 0;
  return (
    <section className="space-y-3">
      <SectionHeading
        title="The funnel"
        icon={CreditCard}
        hint="Each step is a server-recorded event"
      />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {(metrics?.funnel ?? PLACEHOLDER_FUNNEL).map((step, i) => {
          const prev = i === 0 ? null : (metrics?.funnel[i - 1]?.count ?? null);
          const dropPct =
            prev && prev > 0 && metrics
              ? Math.round(((prev - step.count) / prev) * 100)
              : null;
          const widthPct = top > 0 ? Math.max(4, Math.round((step.count / top) * 100)) : 0;
          return (
            <div
              key={step.key}
              className="relative rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4 flex flex-col"
            >
              <div className="flex items-center gap-2 text-[10px] text-[var(--mp-fg-muted)] uppercase tracking-[0.08em]">
                <span className="font-mono">{i + 1}</span>
                <span>{step.label}</span>
              </div>
              <div className="mt-2 text-3xl font-semibold text-[var(--mp-fg)] tabular-nums">
                {loading ? (
                  <span className="text-[var(--mp-fg-muted)]">—</span>
                ) : (
                  <FormatInt value={step.count} />
                )}
              </div>
              {/* mini funnel bar relative to step 1 */}
              <div className="mt-2 h-1.5 rounded-full bg-[var(--mp-surface-sunken)] overflow-hidden">
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${widthPct}%`,
                    backgroundColor:
                      step.key === "grant_succeeded"
                        ? "var(--mp-viridian)"
                        : "var(--mp-info)",
                  }}
                  aria-hidden
                />
              </div>
              {dropPct != null && dropPct > 0 && (
                <div className="mt-1.5 text-[10px] text-[var(--mp-fg-subtle)] flex items-center gap-1">
                  <TrendingDown size={11} />
                  {dropPct}% drop from prev
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

const PLACEHOLDER_FUNNEL: FunnelStep[] = [
  { key: "checkout_session_created", label: "Checkout started", count: 0 },
  { key: "checkout_redirected", label: "Redirected to pay", count: 0 },
  { key: "webhook_received", label: "Webhook received", count: 0 },
  { key: "grant_succeeded", label: "Pro granted", count: 0 },
];

// ═══════════════════════════════════════════════════════════════════
// Failures + unmatched — prominent
// ═══════════════════════════════════════════════════════════════════

function FailuresSection({
  metrics,
  loading,
  hasFailures,
}: {
  metrics: PaymentFunnelMetrics | null;
  loading: boolean;
  hasFailures: boolean;
}) {
  return (
    <section className="space-y-3">
      <SectionHeading
        title="Failed & unmatched"
        icon={AlertTriangle}
        hint="A silent grant failure shows up here, not in a swallowed log"
      />
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FailTile
          label="Grants failed"
          value={loading ? "—" : <FormatInt value={metrics?.totals.grant_failed ?? 0} />}
          tone={(metrics?.totals.grant_failed ?? 0) > 0 ? "danger" : "success"}
        />
        <FailTile
          label="Webhooks unmatched"
          value={loading ? "—" : <FormatInt value={metrics?.totals.webhook_unmatched ?? 0} />}
          tone={(metrics?.totals.webhook_unmatched ?? 0) > 0 ? "danger" : "success"}
        />
        <FailTile
          label="Checkouts failed"
          value={loading ? "—" : <FormatInt value={metrics?.totals.checkout_failed ?? 0} />}
          tone={(metrics?.totals.checkout_failed ?? 0) > 0 ? "warn" : "success"}
        />
      </div>

      {/* Named reasons — the WHY behind each drop. */}
      {!loading && metrics && (
        metrics.failure_reasons.length > 0 ? (
          <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] divide-y divide-[var(--mp-border-subtle)]/60">
            {metrics.failure_reasons.map((r) => (
              <div
                key={r.reason}
                className="flex items-center justify-between px-3 py-2 text-xs"
              >
                <span className="font-mono text-[var(--mp-fg)]">{r.reason}</span>
                <span className="tabular-nums text-[var(--mp-fg-muted)]">
                  {formatInt(r.count)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-4 py-3 text-xs text-[var(--mp-fg-muted)]">
            {hasFailures
              ? "No named reasons in window."
              : "No failed or unmatched payment events. The grant path is clean."}
          </div>
        )
      )}
    </section>
  );
}

function FailTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone: "success" | "warn" | "danger";
}) {
  const accent =
    tone === "success"
      ? "var(--mp-viridian)"
      : tone === "warn"
        ? "var(--mp-warning)"
        : "var(--mp-error)";
  return (
    <div className="relative rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4 min-h-[96px] flex flex-col">
      <div
        className="absolute top-0 left-0 right-0 h-[3px] rounded-t-2xl"
        style={{ backgroundColor: accent, opacity: 0.85 }}
        aria-hidden
      />
      <div className="flex items-center gap-2 text-[10px] text-[var(--mp-fg-muted)] uppercase tracking-[0.1em]">
        <span>{label}</span>
        <span className="flex-1" />
        <StatusDot tone={tone} size={6} />
      </div>
      <div className="mt-2 flex-1 flex items-center text-2xl font-semibold text-[var(--mp-fg)] tabular-nums">
        {value}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Webhook delivery truth (webhook_attempts, every delivery)
// ═══════════════════════════════════════════════════════════════════

function DeliveriesSection({
  metrics,
  loading,
}: {
  metrics: PaymentFunnelMetrics | null;
  loading: boolean;
}) {
  const d = metrics?.webhook_deliveries;
  return (
    <section className="space-y-3">
      <SectionHeading
        title="Whop webhook deliveries"
        icon={Webhook}
        hint="Every inbound delivery, recorded before signature check"
      />
      <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-4 py-3 flex items-center gap-4 flex-wrap">
        <div className="flex items-baseline gap-1.5">
          <span className="text-xl font-semibold text-[var(--mp-fg)] tabular-nums">
            {loading || !d ? "—" : formatInt(d.total)}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-subtle)]">
            delivered (all time)
          </span>
        </div>
        {d && d.sig_invalid > 0 && (
          <span
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded border"
            style={{
              color: "var(--mp-error)",
              backgroundColor: "color-mix(in srgb, var(--mp-error) 12%, transparent)",
              borderColor: "color-mix(in srgb, var(--mp-error) 40%, transparent)",
            }}
          >
            <ShieldAlert size={12} />
            {formatInt(d.sig_invalid)} signature-rejected
          </span>
        )}
        {d &&
          Object.entries(d.by_result).map(([result, n]) => (
            <span
              key={result}
              className="inline-flex items-center gap-1 text-[10px] font-mono text-[var(--mp-fg-muted)]"
            >
              <StatusDot
                tone={
                  result === "processed"
                    ? "success"
                    : result === "sig_invalid" || result === "other_error"
                      ? "danger"
                      : result === "user_not_found"
                        ? "warn"
                        : "neutral"
                }
                size={5}
              />
              {result}×{n}
            </span>
          ))}
        {d && d.total === 0 && !loading && (
          <span className="text-xs text-[var(--mp-fg-muted)]">
            No Whop webhook has ever reached this endpoint. If a real payment
            was made, the Whop dashboard webhook URL is the suspect.
          </span>
        )}
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Recent payment-events feed
// ═══════════════════════════════════════════════════════════════════

function FeedSection({
  metrics,
  loading,
}: {
  metrics: PaymentFunnelMetrics | null;
  loading: boolean;
}) {
  const rows = metrics?.recent_events ?? [];
  return (
    <section className="space-y-3">
      <SectionHeading
        title="Recent payment events"
        icon={Inbox}
        hint="Newest first: the live funnel feed"
      />
      <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-muted)] border-b border-[var(--mp-border-subtle)]">
                <th className="text-left font-medium px-3 py-2.5">When</th>
                <th className="text-left font-medium px-3 py-2.5">Event</th>
                <th className="text-left font-medium px-3 py-2.5">Tier</th>
                <th className="text-left font-medium px-3 py-2.5">Reason</th>
                <th className="text-left font-medium px-3 py-2.5">Payment / session</th>
                <th className="text-left font-medium px-3 py-2.5">User</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-[var(--mp-fg-muted)]">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-[var(--mp-fg-muted)]">
                    No payment events recorded yet. Instrumentation is live; the
                    first checkout or webhook will appear here.
                  </td>
                </tr>
              ) : (
                rows.map((r) => <FeedRow key={r.id} row={r} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function FeedRow({ row }: { row: PaymentFeedRow }) {
  const isFail = row.event === "grant_failed" || row.event === "checkout_failed";
  const isSuccess = row.event === "grant_succeeded";
  const isUnmatched = row.event === "webhook_received" && row.matched === false;
  const eventColor = isSuccess
    ? "var(--mp-viridian)"
    : isFail || isUnmatched
      ? "var(--mp-error)"
      : "var(--mp-fg)";
  const idRef = row.payment_id ?? row.checkout_session_id ?? null;
  return (
    <tr className="border-b last:border-0 border-[var(--mp-border-subtle)]/60 hover:bg-[var(--mp-surface-sunken)]/50">
      <td className="px-3 py-2 whitespace-nowrap text-[var(--mp-fg-muted)] font-mono text-[10px]">
        {new Date(row.created_at).toLocaleString("en-GB", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </td>
      <td className="px-3 py-2 whitespace-nowrap">
        <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: eventColor }}>
          <StatusDot
            tone={isSuccess ? "success" : isFail || isUnmatched ? "danger" : "neutral"}
            size={6}
          />
          {row.event}
          {isUnmatched && (
            <span className="text-[9px] uppercase text-[var(--mp-error)]">unmatched</span>
          )}
        </span>
      </td>
      <td className="px-3 py-2 whitespace-nowrap text-[var(--mp-fg-muted)]">
        {row.tier ?? "—"}
      </td>
      <td className="px-3 py-2 whitespace-nowrap font-mono text-[10px] text-[var(--mp-fg-muted)]">
        {row.reason ?? "—"}
      </td>
      <td className="px-3 py-2 whitespace-nowrap font-mono text-[10px] text-[var(--mp-fg-muted)]">
        {idRef ? `${idRef.slice(0, 18)}${idRef.length > 18 ? "…" : ""}` : "—"}
      </td>
      <td className="px-3 py-2 whitespace-nowrap font-mono text-[10px] text-[var(--mp-fg-muted)]">
        {row.user_id ? `${row.user_id.slice(0, 8)}…` : "—"}
      </td>
    </tr>
  );
}
