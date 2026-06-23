"use client";

/**
 * /admin/control-plane — Autonomy Control Plane v1 (AUTONOMY.md).
 *
 * The superadmin surface where the autonomous business is tracked + measured.
 * v1 is deliberately STATIC / read-only over data that already exists:
 *
 *   1. North-star / Measurement (F-07): euros TOP-LINE (MRR, active paid,
 *      paid conversion, 30-day churn, LTV), fed by GET
 *      /api/stats/admin/control-plane. A SMALLER, secondary automation-
 *      coverage % sits beneath — per AUTONOMY.md's one rule, euros read as
 *      the goal and coverage as an efficiency stat, never the success metric.
 *   2. Process registry (F-02, STATIC): the 8 processes (CONTENT … SECURITY)
 *      with owner-agent, current L (L0–L4), target L, success metric, top gap.
 *      Hand-maintained mirror of AUTONOMY.md's table (@/lib/admin/processRegistry).
 *
 * DEFERRED (not built here): gap-detection cron, agent-activity timeline,
 * evolution loop, the Funnels/Experiments/Deploys/Errors revival.
 *
 * Boundary note: this client page imports ONLY pure data (the process
 * registry const + the metrics TYPE). The metric COMPUTATION lives server-side
 * in @/lib/admin/controlPlaneMetrics (it pulls getServiceClient) and is reached
 * exclusively via the admin-shelled API route — never imported into the client.
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Coins,
  Cpu,
  GitMerge,
  HeartPulse,
  Layers,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { AdminPageShell } from "../_components/AdminPageShell";
import {
  FormatEuro,
  FormatInt,
  SectionHeading,
  StatusDot,
  formatInt,
  formatPct,
} from "../_components/primitives";
import {
  CONTROL_PLANE_PROCESSES,
  LADDER_LEGEND,
  REGISTRY_REALITY_NOTE,
  type AutomationLevel,
  type ProcessRow,
} from "@/lib/admin/processRegistry";

// Mirror of the API response shape (the server type lives with the computation
// in @/lib/admin/controlPlaneMetrics; duplicated minimally here to avoid pulling
// a server-only module into the client bundle).
interface ControlPlaneMetrics {
  generated_at: string;
  mrr_cents: number;
  active_paid_users: number;
  paid_conversion: { paying_users: number; total_users: number; ratio: number };
  entitled_pro: { entitled_now: number; entitled_all_time: number };
  churn_30d: number;
  ltv_cents: number;
  basis: { mrr: string; ltv: string; conversion: string; churn: string };
  reconciliation: { active_subscription_rows: number; note: string };
  automation_coverage: {
    ratio: number;
    process_count: number;
    by_level: Record<string, number>;
  };
}

export default function AdminControlPlanePage() {
  const [metrics, setMetrics] = useState<ControlPlaneMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const hydrate = useCallback(async () => {
    try {
      const res = await fetch("/api/stats/admin/control-plane", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`control-plane ${res.status}`);
      setMetrics((await res.json()) as ControlPlaneMetrics);
      setError(null);
    } catch (e) {
      setError((e as Error).message || "Failed to load metrics");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const freshness = loading ? "cached" : error ? "disconnected" : "live";

  return (
    <AdminPageShell
      title="Autonomy Control Plane"
      description={
        <span>
          The business, tracked + measured. Euros are the goal; coverage is an
          efficiency stat.{" "}
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

      {/* ─── NORTH-STAR: EUROS (top-line, large) ─────────────────────── */}
      <NorthStarBlock metrics={metrics} loading={loading} />

      {/* ─── SECONDARY: automation coverage (smaller) ────────────────── */}
      <CoverageStrip metrics={metrics} loading={loading} />

      {/* ─── PROCESS REGISTRY (static, F-02) ─────────────────────────── */}
      <ProcessRegistrySection />
    </AdminPageShell>
  );
}

// ═══════════════════════════════════════════════════════════════════
// North-star euros block
// ═══════════════════════════════════════════════════════════════════

function NorthStarBlock({
  metrics,
  loading,
}: {
  metrics: ControlPlaneMetrics | null;
  loading: boolean;
}) {
  const conv = metrics?.paid_conversion;
  const convRatio = conv ? conv.ratio : null;
  const entitled = metrics?.entitled_pro;
  // Conversion = genuinely-paying customers ÷ real users (0/112 today, comped /
  // admin / demo excluded). Danger-tone under 2%.
  const convTone = convRatio == null ? "neutral" : convRatio < 0.02 ? "danger" : "info";

  return (
    <section className="space-y-3">
      <SectionHeading
        title="North-star — euros"
        icon={Coins}
        hint="The goal the autonomy roadmap is graded on"
      />

      {/* Hero: MRR, huge. */}
      <div className="rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-5 relative overflow-hidden">
        <div
          className="absolute top-0 left-0 right-0 h-[3px] rounded-t-2xl"
          style={{ backgroundColor: "var(--mp-viridian)", opacity: 0.85 }}
          aria-hidden
        />
        <div className="flex items-center gap-2 text-[10px] text-[var(--mp-fg-muted)] uppercase tracking-[0.1em]">
          <Coins size={12} />
          <span>Monthly recurring revenue</span>
          <span className="flex-1" />
          <StatusDot tone="success" size={6} />
        </div>
        <div className="mt-2 flex items-end gap-4 flex-wrap">
          <div className="text-[44px] leading-none font-semibold text-[var(--mp-fg)] tabular-nums">
            {loading ? (
              <span className="text-[var(--mp-fg-muted)]">—</span>
            ) : (
              <FormatEuro cents={metrics?.mrr_cents ?? 0} />
            )}
          </div>
          <div className="text-xs text-[var(--mp-fg-muted)] pb-1.5">/ month</div>
        </div>
        {metrics && (
          <div className="mt-2 text-[11px] text-[var(--mp-fg-muted)] max-w-2xl">
            {metrics.basis.mrr}
          </div>
        )}
      </div>

      {/* Supporting euro tiles. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
        <MetricTile
          label="Paying customers"
          icon={Users}
          tone="info"
          value={
            loading ? "—" : <FormatInt value={metrics?.active_paid_users ?? 0} />
          }
          footer="Genuinely paying right now (excl. comped)"
        />
        <MetricTile
          label="Paid conversion"
          icon={TrendingUp}
          tone={convTone}
          value={
            loading || convRatio == null ? "—" : formatPct(convRatio)
          }
          footer={
            conv ? (
              <span>
                <strong className="text-[var(--mp-fg)] tabular-nums">
                  {formatInt(conv.paying_users)}
                </strong>{" "}
                / {formatInt(conv.total_users)} real users · the number to move
              </span>
            ) : (
              "paying ÷ real users"
            )
          }
        />
        <MetricTile
          label="Entitled Pro (incl. comped)"
          icon={Users}
          tone="neutral"
          value={
            loading ? "—" : <FormatInt value={entitled?.entitled_now ?? 0} />
          }
          footer={
            entitled ? (
              <span>
                <strong className="text-[var(--mp-fg)] tabular-nums">
                  {formatInt(entitled.entitled_all_time)}
                </strong>{" "}
                all-time · admin / comped / demo, not revenue
              </span>
            ) : (
              "tier=pro incl. comped"
            )
          }
        />
        <MetricTile
          label="Churn (30d)"
          icon={TrendingDown}
          tone={
            loading
              ? "neutral"
              : (metrics?.churn_30d ?? 0) > 0
                ? "warn"
                : "success"
          }
          value={loading ? "—" : <FormatInt value={metrics?.churn_30d ?? 0} />}
          footer="Activated subs lost (not abandoned checkouts)"
        />
        <MetricTile
          label="LTV (modeled)"
          icon={Coins}
          tone="info"
          value={loading ? "—" : <FormatEuro cents={metrics?.ltv_cents ?? 0} />}
          footer="Per paying customer"
        />
      </div>

      {/* Reconciliation line — keeps €0-active-rows honest, never hidden. */}
      {metrics && (
        <div className="rounded-md border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-sunken)] px-3 py-2 text-[11px] text-[var(--mp-fg-muted)] flex items-start gap-2">
          <GitMerge size={13} className="mt-0.5 flex-shrink-0" />
          <span>
            <strong className="text-[var(--mp-fg)]">Reconciliation:</strong>{" "}
            {metrics.reconciliation.active_subscription_rows} active subscription
            row
            {metrics.reconciliation.active_subscription_rows === 1
              ? ""
              : "s"}. {metrics.reconciliation.note}
          </span>
        </div>
      )}
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Secondary coverage strip — intentionally smaller than the euros block
// ═══════════════════════════════════════════════════════════════════

function CoverageStrip({
  metrics,
  loading,
}: {
  metrics: ControlPlaneMetrics | null;
  loading: boolean;
}) {
  const cov = metrics?.automation_coverage;
  const pct = cov ? cov.ratio : null;

  return (
    <section className="space-y-2">
      <SectionHeading
        title="Secondary — automation coverage"
        icon={Cpu}
        hint="Efficiency stat, never the success metric"
      />
      <div className="rounded-xl border border-dashed border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-4 py-3 flex items-center gap-4 flex-wrap">
        <div className="flex items-baseline gap-1.5">
          <span className="text-xl font-semibold text-[var(--mp-fg-muted)] tabular-nums">
            {loading || pct == null ? "—" : formatPct(pct)}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-subtle)]">
            covered
          </span>
        </div>
        {/* Slim bar — muted, so it can't outshine the euros above. */}
        <div className="flex-1 min-w-[160px] h-1.5 rounded-full bg-[var(--mp-surface-sunken)] overflow-hidden">
          <div
            className="h-full rounded-full bg-[var(--mp-fg-muted)] transition-[width] duration-500"
            style={{ width: `${Math.round((pct ?? 0) * 100)}%` }}
            aria-hidden
          />
        </div>
        {cov && (
          <div className="flex items-center gap-2 text-[10px] text-[var(--mp-fg-muted)] font-mono">
            {LADDER_LEGEND.map(({ level }) => {
              const n = cov.by_level[level] ?? 0;
              if (n === 0) return null;
              return (
                <span key={level} className="inline-flex items-center gap-1">
                  <LevelChip level={level} muted />
                  <span>×{n}</span>
                </span>
              );
            })}
            <span className="text-[var(--mp-fg-subtle)]">
              across {cov.process_count} processes
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Process registry — STATIC table (F-02)
// ═══════════════════════════════════════════════════════════════════

function ProcessRegistrySection() {
  return (
    <section className="space-y-3">
      <SectionHeading
        title="Process registry"
        icon={Layers}
        hint="8 processes · static · mirrors AUTONOMY.md"
      />

      {/* Ladder legend so L0–L4 are self-explaining. */}
      <div className="flex items-center gap-2 flex-wrap text-[10px] text-[var(--mp-fg-muted)]">
        <span className="uppercase tracking-wider text-[var(--mp-fg-subtle)]">
          Ladder:
        </span>
        {LADDER_LEGEND.map(({ level, label }) => (
          <span key={level} className="inline-flex items-center gap-1">
            <LevelChip level={level} />
            <span>{label}</span>
          </span>
        ))}
      </div>

      <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-muted)] border-b border-[var(--mp-border-subtle)]">
                <th className="text-left font-medium px-3 py-2.5">Process</th>
                <th className="text-left font-medium px-3 py-2.5">Owner</th>
                <th className="text-left font-medium px-3 py-2.5">Now</th>
                <th className="text-left font-medium px-3 py-2.5">Target</th>
                <th className="text-left font-medium px-3 py-2.5">
                  Success metric
                </th>
                <th className="text-left font-medium px-3 py-2.5">Top gap</th>
              </tr>
            </thead>
            <tbody>
              {CONTROL_PLANE_PROCESSES.map((p) => (
                <ProcessRowView key={p.process} row={p} />
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-[var(--mp-border-subtle)] px-3 py-2 text-[11px] text-[var(--mp-fg-muted)] flex items-start gap-2">
          <HeartPulse size={13} className="mt-0.5 flex-shrink-0" />
          <span>{REGISTRY_REALITY_NOTE}</span>
        </div>
      </div>
    </section>
  );
}

function ProcessRowView({ row }: { row: ProcessRow }) {
  return (
    <tr className="border-b last:border-0 border-[var(--mp-border-subtle)]/60 hover:bg-[var(--mp-surface-sunken)]/50">
      <td className="px-3 py-2.5 font-semibold text-[var(--mp-fg)] whitespace-nowrap">
        {row.process}
      </td>
      <td className="px-3 py-2.5 text-[var(--mp-fg-muted)] whitespace-nowrap">
        {row.owner}
      </td>
      <td className="px-3 py-2.5">
        <LevelChip level={row.currentLevel} prominent />
      </td>
      <td className="px-3 py-2.5 text-[var(--mp-fg-muted)]">{row.targetLevel}</td>
      <td className="px-3 py-2.5 text-[var(--mp-fg)]">{row.successMetric}</td>
      <td className="px-3 py-2.5 font-mono text-[10px] text-[var(--mp-fg-muted)]">
        {row.topGap}
      </td>
    </tr>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Shared bits
// ═══════════════════════════════════════════════════════════════════

/**
 * Level chip — color climbs L0 (muted) → L4 (viridian). `prominent` is the
 * bigger pill used in the "Now" column; `muted` flattens it for the legend.
 */
function LevelChip({
  level,
  prominent = false,
  muted = false,
}: {
  level: AutomationLevel;
  prominent?: boolean;
  muted?: boolean;
}) {
  const tone: Record<AutomationLevel, { fg: string; bg: string; bd: string }> = {
    L0: {
      fg: "var(--mp-fg-muted)",
      bg: "var(--mp-surface-sunken)",
      bd: "var(--mp-border-subtle)",
    },
    L1: {
      fg: "var(--mp-info)",
      bg: "color-mix(in srgb, var(--mp-info) 12%, transparent)",
      bd: "color-mix(in srgb, var(--mp-info) 40%, transparent)",
    },
    L2: {
      fg: "var(--mp-warning)",
      bg: "color-mix(in srgb, var(--mp-warning) 12%, transparent)",
      bd: "color-mix(in srgb, var(--mp-warning) 40%, transparent)",
    },
    L3: {
      fg: "var(--mp-viridian)",
      bg: "color-mix(in srgb, var(--mp-viridian) 12%, transparent)",
      bd: "color-mix(in srgb, var(--mp-viridian) 40%, transparent)",
    },
    L4: {
      fg: "var(--mp-viridian)",
      bg: "color-mix(in srgb, var(--mp-viridian) 20%, transparent)",
      bd: "color-mix(in srgb, var(--mp-viridian) 60%, transparent)",
    },
  };
  const t = muted
    ? {
        fg: "var(--mp-fg-muted)",
        bg: "var(--mp-surface-sunken)",
        bd: "var(--mp-border-subtle)",
      }
    : tone[level];
  return (
    <span
      className={`inline-flex items-center justify-center font-mono font-semibold rounded border ${
        prominent ? "text-[11px] px-2 py-0.5" : "text-[9px] px-1.5 py-0.5"
      }`}
      style={{ color: t.fg, backgroundColor: t.bg, borderColor: t.bd }}
    >
      {level}
    </span>
  );
}

interface MetricTileProps {
  label: string;
  icon: typeof Users;
  value: React.ReactNode;
  footer?: React.ReactNode;
  tone?: "success" | "warn" | "danger" | "info" | "neutral";
}

function MetricTile({ label, icon: Icon, value, footer, tone = "neutral" }: MetricTileProps) {
  const accent =
    tone === "success"
      ? "var(--mp-viridian)"
      : tone === "warn"
        ? "var(--mp-warning)"
        : tone === "danger"
          ? "var(--mp-error)"
          : tone === "info"
            ? "var(--mp-info)"
            : "var(--mp-fg-muted)";
  return (
    <div className="relative rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4 min-h-[120px] flex flex-col">
      <div
        className="absolute top-0 left-0 right-0 h-[3px] rounded-t-2xl"
        style={{ backgroundColor: accent, opacity: 0.85 }}
        aria-hidden
      />
      <div className="flex items-center gap-2 text-[10px] text-[var(--mp-fg-muted)] uppercase tracking-[0.1em]">
        <Icon size={12} />
        <span>{label}</span>
        <span className="flex-1" />
        <StatusDot tone={tone} size={6} />
      </div>
      <div className="mt-2 flex-1 flex items-center text-2xl font-semibold text-[var(--mp-fg)] tabular-nums">
        {value}
      </div>
      {footer && (
        <div className="mt-2 pt-2 border-t border-[var(--mp-border-subtle)] text-[10px] text-[var(--mp-fg-muted)]">
          {footer}
        </div>
      )}
    </div>
  );
}
