"use client";

/**
 * Today page tiles (a18). The Needs-you list, money strip and system line
 * live in page.tsx; these tiles sit under "More signals". Tiles without a
 * page that holds their data are not links (UX-ADM-07): AI chat, Telegram
 * activation, free-limit hits and learner activity.
 */

import Link from "next/link";
import { Activity, Gauge, ShieldAlert, TrendingUp, Users, Wallet, Webhook } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
  FormatEuro,
  FormatInt,
  Sparkline,
  StatusDot,
  TileEmptyLabel,
  formatInt,
  formatEuroFromCents,
} from "../_components/primitives";

export interface MoneySplit {
  gross_cents: number;
  refunds_cents: number;
  cash_cents: number;
}

export interface PaymentHealthTile {
  level: "alarm" | "attention" | "ok" | "quiet";
  diagnosis: string;
  failures_24h: number;
  probes_24h: number;
  unresolved_total: number;
}

export interface OverviewSnapshot {
  generated_at: string;
  day?: string;
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
    new_payers_7d: { new_payers: number; signups: number; ratio: number | null } | null;
    real_signups?: { d7: number; d30: number } | null;
    payment_health: PaymentHealthTile | null;
    signups_today: number | null;
    free_limit_hits_today?: number | null;
    feedback_new?: number | null;
    ai_chat_1h: { requests: number; completed: number; failed: number; avg_latency_ms: number | null } | null;
    telegram_activation: { registered: number; confirmed: number } | null;
    crons: Record<string, { lastStatus: string; lastStartedAt: string | null }> | null;
    recent_events_aggregate: { total_last_24h: number } | null;
  };
  needs?: {
    unresolved: { count: number; oldest_at: string | null; currencies: string[] };
    refunds_7d: { count: number; by_currency: Array<{ currency: string; cents: number }>; unknown_amounts?: number };
    ending_7d: { count: number; soonest_days: number | null };
  } | null;
  /** Blocks that could not be read this time (ADM-Q07). */
  failed?: string[];
}

/** Grey "Could not load" with Retry: a failed read never shows as 0 (ADM-Q07). */
export function CouldNotLoad({ onRetry, what }: { onRetry: () => void; what?: string }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 text-xs text-[var(--mp-fg-muted)]" data-testid="could-not-load">
      <span>Could not load{what ? ` ${what}` : ""}.</span>
      <button type="button" className="min-h-8 underline" onClick={onRetry}>Retry</button>
    </span>
  );
}

export function FailedTile({ label, icon, onRetry }: { label: string; icon: LucideIcon; onRetry: () => void }) {
  return (
    <Tile label={label} icon={icon} tone="neutral">
      <CouldNotLoad onRetry={onRetry} />
    </Tile>
  );
}

export function FreeLimitTile({ count }: { count: number }) {
  return (
    <Tile label="Free limit reached today" icon={ShieldAlert} tone="neutral" footer="Learners who hit the free question limit since Vienna midnight">
      <div className="text-2xl font-semibold text-[var(--mp-fg)]">
        <FormatInt value={count} />
      </div>
    </Tile>
  );
}

export function ActivityCountTile({ count }: { count: number }) {
  return (
    <Tile label="Activity (24h)" icon={Activity} tone="neutral" footer="Recorded learner events in the last 24 hours">
      <div className="text-2xl font-semibold text-[var(--mp-fg)]">
        <FormatInt value={count} />
      </div>
    </Tile>
  );
}


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

export function Tile({
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

export function PaymentDiagnosisLine({ health }: { health: PaymentHealthTile }) {
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

export function RevenueHeroTile({ revenue }: { revenue: OverviewSnapshot["tiles"]["revenue"] }) {
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

export function PayingLearnersTile({ paying }: { paying: OverviewSnapshot["tiles"]["active_subs"] }) {
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
        {paying ? <FormatInt value={paying.total} /> : "--"}
      </div>
    </Tile>
  );
}

export function NewPayersTile({ data }: { data: OverviewSnapshot["tiles"]["new_payers_7d"] }) {
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
        {data ? <FormatInt value={data.new_payers} /> : "--"}
      </div>
      <div className="mt-1 text-[10px] text-[var(--mp-fg-muted)]">
        Learners whose first paid payment was in the last 7 days
      </div>
    </Tile>
  );
}

export function PaymentFailuresTile({ health, restricted }: { health: PaymentHealthTile | null; restricted?: boolean }) {
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

export function CronsTile({
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

export function TelegramActivationTile({
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

export function AIChatHealthTile({
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
    ? "--"
    : `${Math.round(live.avg_latency_ms / 100) / 10}s`;

  return (
    <Tile
      label="AI chat (60 min)"
      icon={Activity}
      tone={tone}
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
