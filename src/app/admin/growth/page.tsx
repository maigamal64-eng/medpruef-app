"use client";

/**
 * /admin/growth — the GROWTH section of the Autonomy Control Plane (AUTONOMY.md
 * F-08). The reach/funnel counterpart to /admin/control-plane.
 *
 *   1. FUNNEL hero (live): signups → activated → engaged → paying, each with a
 *      count, % of signups, and a bar. Fed by GET /api/stats/admin/growth.
 *   2. PRESENCE CHANNELS (static): the 11 platforms with status dots (live /
 *      ready / planned), mirroring marketing/presence/presence-console.html.
 *   3. CAMPAIGNS (static): the community + own-channel queue from
 *      MEDPRUF-CAMPAIGNS.md.
 *   4. EXPERIMENTS (static): the revived Funnels/Experiments stubs — none yet.
 *
 * Boundary note (same rule as control-plane): this client page imports ONLY
 * pure data (growthChannels consts) + the funnel TYPE (duplicated minimally
 * below). The funnel COMPUTATION lives server-side in @/lib/admin/growthMetrics
 * (it pulls getServiceClient) and is reached exclusively via the admin-shelled
 * API route — it is NEVER imported into the client.
 *
 * Growth owns reach/funnel; euros (MRR, conversion, churn, LTV) stay on
 * /admin/control-plane.
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  FlaskConical,
  Radio,
  TrendingUp,
  UserCheck,
  UserPlus,
  Users,
  Wallet,
  Megaphone,
} from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { AdminPageShell } from "../_components/AdminPageShell";
import {
  SectionHeading,
  StatusDot,
  formatInt,
  formatPct,
  type StatusTone,
} from "../_components/primitives";
import {
  PRESENCE_CHANNELS,
  CAMPAIGNS,
  EXPERIMENTS,
  EXPERIMENTS_EMPTY_NOTE,
  type ChannelStatus,
} from "@/lib/admin/growthChannels";

// Mirror of the API response shape (the server type lives with the computation
// in @/lib/admin/growthMetrics; duplicated minimally here to avoid pulling a
// server-only module into the client bundle).
interface GrowthFunnelStep {
  count: number;
  pctOfSignups: number;
}
interface GrowthMetrics {
  generated_at: string;
  signups: GrowthFunnelStep;
  activated: GrowthFunnelStep;
  engaged: GrowthFunnelStep;
  paying: GrowthFunnelStep;
  basis: {
    signups: string;
    activated: string;
    engaged: string;
    paying: string;
  };
}

export default function AdminGrowthPage() {
  const [metrics, setMetrics] = useState<GrowthMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const hydrate = useCallback(async () => {
    try {
      const res = await fetch("/api/stats/admin/growth", { cache: "no-store" });
      if (!res.ok) throw new Error(`growth ${res.status}`);
      setMetrics((await res.json()) as GrowthMetrics);
      setError(null);
    } catch (e) {
      setError((e as Error).message || "Failed to load growth metrics");
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
      title="Growth"
      description={
        <span>
          Reach + funnel. Euros stay on the control plane.{" "}
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

      {/* ─── GROWTH FUNNEL (live hero) ───────────────────────────────── */}
      <FunnelBlock metrics={metrics} loading={loading} />

      {/* ─── PRESENCE CHANNELS (static) ──────────────────────────────── */}
      <PresenceSection />

      {/* ─── CAMPAIGNS pipeline (static) ─────────────────────────────── */}
      <CampaignsSection />

      {/* ─── EXPERIMENTS (static, none yet) ──────────────────────────── */}
      <ExperimentsSection />
    </AdminPageShell>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Funnel hero — signups → activated → engaged → paying
// ═══════════════════════════════════════════════════════════════════

const FUNNEL_STAGES: Array<{
  key: keyof Omit<GrowthMetrics, "generated_at" | "basis">;
  label: string;
  icon: typeof Users;
  tone: StatusTone;
}> = [
  { key: "signups", label: "Signups", icon: UserPlus, tone: "info" },
  { key: "activated", label: "Activated", icon: UserCheck, tone: "info" },
  { key: "engaged", label: "Engaged", icon: TrendingUp, tone: "success" },
  { key: "paying", label: "Paying", icon: Wallet, tone: "success" },
];

function FunnelBlock({
  metrics,
  loading,
}: {
  metrics: GrowthMetrics | null;
  loading: boolean;
}) {
  return (
    <section className="space-y-3">
      <SectionHeading
        title="Growth funnel"
        icon={TrendingUp}
        hint="Real users only (admin / comped / demo excluded)"
      />

      <div className="rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-5 relative overflow-hidden">
        <div
          className="absolute top-0 left-0 right-0 h-[3px] rounded-t-2xl"
          style={{ backgroundColor: "var(--mp-viridian)", opacity: 0.85 }}
          aria-hidden
        />
        <div className="space-y-3">
          {FUNNEL_STAGES.map(({ key, label, icon: Icon, tone }) => {
            const stepData = metrics ? metrics[key] : null;
            const pct = stepData ? stepData.pctOfSignups : null;
            const basis = metrics ? metrics.basis[key] : null;
            return (
              <div key={key} className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-2 w-32 flex-shrink-0">
                  <Icon size={14} className="text-[var(--mp-fg-muted)]" />
                  <span className="text-xs font-medium text-[var(--mp-fg)]">
                    {label}
                  </span>
                </div>
                <div className="text-2xl font-semibold text-[var(--mp-fg)] tabular-nums w-20 flex-shrink-0">
                  {loading || !stepData ? (
                    <span className="text-[var(--mp-fg-muted)]">—</span>
                  ) : (
                    formatInt(stepData.count)
                  )}
                </div>
                {/* Bar — width tracks % of signups so drop-off is visible. */}
                <div className="flex-1 min-w-[140px] h-2.5 rounded-full bg-[var(--mp-surface-sunken)] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{
                      width: `${Math.round((pct ?? 0) * 100)}%`,
                      backgroundColor:
                        tone === "success"
                          ? "var(--mp-viridian)"
                          : "var(--mp-info)",
                    }}
                    aria-hidden
                  />
                </div>
                <div className="text-xs text-[var(--mp-fg-muted)] tabular-nums w-14 flex-shrink-0 text-right">
                  {loading || pct == null ? "—" : formatPct(pct)}
                </div>
                {basis && (
                  <div className="w-full pl-32 text-[10px] text-[var(--mp-fg-subtle)]">
                    {basis}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Presence channels — static grid with status dots
// ═══════════════════════════════════════════════════════════════════

const CHANNEL_TONE: Record<ChannelStatus, StatusTone> = {
  live: "success",
  ready: "info",
  planned: "neutral",
};

const CHANNEL_LABEL: Record<ChannelStatus, string> = {
  live: "Live",
  ready: "Ready",
  planned: "Planned",
};

function PresenceSection() {
  const liveCount = PRESENCE_CHANNELS.filter((c) => c.status === "live").length;
  return (
    <section className="space-y-3">
      <SectionHeading
        title="Presence channels"
        icon={Radio}
        hint={`${liveCount} live · ${PRESENCE_CHANNELS.length} platforms · mirrors the presence console`}
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {PRESENCE_CHANNELS.map((c) => (
          <div
            key={c.name}
            className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-4 py-3 flex items-center gap-3"
          >
            <StatusDot tone={CHANNEL_TONE[c.status]} size={8} />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-[var(--mp-fg)] truncate">
                {c.name}
              </div>
              <div className="text-[11px] text-[var(--mp-fg-muted)] font-mono truncate">
                {c.handle}
              </div>
            </div>
            <span className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-subtle)] flex-shrink-0">
              {CHANNEL_LABEL[c.status]}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Campaigns pipeline — static list
// ═══════════════════════════════════════════════════════════════════

const CAMPAIGN_TONE: Record<Campaign["status"], StatusTone> = {
  live: "success",
  queued: "warn",
  drafted: "neutral",
};

const CAMPAIGN_LABEL: Record<Campaign["status"], string> = {
  live: "Live",
  queued: "Queued",
  drafted: "Drafted",
};

type Campaign = (typeof CAMPAIGNS)[number];

function CampaignsSection() {
  return (
    <section className="space-y-3">
      <SectionHeading
        title="Campaigns"
        icon={Megaphone}
        hint="Community + own-channel queue · mirrors the campaigns log"
      />
      <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] overflow-hidden divide-y divide-[var(--mp-border-subtle)]">
        {CAMPAIGNS.map((c, i) => (
          <div
            key={`${c.channel}-${i}`}
            className="px-4 py-3 flex items-start gap-3 hover:bg-[var(--mp-surface-sunken)]/50"
          >
            <StatusDot tone={CAMPAIGN_TONE[c.status]} size={8} />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-[var(--mp-fg)]">
                {c.channel}
              </div>
              <div className="text-[11px] text-[var(--mp-fg-muted)]">
                {c.angle}
              </div>
            </div>
            <span className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-subtle)] flex-shrink-0">
              {CAMPAIGN_LABEL[c.status]}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Experiments — static (none running yet)
// ═══════════════════════════════════════════════════════════════════

function ExperimentsSection() {
  return (
    <section className="space-y-3">
      <SectionHeading
        title="Experiments"
        icon={FlaskConical}
        hint="A/B tests · revived Funnels + Experiments stubs"
      />
      {EXPERIMENTS.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-4 py-4 flex items-start gap-2 text-[11px] text-[var(--mp-fg-muted)]">
          <FlaskConical size={13} className="mt-0.5 flex-shrink-0" />
          <span>{EXPERIMENTS_EMPTY_NOTE}</span>
        </div>
      ) : (
        <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] overflow-hidden divide-y divide-[var(--mp-border-subtle)]">
          {EXPERIMENTS.map((e) => (
            <div
              key={e.name}
              className="px-4 py-3 flex items-start gap-3"
            >
              <StatusDot
                tone={e.status === "running" ? "success" : "neutral"}
                size={8}
              />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-[var(--mp-fg)]">
                  {e.name}
                </div>
                <div className="text-[11px] text-[var(--mp-fg-muted)]">
                  {e.metric}
                </div>
              </div>
              <span className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-subtle)] flex-shrink-0">
                {e.status}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
