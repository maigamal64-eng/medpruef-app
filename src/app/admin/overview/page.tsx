"use client";

/**
 * /admin/overview: Today (a18, ADM-11 A).
 *
 * One phone screen answers "what needs my hand today":
 *   1. Needs you: one row per queue with something waiting (count, how long
 *      the oldest item has waited, a link). "Nothing waiting on you" when
 *      every known queue is empty. A queue that could not be read shows a
 *      grey "Could not load, Retry", never a 0 (ADM-Q07).
 *   2. Money strip: money in this month, paying learners, real signups.
 *   3. System line: payment diagnosis, cron runs, admin action log.
 * Everything else sits under "More signals".
 *
 * Counts come from /api/admin/overview (money rows, shared money rules) and
 * /api/admin/inbox (queues, shared with the menu badges through the admin
 * chrome context). Admin realtime is off (ADM-20 A): the page polls every
 * 60 s while visible, refetches when the tab returns or the browser comes
 * back online, and says when it was updated. Days are Vienna days.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Activity, Bot, Gauge, ShieldAlert, TrendingUp, Users, Wallet, Webhook } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";
import { waitedFor } from "@/lib/admin/today-rules";
import { MentorOverviewCard } from "../mentor/OverviewCard";
import { AiSpendRow } from "./AiSpendRow";
import { AdminPageShell } from "../_components/AdminPageShell";
import { ADMIN_POLL_MS } from "../_components/freshness";
import { RowBoundary } from "../_components/RowBoundary";
import { useAdminChrome } from "../_components/admin-chrome";
import type { InboxKey } from "../_components/admin-nav";
import { SectionHeading, StatusDot, TileSkeleton, formatEuroFromCents, formatInt } from "../_components/primitives";
import {
  AIChatHealthTile,
  ActivityCountTile,
  CouldNotLoad,
  CronsTile,
  FailedTile,
  FreeLimitTile,
  NewPayersTile,
  PayingLearnersTile,
  PaymentDiagnosisLine,
  PaymentFailuresTile,
  RevenueHeroTile,
  TelegramActivationTile,
  type OverviewSnapshot,
} from "./MoreSignals";

const VIENNA_DATE = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "Europe/Vienna" });
const VIENNA_MONTH = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "Europe/Vienna" });

type RowTone = "danger" | "warn" | "neutral";

interface NeedRow {
  key: string;
  label: string;
  detail?: string | null;
  href: string;
  tone: RowTone;
  /** number = known; null + failed = could not load; null + !failed = not offered. */
  count: number | null;
  failed: boolean;
  retry: () => void;
}

function moneyList(items: Array<{ currency: string; cents: number }>): string {
  return items.map((i) => (i.currency === "EUR" ? formatEuroFromCents(i.cents) : `${i.currency} ${(i.cents / 100).toFixed(2)}`)).join(", ");
}

export default function AdminOverviewPage() {
  const { can, roles, loading: accessLoading } = useAdminPermissions();
  const { inbox, refreshInbox } = useAdminChrome();
  const [snapshot, setSnapshot] = useState<OverviewSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const isOwner = roles.some((role) => role.key === "owner");

  const hydrate = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/overview", { cache: "no-store" });
      if (!res.ok) throw new Error(`overview ${res.status}`);
      const body = (await res.json()) as OverviewSnapshot;
      if (!body || typeof body !== "object" || !body.tiles) throw new Error("overview malformed");
      setSnapshot(body);
      setUpdatedAt(Date.now());
      setNow(Date.now());
      setError(null);
    } catch (e) {
      setError((e as Error).message || "Failed to load Today");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accessLoading && can("overview.read")) void hydrate();
  }, [accessLoading, can, hydrate]);

  // The chrome provider already polls the Inbox counts; refresh them here
  // only when they are older than 30 s (manual Refresh, tab return).
  const refreshAll = useCallback(() => {
    void hydrate();
    if (!inbox.updatedAt || Date.now() - inbox.updatedAt > 30_000) void refreshInbox();
  }, [hydrate, inbox.updatedAt, refreshInbox]);

  const failed = useMemo(() => new Set(snapshot?.failed ?? []), [snapshot]);
  const overviewDown = Boolean(error);

  const rows = useMemo<NeedRow[]>(() => {
    const needs = snapshot?.needs ?? null;
    const moneyFailed = overviewDown || failed.has("money");
    const out: NeedRow[] = [];
    const inboxRow = (key: InboxKey, label: string, href: string, allowed: boolean, detail?: string | null, tone: RowTone = "warn") => {
      if (!allowed) return;
      const n = inbox.counts[key];
      const rowFailed = inbox.failed.has(key) || (inbox.status === "error" && typeof n !== "number");
      // Loaded, not failed, still null: the server does not offer this queue (Ops approvals off).
      if (inbox.status === "ok" && typeof n !== "number" && !rowFailed) return;
      const waited = typeof n === "number" && n > 0 ? waitedFor(inbox.oldest[key], now) : null;
      out.push({
        key,
        label,
        href,
        tone,
        count: typeof n === "number" ? n : null,
        failed: rowFailed,
        retry: () => void refreshInbox(),
        detail: [detail, waited ? `oldest waited ${waited}` : null].filter(Boolean).join(" · ") || null,
      });
    };
    const moneyRow = (key: string, label: string, href: string, count: number | undefined, detail: string | null, tone: RowTone) => {
      if (!can("revenue.read")) return;
      out.push({ key, label, href, tone, count: typeof count === "number" ? count : null, failed: moneyFailed || (snapshot !== null && !needs), detail, retry: () => void hydrate() });
    };

    moneyRow("unresolved", "Payments that did not grant access", "/admin/payments#unresolved", needs?.unresolved.count,
      needs && needs.unresolved.count > 0 ? [needs.unresolved.currencies.join(", "), waitedFor(needs.unresolved.oldest_at, now) && `oldest waited ${waitedFor(needs.unresolved.oldest_at, now)}`].filter(Boolean).join(" · ") : null, "danger");
    inboxRow("ops_actions", "Ops approvals waiting", "/admin/ops", isOwner && can("access.manage"), null, "danger");
    moneyRow("ending_7d", "Pro ends within 7 days, no renewal", "/admin/subscriptions", needs?.ending_7d.count,
      needs && needs.ending_7d.soonest_days != null ? `soonest in ${needs.ending_7d.soonest_days} day${needs.ending_7d.soonest_days === 1 ? "" : "s"}` : null, "warn");
    const feedbackNew = snapshot?.tiles.feedback_new;
    inboxRow("feedback", "Feedback waiting for a reply or close", "/admin/feedback", can("feedback.read"),
      typeof feedbackNew === "number" ? `${formatInt(feedbackNew)} new` : null);
    inboxRow("question_reports", "Question reports to review", "/admin/flagged", can("content.read"));
    inboxRow("note_reports", "Community note reports", "/admin/note-reports", can("content.read"));
    inboxRow("puyp", "PUYP proofs waiting (72 hour promise)", "/admin/puyp", can("revenue.read"));
    inboxRow("referral_rewards", "Referral rewards to confirm", "/admin/referrals", can("revenue.read"));
    inboxRow("referral_payouts", "Referral payouts to send", "/admin/referrals", can("revenue.read"));
    moneyRow("refunds_7d", "Refunds in the last 7 days", "/admin/payments#refunds", needs?.refunds_7d.count,
      needs && needs.refunds_7d.count > 0
        ? [moneyList(needs.refunds_7d.by_currency), needs.refunds_7d.unknown_amounts ? `${needs.refunds_7d.unknown_amounts} amount unknown` : null].filter(Boolean).join(", ")
        : null, "neutral");
    return out;
  }, [can, failed, hydrate, inbox, isOwner, now, overviewDown, refreshInbox, snapshot]);

  if (accessLoading) return <div className="p-6"><TileSkeleton /></div>;
  if (!can("overview.read")) return <div className="p-6"><div className="rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm">Your admin role does not include access to the overview.</div></div>;

  const tiles = snapshot?.tiles;
  // a19: the jobs list is an array; anything else (an older payload) shows the skeleton, never a crash.
  const cronJobs = Array.isArray(tiles?.crons) ? tiles.crons : null;
  const blockFailed = (name: string) => overviewDown || failed.has(name);

  return (
    <AdminPageShell
      title="Today"
      description={`${VIENNA_DATE.format(new Date(snapshot?.generated_at ?? now))}, Vienna time.`}
      loadState={{ loading, error, updatedAt }}
      pollMs={ADMIN_POLL_MS}
      onRefresh={refreshAll}
    >
      {error && !snapshot && (
        <div role="status" className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-4 py-3">
          <CouldNotLoad what="Today" onRetry={refreshAll} />
        </div>
      )}

      <NeedsYou rows={rows} loading={loading && !snapshot} />

      {can("revenue.read") && (
        <MoneyStrip
          snapshot={snapshot}
          loading={loading && !snapshot}
          failed={blockFailed("money")}
          onRetry={() => void hydrate()}
          now={now}
        />
      )}

      {(can("system.read") || can("revenue.read")) && (
        <SystemLine
          health={tiles?.payment_health ?? null}
          crons={cronJobs}
          showPayments={can("revenue.read")}
          showCrons={can("system.read")}
          paymentsFailed={blockFailed("money")}
          cronsFailed={blockFailed("crons")}
          onRetry={() => void hydrate()}
        />
      )}

      {can("system.read") && <SystemStatusRow refreshKey={updatedAt} />}

      {can("revenue.read") && (
        <RowBoundary label="The AI spend row could not be displayed.">
          <AiSpendRow refreshKey={updatedAt} />
        </RowBoundary>
      )}

      {can("system.read") && <AdminActionsRibbon refreshKey={updatedAt} />}

      <details className="group rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)]" data-testid="overview-more-signals">
        <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 text-sm font-semibold text-[var(--mp-fg)]">
          <Gauge size={14} aria-hidden /> More signals
          <span className="text-xs font-normal text-[var(--mp-fg-muted)]">money detail, AI chat, Telegram, activity</span>
        </summary>
        <div className="space-y-5 border-t border-[var(--mp-border-subtle)] p-3 sm:p-4">
          {can("revenue.read") && tiles?.payment_health && <PaymentDiagnosisLine health={tiles.payment_health} />}
          {can("revenue.read") && (
            <section className="space-y-3">
              <SectionHeading title="Money" icon={TrendingUp} hint="Cash basis, Vienna days" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {blockFailed("money") ? (
                  <>
                    <FailedTile label="Money in today (cash)" icon={Wallet} onRetry={() => void hydrate()} />
                    <FailedTile label="Paying learners" icon={Users} onRetry={() => void hydrate()} />
                    <FailedTile label="New payers (7d)" icon={TrendingUp} onRetry={() => void hydrate()} />
                    <FailedTile label="Payment failures (24h)" icon={Webhook} onRetry={() => void hydrate()} />
                  </>
                ) : !tiles ? (
                  <><TileSkeleton /><TileSkeleton /><TileSkeleton /><TileSkeleton /></>
                ) : (
                  <>
                    <div className="sm:col-span-2" data-testid="overview-revenue-hero"><RevenueHeroTile revenue={tiles.revenue} /></div>
                    <PayingLearnersTile paying={tiles.active_subs} />
                    <NewPayersTile data={tiles.new_payers_7d} />
                    <PaymentFailuresTile health={tiles.payment_health} />
                  </>
                )}
              </div>
            </section>
          )}
          {(can("system.read") || can("users.read")) && (
            <section className="space-y-3">
              <SectionHeading title="Platform" icon={Activity} hint="Signals without their own page; not links" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {can("system.read") && (blockFailed("crons") ? <FailedTile label="Scheduled jobs" icon={Gauge} onRetry={() => void hydrate()} /> : cronJobs ? <CronsTile crons={cronJobs} /> : <TileSkeleton />)}
                {can("system.read") && (blockFailed("ai_chat") ? <FailedTile label="AI chat (60 min)" icon={Bot} onRetry={() => void hydrate()} /> : tiles?.ai_chat_1h ? <AIChatHealthTile initial={tiles.ai_chat_1h} /> : <TileSkeleton />)}
                {can("system.read") && (blockFailed("telegram") ? <FailedTile label="Telegram bot activation" icon={Activity} onRetry={() => void hydrate()} /> : tiles?.telegram_activation ? <TelegramActivationTile initial={tiles.telegram_activation} /> : <TileSkeleton />)}
                {can("users.read") && (blockFailed("free_limit") ? <FailedTile label="Free limit reached today" icon={ShieldAlert} onRetry={() => void hydrate()} /> : typeof tiles?.free_limit_hits_today === "number" ? <FreeLimitTile count={tiles.free_limit_hits_today} /> : <TileSkeleton />)}
                {can("users.read") && (blockFailed("activity") ? <FailedTile label="Activity (24h)" icon={Activity} onRetry={() => void hydrate()} /> : tiles?.recent_events_aggregate ? <ActivityCountTile count={tiles.recent_events_aggregate.total_last_24h} /> : <TileSkeleton />)}
              </div>
            </section>
          )}
          {can("revenue.read") && (
            <RowBoundary label="The AI Mentor summary could not be displayed.">
              <MentorOverviewCard />
            </RowBoundary>
          )}
        </div>
      </details>
    </AdminPageShell>
  );
}

// ═══ Needs you ═══════════════════════════════════════════════════════

function NeedsYou({ rows, loading }: { rows: NeedRow[]; loading: boolean }) {
  const waiting = rows.filter((r) => typeof r.count === "number" && r.count > 0);
  const unknown = rows.filter((r) => r.failed);
  const pending = rows.filter((r) => r.count === null && !r.failed);
  const clear = rows.filter((r) => r.count === 0 && !r.failed);
  const items = waiting.reduce((sum, r) => sum + (r.count ?? 0), 0);
  return (
    <section aria-labelledby="needs-you-title" className="space-y-2" data-testid="overview-needs-you">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="needs-you-title" className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--mp-fg-muted)]">Needs you</h2>
        {waiting.length > 0 && <span className="text-xs text-[var(--mp-fg-muted)]">{formatInt(items)} item{items === 1 ? "" : "s"}</span>}
      </div>
      <div className="overflow-hidden rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)]">
        {loading && waiting.length === 0 && unknown.length === 0 ? (
          <div className="p-3"><TileSkeleton /></div>
        ) : (
          <ul className="divide-y divide-[var(--mp-border-subtle)]">
            {waiting.map((r) => (
              <li key={r.key}>
                <Link href={r.href} className="flex min-h-14 items-center gap-3 px-3 py-2.5 no-underline hover:bg-[var(--mp-surface-sunken)]" data-testid={`needs-row-${r.key}`}>
                  <span className={`flex h-10 min-w-10 items-center justify-center rounded-lg px-2 font-mono text-base font-semibold tabular-nums ${r.tone === "danger" ? "bg-[var(--mp-error-bg)] text-[var(--mp-error)]" : r.tone === "warn" ? "bg-[color-mix(in_srgb,var(--mp-warning)_14%,transparent)] text-[var(--mp-fg)]" : "bg-[var(--mp-surface-sunken)] text-[var(--mp-fg)]"}`}>
                    {formatInt(r.count ?? 0)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-[var(--mp-fg)]">{r.label}</span>
                    {r.detail && <span className="block text-xs text-[var(--mp-fg-muted)] [overflow-wrap:anywhere]">{r.detail}</span>}
                  </span>
                </Link>
              </li>
            ))}
            {unknown.map((r) => (
              <li key={r.key} className="flex min-h-14 items-center gap-3 px-3 py-2.5" data-testid={`needs-row-${r.key}`}>
                <span className="flex h-10 min-w-10 items-center justify-center rounded-lg border border-[var(--mp-border-subtle)] px-2 font-mono text-sm text-[var(--mp-fg-muted)]" aria-hidden>--</span>
                <span className="min-w-0 flex-1">
                  <Link href={r.href} className="block text-sm text-[var(--mp-fg)]">{r.label}</Link>
                  <CouldNotLoad onRetry={r.retry} />
                </span>
              </li>
            ))}
            {waiting.length === 0 && unknown.length === 0 && pending.length === 0 && (
              <li className="flex min-h-14 items-center gap-2 px-3 py-3 text-sm text-[var(--mp-fg)]" data-testid="needs-clear">
                <StatusDot tone="success" size={8} /> Nothing waiting on you.
              </li>
            )}
            {(waiting.length > 0 || unknown.length > 0) && clear.length > 0 && (
              <li className="flex items-start gap-2 bg-[var(--mp-surface-sunken)] px-3 py-2.5 text-xs text-[var(--mp-fg-muted)]">
                <span className="mt-1"><StatusDot tone="success" size={6} /></span>
                <span>Nothing waiting in {clear.map((r) => r.label.replace(/ \(.*\)$/, "")).join(", ")}.</span>
              </li>
            )}
          </ul>
        )}
      </div>
    </section>
  );
}

// ═══ Money strip ═════════════════════════════════════════════════════

function MoneyStrip({ snapshot, loading, failed, onRetry, now }: {
  snapshot: OverviewSnapshot | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  now: number;
}) {
  const t = snapshot?.tiles;
  const mtd = t?.revenue?.month_to_date ?? (t?.revenue ? { cash_cents: t.revenue.mtd_cents, refunds_cents: 0, gross_cents: t.revenue.mtd_cents } : null);
  const cells: Array<{ key: string; label: string; value: string | null; sub: string | null; href: string; accent: string }> = [
    {
      key: "money",
      label: `In, ${VIENNA_MONTH.format(new Date(snapshot?.generated_at ?? now))}`,
      value: mtd ? formatEuroFromCents(mtd.cash_cents) : null,
      sub: mtd ? (mtd.refunds_cents > 0 ? `${formatEuroFromCents(mtd.refunds_cents)} refunded` : "cash, no refunds") : null,
      href: "/admin/payments#money",
      accent: "var(--mp-viridian)",
    },
    {
      key: "paying",
      label: "Paying",
      value: t?.active_subs ? formatInt(t.active_subs.total) : null,
      sub: t?.active_subs ? `learners · ${formatInt(t.active_subs.in_trial)} in trial${t.active_subs.seed_seats ? ` · ${formatInt(t.active_subs.seed_seats)} on a seed seat (not paying)` : ""}` : null,
      href: "/admin/subscriptions?view=all",
      accent: "var(--mp-cta-blue)",
    },
    {
      key: "signups",
      label: "Signups 7d",
      value: t?.real_signups ? formatInt(t.real_signups.d7) : null,
      sub: t?.real_signups ? `${formatInt(t.real_signups.d30)} in 30d` : null,
      href: "/admin/users",
      accent: "var(--mp-accent, #00A896)",
    },
  ];
  return (
    <section aria-labelledby="money-strip-title" className="space-y-2" data-testid="overview-money-strip">
      <h2 id="money-strip-title" className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--mp-fg-muted)]">Money this month</h2>
      {/* n-web-01: two columns under 400px so a four-digit euro value never
          clips; the third cell takes the full row. A failed cell is not a
          link, so Retry never also navigates. */}
      <div className="grid grid-cols-2 gap-2 min-[400px]:grid-cols-3 sm:gap-3">
        {cells.map((c, i) => {
          const className = `relative min-w-0 overflow-hidden rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-3 no-underline hover:border-[var(--mp-border)] ${i === cells.length - 1 ? "max-[399px]:col-span-2" : ""}`;
          const body = (
            <>
              <span aria-hidden className="absolute inset-x-0 top-0 h-[3px]" style={{ backgroundColor: c.accent }} />
              <span className="block truncate text-[10px] uppercase tracking-wider text-[var(--mp-fg-muted)]">{c.label}</span>
              {failed ? (
                <span className="mt-1 block"><CouldNotLoad onRetry={onRetry} /></span>
              ) : loading || c.value === null ? (
                <span className="mt-1 block h-7 w-16 animate-pulse rounded bg-[var(--mp-surface-sunken)]" aria-label="Loading" />
              ) : (
                <>
                  <span className="mt-1 block truncate text-xl font-semibold tabular-nums text-[var(--mp-fg)] sm:text-2xl">{c.value}</span>
                  {c.sub && <span className="block text-[11px] leading-snug text-[var(--mp-fg-muted)] [overflow-wrap:anywhere]">{c.sub}</span>}
                </>
              )}
            </>
          );
          return failed ? (
            <div key={c.key} className={className}>{body}</div>
          ) : (
            <Link key={c.key} href={c.href} className={className}>{body}</Link>
          );
        })}
      </div>
    </section>
  );
}

// ═══ System line ═════════════════════════════════════════════════════

function SystemLine({ health, crons, showPayments, showCrons, paymentsFailed, cronsFailed, onRetry }: {
  health: OverviewSnapshot["tiles"]["payment_health"];
  crons: OverviewSnapshot["tiles"]["crons"];
  showPayments: boolean;
  showCrons: boolean;
  paymentsFailed: boolean;
  cronsFailed: boolean;
  onRetry: () => void;
}) {
  const failing = (crons ?? []).filter((c) => c.tone === "danger");
  const late = (crons ?? []).filter((c) => c.tone === "warn");
  // A job whose evidence could not be read is never reported as on time (ADM-Q07).
  const unreadable = (crons ?? []).filter((c) => c.state === "unknown");
  const attention = [...failing, ...late];
  const payTone = health?.level === "alarm" ? "danger" : health?.level === "attention" ? "warn" : health?.level === "ok" ? "success" : "neutral";
  return (
    <section aria-label="System" className="flex flex-col gap-2 rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-3 py-2.5 text-xs sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5" data-testid="overview-system-line">
      {showPayments && (
        paymentsFailed ? (
          <span className="flex items-center gap-2"><span className="font-semibold text-[var(--mp-fg)]">Payments</span><CouldNotLoad onRetry={onRetry} /></span>
        ) : health ? (
          <Link href="/admin/payments" className="flex min-h-8 min-w-0 items-start gap-2 text-[var(--mp-fg)] no-underline hover:underline" data-testid="overview-payment-diagnosis">
            <span className="mt-1"><StatusDot tone={payTone} size={7} /></span>
            <span className="min-w-0 [overflow-wrap:anywhere]"><span className="font-semibold">Payments: </span>{health.diagnosis}</span>
          </Link>
        ) : null
      )}
      {showCrons && (
        cronsFailed ? (
          <span className="flex items-center gap-2"><span className="font-semibold text-[var(--mp-fg)]">Jobs</span><CouldNotLoad onRetry={onRetry} /></span>
        ) : crons ? (
          <Link href="/admin/crons" className="flex min-h-8 min-w-0 items-start gap-2 text-[var(--mp-fg)] no-underline hover:underline" data-testid="overview-cron-line">
            <span className="mt-1"><StatusDot tone={failing.length > 0 ? "danger" : late.length > 0 || unreadable.length > 0 ? "warn" : "success"} size={7} /></span>
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <span className="font-semibold">Jobs: </span>
              {[
                ...attention.map((c) => `${c.label} (${c.text})`),
                ...(unreadable.length > 0 ? [`${unreadable.length} job${unreadable.length === 1 ? "" : "s"} could not be read`] : []),
              ].join("; ") || "no scheduled job is late or failing"}
            </span>
          </Link>
        ) : null
      )}
    </section>
  );
}

// ═══ System status row (a19, UX-ADM-09) ══════════════════════════════

interface SystemStatus {
  deploy: { ok: true; sha: string | null; created_at: number | null; summary: string | null } | { ok: false; reason: string };
  sentry: { ok: true; unresolved: number } | { ok: false; reason: string };
}

/** Production deploy age and unresolved Sentry issues; loaded on its own so a slow upstream never holds Today. */
function SystemStatusRow({ refreshKey }: { refreshKey: number | null }) {
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/admin/system-status", { cache: "no-store" });
        const body = await res.json().catch(() => null);
        if (!alive) return;
        if (!res.ok || !body?.deploy || !body?.sentry) throw new Error("status");
        setStatus(body as SystemStatus);
        setFailed(false);
        setNow(Date.now());
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => { alive = false; };
  }, [refreshKey, attempt]);

  if (failed && !status) {
    return (
      <section aria-label="System status" className="flex items-center gap-2 rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-3 py-2.5 text-xs">
        <span className="font-semibold text-[var(--mp-fg)]">System status</span><CouldNotLoad onRetry={() => setAttempt((n) => n + 1)} />
      </section>
    );
  }
  if (!status) return null;
  const d = status.deploy;
  const staleNote = failed ? " (last refresh failed, showing the previous reading)" : "";
  const e = status.sentry;
  return (
    <section aria-label="System status" className="flex flex-col gap-2 rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-3 py-2.5 text-xs sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5" data-testid="overview-system-status">
      <Link href="/admin/deploys" className="flex min-h-8 min-w-0 items-start gap-2 text-[var(--mp-fg)] no-underline hover:underline">
        <span className="mt-1"><StatusDot tone={d.ok ? "success" : "neutral"} size={7} /></span>
        <span className="min-w-0 [overflow-wrap:anywhere]">
          <span className="font-semibold">Production: </span>
          {d.ok ? `${d.sha ?? "deploy"}${d.created_at ? `, live for ${waitedFor(new Date(d.created_at).toISOString(), now)}` : ""}` : d.reason}{staleNote}
        </span>
      </Link>
      <Link href="/admin/errors" className="flex min-h-8 min-w-0 items-start gap-2 text-[var(--mp-fg)] no-underline hover:underline">
        <span className="mt-1"><StatusDot tone={!e.ok ? "neutral" : e.unresolved > 0 ? "warn" : "success"} size={7} /></span>
        <span className="min-w-0 [overflow-wrap:anywhere]">
          <span className="font-semibold">Sentry: </span>
          {e.ok ? `${formatInt(e.unresolved)} unresolved issue${e.unresolved === 1 ? "" : "s"} (14 days)` : e.reason}{staleNote}
        </span>
      </Link>
    </section>
  );
}

// ═══ Admin action log ribbon ═════════════════════════════════════════

/**
 * Admin actions today and the latest one. Refetched with the page poll.
 * A failed read is an amber warning with Retry, never a silent gap (ADM-Q07).
 * Goes amber with "Is the audit log being written?" when nothing landed for
 * 24 hours (the regression that triggered the post-audit-rescue sprint).
 */
function AdminActionsRibbon({ refreshKey }: { refreshKey: number | null }) {
  const [summary, setSummary] = useState<{ today_count: number; last_action_at: string | null; last_action: string | null } | null>(null);
  const [auditError, setAuditError] = useState(false);
  const [auditAttempt, setAuditAttempt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/admin/audit-log/latest?limit=1", { cache: "no-store" });
        if (!res.ok) throw new Error(`audit-log ${res.status}`);
        const body = (await res.json()) as { today_count: number; last_action_at: string | null; last_action: string | null };
        if (cancelled) return;
        setSummary({ today_count: body.today_count || 0, last_action_at: body.last_action_at, last_action: body.last_action });
        setAuditError(false);
        setNow(Date.now());
      } catch {
        if (!cancelled) setAuditError(true);
      }
    })();
    return () => { cancelled = true; };
  }, [auditAttempt, refreshKey]);

  const warn = "var(--mp-warning)";
  const ribbonStyle = (color: string) => ({
    borderColor: `color-mix(in srgb, ${color} 40%, transparent)`,
    backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
  });

  if (auditError) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs text-[var(--mp-fg)]" style={ribbonStyle(warn)} data-testid="admin-actions-ribbon">
        <Activity size={12} style={{ color: warn }} aria-hidden />
        <span>Could not load the admin action log, so a quiet log cannot be ruled out.</span>
        <button type="button" className="min-h-11 underline" onClick={() => setAuditAttempt((n) => n + 1)}>Retry</button>
      </div>
    );
  }
  if (!summary) return null;

  const count = summary.today_count;
  const latestAt = summary.last_action_at ? new Date(summary.last_action_at).getTime() : null;
  const ageMinutes = latestAt != null ? Math.max(0, Math.floor((now - latestAt) / 60_000)) : null;
  const quietFor24h = latestAt == null || now - latestAt > 24 * 60 * 60_000;
  const toneColor = quietFor24h && count === 0 ? warn : "var(--mp-info)";
  const relativeLabel =
    ageMinutes == null ? "not logged yet"
      : ageMinutes < 1 ? "less than a minute ago"
        : ageMinutes < 60 ? `${ageMinutes} min ago`
          : ageMinutes < 1440 ? `${Math.floor(ageMinutes / 60)} hr ago`
            : `${Math.floor(ageMinutes / 1440)} day${Math.floor(ageMinutes / 1440) === 1 ? "" : "s"} ago`;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2 text-xs" style={ribbonStyle(toneColor)} data-testid="admin-actions-ribbon">
      <div className="flex items-center gap-1.5 font-semibold" style={{ color: toneColor }}>
        <Activity size={12} aria-hidden />
        Admin actions today
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1 font-mono tabular-nums text-[var(--mp-fg)]">
        <strong>{formatInt(count)}</strong>
        <span className="text-[var(--mp-fg-muted)]">·</span>
        <span>Last action: {relativeLabel}</span>
        {summary.last_action && (
          <>
            <span className="text-[var(--mp-fg-muted)]">·</span>
            <span className="text-[var(--mp-fg-muted)] [overflow-wrap:anywhere]">{summary.last_action}</span>
          </>
        )}
      </div>
      {quietFor24h && count === 0 && <span className="italic text-[var(--mp-warning)]">Is the audit log being written?</span>}
      <Link href="/admin/audit" className="ml-auto inline-flex min-h-8 items-center text-[var(--mp-viridian)] hover:underline">
        Admin action log →
      </Link>
    </div>
  );
}
