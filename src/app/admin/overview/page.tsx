"use client";

/**
 * /admin/overview — mission-control landing page.
 *
 * §2.2 of the April 23 admin revamp sprint — polish pass.
 *
 * Grouping: the 11 tiles are split into three named sections so the
 * operator's eye doesn't read the page as "wall of tiles":
 *
 *   1. Revenue & Growth      (revenue, active subs, signups, conversion)
 *   2. Operational Queues    (paywall, referrals, PUYP, flagged feedback)
 *   3. Platform Health       (webhooks, crons, activity feed)
 *
 * Within each section ONE tile is hero-sized (col-span-2). Every tile
 * uses `tabular-nums`, every euro figure goes through
 * `Intl.NumberFormat('de-AT', { currency: 'EUR' })` from
 * `_components/primitives.tsx`.
 *
 * Live pulse animations are gated on `document.visibilityState ===
 * 'visible'` so a backgrounded tab doesn't thrash.
 *
 * The activity feed renders as a narrow scrolling column on the
 * right side of the Platform Health row on desktop, and a horizontal
 * carousel row on mobile.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Activity,
  AlertCircle,
  Clock,
  Gauge,
  GitBranch,
  HeartPulse,
  Layers,
  MessageSquare,
  ShieldAlert,
  ShieldCheck,
  TrendingUp,
  Users,
  Wallet,
  Webhook,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { useAdminRealtime } from "@/lib/admin/useAdminRealtime";
import { AdminPageShell } from "../_components/AdminPageShell";
import {
  FormatEuro,
  FormatInt,
  SectionHeading,
  Sparkline,
  StatusDot,
  TileEmptyLabel,
  TileSkeleton,
  useIsVisible,
  formatInt,
  formatEuroFromCents,
  formatPct,
} from "../_components/primitives";

interface OverviewSnapshot {
  generated_at: string;
  tiles: {
    revenue: {
      today_cents: number;
      mtd_cents: number;
      /** Optional sparkline series — 7-day daily revenue in cents. */
      series_7d?: number[];
    };
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
  const isVisible = useIsVisible();

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
  // Only poll while the tab is visible — no reason to chat with Supabase
  // when the operator is off doing something else.
  useEffect(() => {
    if (!isVisible) return;
    const id = setInterval(hydrate, 60_000);
    return () => clearInterval(id);
  }, [hydrate, isVisible]);

  const freshness = loading ? "cached" : error ? "disconnected" : "live";

  return (
    <AdminPageShell
      title="Mission Control"
      description={
        <span>
          Live ops view.{" "}
          {snapshot && (
            <span className="font-mono text-[var(--mp-fg-muted)]">
              Snapshot {new Date(snapshot.generated_at).toLocaleTimeString()}
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

      {/* Running-now ribbon — reads `jobs` Realtime + shows active jobs. */}
      <RunningNowRibbon />

      {/* Admin-actions ribbon — confirms audit logging is healthy. Goes
          amber if 0 rows have landed in 24h (possible silent breakage). */}
      <AdminActionsRibbon />

      {/* ─── SECTION 1: Revenue & Growth ─────────────────────────── */}
      <section className="space-y-3">
        <SectionHeading
          title="Revenue & Growth"
          icon={TrendingUp}
          hint="Money in, users in, funnel health"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {loading ? (
            <>
              <div className="sm:col-span-2">
                <TileSkeleton />
              </div>
              <TileSkeleton />
              <TileSkeleton />
              <TileSkeleton />
            </>
          ) : (
            <>
              {/* Hero tile — Revenue today with sparkline */}
              <div className="sm:col-span-2">
                <RevenueHeroTile
                  todayCents={snapshot?.tiles.revenue.today_cents ?? 0}
                  mtdCents={snapshot?.tiles.revenue.mtd_cents ?? 0}
                  series7d={snapshot?.tiles.revenue.series_7d ?? []}
                  visible={isVisible}
                />
              </div>
              <ActiveSubsTile
                total={snapshot?.tiles.active_subs.total ?? 0}
                byTier={snapshot?.tiles.active_subs.by_tier ?? {}}
                visible={isVisible}
              />
              <SignupsTile
                initial={snapshot?.tiles.signups_today ?? 0}
                visible={isVisible}
              />
              <ConversionTile conversion7d={snapshot?.tiles.conversion_7d ?? null} />
            </>
          )}
        </div>
      </section>

      {/* ─── SECTION 2: Operational Queues ───────────────────────── */}
      <section className="space-y-3">
        <SectionHeading
          title="Operational Queues"
          icon={Layers}
          hint="Work waiting on your review"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {loading ? (
            <>
              <div className="sm:col-span-2">
                <TileSkeleton />
              </div>
              <TileSkeleton />
              <TileSkeleton />
            </>
          ) : (
            <>
              {/* Hero tile — Referrals payout queue */}
              <div className="sm:col-span-2">
                <ReferralsHeroTile
                  initial={snapshot?.tiles.referrals_awaiting_action ?? 0}
                  visible={isVisible}
                />
              </div>
              <PaywallTile
                initial={snapshot?.tiles.paywall_hits_today ?? 0}
                visible={isVisible}
              />
              <PuypTile
                initial={snapshot?.tiles.puyp_pending ?? 0}
                visible={isVisible}
              />
              <FlaggedQuestionsTile
                initial={snapshot?.tiles.flagged_open ?? 0}
                visible={isVisible}
              />
            </>
          )}
        </div>
      </section>

      {/* ─── SECTION 3: Platform Health ──────────────────────────── */}
      <section className="space-y-3">
        <SectionHeading
          title="Platform Health"
          icon={HeartPulse}
          hint="Infra signals + live activity feed"
        />
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_320px] gap-3">
          <WebhookFailuresTile
            initial={snapshot?.tiles.webhook_failures_24h ?? 0}
          />
          <CronsTile crons={snapshot?.tiles.crons ?? {}} />
          <LiveFeedTile events={snapshot?.tiles.recent_events ?? []} />
        </div>
      </section>
    </AdminPageShell>
  );
}

// ═══ Tile primitives ═══════════════════════════════════════════════

interface TileProps {
  label: string;
  icon: LucideIcon;
  children: React.ReactNode;
  href?: string;
  footer?: React.ReactNode;
  tone?: "success" | "warn" | "danger" | "info" | "neutral";
  pulse?: boolean;
  /** When true, render a hero-sized tile (larger padding + typography). */
  hero?: boolean;
}

function Tile({
  label,
  icon: Icon,
  children,
  href,
  footer,
  tone = "neutral",
  pulse,
  hero,
}: TileProps) {
  const accentColor =
    tone === "success"
      ? "#10B981"
      : tone === "warn"
        ? "#F59E0B"
        : tone === "danger"
          ? "#EF4444"
          : tone === "info"
            ? "#3B82F6"
            : "#64748B";

  const inner = (
    <div
      className={`relative rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] flex flex-col transition-all duration-200 hover:shadow-md hover:border-[var(--mp-border-subtle)] ${
        hero ? "p-5 min-h-[160px]" : "p-4 min-h-[128px]"
      } ${pulse ? "tile-pulse" : ""}`}
      style={{
        boxShadow: pulse ? `0 0 0 4px ${accentColor}22` : undefined,
      }}
    >
      {/* Top accent stripe */}
      <div
        className="absolute top-0 left-0 right-0 h-[3px] rounded-t-2xl"
        style={{ backgroundColor: accentColor, opacity: 0.85 }}
        aria-hidden
      />
      <div className="flex items-center gap-2 text-[10px] text-[var(--mp-fg-muted)] uppercase tracking-[0.1em]">
        <Icon size={12} />
        <span>{label}</span>
        <span className="flex-1" />
        <StatusDot tone={tone} size={6} />
      </div>
      <div className="mt-2 flex-1 flex flex-col justify-center tabular-nums">
        {children}
      </div>
      {footer && (
        <div className="mt-3 pt-2 border-t border-[var(--mp-border-subtle)] text-[10px] text-[var(--mp-fg-muted)]">
          {footer}
        </div>
      )}
      <style jsx>{`
        .tile-pulse {
          transition: box-shadow 0.7s ease-out;
        }
      `}</style>
    </div>
  );

  return href ? (
    <Link href={href} className="no-underline block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

// ═══ Revenue & Growth tiles ═══════════════════════════════════════

function RevenueHeroTile({
  todayCents,
  mtdCents,
  series7d,
  visible,
}: {
  todayCents: number;
  mtdCents: number;
  series7d: number[];
  visible: boolean;
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
      if (visible) {
        setPulse(true);
        setTimeout(() => setPulse(false), 700);
      }
    },
  });

  const hasAny = liveToday > 0 || liveMtd > 0 || series7d.length > 0;

  return (
    <Tile
      label="Revenue today"
      icon={Wallet}
      tone="success"
      href="/admin/subscriptions"
      pulse={pulse}
      hero
      footer={
        <div className="flex items-center justify-between">
          <span>
            Month-to-date:{" "}
            <strong className="text-[var(--mp-fg)]">
              {formatEuroFromCents(liveMtd)}
            </strong>
          </span>
          <StatusDot tone="success" size={6} pulse={pulse} />
        </div>
      }
    >
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-muted)]">
            Today
          </div>
          <div className="text-[32px] leading-none font-semibold text-[var(--mp-fg)]">
            <FormatEuro cents={liveToday} />
          </div>
        </div>
        <div className="flex flex-col items-end">
          <div className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-muted)] mb-1">
            Last 7 days
          </div>
          <Sparkline
            series={series7d}
            width={140}
            height={40}
            ariaLabel={`7-day revenue. ${
              hasAny ? "" : "No revenue recorded in the last 7 days."
            }`}
          />
        </div>
      </div>
    </Tile>
  );
}

function ActiveSubsTile({
  total,
  byTier,
  visible,
}: {
  total: number;
  byTier: Record<string, number>;
  visible: boolean;
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
          if (visible) {
            setPulse(true);
            setTimeout(() => setPulse(false), 700);
          }
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
      tone="info"
      href="/admin/subscriptions"
      pulse={pulse}
      footer={
        tiers.length > 0 ? (
          <div className="flex gap-2 flex-wrap">
            {tiers.map(([tier, n]) => (
              <span key={tier} className="text-[var(--mp-fg)]">
                {tier}:{" "}
                <strong className="tabular-nums">{formatInt(n)}</strong>
              </span>
            ))}
          </div>
        ) : (
          <span>No active subs</span>
        )
      }
    >
      <div className="text-2xl font-semibold text-[var(--mp-fg)]">
        <FormatInt value={live.total} />
      </div>
    </Tile>
  );
}

function SignupsTile({
  initial,
  visible,
}: {
  initial: number;
  visible: boolean;
}) {
  const [pulse, setPulse] = useState(false);
  const [live, setLive] = useState(initial);
  useEffect(() => setLive(initial), [initial]);

  useAdminRealtime("user_events", {
    onEvent: (payload) => {
      if (payload.eventType !== "INSERT") return;
      const row = payload.new as Record<string, unknown> | undefined;
      if (row?.event_type === "user_registered") {
        setLive((v) => v + 1);
        if (visible) {
          setPulse(true);
          setTimeout(() => setPulse(false), 700);
        }
      }
    },
  });

  return (
    <Tile
      label="New signups today"
      icon={TrendingUp}
      tone="success"
      href="/admin/users"
      pulse={pulse}
    >
      <div className="text-2xl font-semibold text-[var(--mp-fg)]">
        <FormatInt value={live} />
      </div>
    </Tile>
  );
}

function ConversionTile({ conversion7d }: { conversion7d: number | null }) {
  const ratio = conversion7d;
  const pct = ratio != null ? ratio * 100 : null;
  const tone = pct == null ? "neutral" : pct < 2 ? "danger" : "info";
  return (
    <Tile
      label="Conversion (7d)"
      icon={TrendingUp}
      tone={tone}
      href="/admin/funnels"
      footer={
        <span className="italic text-[var(--mp-fg-muted)]">
          Paywall hit → purchase
        </span>
      }
    >
      <div className="text-2xl font-semibold text-[var(--mp-fg)]">
        {ratio != null ? formatPct(ratio) : "—"}
      </div>
    </Tile>
  );
}

// ═══ Operational Queues tiles ═════════════════════════════════════

function ReferralsHeroTile({
  initial,
  visible,
}: {
  initial: number;
  visible: boolean;
}) {
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
          if (visible) {
            setPulse(true);
            setTimeout(() => setPulse(false), 700);
          }
        } else if (oldRow?.status === "qualified" && row?.status !== "qualified") {
          setLive((v) => Math.max(0, v - 1));
        }
      } else if (payload.eventType === "INSERT" && row?.status === "qualified") {
        setLive((v) => v + 1);
      }
    },
  });

  const tone = live > 0 ? "warn" : "success";

  return (
    <Tile
      label="Referrals awaiting payout"
      icon={GitBranch}
      tone={tone}
      href="/admin/referrals"
      pulse={pulse}
      hero
      footer={
        <div className="flex items-center justify-between">
          <span>
            {live > 0
              ? "Oldest first. Mark paid after Wise/USDT transfer."
              : "Queue clear. Qualified referrals show up here."}
          </span>
          <StatusDot tone={tone} size={6} pulse={pulse} />
        </div>
      }
    >
      <div className="flex items-end gap-3">
        <div className="text-[32px] leading-none font-semibold text-[var(--mp-fg)]">
          <FormatInt value={live} />
        </div>
        <span className="text-xs text-[var(--mp-fg-muted)] pb-1.5">
          {live === 1 ? "referral" : "referrals"} qualified
        </span>
      </div>
    </Tile>
  );
}

function PaywallTile({
  initial,
  visible,
}: {
  initial: number;
  visible: boolean;
}) {
  const [pulse, setPulse] = useState(false);
  const [live, setLive] = useState(initial);
  useEffect(() => setLive(initial), [initial]);

  useAdminRealtime("user_events", {
    onEvent: (payload) => {
      if (payload.eventType !== "INSERT") return;
      const row = payload.new as Record<string, unknown> | undefined;
      if (row?.event_type === "paywall_hit") {
        setLive((v) => v + 1);
        if (visible) {
          setPulse(true);
          setTimeout(() => setPulse(false), 700);
        }
      }
    },
  });

  return (
    <Tile
      label="Paywall hits today"
      icon={ShieldAlert}
      tone="warn"
      href="/admin/subscriptions"
      pulse={pulse}
    >
      <div className="text-2xl font-semibold text-[var(--mp-fg)]">
        <FormatInt value={live} />
      </div>
    </Tile>
  );
}

function PuypTile({
  initial,
  visible,
}: {
  initial: number;
  visible: boolean;
}) {
  const [pulse, setPulse] = useState(false);
  const [live, setLive] = useState(initial);
  useEffect(() => setLive(initial), [initial]);

  useAdminRealtime("exam_attempts", {
    onEvent: (payload) => {
      const row = payload.new as Record<string, unknown> | undefined;
      if (payload.eventType === "INSERT" && row?.result === "fail" && !row?.verified_at) {
        setLive((v) => v + 1);
        if (visible) {
          setPulse(true);
          setTimeout(() => setPulse(false), 700);
        }
      }
      if (payload.eventType === "UPDATE") {
        const oldRow = payload.old as Record<string, unknown> | undefined;
        if (!oldRow?.verified_at && row?.verified_at) {
          setLive((v) => Math.max(0, v - 1));
        }
      }
    },
  });

  const tone = live > 0 ? "warn" : "success";

  return (
    <Tile
      label="PUYP pending"
      icon={ShieldCheck}
      tone={tone}
      href="/admin/puyp"
      pulse={pulse}
    >
      <div className="text-2xl font-semibold text-[var(--mp-fg)]">
        <FormatInt value={live} />
      </div>
    </Tile>
  );
}

function FlaggedQuestionsTile({
  initial,
  visible,
}: {
  initial: number;
  visible: boolean;
}) {
  const [pulse, setPulse] = useState(false);
  const [live, setLive] = useState(initial);
  useEffect(() => setLive(initial), [initial]);

  useAdminRealtime("user_feedback", {
    onEvent: (payload) => {
      const row = payload.new as Record<string, unknown> | undefined;
      if (payload.eventType === "INSERT" && row?.status === "new") {
        setLive((v) => v + 1);
        if (visible) {
          setPulse(true);
          setTimeout(() => setPulse(false), 700);
        }
      }
    },
  });

  const tone = live > 0 ? "warn" : "success";

  return (
    <Tile
      label="Open feedback"
      icon={MessageSquare}
      tone={tone}
      href="/admin/feedback"
      pulse={pulse}
    >
      <div className="text-2xl font-semibold text-[var(--mp-fg)]">
        <FormatInt value={live} />
      </div>
    </Tile>
  );
}

// ═══ Platform Health tiles ════════════════════════════════════════

function WebhookFailuresTile({
  initial,
}: {
  initial: number;
}) {
  // Not yet wired to Realtime (processed_webhook_events RT lands in a
  // follow-up — until then the /api/admin/overview 60s refresh is
  // good enough).
  const [live, setLive] = useState(initial);
  useEffect(() => setLive(initial), [initial]);

  const tone = live > 0 ? "danger" : "success";

  return (
    <Tile
      label="Webhook failures (24h)"
      icon={Webhook}
      tone={tone}
      href="/admin/webhooks"
      footer={
        live > 0 ? (
          <span>
            <StatusDot tone="danger" size={6} />{" "}
            <span className="ml-1">Investigate retries — NOWPayments IPN.</span>
          </span>
        ) : (
          <span className="italic text-[var(--mp-fg-muted)]">
            All webhooks landed in the last 24h
          </span>
        )
      }
    >
      <div className="text-2xl font-semibold text-[var(--mp-fg)]">
        <FormatInt value={live} />
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
  const tone = anyFail ? "danger" : entries.length === 0 ? "warn" : "success";

  const latestAt = entries
    .map(([, v]) => (v.lastStartedAt ? new Date(v.lastStartedAt).getTime() : 0))
    .reduce((max, t) => (t > max ? t : max), 0);
  const latestDate = latestAt > 0 ? new Date(latestAt) : null;

  return (
    <Tile
      label="Cron health (24h)"
      icon={Gauge}
      tone={tone}
      href="/admin/crons"
      footer={
        entries.length === 0 ? (
          <TileEmptyLabel updatedAt={null} tone="warn" />
        ) : (
          <div className="flex items-center justify-between">
            <span>
              {formatInt(entries.length)}{" "}
              {entries.length === 1 ? "job tracked" : "jobs tracked"}
            </span>
            <TileEmptyLabel updatedAt={latestDate} tone={tone} />
          </div>
        )
      }
    >
      <div className="flex flex-wrap gap-1.5 items-center">
        {entries.length === 0 && (
          <span className="text-sm text-[var(--mp-fg-muted)]">
            No cron runs yet
          </span>
        )}
        {entries.slice(0, 10).map(([name, v]) => {
          const dotTone: "success" | "danger" | "warn" =
            v.lastStatus === "succeeded"
              ? "success"
              : v.lastStatus === "failed"
                ? "danger"
                : "warn";
          return (
            <span
              key={name}
              title={`${name} — ${v.lastStatus}`}
              className="inline-flex items-center"
            >
              <StatusDot tone={dotTone} size={9} />
            </span>
          );
        })}
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
    <div className="relative rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] flex flex-col min-h-[240px] overflow-hidden">
      <div
        className="absolute top-0 left-0 right-0 h-[3px] rounded-t-2xl"
        style={{ backgroundColor: "#3B82F6", opacity: 0.85 }}
        aria-hidden
      />
      <div className="flex items-center gap-2 px-4 pt-3 pb-3 border-b border-[var(--mp-border-subtle)]">
        <Activity size={12} className="text-[var(--mp-fg-muted)]" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--mp-fg-muted)]">
          Live activity
        </span>
        <span className="flex-1" />
        <StatusDot tone="info" size={6} />
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-auto max-h-[260px]">
        {events.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-[var(--mp-fg-muted)]">
            <Clock size={14} className="inline-block mb-1 opacity-50" />
            <div>Waiting for events…</div>
          </div>
        ) : (
          <ul className="flex lg:flex-col gap-0 px-2 py-1">
            {events.slice(0, 40).map((e) => (
              <li
                key={String(e.id)}
                className="flex-shrink-0 lg:flex-shrink flex items-center gap-2 px-2 py-1.5 text-[11px] font-mono text-[var(--mp-fg-muted)] border-b last:border-0 border-[var(--mp-border-subtle)]/40"
              >
                <StatusDot tone="info" size={6} />
                <span className="text-[var(--mp-fg)] flex-shrink-0">
                  {e.event_type}
                </span>
                <span className="tabular-nums text-[10px] text-[var(--mp-fg-subtle)] ml-auto flex-shrink-0">
                  {new Date(e.created_at).toLocaleTimeString("de-AT", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="px-4 py-2 border-t border-[var(--mp-border-subtle)] text-[10px] text-[var(--mp-fg-muted)] flex items-center justify-between">
        <span>Last {events.slice(0, 40).length}</span>
        <Link
          href="/admin/audit"
          className="text-[var(--mp-viridian)] hover:underline"
        >
          See full audit →
        </Link>
      </div>
    </div>
  );
}

// ═══ Admin-actions ribbon ═════════════════════════════════════════

/**
 * Audit-trail health indicator. Two values live in the header:
 *   1. "Admin-Aktionen heute: N"  — count of admin_audit_log rows
 *      created since local midnight.
 *   2. "Letzte Aktion: vor Xm"   — how long ago the latest row landed.
 *
 * Goes amber + "Wird das Audit-Log geschrieben?" when N=0 for 24h — so
 * [name] sees instantly if the audit pipe went quiet again (that's the
 * regression that triggered the post-audit-rescue sprint).
 *
 * Hits /api/admin/audit-log/latest on mount + subscribes to
 * admin_audit_log INSERT events for live updates.
 */
function AdminActionsRibbon() {
  const [summary, setSummary] = useState<{
    today_count: number;
    last_action_at: string | null;
    last_action: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  // Keep the relative timestamp fresh — re-render once a minute.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Initial fetch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/audit-log/latest?limit=1", {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`audit-log ${res.status}`);
        const body = (await res.json()) as {
          today_count: number;
          last_action_at: string | null;
          last_action: string | null;
        };
        if (!cancelled) {
          setSummary({
            today_count: body.today_count || 0,
            last_action_at: body.last_action_at,
            last_action: body.last_action,
          });
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Realtime bump on INSERT — every mutation landing in admin_audit_log
  // triggers a local counter bump so the header stays live without
  // polling.
  useAdminRealtime("admin_audit_log", {
    onEvent: (payload) => {
      if (payload.eventType !== "INSERT") return;
      const row = payload.new as Record<string, unknown> | undefined;
      if (!row) return;
      const createdAt = (row.created_at as string) || new Date().toISOString();
      const action = (row.action as string) || "unknown";
      // Rolling local count — we don't re-fetch the day bucket because
      // the page refresh timer already keeps it honest every 60s.
      setSummary((prev) => ({
        today_count: (prev?.today_count ?? 0) + 1,
        last_action_at: createdAt,
        last_action: action,
      }));
      setNow(Date.now());
    },
  });

  if (loading || !summary) return null;

  const count = summary.today_count;
  const latestAt = summary.last_action_at
    ? new Date(summary.last_action_at).getTime()
    : null;
  const ageMinutes =
    latestAt != null ? Math.max(0, Math.floor((now - latestAt) / 60_000)) : null;
  const quietFor24h =
    latestAt == null || now - latestAt > 24 * 60 * 60_000;

  const tone: "warn" | "info" = quietFor24h && count === 0 ? "warn" : "info";
  const toneColor = tone === "warn" ? "#F59E0B" : "#3B82F6";

  const relativeLabel =
    ageMinutes == null
      ? "noch nichts geloggt"
      : ageMinutes < 1
        ? "vor <1 Min"
        : ageMinutes < 60
          ? `vor ${ageMinutes} Min`
          : ageMinutes < 1440
            ? `vor ${Math.floor(ageMinutes / 60)} Std`
            : `vor ${Math.floor(ageMinutes / 1440)} Tag${
                Math.floor(ageMinutes / 1440) === 1 ? "" : "en"
              }`;

  return (
    <div
      className="rounded-md border px-3 py-2 text-xs flex items-center gap-3 flex-wrap"
      style={{
        borderColor: `${toneColor}66`,
        backgroundColor: `${toneColor}1a`,
      }}
      data-testid="admin-actions-ribbon"
    >
      <div
        className="flex items-center gap-1.5 font-semibold"
        style={{ color: toneColor }}
      >
        <Activity size={12} />
        Admin-Aktionen heute
      </div>
      <div className="flex items-center gap-1 tabular-nums font-mono text-[var(--mp-fg)]">
        <strong>{formatInt(count)}</strong>
        <span className="text-[var(--mp-fg-muted)]">·</span>
        <span>Letzte: {relativeLabel}</span>
        {summary.last_action && (
          <>
            <span className="text-[var(--mp-fg-muted)]">·</span>
            <span className="text-[var(--mp-fg-muted)]">
              {summary.last_action}
            </span>
          </>
        )}
      </div>
      {quietFor24h && count === 0 && (
        <span className="ml-auto text-[var(--mp-warning)] italic">
          Wird das Audit-Log geschrieben?
        </span>
      )}
      <Link
        href="/admin/audit"
        className="ml-auto text-[var(--mp-viridian)] hover:underline"
      >
        Audit-Trail →
      </Link>
    </div>
  );
}

// ═══ Running-now ribbon ═══════════════════════════════════════════

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
          if (
            row.status === "succeeded" ||
            row.status === "failed" ||
            row.status === "cancelled"
          ) {
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
          <span className="text-[10px] font-mono text-[var(--mp-fg-muted)] tabular-nums">
            {Number(j.progress_pct) || 0}%
          </span>
        </div>
      ))}
    </div>
  );
}
