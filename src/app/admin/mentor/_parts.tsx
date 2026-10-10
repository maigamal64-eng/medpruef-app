"use client";

/**
 * Mentor admin cost view: presentational sections (W3-COSTVIEW).
 * Pure props in, markup out. Money is micro-USD of true API cost (admin only);
 * ids only, never emails. Uses the admin --mp-* tokens so it follows the
 * admin dark/light theme with no hex literals.
 */

import type { ReactNode } from "react";
import type { MentorAdminSummary } from "@/lib/mentor/contract";
import { StatusDot, type StatusTone } from "../_components/primitives";
import {
  dayOfMonth,
  expiredUnusedMicro,
  formatAge,
  formatCount,
  formatCredits,
  formatPct,
  formatTokens,
  formatUsd,
  PACKAGE_LABEL,
  shortId,
} from "./format";

const CARD = "rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)]";
const TH = "px-3 py-2 text-[10px] uppercase tracking-wider font-medium text-[var(--mp-fg-muted)]";
const TD = "px-3 py-2 tabular-nums";

export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h2 className="text-sm font-semibold text-[var(--mp-fg)]">{title}</h2>
        {hint && <p className="text-[11px] text-[var(--mp-fg-muted)]">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function TableWrap({ children }: { children: ReactNode }) {
  return <div className={`${CARD} overflow-x-auto`}>{children}</div>;
}

function Empty({ children }: { children: ReactNode }) {
  return <div className={`${CARD} px-4 py-6 text-center text-xs text-[var(--mp-fg-muted)]`}>{children}</div>;
}

// ─── Breaker ────────────────────────────────────────────────────────────

export function BreakerCard({ summary }: { summary: MentorAdminSummary }) {
  const { spend, state } = summary;
  const resting = state.resting;
  const pct = Math.min(Math.max(spend.pct_of_cap, 0), 100);
  const tone: StatusTone = resting ? "danger" : spend.pct_of_cap >= 80 ? "warn" : "success";
  const bar = resting ? "bg-red-500" : spend.pct_of_cap >= 80 ? "bg-amber-500" : "bg-emerald-500";
  return (
    <div className={`${CARD} p-4 sm:p-5 space-y-3`} data-testid="breaker">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <StatusDot tone={tone} pulse={resting} size={10} title={resting ? "Breaker tripped" : "Within budget"} />
          <span className="text-sm font-semibold text-[var(--mp-fg)]">
            {resting ? "Breaker tripped: the mentor is resting" : tone === "warn" ? "Approaching the global monthly cap" : "Within the global monthly cap"}
          </span>
        </div>
        <span className="text-[11px] font-mono text-[var(--mp-fg-muted)]">UTC month {summary.month}</span>
      </div>
      <div
        className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--mp-surface-sunken)]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label="Monthly spend against the global cap"
      >
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-xs text-[var(--mp-fg-muted)]">
        <span>
          <strong className="text-base text-[var(--mp-fg)] tabular-nums">{formatUsd(spend.total_micro)}</strong> spent of{" "}
          <span className="tabular-nums">{formatUsd(spend.cap_micro)}</span> cap
        </span>
        <span className="tabular-nums">{formatPct(spend.pct_of_cap)} of cap</span>
      </div>
      <p className="text-[11px] leading-relaxed text-[var(--mp-fg-muted)]">
        Cap is the larger of the floor and the configured share of trailing 30-day net revenue. At or over it, no new
        mentor message starts (the same two database functions the guard calls).
      </p>
    </div>
  );
}

// ─── State chips ────────────────────────────────────────────────────────

function Chip({ label, on, detail }: { label: string; on: boolean; detail?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-mono ${
        on
          ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
          : "border-[var(--mp-border-subtle)] text-[var(--mp-fg-muted)]"
      }`}
    >
      <StatusDot tone={on ? "success" : "neutral"} size={6} />
      {label}
      {detail ? <span className="opacity-70">{detail}</span> : null}
    </span>
  );
}

export function StateChips({ state }: { state: MentorAdminSummary["state"] }) {
  return (
    <div className="flex flex-wrap gap-2" aria-label="Mentor switches">
      <Chip label="AI_FEATURES_ENABLED" on={state.ai_features_enabled} />
      <Chip label="MENTOR_ENABLED" on={state.mentor_enabled} />
      <Chip label="PACKAGES" on={state.packages_enabled} />
      <Chip label="TOPUPS" on={state.topups_enabled} />
      <Chip
        label="DB flag"
        on={!!state.db_flag?.enabled}
        detail={state.db_flag ? `${state.db_flag.env} ${state.db_flag.rollout_pct}%` : "no row"}
      />
      <Chip label="Beta allowlist" on={state.beta_allowlist_size > 0} detail={`${state.beta_allowlist_size} ids`} />
    </div>
  );
}

// ─── Tiles ──────────────────────────────────────────────────────────────

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: StatusTone }) {
  const color =
    tone === "danger" ? "text-red-500" : tone === "warn" ? "text-amber-500" : "text-[var(--mp-fg)]";
  return (
    <div className={`${CARD} p-3.5`}>
      <div className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-muted)]">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-[var(--mp-fg-muted)] tabular-nums">{sub}</div>}
    </div>
  );
}

export function Tiles({ summary }: { summary: MentorAdminSummary }) {
  const calls = summary.by_day.reduce((s, d) => s + d.calls, 0);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
      <Tile label="Mentor spend" value={formatUsd(summary.spend.mentor_micro)} sub={`${formatCount(calls)} calls`} />
      <Tile label="Legacy AI spend" value={formatUsd(summary.spend.legacy_micro)} sub="other Anthropic routes" />
      <Tile
        label="House cost"
        value={formatUsd(summary.by_day.reduce((s, d) => s + d.house_micro, 0))}
        sub="failed calls we paid"
      />
      <Tile
        label="Overruns"
        value={formatCount(summary.overruns)}
        sub="calls over their reserve"
        tone={summary.overruns > 0 ? "warn" : undefined}
      />
      <Tile
        label="Wallet debt"
        value={formatUsd(summary.debt_total_micro)}
        sub="uncovered actual cost"
        tone={summary.debt_total_micro > 0 ? "warn" : undefined}
      />
      <Tile
        label="Stuck holds"
        value={formatCount(summary.stale_reservations.length)}
        sub="open past the sweep age"
        tone={summary.stale_reservations.length > 0 ? "danger" : undefined}
      />
    </div>
  );
}

// ─── Spend per day ──────────────────────────────────────────────────────

export function SpendByDay({ rows }: { rows: MentorAdminSummary["by_day"] }) {
  const max = Math.max(1, ...rows.map((r) => r.mentor_micro));
  const total = rows.reduce((s, r) => s + r.mentor_micro, 0);
  if (rows.length === 0 || total === 0) {
    return <Empty>No mentor calls settled yet this month.</Empty>;
  }
  return (
    <div className={`${CARD} p-4 space-y-3`}>
      <div className="overflow-x-auto">
        <div
          className="flex h-40 min-w-[36rem] items-end gap-[3px]"
          role="img"
          aria-label={`Mentor spend per UTC day, ${formatUsd(total)} in total`}
        >
          {rows.map((r) => {
            const h = (r.mentor_micro / max) * 100;
            const houseH = r.mentor_micro > 0 ? (r.house_micro / r.mentor_micro) * 100 : 0;
            return (
              <div
                key={r.day}
                className="flex h-full min-w-0 flex-1 flex-col justify-end"
                title={`${r.day}: ${formatUsd(r.mentor_micro)} over ${r.calls} calls (house ${formatUsd(r.house_micro)})`}
              >
                <div
                  className="flex w-full flex-col justify-end overflow-hidden rounded-t-sm bg-[var(--mp-accent-teal)]"
                  style={{ height: `${Math.max(h, r.mentor_micro > 0 ? 2 : 0)}%` }}
                >
                  {houseH > 0 && <div className="w-full bg-amber-500" style={{ height: `${houseH}%` }} />}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex min-w-[36rem] gap-[3px] text-[9px] font-mono text-[var(--mp-fg-muted)]">
          {rows.map((r) => (
            <span key={r.day} className="min-w-0 flex-1 text-center">
              {dayOfMonth(r.day)}
            </span>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--mp-fg-muted)]">
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2 w-2 rounded-sm bg-[var(--mp-accent-teal)]" /> billed to users
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2 w-2 rounded-sm bg-amber-500" /> paid by the house
        </span>
        <span>UTC days</span>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-[var(--mp-fg-muted)]">Daily table</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left">
                <th className={TH}>Day (UTC)</th>
                <th className={`${TH} text-right`}>Spend</th>
                <th className={`${TH} text-right`}>Calls</th>
                <th className={`${TH} text-right`}>House</th>
              </tr>
            </thead>
            <tbody>
              {[...rows].reverse().map((r) => (
                <tr key={r.day} className="border-t border-[var(--mp-border-subtle)] text-[var(--mp-fg)]">
                  <td className={`${TD} font-mono`}>{r.day}</td>
                  <td className={`${TD} text-right`}>{formatUsd(r.mentor_micro)}</td>
                  <td className={`${TD} text-right`}>{formatCount(r.calls)}</td>
                  <td className={`${TD} text-right`}>{formatUsd(r.house_micro)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

// ─── Credits sold vs consumed ───────────────────────────────────────────

export function PackagesTable({ rows }: { rows: MentorAdminSummary["lots_by_package"] }) {
  return (
    <TableWrap>
      <table className="w-full text-xs">
        <thead className="bg-[var(--mp-surface-sunken)]">
          <tr className="text-left">
            <th className={TH}>Package</th>
            <th className={`${TH} text-right`}>Lots</th>
            <th className={`${TH} text-right`}>Granted</th>
            <th className={`${TH} text-right`}>Consumed</th>
            <th className={`${TH} text-right`}>Used</th>
            <th className={`${TH} text-right`}>Clawed back</th>
            <th className={`${TH} text-right`}>Live now</th>
            <th className={`${TH} text-right`}>Expired unused</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const used = r.granted_micro > 0 ? (r.spent_micro / r.granted_micro) * 100 : 0;
            return (
              <tr key={r.package_id} className="border-t border-[var(--mp-border-subtle)] text-[var(--mp-fg)]">
                <td className={TD}>
                  <div>{PACKAGE_LABEL[r.package_id] ?? r.package_id}</div>
                  <div className="font-mono text-[10px] text-[var(--mp-fg-muted)]">{r.package_id}</div>
                </td>
                <td className={`${TD} text-right`}>{formatCount(r.lots)}</td>
                <td className={`${TD} text-right`}>
                  {formatCredits(r.granted_micro)} <span className="text-[var(--mp-fg-muted)]">cr</span>
                </td>
                <td className={`${TD} text-right`}>
                  {formatCredits(r.spent_micro)} <span className="text-[var(--mp-fg-muted)]">cr</span>
                  <div className="text-[10px] text-[var(--mp-fg-muted)]">{formatUsd(r.spent_micro)}</div>
                </td>
                <td className={`${TD} text-right`}>{r.granted_micro > 0 ? formatPct(used) : "n/a"}</td>
                <td className={`${TD} text-right`}>{formatCredits(r.clawed_back_micro)}</td>
                <td className={`${TD} text-right`}>{formatCredits(r.live_remaining_micro)}</td>
                <td className={`${TD} text-right`}>{formatCredits(expiredUnusedMicro(r))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableWrap>
  );
}

// ─── Top users ──────────────────────────────────────────────────────────

export function TopUsersTable({ rows }: { rows: MentorAdminSummary["top_users"] }) {
  if (rows.length === 0) return <Empty>No billed mentor messages yet this month.</Empty>;
  return (
    <TableWrap>
      <table className="w-full text-xs">
        <thead className="bg-[var(--mp-surface-sunken)]">
          <tr className="text-left">
            <th className={TH}>User id</th>
            <th className={`${TH} text-right`}>Spent</th>
            <th className={`${TH} text-right`}>Messages</th>
            <th className={`${TH} text-right`}>Per message</th>
            <th className={`${TH} text-right`}>Credits left</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.user_id} className="border-t border-[var(--mp-border-subtle)] text-[var(--mp-fg)]">
              <td className={`${TD} font-mono`} title={r.user_id}>
                {shortId(r.user_id)}
              </td>
              <td className={`${TD} text-right`}>{formatUsd(r.spent_micro)}</td>
              <td className={`${TD} text-right`}>{formatCount(r.messages)}</td>
              <td className={`${TD} text-right`}>{r.messages > 0 ? formatUsd(r.spent_micro / r.messages) : "n/a"}</td>
              <td className={`${TD} text-right`}>{formatCredits(r.available_micro)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

// ─── By model ───────────────────────────────────────────────────────────

export function ModelsTable({ rows }: { rows: MentorAdminSummary["by_model"] }) {
  if (rows.length === 0) return <Empty>No calls yet this month.</Empty>;
  return (
    <TableWrap>
      <table className="w-full text-xs">
        <thead className="bg-[var(--mp-surface-sunken)]">
          <tr className="text-left">
            <th className={TH}>Model</th>
            <th className={`${TH} text-right`}>Spend</th>
            <th className={`${TH} text-right`}>Calls</th>
            <th className={`${TH} text-right`}>Input</th>
            <th className={`${TH} text-right`}>Output</th>
            <th className={`${TH} text-right`}>Cache read</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.model} className="border-t border-[var(--mp-border-subtle)] text-[var(--mp-fg)]">
              <td className={`${TD} font-mono`}>{r.model}</td>
              <td className={`${TD} text-right`}>{formatUsd(r.mentor_micro)}</td>
              <td className={`${TD} text-right`}>{formatCount(r.calls)}</td>
              <td className={`${TD} text-right`}>{formatTokens(r.input_tokens)}</td>
              <td className={`${TD} text-right`}>{formatTokens(r.output_tokens)}</td>
              <td className={`${TD} text-right`}>{formatTokens(r.cache_read_tokens)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

// ─── Stuck holds and clawbacks ──────────────────────────────────────────

export function StaleTable({ rows }: { rows: MentorAdminSummary["stale_reservations"] }) {
  if (rows.length === 0) return <Empty>No stuck holds. The sweep is keeping up.</Empty>;
  return (
    <TableWrap>
      <table className="w-full text-xs">
        <thead className="bg-[var(--mp-surface-sunken)]">
          <tr className="text-left">
            <th className={TH}>Request</th>
            <th className={TH}>User id</th>
            <th className={`${TH} text-right`}>Call</th>
            <th className={`${TH} text-right`}>Held</th>
            <th className={`${TH} text-right`}>Age</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.request_id}:${r.call_index}`} className="border-t border-[var(--mp-border-subtle)] text-[var(--mp-fg)]">
              <td className={`${TD} font-mono`} title={r.request_id}>
                {shortId(r.request_id)}
              </td>
              <td className={`${TD} font-mono`} title={r.user_id}>
                {shortId(r.user_id)}
              </td>
              <td className={`${TD} text-right`}>{r.call_index}</td>
              <td className={`${TD} text-right`}>{formatUsd(r.ceiling_micro)}</td>
              <td className={`${TD} text-right text-red-500`}>{formatAge(r.age_minutes)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

export function ClawbacksTable({ rows }: { rows: MentorAdminSummary["clawbacks"] }) {
  if (rows.length === 0) return <Empty>No clawbacks (refunds or disputes on mentor payments).</Empty>;
  return (
    <TableWrap>
      <table className="w-full text-xs">
        <thead className="bg-[var(--mp-surface-sunken)]">
          <tr className="text-left">
            <th className={TH}>When (UTC)</th>
            <th className={TH}>Package</th>
            <th className={TH}>User id</th>
            <th className={TH}>Lot</th>
            <th className={`${TH} text-right`}>Clawed back</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.lot_id} className="border-t border-[var(--mp-border-subtle)] text-[var(--mp-fg)]">
              <td className={`${TD} font-mono`}>{r.at.slice(0, 16).replace("T", " ")}</td>
              <td className={TD}>{PACKAGE_LABEL[r.package_id] ?? r.package_id}</td>
              <td className={`${TD} font-mono`} title={r.user_id}>
                {shortId(r.user_id)}
              </td>
              <td className={`${TD} font-mono`} title={r.lot_id}>
                {shortId(r.lot_id)}
              </td>
              <td className={`${TD} text-right`}>
                {formatCredits(r.clawed_micro)} <span className="text-[var(--mp-fg-muted)]">cr</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}
