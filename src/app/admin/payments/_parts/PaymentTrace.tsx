"use client";

import { useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { SectionHeading } from "../../_components/primitives";
import { money, when } from "./types";

interface Trace {
  payment_id: string;
  found: boolean;
  payment: { gross_cents: number | null; net_cents: number | null; currency: string; paid_at: string; granted: boolean; user_id: string | null; plan_id: string | null; tier: string | null; failure_reasons: string[]; resolution: { kind: string; reason: string } | null } | null;
  refund: { amount_cents: number | null; currency: string; refunded_at: string; kind: string } | null;
  linkable_tier: string | null;
  events: Array<{ event: string; whop_event: string | null; reason: string | null; amount_cents: number | null; currency: string | null; user_id: string | null; matched: boolean | null; source: string | null; created_at: string }>;
  deliveries: Array<{ provider: string; result: string; error: string | null; received_at: string }>;
  claims: Array<{ provider: string; event_id: string; processed_at: string | null }>;
  subscriptions: Array<{ id: string; user_id: string | null; tier: string | null; status: string | null; started_at: string | null; expires_at: string | null }>;
  resolution: { kind: string; reason: string; created_at: string } | null;
}

/** Trace one payment end to end (ADM-02 A): events, deliveries, claims, rows. */
export function PaymentTrace({ initial }: { initial?: string }) {
  const [query, setQuery] = useState(initial ?? "");
  const [trace, setTrace] = useState<Trace | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (id: string) => {
    const paymentId = id.trim();
    if (!paymentId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/stats/admin/payments/trace?payment_id=${encodeURIComponent(paymentId)}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error || `Trace failed (HTTP ${res.status}).`);
      setTrace(body as Trace);
    } catch (e) {
      setError((e as Error).message);
      setTrace(null);
    } finally {
      setBusy(false);
    }
  };

  const p = trace?.payment;
  return (
    <section id="trace" className="scroll-mt-20 space-y-3">
      <SectionHeading title="Trace a payment" icon={Search} hint="Every record for one payment id" />
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => { e.preventDefault(); void run(query); }}
      >
        <label className="sr-only" htmlFor="payment-trace-id">Payment id</label>
        <input
          id="payment-trace-id"
          className="mp-field__input min-w-0 flex-1 font-mono text-xs"
          placeholder="pay_… or a refund id"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" className="mp-btn mp-btn--secondary mp-btn--sm" disabled={busy || !query.trim()} aria-busy={busy}>
          {busy ? "Tracing…" : "Trace"}
        </button>
      </form>
      {error && <p role="alert" className="text-xs text-[var(--mp-error)]">{error}</p>}
      {trace && !trace.found && (
        <p className="rounded-xl border border-dashed border-[var(--mp-border-subtle)] px-4 py-3 text-xs text-[var(--mp-fg-muted)]">
          Nothing recorded for {trace.payment_id}. Check the id in Whop; if Whop shows the payment, its webhook never reached us.
        </p>
      )}
      {trace && trace.found && (
        <div className="space-y-3 rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4 text-xs">
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {p && <>
              <Row k="Gross (charge)" v={money(p.gross_cents, p.currency)} />
              <Row k="Net after Whop fees" v={p.net_cents != null ? `${money(p.net_cents, p.currency)} (fee ${money((p.gross_cents ?? 0) - p.net_cents, p.currency)})` : "not reported by Whop"} />
              <Row k="Paid" v={when(p.paid_at)} />
              <Row k="Granted" v={p.granted ? "Yes" : p.resolution ? `No, resolved as ${p.resolution.kind.replace("_", " ")}` : "No"} />
              <Row k="Plan" v={`${p.plan_id ?? "unknown"}${trace.linkable_tier ? ` (${trace.linkable_tier})` : ""}`} />
              <Row k="Learner" v={p.user_id ? <Link className="text-[var(--mp-viridian)] underline" href={`/admin/users/${p.user_id}`}>{p.user_id}</Link> : "not tied to a learner"} />
              {p.failure_reasons.length > 0 && <Row k="Failure reasons" v={p.failure_reasons.join(", ")} />}
            </>}
            {trace.refund && <Row k={trace.refund.kind === "dispute" ? "Dispute" : "Refund"} v={`${money(trace.refund.amount_cents, trace.refund.currency)} on ${when(trace.refund.refunded_at)}`} />}
            {trace.resolution && <Row k="Resolution" v={`${trace.resolution.kind.replace("_", " ")}: ${trace.resolution.reason}`} />}
          </dl>
          <TraceList title={`Events (${trace.events.length})`} empty="No payment events.">
            {trace.events.map((e, i) => (
              <li key={i} className="flex flex-wrap gap-x-3">
                <span className="font-mono text-[var(--mp-fg-muted)]">{when(e.created_at)}</span>
                <span className="font-medium">{e.event}{e.whop_event ? ` (${e.whop_event})` : ""}</span>
                {e.amount_cents != null && <span className="font-mono">{money(e.amount_cents, (e.currency ?? "eur").toUpperCase())}</span>}
                {e.reason && <span className="font-mono text-[var(--mp-fg-muted)]">{e.reason}</span>}
                {e.source && <span className="text-[var(--mp-fg-muted)]">via {e.source}</span>}
              </li>
            ))}
          </TraceList>
          <TraceList title={`Webhook deliveries (${trace.deliveries.length})`} empty="No delivery recorded with this id.">
            {trace.deliveries.map((d, i) => (
              <li key={i} className="flex flex-wrap gap-x-3">
                <span className="font-mono text-[var(--mp-fg-muted)]">{when(d.received_at)}</span>
                <span>{d.provider} · {d.result}</span>
                {d.error && <span className="break-words text-[var(--mp-fg-muted)]">{d.error}</span>}
              </li>
            ))}
          </TraceList>
          <TraceList title={`Idempotency claims (${trace.claims.length})`} empty="No claim taken.">
            {trace.claims.map((c) => (
              <li key={c.event_id} className="flex flex-wrap gap-x-3"><span className="font-mono">{c.event_id}</span><span className="text-[var(--mp-fg-muted)]">{when(c.processed_at)}</span></li>
            ))}
          </TraceList>
          <TraceList title={`Subscription rows (${trace.subscriptions.length})`} empty="No subscription row carries this payment.">
            {trace.subscriptions.map((s) => (
              <li key={s.id} className="flex flex-wrap gap-x-3">
                <span>{s.tier ?? "no tier"} · {s.status}</span>
                <span className="text-[var(--mp-fg-muted)]">ends {s.expires_at ? s.expires_at.slice(0, 10) : "never"}</span>
                {s.user_id && <Link className="text-[var(--mp-viridian)] underline" href={`/admin/users/${s.user_id}`}>learner</Link>}
              </li>
            ))}
          </TraceList>
        </div>
      )}
    </section>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-wrap gap-x-2">
      <dt className="text-[var(--mp-fg-muted)]">{k}:</dt>
      <dd className="min-w-0 break-all font-medium text-[var(--mp-fg)]">{v}</dd>
    </div>
  );
}

function TraceList({ title, empty, children }: { title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--mp-fg-muted)]">{title}</p>
      {children.length === 0 ? <p className="text-[var(--mp-fg-muted)]">{empty}</p> : <ul className="space-y-1">{children}</ul>}
    </div>
  );
}
