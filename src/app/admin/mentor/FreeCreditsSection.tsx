"use client";

/**
 * Free mentor credits (a-free-credit-hooks): campaign codes and the grant log.
 *  - Codes: create (revenue.manage), pause or resume, per code: redemptions
 *    total and today (Vienna), new accounts among redeemers, later payers.
 *  - Grants this Vienna month: every house-funded lot kind against its breaker
 *    (welcome) and the newest 50 lots (8-character account ids only).
 * Every flag is shown as it is; nothing here switches a flag.
 */

import { useCallback, useEffect, useState } from "react";
import { authFetch } from "@/lib/authFetch";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";
import type { CampaignStats } from "@/lib/mentor/credits/campaign";
import type { FreeGrantSummary } from "@/lib/mentor/credits/free-grants-admin";
import { formatCount } from "./format";

const KIND_LABEL: Record<string, string> = {
  welcome: "Welcome credits",
  campaign: "Campaign code",
  experience: "Experience reward",
  referral_first_charge: "Referral: first payment",
  referral_trial_start: "Referral: trial start",
  referral_exam: "Referral: exam reward lot",
  trial: "Card trial taste",
  free_taste: "Free taste (facts only)",
  included: "Pro and Cohort included",
};

const input = "min-h-11 rounded border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-2 text-sm";
const day = (iso: string) => iso.slice(0, 10);

export function FreeCreditsSection() {
  const { can } = useAdminPermissions();
  const canRead = can("revenue.read");
  const canManage = can("revenue.manage");
  const [codes, setCodes] = useState<{ installed: boolean; enabled: boolean; campaigns: CampaignStats[] } | null>(null);
  const [grants, setGrants] = useState<FreeGrantSummary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ code: "", label: "", credits: "100", expiry_days: "60", total_cap: "200", daily_cap: "50", ends_at: "", note: "" });

  const load = useCallback(async () => {
    if (!canRead) return;
    try {
      const [a, b] = await Promise.all([authFetch("/api/admin/mentor-campaigns"), authFetch("/api/admin/mentor-grants")]);
      if (!a.ok || !b.ok) throw new Error("Could not load free credit data. Retry.");
      setCodes(await a.json());
      setGrants(await b.json());
      setError("");
    } catch (e) { setError((e as Error).message); }
  }, [canRead]);
  useEffect(() => { void load(); }, [load]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const r = await authFetch("/api/admin/mentor-campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, ends_at: form.ends_at ? new Date(`${form.ends_at}T23:59:00`).toISOString() : "" }) });
      const body = (await r.json().catch(() => ({}))) as { error?: string; code?: string };
      if (!r.ok) setNotice(body.error ?? `Not created (HTTP ${r.status}).`);
      else { setNotice(`Created ${body.code}. Link: /gratis/${body.code}`); setForm((f) => ({ ...f, code: "", label: "", note: "" })); await load(); }
    } finally { setBusy(false); }
  };

  const toggle = async (code: string, active: boolean) => {
    setBusy(true);
    try {
      const r = await authFetch(`/api/admin/mentor-campaigns/${encodeURIComponent(code)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active }) });
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      setNotice(r.ok ? `${code} ${active ? "resumed" : "paused"}.` : body.error ?? `Not changed (HTTP ${r.status}).`);
      await load();
    } finally { setBusy(false); }
  };

  if (!canRead) return <p className="text-sm text-[var(--mp-fg-muted)]">Needs revenue.read.</p>;
  return (
    <div className="space-y-8" data-testid="admin-free-credits">
      {error && <p role="alert" className="text-sm text-[var(--mp-error-text)]">{error} <button type="button" className="underline min-h-11" onClick={() => void load()}>Retry</button></p>}
      {grants && (
        <section aria-labelledby="fc-flags" className="space-y-2">
          <h2 id="fc-flags" className="text-base font-semibold">Flags</h2>
          <ul className="flex flex-wrap gap-2 text-xs">
            {Object.entries(grants.flags).map(([k, v]) => <li key={k} className="rounded border border-[var(--mp-border-subtle)] px-2 py-1"><span className="font-mono">{k}</span>: <strong>{String(v)}</strong></li>)}
          </ul>
        </section>
      )}

      <section aria-labelledby="fc-codes" className="space-y-3">
        <h2 id="fc-codes" className="text-base font-semibold">Campaign codes</h2>
        {codes && !codes.installed && <p className="text-sm">Not installed: the a-free-credit-hooks changeset (20270102090000) is not applied.</p>}
        {codes && codes.installed && !codes.enabled && <p className="text-sm text-[var(--mp-fg-muted)]">MENTOR_CAMPAIGN_CODES_ENABLED is off: links show the neutral page and nothing can be redeemed.</p>}
        {codes?.installed && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="text-left text-xs text-[var(--mp-fg-muted)]"><th className="py-2 pr-3">Code</th><th className="pr-3">Credits / days</th><th className="pr-3">Redeemed (today)</th><th className="pr-3">Caps total / day</th><th className="pr-3">New accounts</th><th className="pr-3">Payers after</th><th className="pr-3">Ends</th><th>State</th></tr></thead>
              <tbody>
                {codes.campaigns.length === 0 && <tr><td colSpan={8} className="py-3 text-[var(--mp-fg-muted)]">No codes yet.</td></tr>}
                {codes.campaigns.map((c) => (
                  <tr key={c.code} className="border-t border-[var(--mp-border-subtle)]">
                    <td className="py-2 pr-3"><span className="font-mono font-semibold">{c.code}</span><br /><span className="text-xs text-[var(--mp-fg-muted)]">{c.label}</span></td>
                    <td className="pr-3">{c.credits} / {c.expiry_days}</td>
                    <td className="pr-3">{formatCount(c.redeemed_total)} ({formatCount(c.redeemed_today)})</td>
                    <td className="pr-3">{c.total_cap} / {c.daily_cap}</td>
                    <td className="pr-3">{formatCount(c.new_accounts)}</td>
                    <td className="pr-3">{formatCount(c.payers)}</td>
                    <td className="pr-3">{day(c.ends_at)}</td>
                    <td>{c.live ? "Live" : c.active ? "Not live" : "Paused"} {canManage && <button type="button" disabled={busy} className="ml-2 min-h-11 underline" onClick={() => void toggle(c.code, !c.active)}>{c.active ? "Pause" : "Resume"}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {canManage && codes?.installed && (
          <form onSubmit={create} className="grid gap-2 sm:grid-cols-4" aria-label="Create a campaign code">
            <label className="text-xs">Code<input required className={`${input} mt-1 w-full font-mono uppercase`} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="TG-SPT" /></label>
            <label className="text-xs sm:col-span-3">Label (admin only)<input required className={`${input} mt-1 w-full`} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Telegram SPT group, Oct 2026" /></label>
            <label className="text-xs">Credits<input type="number" min={1} max={1000} className={`${input} mt-1 w-full`} value={form.credits} onChange={(e) => setForm({ ...form, credits: e.target.value })} /></label>
            <label className="text-xs">Valid days<input type="number" min={1} max={180} className={`${input} mt-1 w-full`} value={form.expiry_days} onChange={(e) => setForm({ ...form, expiry_days: e.target.value })} /></label>
            <label className="text-xs">Total cap<input type="number" min={1} className={`${input} mt-1 w-full`} value={form.total_cap} onChange={(e) => setForm({ ...form, total_cap: e.target.value })} /></label>
            <label className="text-xs">Daily cap<input type="number" min={1} className={`${input} mt-1 w-full`} value={form.daily_cap} onChange={(e) => setForm({ ...form, daily_cap: e.target.value })} /></label>
            <label className="text-xs">Ends on<input required type="date" className={`${input} mt-1 w-full`} value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} /></label>
            <label className="text-xs sm:col-span-2">Note<input className={`${input} mt-1 w-full`} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
            <div className="flex items-end"><button type="submit" disabled={busy} className="mp-btn mp-btn--primary min-h-11 w-full">Create code</button></div>
          </form>
        )}
        {notice && <p role="status" className="text-sm">{notice}</p>}
      </section>

      {grants && (
        <section aria-labelledby="fc-grants" className="space-y-3">
          <h2 id="fc-grants" className="text-base font-semibold">Grants since {day(grants.month_start)} (Vienna month)</h2>
          {grants.truncated && <p className="text-sm">More than 5,000 lots this month; counts are a lower bound.</p>}
          <ul className="grid gap-2 sm:grid-cols-3">
            {Object.entries(grants.counts).map(([k, v]) => (
              <li key={k} className="rounded border border-[var(--mp-border-subtle)] p-3 text-sm">
                <div className="text-xs text-[var(--mp-fg-muted)]">{KIND_LABEL[k] ?? k}</div>
                <div className="font-semibold">{formatCount(v.lots)} lots, {formatCount(v.credits)} credits</div>
                {k === "welcome" && <div className="text-xs text-[var(--mp-fg-muted)]">Breaker: {formatCount(grants.caps.welcome)} a month</div>}
              </li>
            ))}
          </ul>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="text-left text-xs text-[var(--mp-fg-muted)]"><th className="py-2 pr-3">Kind</th><th className="pr-3">Account</th><th className="pr-3">Credits</th><th className="pr-3">Granted</th><th className="pr-3">Expires</th><th>Status</th></tr></thead>
              <tbody>
                {grants.recent.length === 0 && <tr><td colSpan={6} className="py-3 text-[var(--mp-fg-muted)]">No free credit grants this month.</td></tr>}
                {grants.recent.map((g, i) => (
                  <tr key={`${g.account}-${g.created_at}-${i}`} className="border-t border-[var(--mp-border-subtle)]">
                    <td className="py-2 pr-3">{KIND_LABEL[g.kind] ?? g.kind}</td><td className="pr-3 font-mono">{g.account}</td><td className="pr-3">{g.credits}</td><td className="pr-3">{day(g.created_at)}</td><td className="pr-3">{day(g.expires_at)}</td><td>{g.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
