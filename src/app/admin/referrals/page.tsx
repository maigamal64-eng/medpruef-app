"use client";

/**
 * /admin/referrals — payout queue + mark-paid action.
 *
 * §2.4 — mark-paid with txid input + 2-step confirm + audit log.
 *
 * Polish pass (Apr 23):
 *   - Days-in-hold column, sorted ascending (oldest first)
 *   - Currency via Intl.NumberFormat('de-AT', { currency: 'EUR' })
 *   - Bulk select + bulk Mark Paid with single 2-step confirm
 *   - Status dots + tabular-nums throughout
 */

import { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  FormatEuro,
  StatusDot,
  formatEuroFromCents,
  formatInt,
} from "../_components/primitives";

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
  referrer: {
    email: string | null;
    first_name: string | null;
    payout_method: string | null;
  } | null;
  referee: { email: string | null; first_name: string | null } | null;
}

export default function AdminReferralsPage() {
  const toast = useToast();
  const [status, setStatus] = useState<Status>("qualified");
  const [items, setItems] = useState<ReferralRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [target, setTarget] = useState<ReferralRow | null>(null);
  const [txid, setTxid] = useState("");
  const [notes, setNotes] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [processing, setProcessing] = useState(false);

  // Bulk-paid dialog state
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [bulkNotes, setBulkNotes] = useState("");

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

  // Reset selection whenever the filter changes
  useEffect(() => {
    setSelected(new Set());
  }, [status]);

  // Sort by hold-expires-at ASC (oldest first — they're most at risk).
  // Fallback to qualified_at for rows without a hold.
  const sorted = useMemo(() => {
    const arr = [...items];
    arr.sort((a, b) => {
      const aTs =
        (a.hold_expires_at && new Date(a.hold_expires_at).getTime()) ||
        (a.qualified_at && new Date(a.qualified_at).getTime()) ||
        Number.MAX_SAFE_INTEGER;
      const bTs =
        (b.hold_expires_at && new Date(b.hold_expires_at).getTime()) ||
        (b.qualified_at && new Date(b.qualified_at).getTime()) ||
        Number.MAX_SAFE_INTEGER;
      return aTs - bTs;
    });
    return arr;
  }, [items]);

  const payableSelected = useMemo(
    () => sorted.filter((r) => selected.has(r.id) && r.status === "qualified"),
    [sorted, selected]
  );
  const bulkTotalCents = payableSelected.reduce(
    (n, r) => n + (r.reward_credit_cents || 0),
    0
  );

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
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(target.id);
        return next;
      });
      load(status);
    } catch (e) {
      toast.error((e as Error).message || "Could not mark paid");
    } finally {
      setProcessing(false);
    }
  }

  async function submitBulk() {
    if (!bulkConfirming) {
      setBulkConfirming(true);
      return;
    }
    if (payableSelected.length === 0) return;
    setProcessing(true);
    let ok = 0;
    let fail = 0;
    for (const r of payableSelected) {
      try {
        const res = await fetch("/api/admin/referrals/mark-paid", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            referral_id: r.id,
            notes: bulkNotes.trim() || undefined,
          }),
        });
        if (res.ok) ok++;
        else fail++;
      } catch {
        fail++;
      }
    }
    setProcessing(false);
    setBulkOpen(false);
    setBulkConfirming(false);
    setBulkNotes("");
    setSelected(new Set());
    if (fail === 0) {
      toast.success(
        `Marked ${formatInt(ok)} ${ok === 1 ? "referral" : "referrals"} paid`
      );
    } else {
      toast.error(`${ok} paid · ${fail} failed — check audit log`);
    }
    load(status);
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    const qualifiedIds = sorted
      .filter((r) => r.status === "qualified")
      .map((r) => r.id);
    if (qualifiedIds.every((id) => selected.has(id))) {
      setSelected(new Set());
    } else {
      setSelected(new Set(qualifiedIds));
    }
  }

  return (
    <AdminPageShell
      title="Referrals"
      description="Payout queue. Oldest holds first — mark paid after the Wise/USDT transfer lands."
      freshness={loading ? "cached" : "live"}
      onRefresh={() => load(status)}
      actions={
        <div className="flex items-center gap-2">
          {payableSelected.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setBulkConfirming(false);
                setBulkOpen(true);
              }}
              className="mp-btn mp-btn--primary mp-btn--sm flex items-center gap-1"
            >
              Mark {formatInt(payableSelected.length)} paid ·{" "}
              {formatEuroFromCents(bulkTotalCents)}
            </button>
          )}
          <div className="mp-tabs" role="tablist">
            {(["qualified", "pending", "rewarded", "all"] as Status[]).map(
              (s) => (
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
              )
            )}
          </div>
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
      ) : sorted.length === 0 ? (
        <EmptyState
          tone="success"
          icon={<CheckCircle2 className="w-10 h-10" aria-hidden />}
          title={
            status === "qualified"
              ? "No referrals awaiting payout"
              : "No referrals in this filter"
          }
          body="Qualified referrals appear here once the referee's first subscription activates."
        />
      ) : (
        <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] overflow-hidden">
          <table className="w-full text-xs tabular-nums">
            <thead className="bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)] uppercase text-[10px] tracking-wider">
              <tr>
                <th className="text-left px-3 py-2 w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all qualified referrals"
                    checked={
                      payableSelected.length > 0 &&
                      payableSelected.length ===
                        sorted.filter((r) => r.status === "qualified").length
                    }
                    onChange={toggleSelectAll}
                    disabled={
                      sorted.filter((r) => r.status === "qualified").length ===
                      0
                    }
                  />
                </th>
                <th className="text-left px-3 py-2">Hold expires</th>
                <th className="text-left px-3 py-2">Days in hold</th>
                <th className="text-left px-3 py-2">Referrer</th>
                <th className="text-left px-3 py-2">Referee</th>
                <th className="text-left px-3 py-2">Payout method</th>
                <th className="text-right px-3 py-2">Reward</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-right px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const daysInHold = daysBetween(
                  r.qualified_at || r.created_at,
                  new Date().toISOString()
                );
                const holdOverdue =
                  r.hold_expires_at &&
                  new Date(r.hold_expires_at).getTime() < Date.now() &&
                  r.status === "qualified";
                return (
                  <tr
                    key={r.id}
                    className={`border-t border-[var(--mp-border-subtle)] text-[var(--mp-fg)] ${
                      selected.has(r.id)
                        ? "bg-[var(--mp-viridian)]/5"
                        : ""
                    }`}
                  >
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Select referral ${r.id}`}
                        checked={selected.has(r.id)}
                        onChange={() => toggleSelect(r.id)}
                        disabled={r.status !== "qualified"}
                      />
                    </td>
                    <td className="px-3 py-2 text-[var(--mp-fg-muted)] font-mono text-[10px]">
                      {r.hold_expires_at ? (
                        <span
                          className={
                            holdOverdue
                              ? "text-[var(--mp-error)] font-semibold"
                              : ""
                          }
                        >
                          {new Date(r.hold_expires_at).toLocaleString("de-AT", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                          {holdOverdue && " · overdue"}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <StatusDot
                          tone={
                            daysInHold == null
                              ? "neutral"
                              : daysInHold >= 30
                                ? "danger"
                                : daysInHold >= 14
                                  ? "warn"
                                  : "success"
                          }
                          size={6}
                        />
                        <span className="font-mono tabular-nums">
                          {daysInHold != null ? `${daysInHold}d` : "—"}
                        </span>
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">
                        {r.referrer?.first_name || "—"}
                      </div>
                      <div className="text-[var(--mp-fg-muted)]">
                        {r.referrer?.email}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">
                        {r.referee?.first_name || "—"}
                      </div>
                      <div className="text-[var(--mp-fg-muted)]">
                        {r.referee?.email}
                      </div>
                    </td>
                    <td className="px-3 py-2 font-mono text-[10px]">
                      {r.referrer?.payout_method || (
                        <span className="text-[var(--mp-status-warning)]">
                          not set
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      <FormatEuro cents={r.reward_credit_cents} />
                    </td>
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <StatusDot
                          tone={
                            r.status === "qualified"
                              ? "warn"
                              : r.status === "rewarded"
                                ? "success"
                                : "neutral"
                          }
                          size={6}
                        />
                        <span className="text-[10px] font-mono">
                          {r.status}
                        </span>
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
                            ? `Paid ${new Date(r.rewarded_at).toLocaleDateString(
                                "de-AT"
                              )}`
                            : "—"}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Single Mark-Paid Dialog ────────────────────────────── */}
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
            ? `Marking ${formatEuroFromCents(target.reward_credit_cents ?? 0)} referral paid to ${target.referrer?.email ?? "(unknown)"}`
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

      {/* ─── Bulk Mark-Paid Dialog ──────────────────────────────── */}
      <Dialog
        open={bulkOpen}
        onOpenChange={(o) => {
          if (!o) {
            setBulkOpen(false);
            setBulkConfirming(false);
            setBulkNotes("");
          }
        }}
        title={
          bulkConfirming
            ? `Confirm ${formatInt(payableSelected.length)} payouts`
            : `Bulk mark ${formatInt(payableSelected.length)} paid`
        }
        description={`Total: ${formatEuroFromCents(bulkTotalCents)} across ${formatInt(payableSelected.length)} referrals.`}
        footer={
          <DialogFooter>
            <button
              className="mp-btn mp-btn--secondary"
              onClick={() => {
                setBulkOpen(false);
                setBulkConfirming(false);
              }}
              disabled={processing}
            >
              Cancel
            </button>
            <button
              className="mp-btn mp-btn--primary"
              onClick={submitBulk}
              disabled={processing || payableSelected.length === 0}
            >
              {processing
                ? "Processing…"
                : bulkConfirming
                  ? `Confirm ${formatInt(payableSelected.length)} paid`
                  : "Continue"}
            </button>
          </DialogFooter>
        }
      >
        <div className="space-y-3">
          <Textarea
            label="Notes (applied to all)"
            rows={3}
            value={bulkNotes}
            onChange={(e) => setBulkNotes(e.target.value)}
            placeholder="e.g. April payout batch — Wise transfer ref 12345"
          />
          {bulkConfirming && (
            <Alert variant="warning" title="Batch destructive action">
              Every selected referral flips to <code>rewarded</code>. Each
              lands a separate <code>admin_audit_log</code> row. No txid
              field on bulk — record the batch reference in Notes.
            </Alert>
          )}
        </div>
      </Dialog>
    </AdminPageShell>
  );
}

function daysBetween(aIso: string | null, bIso: string | null): number | null {
  if (!aIso || !bIso) return null;
  const a = new Date(aIso).getTime();
  const b = new Date(bIso).getTime();
  if (!isFinite(a) || !isFinite(b)) return null;
  return Math.max(0, Math.floor((b - a) / (24 * 60 * 60 * 1000)));
}
