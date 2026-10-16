"use client";
/**
 * Guarantee Ticket renewal queue (a-pricing-v2). One card per request: the
 * proof (5-minute signed link, or the learner's https link), the ticket end
 * the decision compares against, renewals used out of two, Approve (adds 12
 * months, compare-and-set) and Deny (reason required). English admin copy.
 * Proof files disappear 30 days after the decision (cron pricing-v2).
 */
import { useCallback, useEffect, useState } from "react";
import { authFetch as fetch } from "@/lib/authFetch";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";
import { Alert, BrandedLoader } from "@/components/ui";
import { AdminPageShell } from "../_components/AdminPageShell";
import { UserLink } from "../_components/UserLink";

type Status = "pending" | "approved" | "denied";
interface Item {
  id: string;
  user_id: string;
  kind: "failed_result" | "booked_sitting";
  status: Status;
  note: string | null;
  sitting_date: string | null;
  proof_link: string | null;
  proof_url: string | null;
  proof_deleted: boolean;
  created_at: string;
  decided_at: string | null;
  decision_reason: string | null;
  new_expires_at: string | null;
  ticket_expires_at: string | null;
  renewals_used: number;
  max_renewals: number;
  learner: string | null;
}

const linkHost = (url: string) => { try { return new URL(url).host; } catch { return "invalid link"; } };
const fmt = (iso: string | null) => iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Vienna" }).format(new Date(iso)) : "unknown";

export default function TicketRenewalsPage() {
  const { can, loading: accessLoading } = useAdminPermissions();
  const [status, setStatus] = useState<Status>("pending");
  const [items, setItems] = useState<Item[]>([]);
  const [available, setAvailable] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});

  const load = useCallback(async (s: Status) => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/admin/ticket-renewals?status=${s}`, { timeoutMs: 15_000 });
      const d = await r.json().catch(() => null);
      if (!r.ok || !d) throw new Error(d?.error ?? `HTTP ${r.status}`);
      setAvailable(d.available !== false);
      setItems(Array.isArray(d.items) ? d.items : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the queue");
    }
    setLoading(false);
  }, []);
  useEffect(() => { if (!accessLoading && can("revenue.read")) void load(status); }, [accessLoading, can, load, status]);

  const decide = async (item: Item, decision: "approve" | "deny") => {
    const reason = (reasons[item.id] ?? "").trim();
    if (decision === "deny" && reason.length < 3) { setMessage("Give a reason (3 to 500 characters) to deny."); return; }
    if (decision === "approve" && !window.confirm(`Approve one renewal year for this ticket? The end moves from ${fmt(item.ticket_expires_at)} by 12 months.`)) return;
    setBusy(item.id); setMessage(null);
    try {
      const r = await fetch("/api/admin/ticket-renewals", {
        method: "POST", headers: { "content-type": "application/json" }, timeoutMs: 15_000,
        body: JSON.stringify({ request_id: item.id, decision, reason: reason || undefined, expected_expires_at: item.ticket_expires_at }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) setMessage(d?.error ?? `Failed (HTTP ${r.status})`);
      else setMessage(decision === "approve" ? `Approved. New end: ${fmt(d?.result?.new_expires_at ?? null)}.` : "Denied.");
      await load(status);
    } catch {
      setMessage("Network error: nothing was confirmed. Reload before deciding again.");
    }
    setBusy(null);
  };

  if (accessLoading) return <div className="p-6"><BrandedLoader size={40} label="Checking access…" /></div>;
  if (!can("revenue.read")) return <div className="p-6"><Alert variant="error" title="Access not available">Your admin role does not include permission to view ticket renewals.</Alert></div>;
  const canDecide = can("revenue.manage");

  return (
    <AdminPageShell
      title="Ticket renewals"
      description="Guarantee Ticket renewal on proof: a failed official result, or a registration for a sitting after the ticket ends. At most two renewal years per ticket."
      loadState={{ loading, error }}
      onRefresh={() => load(status)}
      actions={
        <div className="mp-tabs" role="tablist">
          {(["pending", "approved", "denied"] as Status[]).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={status === s} className="mp-tabs__tab min-h-11" onClick={() => setStatus(s)}>
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      }
    >
      {!available && <Alert variant="warning" title="Not set up yet">The 20270103090000 changeset is not applied, so there is no queue.</Alert>}
      {message && <p role="status" className="mp-card p-3 text-sm">{message}</p>}
      {error && <Alert variant="error" title="Could not load">{error}</Alert>}
      {!loading && !error && available && items.length === 0 && <p className="text-sm text-[var(--mp-fg-muted)]">Nothing here.</p>}
      <ul className="space-y-3 m-0 p-0 list-none">
        {items.map((item) => (
          <li key={item.id} className="mp-card p-4 space-y-2 text-sm" data-ticket-request={item.id}>
            <div className="flex flex-wrap items-center gap-2">
              <strong>{item.kind === "failed_result" ? "Failed result" : "Booked sitting"}</strong>
              <span className="text-[var(--mp-fg-muted)]">submitted {fmt(item.created_at)}</span>
              <UserLink id={item.user_id} label={item.learner ?? undefined} />
            </div>
            <p className="m-0">Ticket ends {fmt(item.ticket_expires_at)} · renewals used {item.renewals_used} of {item.max_renewals}{item.sitting_date ? ` · booked sitting ${fmt(item.sitting_date)}` : ""}</p>
            {item.note && <p className="m-0 text-[var(--mp-fg-muted)]">Note: {item.note}</p>}
            <p className="m-0">
              {item.proof_url ? <a className="underline min-h-11 inline-flex items-center" href={item.proof_url} target="_blank" rel="noopener noreferrer">Open proof file (link valid 5 minutes)</a>
                : item.proof_link ? <a className="underline min-h-11 inline-flex items-center break-all" href={item.proof_link} target="_blank" rel="noopener noreferrer nofollow">Open learner link ({linkHost(item.proof_link)})</a>
                : item.proof_deleted ? <span className="text-[var(--mp-fg-muted)]">Proof file deleted after the retention period.</span>
                : <span className="text-[var(--mp-fg-muted)]">No proof link available.</span>}
            </p>
            {item.status !== "pending" && <p className="m-0 text-[var(--mp-fg-muted)]">{item.status} {fmt(item.decided_at)}{item.new_expires_at ? ` · new end ${fmt(item.new_expires_at)}` : ""}{item.decision_reason ? ` · ${item.decision_reason}` : ""}</p>}
            {item.status === "pending" && canDecide && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <label className="flex-1">
                  <span className="block text-xs text-[var(--mp-fg-muted)]">Reason (required to deny, shown to the learner)</span>
                  <input className="mp-field w-full min-h-11" maxLength={500} value={reasons[item.id] ?? ""} onChange={(e) => setReasons((r) => ({ ...r, [item.id]: e.target.value }))} />
                </label>
                <button type="button" className="mp-btn mp-btn--success min-h-11" aria-disabled={busy !== null} disabled={busy !== null || item.renewals_used >= item.max_renewals} onClick={() => void decide(item, "approve")}>Approve 12 months</button>
                <button type="button" className="mp-btn mp-btn--destructive min-h-11" aria-disabled={busy !== null} disabled={busy !== null} onClick={() => void decide(item, "deny")}>Deny</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </AdminPageShell>
  );
}
