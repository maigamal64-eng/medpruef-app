"use client";

/**
 * /admin/overview — mission-control landing page.
 *
 * §2.2 of the April 23 admin revamp sprint — polish pass.
 *
 * Grouping: the 11 tiles are split into three named sections so the
 * operator's eye doesn't read the page as "wall of tiles":
 *
 *   1. Revenue & Growth      (money in, paying learners, signups, new payers)
 *   2. Operational Queues    (paywall, referrals, PUYP, flagged feedback)
 *   3. Platform Health       (payment failures, crons, activity feed)
 *
 * Money tiles (a14, 2026-10-12) use the shared definitions in
 * src/lib/admin/money-rules.ts via /api/admin/overview: cash in by payment
 * date, paying learners with trials apart, and the same payment diagnosis
 * as /admin/payments. They refresh on the 60s poll; no tile adds amounts
 * from Realtime subscription inserts, because renewals extend rows in place
 * and stored amounts mix gross and net.
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
  CreditCard,
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
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";
import { useAdminRealtime } from "@/lib/admin/useAdminRealtime";
import { MentorOverviewCard } from "../mentor/OverviewCard";
import { InboxStrip } from "./InboxStrip";
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
} from "../_components/primitives";

interface OverviewSnapshot {
  generated_at: string;
  tiles: {
    revenue: {
      /** Cash today (gross minus refunds), Vienna day, EUR cents. */
      today_cents: number;
      mtd_cents: number;
      /** 7 Vienna days of cash, oldest first. */
      series_7d?: number[];
      today?: MoneySplit;
      month_to_date?: MoneySplit;
      other_currencies?: Array<{ currency: string; paid_payments: number; gross_cents: number; refunds_cents: number }>;
      basis?: string;
    } | null;
    active_subs: {
      total: number;
      in_trial: number;
      by_cadence: { renews: number; one_time: number; unknown: number };
      basis?: string;
    } | null;
    signups_today: number;
    paywall_hits_today: number;
    referrals_awaiting_action: number;
    puyp_pending: number;
    flagged_open: number;
    payment_health: PaymentHealthTile | null;
    stuck_pending_24h: number | null;
    new_payers_7d: { new_payers: number; signups: number; ratio: number | null } | null;
    ai_chat_1h: {
      requests: number;
      completed: number;
      failed: number;
      avg_latency_ms: number | null;
    } | null;
    telegram_activation: {
      registered: number;
      confirmed: number;
    } | null;
    crons: Record<string, { lastStatus: string; lastStartedAt: string | null }> | null;
    recent_events_aggregate: { total_last_24h: number };
  };
}

interface MoneySplit {
  gross_cents: number;
  refunds_cents: number;
  cash_cents: number;
}

interface PaymentHealthTile {
  level: "alarm" | "attention" | "ok" | "quiet";
  diagnosis: string;
  failures_24h: number;
  probes_24h: number;
  unresolved_total: number;
}

export default function AdminOverviewPage() {
  const { can, loading: accessLoading } = useAdminPermissions();
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
    if (!accessLoading && can("overview.read")) void hydrate();
  }, [accessLoading, can, hydrate]);

  // Auto-refresh every 60s as a polling fallback in case Realtime drops.
  // Only poll while the tab is visible — no reason to chat with Supabase
  // when the operator is off doing something else.
  useEffect(() => {
    if (!isVisible || !can("overview.read")) return;
    const id = setInterval(hydrate, 60_000);
    return () => clearInterval(id);
  }, [can, hydrate, isVisible]);

  const freshness = loading ? "cached" : error ? "disconnected" : "live";

  if (accessLoading) return <div className="p-6"><TileSkeleton /></div>;
  if (!can("overview.read")) return <div className="p-6"><div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm">Your admin role does not include access to the overview.</div></div>;

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
        <div className="rounded-md border border-[var(--mp-border)] bg-[var(--mp-surface-raised)] px-3 py-2 text-xs text-[var(--mp-fg-muted)] flex items-center gap-2">
          <AlertCircle size={14} />
          Could not load overview. <button type="button" className="underline" onClick={() => void hydrate()}>Retry</button>
        </div>
      )}

      {!error && <>
      {can("system.read") && <>
        <RunningNowRibbon />
        <AdminActionsRibbon />
      </>}

      {can("revenue.read") && snapshot?.tiles.payment_health && (
        <PaymentDiagnosisLine health={snapshot.tiles.payment_health} />
      )}

      <InboxStrip />

      {can("revenue.read") && <MentorOverviewCard />}

      {/* Revenue figures are withheld from roles without revenue.read. */}
      {can("revenue.read") && <>
      <section className="space-y-3">
        <SectionHeading
          title="Revenue & Growth"
          icon={TrendingUp}
          hint="Money in, users in, funnel health"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {loading ? (
            <>
              <div className="sm:col-span-2" data-testid="overview-revenue-hero">
                <TileSkeleton />
              </div>
              <TileSkeleton />
              <TileSkeleton />
              <TileSkeleton />
            </>
          ) : (
            <>
              {/* Hero tile — Revenue today with sparkline */}
              <div className="sm:col-span-2" data-testid="overview-revenue-hero">
                <RevenueHeroTile revenue={snapshot?.tiles.revenue ?? null} />
              </div>
              <PayingLearnersTile paying={snapshot?.tiles.active_subs ?? null} />
              <SignupsTile
                initial={snapshot?.tiles.signups_today ?? 0}
                visible={isVisible}
              />
              <div className="sm:col-span-2 lg:col-span-1" data-testid="overview-conversion-tile">
                <NewPayersTile data={snapshot?.tiles.new_payers_7d ?? null} />
              </div>
            </>
          )}
        </div>
      </section>
      </>}

      {/* ─── SECTION 2: Operational Queues ───────────────────────── */}
      {can("revenue.read") && <section className="space-y-3">
        <SectionHeading
          title="Operational Queues"
          icon={Layers}
          hint="Work waiting on your review"
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {loading ? (
            <>
              <div className="sm:col-span-2" data-testid="overview-referrals-hero">
                <TileSkeleton />
              </div>
              <TileSkeleton />
              <TileSkeleton />
              <TileSkeleton />
            </>
          ) : (
            <>
              {/* Hero tile — Referrals payout queue */}
              <div className="sm:col-span-2" data-testid="overview-referrals-hero">
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
              <div className="sm:col-span-2 lg:col-span-1" data-testid="overview-flagged-tile">
                <FlaggedQuestionsTile
                  initial={snapshot?.tiles.flagged_open ?? 0}
                  visible={isVisible}
                />
              </div>
            </>
          )}
        </div>
      </section>
      }

      {/* ─── SECTION 3: Platform Health ──────────────────────────── */}
      {can("system.read") && <section className="space-y-3">
        <SectionHeading
          title="Platform Health"
          icon={HeartPulse}
          hint="Infra signals + live activity feed"
        />
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_320px] gap-3">
          {can("revenue.read") ? (
            <PaymentFailuresTile health={snapshot?.tiles.payment_health ?? null} />
          ) : (
            <PaymentFailuresTile health={null} restricted />
          )}
          <CronsTile crons={snapshot?.tiles.crons ?? {}} />
          {can("users.read") && <ActivityCountTile count={snapshot?.tiles.recent_events_aggregate?.total_last_24h ?? 0} />}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {can("revenue.read") && snapshot && snapshot.tiles.stuck_pending_24h !== null && (
            <StuckPendingTile initial={snapshot.tiles.stuck_pending_24h} />
          )}
          <AIChatHealthTile
            initial={snapshot?.tiles.ai_chat_1h ?? {
              requests: 0,
              completed: 0,
              failed: 0,
              avg_latency_ms: null,
            }}
          />
          <TelegramActivationTile
            initial={snapshot?.tiles.telegram_activation ?? { registered: 0, confirmed: 0 }}
          />
        </div>
      </section>}
      </>}
    </AdminPageShell>
  );
}

// ═══ Telegram bot activation tile ══════════════════════════════════
//
// Shows X / Y where X = users with telegram_chat_id_confirmed, Y = total
// telegram-registered users. Footer reads "{X}/{Y} bot-active" so we can
// see the activation lift after the /dashboard CTA ships.
// review-2026-04-26-B2.

function TelegramActivationTile({
  initial,
}: {
  initial: { registered: number; confirmed: number };
}) {
  const [live, setLive] = useState(initial);
  useEffect(() => setLive(initial), [initial]);

  const pct = live.registered > 0 ? live.confirmed / live.registered : 0;
  const tone: "success" | "warn" | "danger" =
    pct >= 0.5 ? "success" : pct >= 0.25 ? "warn" : "danger";

  return (
    <Tile
      label="Telegram bot activation"
      icon={Activity}
      tone={tone}
      href="/admin/users"
      footer={
        live.registered === 0 ? (
          <span className="italic text-[var(--mp-fg-muted)]">
            No Telegram-registered users yet
          </span>
        ) : (
          <span>
            <StatusDot tone={tone} size={6} />{" "}
            <span className="ml-1">
              {live.confirmed}/{live.registered} bot-active ({Math.round(pct * 100)}%)
            </span>
          </span>
        )
      }
    >
      <div className="text-2xl font-semibold text-[var(--mp-fg)]">
        <FormatInt value={live.confirmed} />
        <span className="text-sm text-[var(--mp-fg-muted)] ml-1">
          / {live.registered}
        </span>
      </div>
    </Tile>
  );
}

// ═══ AI chat health tile ═══════════════════════════════════════════
//
// Surfaces last-60-minutes AI chat health: total requests, completed,
// failed, average latency. Tone goes:
//   - success when failure rate < 10% AND avg_latency < 8 s
//   - warn when failure rate 10-25% OR avg_latency 8-12 s
//   - danger when failure rate > 25% OR avg_latency > 12 s
//
// Refreshes via the parent /api/admin/overview poll. review-2026-04-26-A4.

function AIChatHealthTile({
  initial,
}: {
  initial: {
    requests: number;
    completed: number;
    failed: number;
    avg_latency_ms: number | null;
  };
}) {
  const [live, setLive] = useState(initial);
  useEffect(() => setLive(initial), [initial]);

  const failureRate =
    live.requests > 0 ? live.failed / live.requests : 0;
  const tone: "success" | "warn" | "danger" =
    failureRate > 0.25 || (live.avg_latency_ms ?? 0) > 12_000
      ? "danger"
      : failureRate > 0.1 || (live.avg_latency_ms ?? 0) > 8_000
        ? "warn"
        : "success";

  const latencyLabel = live.avg_latency_ms == null
    ? "—"
    : `${Math.round(live.avg_latency_ms / 100) / 10}s`;

  return (
    <Tile
      label="AI chat (60 min)"
      icon={Activity}
      tone={tone}
      href="/admin/users"
      footer={
        live.requests === 0 ? (
          <span className="italic text-[var(--mp-fg-muted)]">
            No AI chat traffic in last 60 min
          </span>
        ) : (
          <span>
            <StatusDot tone={tone} size={6} />{" "}
            <span className="ml-1">
              {live.completed}/{live.requests} ok · avg {latencyLabel}
              {live.failed > 0 ? ` · ${live.failed} failed` : ""}
            </span>
          </span>
        )
      }
    >
      <div className="text-2xl font-semibold text-[var(--mp-fg)]">
        <FormatInt value={live.requests} />
      </div>
    </Tile>
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
  // MPDS palette — was hard-coded Tailwind defaults (#10B981, #F59E0B,
  // #EF4444, #3B82F6, #64748B). Now reads from CSS vars so dark mode and
  // any future palette tweaks flow through automatically.
  const accentColor =
    tone === "success"
      ? "var(--mp-viridian)"
      : tone === "warn"
        ? "var(--mp-warning)"
        : tone === "danger"
          ? "var(--mp-error)"
          : tone === "info"
            ? "var(--mp-info)"
            : "var(--mp-fg-muted)";

  const inner = (
    <div
      className={`relative rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] flex flex-col transition-all duration-200 hover:shadow-md hover:border-[var(--mp-border-subtle)] ${
        hero ? "p-5 min-h-[160px]" : "p-4 min-h-[128px]"
      } ${pulse ? "tile-pulse" : ""}`}
      style={{
        // 0x22 ≈ 13% alpha — render via color-mix so we get the right tint
        // regardless of whether accentColor is a CSS var or a literal hex.
        boxShadow: pulse
          ? `0 0 0 4px color-mix(in srgb, ${accentColor} 13%, transparent)`
          : undefined,
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

function PaymentDiagnosisLine({ health }: { health: PaymentHealthTile }) {
  const tone = health.level === "alarm" ? "danger" : health.level === "attention" ? "warn" : health.level === "ok" ? "success" : "neutral";
  return (
    <Link
      href="/admin/payments"
      data-testid="overview-payment-diagnosis"
      className="no-underline flex items-start gap-2 rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-4 py-3 text-sm text-[var(--mp-fg)] hover:border-[var(--mp-border)]"
    >
      <span className="mt-1.5"><StatusDot tone={tone} size={8} /></span>
      <span className="min-w-0 flex-1 break-words">
        <span className="font-semibold">Payments: </span>
        {health.diagnosis}
      </span>
    </Link>
  );
}

function RevenueHeroTile({ revenue }: { revenue: OverviewSnapshot["tiles"]["revenue"] }) {
  const series7d = revenue?.series_7d ?? [];
  const today = revenue?.today ?? { gross_cents: revenue?.today_cents ?? 0, refunds_cents: 0, cash_cents: revenue?.today_cents ?? 0 };
  const mtd = revenue?.month_to_date ?? { gross_cents: revenue?.mtd_cents ?? 0, refunds_cents: 0, cash_cents: revenue?.mtd_cents ?? 0 };
  const hasAny = series7d.some((v) => v !== 0);
  const other = revenue?.other_currencies ?? [];

  return (
    <Tile
      label="Money in today (cash)"
      icon={Wallet}
      tone="success"
      href="/admin/payments#money"
      hero
      footer={
        <div className="space-y-0.5">
          <div className="flex flex-wrap items-center justify-between gap-x-3">
            <span>
              This month:{" "}
              <strong className="text-[var(--mp-fg)]">{formatEuroFromCents(mtd.cash_cents)}</strong>
            </span>
            <span className="text-[var(--mp-fg-subtle)]">
              {formatEuroFromCents(mtd.gross_cents)} paid, {formatEuroFromCents(mtd.refunds_cents)} refunded
            </span>
          </div>
          <div className="text-[var(--mp-fg-subtle)]">
            Gross by payment date, refunds on their own day, Vienna time.
            {other.length > 0 && ` Plus ${other.map((o) => `${o.currency} ${(o.gross_cents / 100).toFixed(2)}`).join(", ")} not converted.`}
          </div>
        </div>
      }
    >
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-muted)]">
            Today
          </div>
          <div className="text-[32px] leading-none font-semibold text-[var(--mp-fg)]">
            <FormatEuro cents={today.cash_cents} />
          </div>
          {today.refunds_cents > 0 && (
            <div className="mt-1 text-[10px] text-[var(--mp-fg-muted)]">
              {formatEuroFromCents(today.gross_cents)} paid, {formatEuroFromCents(today.refunds_cents)} refunded
            </div>
          )}
        </div>
        <div className="flex flex-col items-end">
          <div className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-muted)] mb-1">
            Last 7 days
          </div>
          <Sparkline
            series={series7d}
            width={140}
            height={40}
            ariaLabel={`7-day cash in. ${
              hasAny ? "" : "No money in during the last 7 days."
            }`}
          />
        </div>
      </div>
    </Tile>
  );
}

function PayingLearnersTile({ paying }: { paying: OverviewSnapshot["tiles"]["active_subs"] }) {
  const c = paying?.by_cadence ?? { renews: 0, one_time: 0, unknown: 0 };
  return (
    <Tile
      label="Paying learners"
      icon={Users}
      tone="info"
      href="/admin/subscriptions"
      footer={
        paying ? (
          <span className="text-[var(--mp-fg)]">
            {formatInt(c.renews)} renew, {formatInt(c.one_time)} one-time
            {c.unknown > 0 ? `, ${formatInt(c.unknown)} unknown` : ""}
            <span className="text-[var(--mp-fg-muted)]"> · {formatInt(paying.in_trial)} in trial</span>
          </span>
        ) : (
          <span>Not available</span>
        )
      }
    >
      <div className="text-2xl font-semibold text-[var(--mp-fg)]" title={paying?.basis}>
        {paying ? <FormatInt value={paying.total} /> : "—"}
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

function NewPayersTile({ data }: { data: OverviewSnapshot["tiles"]["new_payers_7d"] }) {
  return (
    <Tile
      label="New payers (7d)"
      icon={TrendingUp}
      tone="info"
      href="/admin/subscriptions?view=all"
      footer={
        data ? (
          <span>
            Real signups in the same 7 days: {formatInt(data.signups)}
          </span>
        ) : (
          <span className="italic text-[var(--mp-fg-muted)]">Not available</span>
        )
      }
    >
      <div className="text-2xl font-semibold text-[var(--mp-fg)]">
        {data ? <FormatInt value={data.new_payers} /> : "—"}
      </div>
      <div className="mt-1 text-[10px] text-[var(--mp-fg-muted)]">
        Learners whose first paid payment was in the last 7 days
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
              ? "Oldest first. Mark paid after the payout transfer."
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

/**
 * Stuck-pending NOWPayments subscriptions (>24h old).
 *
 * Should be 0 in steady state. Every entry is either a user who
 * abandoned at the BTC checkout screen or a webhook that never
 * delivered. Clicking the tile drops you on the reconcile route
 * (/admin/subscriptions) — POST /api/admin/subscriptions/reconcile-pending
 * either resolves them via NOWPayments JWT auth or, with
 * `?force_cancel_older_than_hours=24`, force-cancels the lot.
 *
 * Added 2026-04-25 (review-2026-04-25-A2). The post-PR-#7 prod tour
 * found 8 stuck rows — bulk-cancelled directly in DB during that sprint.
 */
function StuckPendingTile({ initial }: { initial: number }) {
  const [live, setLive] = useState(initial);
  useEffect(() => setLive(initial), [initial]);
  const tone = live > 0 ? "warn" : "success";
  return (
    <Tile
      label="Stuck pending >24h"
      icon={CreditCard}
      tone={tone}
      href="/admin/subscriptions?status=pending"
      footer={
        live > 0 ? (
          <span>
            <StatusDot tone="warn" size={6} />{" "}
            <span className="ml-1">
              Stuck checkouts need a manual reconcile. Ask the ops agent or run the reconcile job.
            </span>
          </span>
        ) : (
          <span className="italic text-[var(--mp-fg-muted)]">
            All pending checkouts are fresh (&lt;24h)
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

/**
 * Payment failures (24h) — UX-ADM-04. Same computation as the Payments
 * diagnosis (computePaymentHealth): unresolved paid payments seen in the
 * last 24h plus signed-looking deliveries rejected for the secret. Unsigned
 * probes are counted apart and never turn the tile red. Never a green zero
 * when the number could not be read.
 */
function PaymentFailuresTile({ health, restricted }: { health: PaymentHealthTile | null; restricted?: boolean }) {
  if (!health) {
    return (
      <Tile label="Payment failures (24h)" icon={Webhook} tone="neutral" footer={
        <span className="italic text-[var(--mp-fg-muted)]">
          {restricted ? "Needs revenue access to read payment failures." : "Not measured yet."}
        </span>
      }>
        <div className="text-2xl font-semibold text-[var(--mp-fg-muted)]">Not measured</div>
      </Tile>
    );
  }
  const live = health.failures_24h;
  // Colour follows the shared diagnosis level, so an ALARM whose rejected
  // deliveries are older than 24h never reads as a calm zero.
  const tone = health.level === "alarm" || live > 0 ? "danger" : health.level === "attention" ? "warn" : "neutral";
  return (
    <Tile
      label="Payment failures (24h)"
      icon={Webhook}
      tone={tone}
      href="/admin/payments#failures"
      footer={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {live > 0 ? (
            <span>Open the payment failures and resolve each one.</span>
          ) : health.level === "alarm" ? (
            <span>Deliveries are failing; see the Payments diagnosis.</span>
          ) : health.unresolved_total > 0 ? (
            <span>{formatInt(health.unresolved_total)} older unresolved payment{health.unresolved_total === 1 ? "" : "s"} still open.</span>
          ) : health.level === "attention" ? (
            <span>Needs a look; see the Payments diagnosis.</span>
          ) : (
            <span>No recorded payment is waiting on a grant.</span>
          )}
          {health.probes_24h > 0 && (
            <span className="rounded border border-[var(--mp-border-subtle)] px-1.5 py-0.5 text-[var(--mp-fg-muted)]">
              {formatInt(health.probes_24h)} unsigned probe{health.probes_24h === 1 ? "" : "s"}
            </span>
          )}
        </span>
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
              title={`${name}: ${v.lastStatus}`}
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

function ActivityCountTile({ count }: { count: number }) {
  return <Tile label="Activity (24h)" icon={Activity} tone="neutral" href="/admin/users" footer="Recorded learner events in the last 24 hours">
    <FormatInt value={count} />
  </Tile>;
}

/**
 * Audit-trail health indicator. Two values live in the header:
 *   1. "Admin actions today: N"  — count of admin_audit_log rows
 *      created since local midnight.
 *   2. "Last action: Xm ago"   — how long ago the latest row landed.
 *
 * Goes amber + "Is the audit log being written?" when N=0 for 24h — so
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
  const [auditError, setAuditError] = useState(false);
  const [auditAttempt, setAuditAttempt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  // Keep the relative timestamp fresh — re-render once a minute.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Initial fetch.
  useEffect(() => {
    let cancelled = false;
    setAuditError(false);
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
        if (!cancelled) { setAuditError(true); setLoading(false); }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [auditAttempt]);

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

  if (auditError) return <div role="status" className="text-xs text-[var(--mp-fg-muted)]">Could not load audit summary. <button type="button" className="underline" onClick={() => setAuditAttempt((n) => n + 1)}>Retry</button></div>;
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
  // MPDS palette tokens — was hard-coded Tailwind amber/blue.
  const toneColor =
    tone === "warn" ? "var(--mp-warning)" : "var(--mp-info)";

  const relativeLabel =
    ageMinutes == null
      ? "not logged yet"
      : ageMinutes < 1
        ? "less than a minute ago"
        : ageMinutes < 60
          ? `${ageMinutes} min ago`
          : ageMinutes < 1440
            ? `${Math.floor(ageMinutes / 60)} hr ago`
            : `${Math.floor(ageMinutes / 1440)} day${
                Math.floor(ageMinutes / 1440) === 1 ? "" : "s"
              }`;

  return (
    <div
      className="rounded-md border px-3 py-2 text-xs flex items-center gap-3 flex-wrap"
      style={{
        // 0x66 ≈ 40% alpha border, 0x1a ≈ 10% alpha fill — color-mix lets
        // us derive these from the CSS-var token without falling back to
        // hex string concatenation.
        borderColor: `color-mix(in srgb, ${toneColor} 40%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${toneColor} 10%, transparent)`,
      }}
      data-testid="admin-actions-ribbon"
    >
      <div
        className="flex items-center gap-1.5 font-semibold"
        style={{ color: toneColor }}
      >
        <Activity size={12} />
        Admin actions today
      </div>
      <div className="flex items-center gap-1 tabular-nums font-mono text-[var(--mp-fg)]">
        <strong>{formatInt(count)}</strong>
        <span className="text-[var(--mp-fg-muted)]">·</span>
        <span>Last action: {relativeLabel}</span>
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
          Is the audit log being written?
        </span>
      )}
      <Link
        href="/admin/audit"
        className="ml-auto text-[var(--mp-viridian)] hover:underline"
      >
        Audit trail →
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
