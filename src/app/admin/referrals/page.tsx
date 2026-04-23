"use client";

/**
 * /admin/referrals — payout queue + mark-paid action.
 *
 * §2.4 — mark-paid with txid input + 2-step confirm + audit log.
 */

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { useAdminRealtime } from "@/lib/admin/useAdminRealtime";
import {
  Alert,
  BrandedLoader,
  Dialog,
  DialogFooter,
  EmptyState,
  TextField,
  Textarea,
  useToast,
} from "@/components/ui";
import { AdminPageShell } from "../_components/AdminPageShell";

type Status = "pending" | "qualified" | "rewarded" | "all";

interface ReferralRow {
  id: string;
  referrer_user_id: string | null;
  referee_user_id: string | null;
  referral_code: string;
  status: string;
  reward_credit_cents: number | null;
  qualified_at: string | null;
  rewarded_at: string | null;
  created_at: string | null;
  hold_expires_at: string | null;
  hold_reason: string | null;
  referrer: { email: string | null; first_name: string | null; payout_method: string | null } | null;
  referee: { email: string | null; first_name: string | null } | null;
}

export default function AdminReferralsPage() {
  const toast = useToast();
  const [status, setStatus] = useState<Status>("qualified");
  const [items, setItems] = useState<ReferralRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [target, setTarget] = useState<ReferralRow | null>(null);
  const [txid, setTxid] = useState("");
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [processing, setProcessing] = useState(false);

  const load = useCallback(
    async (s: Status) => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/admin/referrals?status=${s}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setItems(data.items || []);
      } catch (e) {
        setError((e as Error).message || "Failed to load referrals");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    load(status);
  }, [status, load]);

  useAdminRealtime("referrals", {
    onEvent: () => load(status),
  });

  async function submitMarkPaid() {
    if (!target) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setProcessing(true);
    try {
      const res = await fetch("/api/admin/referrals/mark-paid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referral_id: target.id,
          txid: txid.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Mark-paid failed");
      toast.success("Referral marked paid");
      setTarget(null);
      setTxid("");
      setNotes("");
      setConfirming(false);
      load(status);
    } catch (e) {
      toast.error((e as Error).message || "Could not mark paid");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <AdminPageShell
      title="Referrals"
      description="Payout queue for qualified referrals. Mark paid after the transfer completes."
      freshness={loading ? "cached" : "live"}
      onRefresh={() => load(status)}
      actions={
        <div className="mp-tabs" role="tablist">
          {(["qualified", "pending", "rewarded", "all"] as Status[]).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={status === s}
              onClick={() => setStatus(s)}
              className={`mp-tabs__tab ${status === s ? "mp-tabs__tab--active" : ""}`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      }
    >
      {error && (
        <Alert variant="error" title="Failed to load">
          {error}
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <BrandedLoader size={48} label="Loading referrals…" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          tone="success"
          icon={<CheckCircle2 className="w-10 h-10" aria-hidden />}
          title={status === "qualified" ? "No referrals awaiting payout" : "No referrals in this filter"}
          body="Qualified referrals appear here once the referee's first subscription activates."
        />
      ) : (
        <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] overflow-hidden">
          <table className="w-full text-xs tabular-nums">
            <thead className="bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)] uppercase text-[10px] tracking-wider">
              <tr>
                <th className="text-left px-3 py-2">Qualified</th>
                <th className="text-left px-3 py-2">Referrer</th>
                <th className="text-left px-3 py-2">Referee</th>
                <th className="text-left px-3 py-2">Payout method</th>
                <th className="text-right px-3 py-2">Reward</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-[var(--mp-border-subtle)] text-[var(--mp-fg)]"
                >
                  <td className="px-3 py-2 text-[var(--mp-fg-muted)] font-mono text-[10px]">
                    {r.qualified_at
                      ? new Date(r.qualified_at).toLocaleString()
                      : "—"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.referrer?.first_name || "—"}</div>
                    <div className="text-[var(--mp-fg-muted)]">{r.referrer?.email}</div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.referee?.first_name || "—"}</div>
                    <div className="text-[var(--mp-fg-muted)]">{r.referee?.email}</div>
                  </td>
                  <td className="px-3 py-2 font-mono text-[10px]">
                    {r.referrer?.payout_method || "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    €{((r.reward_credit_cents ?? 0) / 100).toFixed(2)}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border font-mono ${
                        r.status === "qualified"
                          ? "border-amber-500/40 text-amber-500"
                          : r.status === "rewarded"
                            ? "border-emerald-500/40 text-emerald-500"
                            : "border-[var(--mp-border-subtle)] text-[var(--mp-fg-muted)]"
                      }`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    {r.status === "qualified" ? (
                      <button
                        type="button"
                        className="mp-btn mp-btn--primary mp-btn--sm"
                        onClick={() => {
                          setTarget(r);
                          setTxid("");
                          setNotes("");
                          setConfirming(false);
                        }}
                      >
                        Mark paid
                      </button>
                    ) : (
                      <span className="text-[10px] text-[var(--mp-fg-muted)]">
                        {r.rewarded_at
                          ? `Paid ${new Date(r.rewarded_at).toLocaleDateString()}`
                          : "—"}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={!!target}
        onOpenChange={(o) => {
          if (!o) {
            setTarget(null);
            setConfirming(false);
            setTxid("");
            setNotes("");
          }
        }}
        title={confirming ? "Confirm payout" : "Record payout"}
        description={
          target
            ? `Marking €${((target.reward_credit_cents ?? 0) / 100).toFixed(2)} referral paid to ${target.referrer?.email ?? "(unknown)"}`
            : undefined
        }
        footer={
          <DialogFooter>
            <button
              className="mp-btn mp-btn--secondary"
              onClick={() => {
                setTarget(null);
                setConfirming(false);
              }}
              disabled={processing}
            >
              Cancel
            </button>
            <button
              className="mp-btn mp-btn--primary"
              onClick={submitMarkPaid}
              disabled={processing}
            >
              {processing
                ? "Recording…"
                : confirming
                  ? "Confirm mark paid"
                  : "Continue"}
            </button>
          </DialogFooter>
        }
      >
        {target && (
          <div className="space-y-3">
            <TextField
              label="Transaction ID"
              value={txid}
              onChange={(e) => setTxid(e.target.value)}
              placeholder="e.g. 0xabc… or Wise ref"
              helper="Optional — but strongly recommended for audit trail."
            />
            <Textarea
              label="Notes"
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything worth remembering"
            />
            {confirming && (
              <Alert variant="warning" title="Destructive action">
                This flips status to <code>rewarded</code> and stamps{" "}
                <code>rewarded_at</code>. The action is logged in{" "}
                <code>admin_audit_log</code>. Click Confirm to proceed.
              </Alert>
            )}
          </div>
        )}
      </Dialog>
    </AdminPageShell>
  );
}
