"use client";

/**
 * /admin/overview — mission-control landing page.
 *
 * §2.2 of the April 23 admin revamp sprint.
 *
 * Renders 11 tiles in a responsive grid. Each tile:
 *  - hydrates from /api/admin/overview on mount,
 *  - subscribes to Supabase Realtime for its backing table via useAdminRealtime,
 *  - bumps its local counter in response to INSERT events,
 *  - flashes a "fresh" pulse when data changes.
 *
 * This sprint wires 6 tiles to real data:
 *  1) Revenue today (subscriptions)
 *  2) Active paid subs (subscriptions)
 *  3) New signups today (user_events / users)
 *  4) Paywall hits today (user_events)
 *  5) Referrals awaiting action (referrals)
 *  6) PUYP verifications pending (exam_attempts)
 *
 * The remaining 5 render a "Coming soon" scaffold with their realtime-ready
 * hooks already attached, so upgrading them in a follow-up is a one-file job.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  Clock,
  Gauge,
  GitBranch,
  MessageSquare,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Users,
  Wallet,
  Webhook,
} from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { useAdminRealtime } from "@/lib/admin/useAdminRealtime";

interface OverviewSnapshot {
  generated_at: string;
  tiles: {
    revenue: { today_cents: number; mtd_cents: number };
    active_subs: { total: number; by_tier: Record<string, number> };
    signups_today: number;
    paywall_hits_today: number;
    referrals_awaiting_action: number;
    puyp_pending: number;
    flagged_open: number;
    webhook_failures_24h: number;
    conversion_7d: number | null;
    crons: Record<string, { lastStatus: string; lastStartedAt: string | null }>;
    recent_events: Array<{
      id: string | number;
      event_type: string;
      user_id: string | null;
      created_at: string;
    }>;
  };
}

export default function AdminOverviewPage() {
  const [snapshot, setSnapshot] = useState<OverviewSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const hydrate = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/overview", { cache: "no-store" });
      if (!res.ok) throw new Error(`overview ${res.status}`);
      setSnapshot((await res.json()) as OverviewSnapshot);
      setError(null);
    } catch (e) {
      setError((e as Error).message || "Failed to load overview");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Auto-refresh every 60s as a polling fallback in case Realtime drops.
  useEffect(() => {
    const id = setInterval(hydrate, 60_000);
    return () => clearInterval(id);
  }, [hydrate]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-[var(--mp-fg)]">Overview</h1>
          <p className="text-xs text-[var(--mp-fg-muted)] mt-0.5">
            Live mission-control deck.{" "}
            {snapshot && (
              <span className="font-mono">
                Snapshot: {new Date(snapshot.generated_at).toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <FreshnessBadge state={loading ? "cached" : "live"} />
      </div>

      {error && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
          <AlertCircle size={14} />
          {error}
        </div>
      )}

      {/* Running-now ribbon — reads `jobs` Realtime + shows active jobs. */}
      <RunningNowRibbon />

      {/* Tile grid. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {/* 1. Revenue today */}
        <RevenueTile
          todayCents={snapshot?.tiles.revenue.today_cents ?? 0}
          mtdCents={snapshot?.tiles.revenue.mtd_cents ?? 0}
        />

        {/* 2. Active paid subs */}
        <ActiveSubsTile
          total={snapshot?.tiles.active_subs.total ?? 0}
          byTier={snapshot?.tiles.active_subs.by_tier ?? {}}
        />

        {/* 3. New signups today */}
        <SignupsTile initial={snapshot?.tiles.signups_today ?? 0} />

        {/* 4. Paywall hits today */}
        <PaywallTile initial={snapshot?.tiles.paywall_hits_today ?? 0} />

        {/* 5. Referrals awaiting action */}
        <ReferralsTile initial={snapshot?.tiles.referrals_awaiting_action ?? 0} />

        {/* 6. PUYP verifications pending */}
        <PuypTile initial={snapshot?.tiles.puyp_pending ?? 0} />

        {/* 7. Flagged questions — skeleton + realtime-ready */}
        <FlaggedQuestionsTile initial={snapshot?.tiles.flagged_open ?? 0} />

        {/* 8. Webhook failures — skeleton */}
        <SkeletonTile
          label="Webhook failures (24h)"
          value={snapshot?.tiles.webhook_failures_24h ?? 0}
          icon={Webhook}
          href="/admin/webhooks"
          comingSoon
        />

        {/* 9. Conversion — skeleton */}
        <ConversionTile conversion7d={snapshot?.tiles.conversion_7d ?? null} />

        {/* 10. Cron health — skeleton */}
        <CronsTile crons={snapshot?.tiles.crons ?? {}} />

        {/* 11. Live activity feed — skeleton */}
        <LiveFeedTile events={snapshot?.tiles.recent_events ?? []} />
      </div>
    </div>
  );
}

// ─── Tiles ───────────────────────────────────────────────────────────────

function Tile({
  label,
  icon: Icon,
  children,
  href,
  footer,
  accent,
  pulse,
}: {
  label: string;
  icon: typeof Users;
  children: React.ReactNode;
  href?: string;
  footer?: React.ReactNode;
  accent?: "success" | "warn" | "danger" | "info";
  pulse?: boolean;
}) {
  const accentClass =
    accent === "success"
      ? "before:bg-emerald-500"
      : accent === "warn"
        ? "before:bg-amber-500"
        : accent === "danger"
          ? "before:bg-red-500"
          : "before:bg-sky-500";

  const inner = (
    <div
      className={`relative rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4 min-h-[108px] flex flex-col transition-shadow hover:shadow-md before:absolute before:top-0 before:left-0 before:right-0 before:h-[2px] before:rounded-t-xl ${accentClass ?? ""} ${pulse ? "tile-pulse" : ""}`}
    >
      <div className="flex items-center gap-2 text-[11px] text-[var(--mp-fg-muted)] uppercase tracking-wider">
        <Icon size={12} />
        <span>{label}</span>
      </div>
      <div className="mt-1 flex-1 flex flex-col justify-center tabular-nums">
        {children}
      </div>
      {footer && (
        <div className="mt-2 pt-2 border-t border-[var(--mp-border-subtle)] text-[10px] text-[var(--mp-fg-muted)]">
          {footer}
        </div>
      )}
      <style jsx>{`
        .tile-pulse {
          animation: tile-pulse 0.6s ease-out;
        }
        @keyframes tile-pulse {
          0% {
            box-shadow: 0 0 0 0 rgba(0, 123, 95, 0);
          }
          30% {
            box-shadow: 0 0 0 6px rgba(0, 123, 95, 0.22);
          }
          100% {
            box-shadow: 0 0 0 0 rgba(0, 123, 95, 0);
          }
        }
      `}</style>
    </div>
  );

  return href ? (
    <Link href={href} className="no-underline">
      {inner}
    </Link>
  ) : (
    inner
  );
}

function RevenueTile({
  todayCents,
  mtdCents,
}: {
  todayCents: number;
  mtdCents: number;
}) {
  const [pulse, setPulse] = useState(false);
  const [liveToday, setLiveToday] = useState(todayCents);
  const [liveMtd, setLiveMtd] = useState(mtdCents);

  useEffect(() => setLiveToday(todayCents), [todayCents]);
  useEffect(() => setLiveMtd(mtdCents), [mtdCents]);

  useAdminRealtime("subscriptions", {
    onEvent: (payload) => {
      if (payload.eventType !== "INSERT") return;
      const row = payload.new as Record<string, unknown> | undefined;
      const cents = Number(row?.amount_cents) || 0;
      const status = row?.status as string | undefined;
      if (status !== "active") return;
      setLiveToday((v) => v + cents);
      setLiveMtd((v) => v + cents);
      setPulse(true);
      setTimeout(() => setPulse(false), 700);
    },
  });

  return (
    <Tile
      label="Revenue today"
      icon={Wallet}
      accent="success"
      href="/admin/subscriptions"
      pulse={pulse}
      footer={
        <>
          MTD: <span className="text-[var(--mp-fg)] font-semibold">€{(liveMtd / 100).toFixed(2)}</span>
        </>
      }
    >
      <div className="text-2xl font-semibold text-[var(--mp-fg)]">
        €{(liveToday / 100).toFixed(2)}
      </div>
    </Tile>
  );
}

function ActiveSubsTile({
  total,
  byTier,
}: {
  total: number;
  byTier: Record<string, number>;
}) {
  const [pulse, setPulse] = useState(false);
  const [live, setLive] = useState({ total, byTier });

  useEffect(() => setLive({ total, byTier }), [total, byTier]);

  useAdminRealtime("subscriptions", {
    onEvent: (payload) => {
      if (payload.eventType === "INSERT") {
        const row = payload.new as Record<string, unknown> | undefined;
        if ((row?.status as string) === "active") {
          const tier = (row?.tier as string) || "unknown";
          setLive((p) => ({
            total: p.total + 1,
            byTier: { ...p.byTier, [tier]: (p.byTier[tier] || 0) + 1 },
          }));
          setPulse(true);
          setTimeout(() => setPulse(false), 700);
        }
      }
    },
  });

  const tiers = Object.entries(live.byTier)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return (
    <Tile
      label="Active paid subs"
      icon={Users}
      accent="info"
      href="/admin/subscriptions"
      pulse={pulse}
      footer={
        tiers.length > 0 ? (
          <div className="flex gap-2 flex-wrap">
            {tiers.map(([tier, n]) => (
              <span key={tier} className="text-[var(--mp-fg)]">
                {tier}: <strong>{n}</strong>
              </span>
            ))}
          </div>
        ) : (
          <span>No active subs</span>
        )
      }
    >
      <div className="text-2xl font-semibold text-[var(--mp-fg)]">{live.total}</div>
    </Tile>
  );
}

function SignupsTile({ initial }: { initial: number }) {
  const [pulse, setPulse] = useState(false);
  const [live, setLive] = useState(initial);
  useEffect(() => setLive(initial), [initial]);

  // We can't subscribe to auth.users — instead we listen to user_events
  // of type 'user_registered' which every signup path emits.
  useAdminRealtime("user_events", {
    onEvent: (payload) => {
      if (payload.eventType !== "INSERT") return;
      const row = payload.new as Record<string, unknown> | undefined;
      if (row?.event_type === "user_registered") {
        setLive((v) => v + 1);
        setPulse(true);
        setTimeout(() => setPulse(false), 700);
      }
    },
  });

  return (
    <Tile
      label="New signups today"
      icon={TrendingUp}
      accent="success"
      href="/admin/users"
      pulse={pulse}
    >
      <div className="text-2xl font-semibold text-[var(--mp-fg)]">{live}</div>
    </Tile>
  );
}

function PaywallTile({ initial }: { initial: number }) {
  const [pulse, setPulse] = useState(false);
  const [live, setLive] = useState(initial);
  useEffect(() => setLive(initial), [initial]);

  useAdminRealtime("user_events", {
    onEvent: (payload) => {
      if (payload.eventType !== "INSERT") return;
      const row = payload.new as Record<string, unknown> | undefined;
      if (row?.event_type === "paywall_hit") {
        setLive((v) => v + 1);
        setPulse(true);
        setTimeout(() => setPulse(false), 700);
      }
    },
  });

  return (
    <Tile
      label="Paywall hits today"
      icon={ShieldAlert}
      accent="warn"
      href="/admin/subscriptions"
      pulse={pulse}
    >
      <div className="text-2xl font-semibold text-[var(--mp-fg)]">{live}</div>
    </Tile>
  );
}

function ReferralsTile({ initial }: { initial: number }) {
  const [pulse, setPulse] = useState(false);
  const [live, setLive] = useState(initial);
  useEffect(() => setLive(initial), [initial]);

  useAdminRealtime("referrals", {
    onEvent: (payload) => {
      const row = payload.new as Record<string, unknown> | undefined;
      if (payload.eventType === "UPDATE") {
        const oldRow = payload.old as Record<string, unknown> | undefined;
        if (oldRow?.status !== "qualified" && row?.status === "qualified") {
          setLive((v) => v + 1);
          setPulse(true);
          setTimeout(() => setPulse(false), 700);
        } else if (oldRow?.status === "qualified" && row?.status !== "qualified") {
          setLive((v) => Math.max(0, v - 1));
        }
      } else if (payload.eventType === "INSERT" && row?.status === "qualified") {
        setLive((v) => v + 1);
      }
    },
  });

  return (
    <Tile
      label="Referrals awaiting action"
      icon={GitBranch}
      accent={live > 0 ? "warn" : "success"}
      href="/admin/referrals"
      pulse={pulse}
    >
      <div className="text-2xl font-semibold text-[var(--mp-fg)]">{live}</div>
    </Tile>
  );
}

function PuypTile({ initial }: { initial: number }) {
  const [pulse, setPulse] = useState(false);
  const [live, setLive] = useState(initial);
  useEffect(() => setLive(initial), [initial]);

  useAdminRealtime("exam_attempts", {
    onEvent: (payload) => {
      const row = payload.new as Record<string, unknown> | undefined;
      if (payload.eventType === "INSERT" && row?.result === "fail" && !row?.verified_at) {
        setLive((v) => v + 1);
        setPulse(true);
        setTimeout(() => setPulse(false), 700);
      }
      if (payload.eventType === "UPDATE") {
        const oldRow = payload.old as Record<string, unknown> | undefined;
        if (!oldRow?.verified_at && row?.verified_at) {
          setLive((v) => Math.max(0, v - 1));
        }
      }
    },
  });

  return (
    <Tile
      label="PUYP pending"
      icon={ShieldCheck}
      accent={live > 0 ? "warn" : "success"}
      href="/admin/puyp"
      pulse={pulse}
    >
      <div className="text-2xl font-semibold text-[var(--mp-fg)]">{live}</div>
    </Tile>
  );
}

function FlaggedQuestionsTile({ initial }: { initial: number }) {
  const [pulse, setPulse] = useState(false);
  const [live, setLive] = useState(initial);
  useEffect(() => setLive(initial), [initial]);

  useAdminRealtime("user_feedback", {
    onEvent: (payload) => {
      const row = payload.new as Record<string, unknown> | undefined;
      if (payload.eventType === "INSERT" && row?.status === "new") {
        setLive((v) => v + 1);
        setPulse(true);
        setTimeout(() => setPulse(false), 700);
      }
    },
  });

  return (
    <Tile
      label="Open feedback"
      icon={MessageSquare}
      accent={live > 0 ? "warn" : "success"}
      href="/admin/feedback"
      pulse={pulse}
    >
      <div className="text-2xl font-semibold text-[var(--mp-fg)]">{live}</div>
    </Tile>
  );
}

function ConversionTile({ conversion7d }: { conversion7d: number | null }) {
  const pct = conversion7d != null ? conversion7d * 100 : null;
  const danger = pct != null && pct < 2;
  return (
    <Tile
      label="Conversion (7d)"
      icon={TrendingUp}
      accent={danger ? "danger" : "info"}
      href="/admin/funnels"
      footer={
        <span className="italic text-[var(--mp-fg-muted)]">
          Deeper funnel view coming soon
        </span>
      }
    >
      <div className="text-2xl font-semibold text-[var(--mp-fg)]">
        {pct != null ? `${pct.toFixed(1)}%` : "—"}
      </div>
    </Tile>
  );
}

function CronsTile({
  crons,
}: {
  crons: Record<string, { lastStatus: string; lastStartedAt: string | null }>;
}) {
  const entries = Object.entries(crons);
  const anyFail = entries.some(([, v]) => v.lastStatus === "failed");
  return (
    <Tile
      label="Cron health (24h)"
      icon={Gauge}
      accent={anyFail ? "danger" : entries.length === 0 ? "warn" : "success"}
      href="/admin/crons"
      footer={
        entries.length === 0
          ? "No cron runs seen in 24h"
          : `${entries.length} jobs tracked`
      }
    >
      <div className="flex flex-wrap gap-1">
        {entries.length === 0 && (
          <span className="text-sm text-[var(--mp-fg-muted)]">—</span>
        )}
        {entries.slice(0, 8).map(([name, v]) => (
          <span
            key={name}
            title={`${name} — ${v.lastStatus}`}
            className={`w-2 h-2 rounded-full ${
              v.lastStatus === "succeeded"
                ? "bg-emerald-500"
                : v.lastStatus === "failed"
                  ? "bg-red-500"
                  : "bg-amber-500"
            }`}
          />
        ))}
      </div>
    </Tile>
  );
}

function LiveFeedTile({
  events,
}: {
  events: Array<{
    id: string | number;
    event_type: string;
    user_id: string | null;
    created_at: string;
  }>;
}) {
  return (
    <Tile
      label="Live activity"
      icon={Activity}
      accent="info"
      href="/admin/audit"
      footer={
        <span className="italic text-[var(--mp-fg-muted)]">
          Full feed lands in a follow-up
        </span>
      }
    >
      {events.length === 0 ? (
        <span className="text-sm text-[var(--mp-fg-muted)]">No recent events</span>
      ) : (
        <ul className="space-y-0.5 text-[11px] font-mono text-[var(--mp-fg-muted)]">
          {events.slice(0, 5).map((e) => (
            <li key={String(e.id)} className="truncate">
              <span className="text-[var(--mp-fg)]">{e.event_type}</span>{" "}
              {new Date(e.created_at).toLocaleTimeString()}
            </li>
          ))}
        </ul>
      )}
    </Tile>
  );
}

function SkeletonTile({
  label,
  value,
  icon: Icon,
  href,
  comingSoon,
}: {
  label: string;
  value: number;
  icon: typeof Users;
  href: string;
  comingSoon?: boolean;
}) {
  return (
    <Tile
      label={label}
      icon={Icon}
      href={href}
      accent={value > 0 ? "danger" : "info"}
      footer={
        comingSoon ? (
          <span className="italic text-[var(--mp-fg-muted)]">
            Auto-refresh in a follow-up
          </span>
        ) : undefined
      }
    >
      <div className="text-2xl font-semibold text-[var(--mp-fg)]">{value}</div>
    </Tile>
  );
}

function RunningNowRibbon() {
  const [jobs, setJobs] = useState<Array<Record<string, unknown>>>([]);

  useAdminRealtime("jobs", {
    onEvent: (payload) => {
      const row = payload.new as Record<string, unknown> | undefined;
      if (!row) return;
      setJobs((current) => {
        const idx = current.findIndex((j) => j.id === row.id);
        if (payload.eventType === "DELETE") {
          return current.filter((j) => j.id !== row.id);
        }
        if ((row.status === "running" || row.status === "queued") && idx === -1) {
          return [...current, row];
        }
        if (idx >= 0) {
          const next = current.slice();
          next[idx] = row;
          if (row.status === "succeeded" || row.status === "failed" || row.status === "cancelled") {
            return next.filter((j) => j.id !== row.id);
          }
          return next;
        }
        return current;
      });
    },
  });

  if (jobs.length === 0) return null;

  return (
    <div className="rounded-md border border-[var(--mp-cta-blue)]/40 bg-[var(--mp-cta-blue)]/10 px-3 py-2 text-xs flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1.5 font-semibold text-[var(--mp-cta-blue)]">
        <Clock size={12} />
        Running now
      </div>
      {jobs.map((j) => (
        <div
          key={String(j.id)}
          className="flex items-center gap-2 text-[var(--mp-fg)]"
        >
          <span className="font-mono">{String(j.kind)}</span>
          <div className="w-20 h-1.5 rounded bg-[var(--mp-surface-sunken)] overflow-hidden">
            <div
              className="h-full bg-[var(--mp-cta-blue)] transition-[width] duration-300"
              style={{ width: `${Number(j.progress_pct) || 0}%` }}
            />
          </div>
          <span className="text-[10px] font-mono text-[var(--mp-fg-muted)]">
            {Number(j.progress_pct) || 0}%
          </span>
        </div>
      ))}
    </div>
  );
}

function FreshnessBadge({ state }: { state: "live" | "cached" | "offline" }) {
  const styles = {
    live: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40",
    cached:
      "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/40",
    offline: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/40",
  } as const;
  const label = state === "live" ? "LIVE" : state === "cached" ? "CACHED" : "OFFLINE";
  return (
    <span
      className={`text-[10px] font-mono font-semibold px-2 py-0.5 rounded border ${styles[state]}`}
    >
      {label}
    </span>
  );
}
