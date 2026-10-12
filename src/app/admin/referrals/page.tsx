"use client";

/**
 * /admin/referrals — payout queue + mark-paid action, plus (2026-07-11)
 * the pending exam-reward grants queue for the non-cash referral
 * mechanic (src/lib/referral-exam-reward.ts).
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
import { CheckCircle2, GraduationCap } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";
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
import { UserLink } from "../_components/UserLink";
import { ResponsiveTable } from "../_components/ResponsiveTable";
import {
  FormatEuro,
  StatusDot,
  formatEuroFromCents,
  formatInt,
} from "../_components/primitives";

type Status = "pending" | "qualified" | "rewarded" | "all";

interface PendingExamRewardReferee {
  referee_user_id: string | null;
  email: string | null;
  email_domain: string | null;
  signup_method: "email" | "telegram";
  signup_at: string | null;
  distinct_question_count: number;
  distinct_day_span: number;
  first_answer_at: string | null;
  last_answer_at: string | null;
  qualified_at: string | null;
  referral_row_status: string;
  card_trial_active: boolean;
  card_trial_activated_at: string | null;
  card_trial_tier: string | null;
}

interface PendingExamRewardItem {
  referrer_user_id: string;
  referrer_email: string | null;
  referrer_first_name: string | null;
  referrer_active_exam: string | null;
  qualified_referral_count: number;
  referees: PendingExamRewardReferee[];
}

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
  const { can, loading: accessLoading } = useAdminPermissions();
  const canRead = can("revenue.read");
  const canManage = can("revenue.manage");
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

  // Pending exam-reward grants queue (2026-07-11)
  const [examRewardItems, setExamRewardItems] = useState<PendingExamRewardItem[]>([]);
  const [examRewardLoading, setExamRewardLoading] = useState(true);
  const [examRewardError, setExamRewardError] = useState<string | null>(null);
  const [examRewardTarget, setExamRewardTarget] = useState<PendingExamRewardItem | null>(null);
  const [examRewardConfirming, setExamRewardConfirming] = useState(false);
  const [examRewardProcessing, setExamRewardProcessing] = useState(false);
  // Whether REFERRAL_REQUIRE_CARD_TRIAL is at its default (card
  // required) or set to 'false' (activity-only fallback). Defaults
  // true so the badge doesn't flash "not required" before the fetch
  // lands, matching the flag's own default-ON polarity.
  const [cardRequired, setCardRequired] = useState(true);

  const loadExamRewards = useCallback(async () => {
    if (!can("revenue.read")) return;
    setExamRewardLoading(true);
    setExamRewardError(null);
    try {
      const res = await fetch("/api/admin/referrals/pending-exam-rewards");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setExamRewardItems(data.items || []);
      setCardRequired(data.card_required !== false);
    } catch (e) {
      setExamRewardError((e as Error).message || "Failed to load pending rewards.");
    } finally {
      setExamRewardLoading(false);
    }
  }, [can]);

  useEffect(() => {
    if (accessLoading) return;
    if (canRead) void loadExamRewards();
    else setExamRewardLoading(false);
  }, [accessLoading, canRead, loadExamRewards]);

  async function submitExamRewardGrant() {
    if (!examRewardTarget || !canManage) return;
    if (!examRewardConfirming) {
      setExamRewardConfirming(true);
      return;
    }
    setExamRewardProcessing(true);
    try {
      const res = await fetch("/api/admin/referrals/grant-exam-reward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referrer_user_id: examRewardTarget.referrer_user_id }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Grant failed");
      if (body.granted) {
        toast.success(
          `Pro granted through ${body.new_expiry ? new Date(body.new_expiry).toLocaleDateString("de-AT") : "exam window"}`
        );
      } else {
        toast.error(`Not granted: ${body.reason || "unknown reason"}`);
      }
      setExamRewardTarget(null);
      setExamRewardConfirming(false);
      loadExamRewards();
    } catch (e) {
      toast.error((e as Error).message || "Could not grant reward");
    } finally {
      setExamRewardProcessing(false);
    }
  }

  const load = useCallback(
    async (s: Status) => {
      if (!can("revenue.read")) return;
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
    [can]
  );

  useEffect(() => {
    if (accessLoading) return;
    if (canRead) void load(status);
    else setLoading(false);
  }, [accessLoading, canRead, status, load]);

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
    if (!target || !canManage) return;
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
    if (!canManage) return;
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
      toast.error(`${ok} paid · ${fail} failed, check audit log`);
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
      description="Referral payout list returns up to 200 records and is not paginated. Verify the transfer in its provider before recording a payout."
      loadState={{ loading: loading || examRewardLoading, error: error || examRewardError }}
      onRefresh={() => load(status)}
      actions={
        <div className="flex items-center gap-2">
          {canManage && payableSelected.length > 0 && (
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
      {!accessLoading && !canRead && (
        <Alert variant="error" title="Access restricted">
          You do not have permission to view referral operations.
        </Alert>
      )}
      {canRead && <>
      {/* ─── Pending exam-reward grants (2026-07-11) ───────────────── */}
      <section className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <GraduationCap className="w-4 h-4 text-[var(--mp-viridian)]" aria-hidden />
          <h2 className="text-sm font-semibold text-[var(--mp-fg)]">
            Pending exam-reward grants
          </h2>
        </div>
        {examRewardError && (
          <Alert variant="error" title={examRewardItems.length ? "Showing saved reward results" : "Could not load reward queue"}>
            {examRewardError}
          </Alert>
        )}
        {examRewardLoading && examRewardItems.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <BrandedLoader size={32} label="Loading pending grants…" />
          </div>
        ) : examRewardError && examRewardItems.length === 0 ? (
          <div role="status" className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-4 py-6 text-sm text-[var(--mp-fg-muted)]">
            Pending reward queue is unavailable. The empty queue cannot be confirmed until the request succeeds.
          </div>
        ) : examRewardItems.length === 0 ? (
          <EmptyState
            tone="success"
            icon={<GraduationCap className="w-8 h-8" aria-hidden />}
            title="No pending exam-reward grants"
            body="A referrer appears here once 2 of their referees qualify by activity (>=20 distinct questions across >=2 distinct days)."
          />
        ) : (
          <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] overflow-hidden">
            <ResponsiveTable
              label="Pending exam-reward grants"
              testId="referrals-exam-rewards"
              rows={examRewardItems}
              rowKey={(item) => item.referrer_user_id}
              columns={[
                { key: "referrer", header: "Referrer", card: "title", cell: (item) => (
                  <>
                    <div className="font-medium">
                      <UserLink id={item.referrer_user_id} label={item.referrer_first_name || null} />
                    </div>
                    <div className="text-xs font-normal text-[var(--mp-fg-muted)]">{item.referrer_email || "--"}</div>
                  </>
                ) },
                { key: "exam", header: "Active exam", className: "font-mono text-[10px]", cell: (item) => item.referrer_active_exam || (
                  <span className="text-[var(--mp-status-warning)]">not set</span>
                ) },
                { key: "referees", header: "Qualified referees (farm signals)", cardLabel: "Qualified referees", cell: (item) => (
                          <ul className="space-y-1.5">
                            {item.referees.map((r) => (
                              <li
                                key={r.referee_user_id || r.email || Math.random()}
                                className="border border-[var(--mp-border-subtle)] rounded-lg px-2 py-1.5"
                              >
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-medium">{r.email || "--"}</span>
                                  {r.referee_user_id && <UserLink id={r.referee_user_id} label="Profile" />}
                                  <span className="text-[var(--mp-fg-muted)]">
                                    ({r.email_domain || "--"})
                                  </span>
                                  <StatusDot
                                    tone={r.signup_method === "telegram" ? "neutral" : "success"}
                                    size={6}
                                  />
                                  <span className="text-[10px] text-[var(--mp-fg-muted)]">
                                    {r.signup_method}
                                  </span>
                                </div>
                                <div className="text-[var(--mp-fg-muted)] mt-0.5">
                                  signed up{" "}
                                  {r.signup_at
                                    ? new Date(r.signup_at).toLocaleDateString("de-AT")
                                    : "--"}{" "}
                                  · {r.distinct_question_count} distinct Qs across{" "}
                                  {r.distinct_day_span} days ·{" "}
                                  {r.first_answer_at && r.last_answer_at
                                    ? `${new Date(r.first_answer_at).toLocaleDateString("de-AT")} → ${new Date(r.last_answer_at).toLocaleDateString("de-AT")}`
                                    : "--"}
                                </div>
                                <div className="flex items-center gap-1.5 mt-1">
                                  <StatusDot
                                    tone={
                                      r.card_trial_active
                                        ? "success"
                                        : cardRequired
                                          ? "danger"
                                          : "neutral"
                                    }
                                    size={6}
                                  />
                                  <span className="text-[10px] text-[var(--mp-fg-muted)]">
                                    {r.card_trial_active
                                      ? `card linked (${r.card_trial_tier || "whop"}) ${
                                          r.card_trial_activated_at
                                            ? new Date(r.card_trial_activated_at).toLocaleDateString("de-AT")
                                            : ""
                                        }`
                                      : cardRequired
                                        ? "no card on file"
                                        : "card not required (gate off)"}
                                  </span>
                                </div>
                              </li>
                            ))}
                          </ul>
                ) },
              ]}
              actions={(item) => (canManage ? (
                <button
                  type="button"
                  className="mp-btn mp-btn--primary mp-btn--sm"
                  onClick={() => {
                    setExamRewardTarget(item);
                    setExamRewardConfirming(false);
                  }}
                >
                  Grant Pro through exam window
                </button>
              ) : null)}
            />
          </div>
        )}
      </section>

      {error && (
        <Alert variant="error" title={items.length ? "Showing saved payout results" : "Could not load payout queue"}>
          {error}
        </Alert>
      )}

      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <BrandedLoader size={48} label="Loading referrals…" />
        </div>
      ) : sorted.length === 0 ? (
        error ? (
          <div role="status" className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-4 py-6 text-sm text-[var(--mp-fg-muted)]">
            The payout queue is unavailable. No matching referrals cannot be confirmed until the request succeeds.
          </div>
        ) : (
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
        )
      ) : (
          <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] overflow-hidden">
          {canManage && sorted.some((r) => r.status === "qualified") && (
            <label className="flex min-h-11 items-center gap-2 border-b border-[var(--mp-border-subtle)] px-4 text-xs text-[var(--mp-fg)] lg:hidden">
              <input
                type="checkbox"
                checked={payableSelected.length > 0 && payableSelected.length === sorted.filter((r) => r.status === "qualified").length}
                onChange={toggleSelectAll}
              />
              Select all qualified referrals
            </label>
          )}
          <ResponsiveTable
            label="Referral payouts"
            testId="referrals-payouts"
            minWidth={900}
            rows={sorted}
            rowKey={(r) => r.id}
            rowClassName={(r) => (selected.has(r.id) ? "bg-[var(--mp-viridian)]/5" : "")}
            columns={[
              { key: "select", cardLabel: "Select", card: "meta", className: "w-10", header: (
                <input
                  type="checkbox"
                  aria-label="Select all qualified referrals"
                  checked={payableSelected.length > 0 && payableSelected.length === sorted.filter((r) => r.status === "qualified").length}
                  onChange={toggleSelectAll}
                  disabled={!canManage || sorted.filter((r) => r.status === "qualified").length === 0}
                />
              ), cell: (r) => (
                <label className="inline-flex min-h-8 items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label={`Select referral ${r.id}`}
                    checked={selected.has(r.id)}
                    onChange={() => toggleSelect(r.id)}
                    disabled={!canManage || r.status !== "qualified"}
                  />
                  <span className="lg:hidden text-xs">Select for bulk payout</span>
                </label>
              ) },
              { key: "referrer", header: "Referrer", card: "title", cell: (r) => (
                <>
                  <div className="font-medium">{r.referrer_user_id ? <UserLink id={r.referrer_user_id} label={r.referrer?.first_name || null} /> : "--"}</div>
                  <div className="text-xs font-normal text-[var(--mp-fg-muted)]">{r.referrer?.email}</div>
                </>
              ) },
              { key: "hold", header: "Hold expires", className: "font-mono text-[10px] text-[var(--mp-fg-muted)]", cell: (r) => {
                const holdOverdue = r.hold_expires_at && new Date(r.hold_expires_at).getTime() < Date.now() && r.status === "qualified";
                return r.hold_expires_at ? (
                  <span className={holdOverdue ? "text-[var(--mp-error)] font-semibold" : ""}>
                    {new Date(r.hold_expires_at).toLocaleString("de-AT", { day: "2-digit", month: "short", year: "numeric" })}
                    {holdOverdue && " · overdue"}
                  </span>
                ) : "--";
              } },
              { key: "days", header: "Days in hold", cell: (r) => {
                const daysInHold = daysBetween(r.qualified_at || r.created_at, new Date().toISOString());
                return (
                  <span className="inline-flex items-center gap-1.5">
                    <StatusDot tone={daysInHold == null ? "neutral" : daysInHold >= 30 ? "danger" : daysInHold >= 14 ? "warn" : "success"} size={6} />
                    <span className="font-mono tabular-nums">{daysInHold != null ? `${daysInHold}d` : "--"}</span>
                  </span>
                );
              } },
              { key: "referee", header: "Referee", cell: (r) => (
                <>
                  <div className="font-medium">{r.referee_user_id ? <UserLink id={r.referee_user_id} label={r.referee?.first_name || null} /> : "--"}</div>
                  <div className="text-[var(--mp-fg-muted)]">{r.referee?.email}</div>
                </>
              ) },
              { key: "method", header: "Payout method", className: "font-mono text-[10px]", cell: (r) => r.referrer?.payout_method || <span className="text-[var(--mp-status-warning)]">not set</span> },
              { key: "reward", header: "Reward", align: "right", className: "font-mono tabular-nums", cell: (r) => <FormatEuro cents={r.reward_credit_cents} /> },
              { key: "status", header: "Status", cell: (r) => (
                <span className="inline-flex items-center gap-1.5">
                  <StatusDot tone={r.status === "qualified" ? "warn" : r.status === "rewarded" ? "success" : "neutral"} size={6} />
                  <span className="text-[10px] font-mono">{r.status}</span>
                </span>
              ) },
            ]}
            actions={(r) => (r.status === "qualified" && canManage ? (
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
                {r.rewarded_at ? `Paid ${new Date(r.rewarded_at).toLocaleDateString("de-AT")}` : "--"}
              </span>
            ))}
          />
        </div>
      )}

      {/* ─── Single Mark-Paid Dialog ────────────────────────────── */}
      <Dialog
        busy={processing}
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
              data-dialog-primary
              onClick={submitMarkPaid}
              disabled={processing || !canManage}
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
              helper="Optional, but strongly recommended for audit trail."
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
      </>}

      {/* ─── Bulk Mark-Paid Dialog ──────────────────────────────── */}
      <Dialog
        busy={processing}
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
              data-dialog-primary
              onClick={submitBulk}
              disabled={processing || !canManage || payableSelected.length === 0}
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
            placeholder="e.g. April payout batch, Wise transfer ref 12345"
          />
          {bulkConfirming && (
            <Alert variant="warning" title="Batch destructive action">
              Every selected referral flips to <code>rewarded</code>. Each
              lands a separate <code>admin_audit_log</code> row. No txid
              field on bulk: record the batch reference in Notes.
            </Alert>
          )}
        </div>
      </Dialog>

      {/* ─── Exam-reward grant confirm dialog ──────────────────────── */}
      <Dialog
        busy={examRewardProcessing}
        open={!!examRewardTarget}
        onOpenChange={(o) => {
          if (!o) {
            setExamRewardTarget(null);
            setExamRewardConfirming(false);
          }
        }}
        title={examRewardConfirming ? "Confirm grant" : "Grant Pro through exam window"}
        description={
          examRewardTarget
            ? `Grants tier='pro' to ${examRewardTarget.referrer_email ?? "(unknown)"} through the next sitting of ${examRewardTarget.referrer_active_exam ?? "their active exam"} +14 days.`
            : undefined
        }
        footer={
          <DialogFooter>
            <button
              className="mp-btn mp-btn--secondary"
              onClick={() => {
                setExamRewardTarget(null);
                setExamRewardConfirming(false);
              }}
              disabled={examRewardProcessing}
            >
              Cancel
            </button>
            <button
              className="mp-btn mp-btn--primary"
              data-dialog-primary
              onClick={submitExamRewardGrant}
              disabled={examRewardProcessing || !canManage}
            >
              {examRewardProcessing
                ? "Granting…"
                : examRewardConfirming
                  ? "Confirm grant"
                  : "Continue"}
            </button>
          </DialogFooter>
        }
      >
        {examRewardTarget && examRewardConfirming && (
          <Alert variant="warning" title="Grants free Pro access">
            This is a non-cash reward: no payment is collected from anyone.
            The referrer flips to <code>tier=&apos;pro&apos;</code> with{" "}
            <code>tier_expires_at</code> set from their active_exam. Logged
            in <code>admin_audit_log</code>. Click Confirm to proceed.
          </Alert>
        )}
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
