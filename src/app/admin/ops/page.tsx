"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";
import { AdminPageShell } from "../_components/AdminPageShell";

interface OpsAction {
  id: string;
  operation: string;
  status: string;
  payload: Record<string, unknown>;
  payload_hash: string;
  target_hash: string;
  predicted_effect: unknown;
  expires_at: string;
  created_at: string;
  principal_id: string;
}

export default function OpsApprovalsPage() {
  const access = useAdminPermissions();
  const isOwner = access.roles.some((role) => role.key === "owner");
  const allowed = !access.loading && !access.error && isOwner && access.can("users.entitlements.write");
  const [actions, setActions] = useState<OpsAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    if (!allowed) { setActions([]); return; }
    setLoading(true);
    setError(null);
    try {
      const response = await authFetch("/api/admin/ops/actions", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load Ops actions.");
      if (!Array.isArray(data.actions)) throw new Error("Ops action response is invalid.");
      setActions(data.actions);
    } catch (cause) {
      setActions([]);
      setError(cause instanceof Error ? cause.message : "Ops actions could not be loaded.");
    } finally { setLoading(false); }
  }, [allowed]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);

  async function decide(action: OpsAction, decision: "approve" | "reject") {
    if (!allowed || busy) return;
    setBusy(action.id);
    setError(null);
    setNotice(null);
    try {
      const response = await authFetch(`/api/admin/ops/actions/${action.id}/${decision}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload_hash: action.payload_hash }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Decision could not be saved.");
      if (data.action?.id !== action.id || data.action?.status !== (decision === "approve" ? "approved" : "rejected")) {
        throw new Error("Decision outcome could not be verified. Refresh before trying again.");
      }
      setNotice(decision === "approve" ? "Approval recorded. Execution is a separate agent action, subject to current permissions and target checks." : "Action rejected.");
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Decision failed. Refresh to check the action state.");
    } finally { setBusy(null); }
  }

  return (
    <AdminPageShell title="Ops approvals" description="Review the exact entitlement change prepared by a registered agent." freshness={error || !allowed ? "disconnected" : "near-live"} onRefresh={allowed && !busy ? () => void load() : undefined}>
      <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4 flex gap-3">
        <ShieldCheck size={22} className="shrink-0 text-[var(--mp-viridian)]" />
        <p className="text-sm text-[var(--mp-fg-muted)]">Only a current owner can approve. Approval covers this immutable payload until its expiry. It authorizes one execution and does not immediately change learner access.</p>
      </div>
      {access.loading && <p role="status" className="text-sm text-[var(--mp-fg-muted)]">Checking owner access…</p>}
      {!access.loading && !allowed && <p role="alert" className="text-sm text-[var(--mp-fg-muted)]">{access.error ?? "Owner role and entitlement permission are required."}</p>}
      {error && <p role="alert" className="rounded-lg border border-red-500/30 p-3 text-sm text-[var(--mp-fg)]">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-[var(--mp-viridian)] p-3 text-sm text-[var(--mp-fg)]">{notice}</p>}
      {loading && <p role="status" className="text-sm text-[var(--mp-fg-muted)]">Loading review queue…</p>}
      {allowed && !loading && !error && actions.length === 0 && <p className="text-sm text-[var(--mp-fg-muted)]">No prepared actions are available for review.</p>}
      {allowed && actions.map((action) => {
        const expires = Date.parse(action.expires_at);
        const reviewable = ["prepared", "approved"].includes(action.status) && Number.isFinite(expires) && expires > now;
        return (
          <article key={action.id} className="overflow-hidden rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)]">
            <div className="p-4 sm:p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div><h2 className="font-semibold text-[var(--mp-fg)]">{action.operation}</h2><p className="text-xs text-[var(--mp-fg-muted)] break-all">Action {action.id}</p></div>
                <span className="rounded border border-[var(--mp-border-subtle)] px-2 py-1 text-xs text-[var(--mp-fg)]">{action.status}{expires <= now ? " · expired" : ""}</span>
              </div>
              <dl className="grid gap-3 text-sm sm:grid-cols-2 text-[var(--mp-fg)]">
                <Field label="Target learner" value={String(action.payload.user_id ?? action.payload.feedback_id ?? "Unavailable")} />
                <Field label="Access days to add" value={String(action.payload.days ?? "Not applicable")} />
                <Field label="Reason" value={String(action.payload.reason ?? "Not provided")} />
                <Field label="Expires at" value={formatDate(action.expires_at)} />
                <Field label="Prepared at" value={formatDate(action.created_at)} />
                <Field label="Preparing principal" value={action.principal_id} />
              </dl>
              <div><p className="mb-1 text-xs text-[var(--mp-fg-muted)]">Expected effect</p><pre className="whitespace-pre-wrap break-all rounded-lg bg-[var(--mp-surface-sunken)] p-3 text-xs text-[var(--mp-fg)]">{JSON.stringify(action.predicted_effect, null, 2)}</pre></div>
              <details><summary className="cursor-pointer text-xs text-[var(--mp-fg-muted)]">Exact payload and approval fingerprints</summary><pre className="mt-2 whitespace-pre-wrap break-all rounded-lg bg-[var(--mp-surface-sunken)] p-3 text-xs text-[var(--mp-fg)]">{JSON.stringify(action.payload, null, 2)}</pre><p className="mt-2 break-all font-mono text-xs text-[var(--mp-fg-muted)]">Payload: {action.payload_hash}<br />Target state: {action.target_hash}</p></details>
              {reviewable && <div className="flex flex-wrap gap-2">{action.status === "prepared" && <button type="button" className="mp-btn mp-btn--primary mp-btn--sm" disabled={busy !== null || loading} onClick={() => void decide(action, "approve")}>{busy === action.id ? "Saving decision…" : "Approve this exact change"}</button>}<button type="button" className="mp-btn mp-btn--secondary mp-btn--sm" disabled={busy !== null || loading} onClick={() => void decide(action, "reject")}>Reject</button></div>}
            </div>
          </article>
        );
      })}
    </AdminPageShell>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs text-[var(--mp-fg-muted)]">{label}</dt><dd className="mt-1 break-words">{value}</dd></div>;
}
function formatDate(value: string): string { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toISOString() : "Invalid expiry"; }
