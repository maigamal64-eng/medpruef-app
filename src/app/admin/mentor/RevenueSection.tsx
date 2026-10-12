"use client";
// a40 (MUX-98): mentor revenue next to cost. Read-only text tiles with units.
// Margin shows only once the Whop fee and USD to EUR rate are verified.
import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/authFetch";
import type { MentorRevenue } from "@/lib/mentor/admin/revenue";
import { formatCount, formatUsd } from "./format";

const CARD = "rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)]";

export function formatMoneyCents(cents: number, currency: string): string {
  const code = /^[A-Za-z]{3}$/.test(currency) ? currency.toUpperCase() : "EUR";
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: code }).format(cents / 100);
  } catch {
    return `${code} ${(cents / 100).toFixed(2)}`;
  }
}

const TONE_LABEL = { ok: "OK", warn: "Watch", danger: "Low" } as const;
const TONE_CLASS = { ok: "text-[var(--mp-fg)]", warn: "text-amber-700 dark:text-amber-400", danger: "text-red-700 dark:text-red-400" } as const;

function Tile({ label, value, sub, valueClass }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className={`${CARD} p-3.5`}>
      <div className="text-[10px] uppercase tracking-wider text-[var(--mp-fg-muted)]">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums break-words ${valueClass ?? "text-[var(--mp-fg)]"}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-[var(--mp-fg-muted)] tabular-nums">{sub}</div>}
    </div>
  );
}

export function RevenueTiles({ revenue }: { revenue: MentorRevenue }) {
  const net = revenue.by_currency.length
    ? revenue.by_currency.map((c) => formatMoneyCents(c.net_cents, c.currency)).join(" + ")
    : formatMoneyCents(0, "EUR");
  const grossLine = revenue.by_currency.length
    ? revenue.by_currency.map((c) => `${formatMoneyCents(c.gross_cents, c.currency)} from ${formatCount(c.payments)} payments, ${formatMoneyCents(c.refunded_cents, c.currency)} refunded`).join("; ")
    : "No mentor payments in the window";
  const m = revenue.margin;
  return (
    <div className="space-y-3" data-testid="mentor-revenue">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label={`Net revenue (${revenue.window_days} d)`} value={net} sub={grossLine} />
        <Tile
          label={`Margin (${revenue.window_days} d)`}
          value={m.available ? `${formatMoneyCents(m.margin_eur_cents, "EUR")}${m.margin_pct === null ? "" : `, ${m.margin_pct.toFixed(1)}%`} (${TONE_LABEL[m.tone]})` : "Unavailable"}
          valueClass={m.available ? TONE_CLASS[m.tone] : undefined}
          sub={m.available ? `After Whop fee ${formatMoneyCents(m.fee_eur_cents, "EUR")} and API cost ${formatMoneyCents(m.cost_eur_cents, "EUR")}` : m.reason}
        />
        <Tile label={`True API cost (${revenue.window_days} d)`} value={revenue.cost_micro === null ? "Unknown" : `${formatUsd(revenue.cost_micro)} USD`} sub={revenue.cost_micro === null ? "Daily cost rollup not readable" : "Settled plus house cost, Vienna days"} />
        <Tile label={`Pro-included cost (${revenue.window_days} d)`} value={`${formatUsd(revenue.pro_included.cost_micro)} USD`} sub={`Spent from ${formatCount(revenue.pro_included.lots)} included lots that started in the window; no extra revenue`} />
      </div>
      {revenue.by_package.length > 0 && (
        <ul className="space-y-1 text-sm" aria-label="Sold per package">
          {revenue.by_package.map((p) => (
            <li key={`${p.package_id}:${p.currency}`} className="tabular-nums">
              <strong>{p.package_id}</strong>: {formatMoneyCents(p.gross_cents, p.currency)} sold, {formatCount(p.payments)} payments
            </li>
          ))}
        </ul>
      )}
      {(revenue.payments_without_amount > 0 || revenue.refunds_without_amount > 0) && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          Not counted: {formatCount(revenue.payments_without_amount)} payments and {formatCount(revenue.refunds_without_amount)} clawbacks without an amount on record.
        </p>
      )}
      <p className="text-xs text-[var(--mp-fg-muted)]">Since {revenue.since} (Vienna). {revenue.basis}</p>
    </div>
  );
}

export function RevenueSection() {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "ok"; revenue: MentorRevenue } | { kind: "not_installed" } | { kind: "error" }>({ kind: "loading" });
  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const res = await authFetch("/api/mentor/admin/revenue");
      if (res.ok) { setState({ kind: "ok", revenue: (await res.json()) as MentorRevenue }); return; }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      setState(body.error === "ledger_not_applied" ? { kind: "not_installed" } : { kind: "error" });
    } catch {
      setState({ kind: "error" });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (state.kind === "loading") return <p className="text-sm text-[var(--mp-fg-muted)]">Loading revenue…</p>;
  if (state.kind === "not_installed") return <p className="text-sm text-[var(--mp-fg-muted)]">Revenue: not installed. The mentor ledger tables are not present yet.</p>;
  if (state.kind === "error") {
    return (
      <p role="alert" className="text-sm">
        Revenue could not load.{" "}
        <button type="button" onClick={() => void load()} className="min-h-11 underline">Retry</button>
      </p>
    );
  }
  return <RevenueTiles revenue={state.revenue} />;
}
