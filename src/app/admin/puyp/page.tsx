"use client";

/**
 * Admin / PUYP tab — Pass-Until-You-Pass verification queue.
 *
 * Lists pending exam_attempts where result='fail' and verified_at IS NULL.
 * For each row the admin can:
 *   - Open the signed-URL preview of the uploaded proof (5-min TTL).
 *   - Approve → extends the subscription's expires_at (default: next
 *     exam cycle from `lib/exam-dates.ts`; override with a date input),
 *     increments puyp_extensions_used, mirrors users.tier_expires_at.
 *   - Reject → records a rejection_reason, marks verified.
 *
 * Status filter tabs: pending | approved | rejected | all.
 *
 * Endpoints:
 *   GET  /api/puyp/admin?status=<filter>  → queue
 *   POST /api/puyp/admin                  → approve/reject action
 *
 * This page is GATED by the `requireAdmin` server guard on the API.
 * The client also uses the `/admin/*` layout's session check to avoid
 * rendering a page full of 403s to non-admins. Neither is sufficient
 * alone — the API guard is the actual security boundary.
 */

import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ExternalLink,
  FileText,
  ShieldCheck,
  X,
} from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
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
import { NEXT_EXAM_DATE } from "@/lib/exam-dates";

type StatusFilter = "pending" | "approved" | "rejected" | "all";

interface AttemptUser {
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  tier: string | null;
  tier_expires_at: string | null;
}

interface AttemptSubscription {
  tier: string | null;
  expires_at: string | null;
  puyp_extensions_used: number | null;
  status: string | null;
}

interface PuypAttempt {
  id: string;
  user_id: string;
  subscription_id: string | null;
  exam_type: string;
  attempt_date: string;
  result: string;
  proof_url: string | null;
  proof_signed_url: string | null;
  verified_at: string | null;
  verified_by: string | null;
  rejection_reason: string | null;
  qbank_completion_pct: number | null;
  created_at: string;
  users: AttemptUser | null;
  subscriptions: AttemptSubscription | null;
}

export default function AdminPuypPage() {
  const toast = useToast();
  const [items, setItems] = useState<PuypAttempt[]>([]);
  const [status, setStatus] = useState<StatusFilter>("pending");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Approval dialog state
  const [approveTarget, setApproveTarget] = useState<PuypAttempt | null>(null);
  const [newExpiresAt, setNewExpiresAt] = useState("");
  const [processing, setProcessing] = useState(false);

  // Rejection dialog state
  const [rejectTarget, setRejectTarget] = useState<PuypAttempt | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const fetchQueue = useCallback(
    async (s: StatusFilter) => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/puyp/admin?status=${s}&limit=100`);
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || "Failed to load queue");
        }
        const data = await res.json();
        setItems(Array.isArray(data.items) ? data.items : []);
      } catch (e) {
        setError((e as Error).message || "Failed to load queue");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void fetchQueue(status);
  }, [status, fetchQueue]);

  // When an admin opens the approval dialog, pre-fill new_expires_at
  // with the next exam date + ~2 weeks buffer for the attempt's exam type.
  useEffect(() => {
    if (!approveTarget) {
      setNewExpiresAt("");
      return;
    }
    const exam = approveTarget.exam_type as keyof typeof NEXT_EXAM_DATE;
    const iso = NEXT_EXAM_DATE[exam];
    if (iso) {
      // Add 14 days buffer, format as datetime-local (browser input)
      const d = new Date(`${iso}T23:59:59Z`);
      d.setUTCDate(d.getUTCDate() + 14);
      // datetime-local wants YYYY-MM-DDTHH:mm (no seconds, local tz).
      // We present UTC but browsers will interpret as local. That's
      // acceptable for admin UX — the submitted value round-trips to
      // an ISO string via new Date() in the POST handler.
      const s = d.toISOString().slice(0, 16);
      setNewExpiresAt(s);
    }
  }, [approveTarget]);

  async function submitApprove() {
    if (!approveTarget) return;
    setProcessing(true);
    try {
      const res = await fetch("/api/puyp/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attempt_id: approveTarget.id,
          action: "approve",
          new_expires_at: newExpiresAt ? new Date(newExpiresAt).toISOString() : undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Approval failed");
      toast.success("Extension granted", `New expiry: ${formatDate(body.new_expires_at)}`);
      setApproveTarget(null);
      await fetchQueue(status);
    } catch (e) {
      toast.error((e as Error).message || "Could not approve");
    } finally {
      setProcessing(false);
    }
  }

  async function submitReject() {
    if (!rejectTarget || !rejectReason.trim()) return;
    setProcessing(true);
    try {
      const res = await fetch("/api/puyp/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attempt_id: rejectTarget.id,
          action: "reject",
          reason: rejectReason.trim(),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Rejection failed");
      toast.success("Rejected", "The user will be emailed.");
      setRejectTarget(null);
      setRejectReason("");
      await fetchQueue(status);
    } catch (e) {
      toast.error((e as Error).message || "Could not reject");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="mp-h2 flex items-center gap-2">
            <ShieldCheck size={18} className="text-[var(--mp-viridian)]" />
            Pass-Until-You-Pass Queue
          </h2>
          <p className="text-xs text-[var(--mp-fg-muted)] mt-1">
            Verify proof uploads and grant subscription extensions. Admin-only.
          </p>
        </div>
        <div className="mp-tabs" role="tablist">
          {(["pending", "approved", "rejected", "all"] as StatusFilter[]).map((s) => (
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
      </div>

      {error && (
        <Alert variant="error" title="Failed to load">
          {error}
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <BrandedLoader size={60} label="Loading queue…" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          tone="success"
          icon={<CheckCircle2 className="w-10 h-10" aria-hidden />}
          title={status === "pending" ? "No pending reviews" : "Nothing in this filter"}
          body={
            status === "pending"
              ? "Inbox is clear. New PUYP submissions will appear here for verification."
              : "Try another filter to see attempts in a different state."
          }
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <AttemptCard
              key={item.id}
              item={item}
              onApprove={() => setApproveTarget(item)}
              onReject={() => setRejectTarget(item)}
            />
          ))}
        </div>
      )}

      {/* ── Approve dialog ── */}
      <Dialog
        open={!!approveTarget}
        onOpenChange={(o) => !o && setApproveTarget(null)}
        title="Approve PUYP extension"
        description={
          approveTarget
            ? `Extending ${approveTarget.users?.first_name || "user"}'s ${approveTarget.subscriptions?.tier || "subscription"} through the next cycle.`
            : undefined
        }
        footer={
          <DialogFooter>
            <button
              className="mp-btn mp-btn--secondary"
              onClick={() => setApproveTarget(null)}
              disabled={processing}
            >
              Cancel
            </button>
            <button
              className="mp-btn mp-btn--primary"
              onClick={submitApprove}
              disabled={processing || !newExpiresAt}
            >
              {processing ? "Granting…" : "Grant extension"}
            </button>
          </DialogFooter>
        }
      >
        {approveTarget && (
          <div className="space-y-3">
            <div className="text-xs text-[var(--mp-fg-muted)] space-y-1">
              <div>
                Current expires_at:{" "}
                <strong>
                  {formatDateTime(approveTarget.subscriptions?.expires_at)}
                </strong>
              </div>
              <div>
                Extensions used so far:{" "}
                <strong>
                  {approveTarget.subscriptions?.puyp_extensions_used ?? 0} / 2
                </strong>
              </div>
              <div>
                Exam type: <strong>{approveTarget.exam_type}</strong>
              </div>
            </div>

            <TextField
              label="New expires_at"
              type="datetime-local"
              required
              value={newExpiresAt}
              onChange={(e) => setNewExpiresAt(e.target.value)}
              helper="Defaults to the next known exam date + 14-day buffer. Override as needed."
            />
          </div>
        )}
      </Dialog>

      {/* ── Reject dialog ── */}
      <Dialog
        open={!!rejectTarget}
        onOpenChange={(o) => {
          if (!o) {
            setRejectTarget(null);
            setRejectReason("");
          }
        }}
        title="Reject PUYP claim"
        description="The user will be emailed with your reason."
        footer={
          <DialogFooter>
            <button
              className="mp-btn mp-btn--secondary"
              onClick={() => {
                setRejectTarget(null);
                setRejectReason("");
              }}
              disabled={processing}
            >
              Cancel
            </button>
            <button
              className="mp-btn mp-btn--destructive"
              onClick={submitReject}
              disabled={processing || !rejectReason.trim()}
            >
              {processing ? "Rejecting…" : "Reject"}
            </button>
          </DialogFooter>
        }
      >
        <Textarea
          label="Reason"
          required
          rows={4}
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          helper="Be specific — this is what the user will see in the email."
          placeholder="e.g. The uploaded document doesn't show the attempt date, or the name on the proof doesn't match the account."
        />
      </Dialog>
    </div>
  );
}

// ═══ Row card ═══════════════════════════════════════════════════════
function AttemptCard({
  item,
  onApprove,
  onReject,
}: {
  item: PuypAttempt;
  onApprove: () => void;
  onReject: () => void;
}) {
  const name =
    [item.users?.first_name, item.users?.last_name]
      .filter(Boolean)
      .join(" ") || "(no name)";
  const completion = item.qbank_completion_pct ?? 0;
  const completionPass = completion >= 70;
  const pending = !item.verified_at;
  const rejected = !!item.rejection_reason;

  return (
    <div
      className={`card rounded-xl p-4 border-l-4 ${
        rejected
          ? "border-l-[var(--mp-error)]"
          : pending
            ? "border-l-[var(--mp-status-warning)]"
            : "border-l-[var(--mp-viridian)]"
      }`}
    >
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-[var(--mp-fg)]">
              {name}
            </h3>
            <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--mp-cta-blue)]/10 text-[var(--mp-cta-blue)] font-mono">
              {item.exam_type}
            </span>
            {item.users?.tier && (
              <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--mp-fg-subtle)]/10 text-[var(--mp-fg-subtle)] font-mono">
                tier: {item.users.tier}
              </span>
            )}
            {rejected ? (
              <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--mp-error)]/10 text-[var(--mp-error)] font-mono">
                rejected
              </span>
            ) : pending ? (
              <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--mp-status-warning)]/10 text-[var(--mp-status-warning)] font-mono">
                pending
              </span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--mp-viridian)]/10 text-[var(--mp-viridian)] font-mono">
                approved
              </span>
            )}
          </div>
          <div className="text-xs text-[var(--mp-fg-muted)] space-y-1">
            <div>Email: {item.users?.email || "—"}</div>
            <div>
              Attempt date:{" "}
              <strong className="text-[var(--mp-fg)]">
                {item.attempt_date}
              </strong>{" "}
              · submitted {formatDateTime(item.created_at)}
            </div>
            <div>
              Qbank completion:{" "}
              <strong
                className={
                  completionPass
                    ? "text-[var(--mp-viridian)]"
                    : "text-[var(--mp-status-warning)]"
                }
              >
                {completion.toFixed(1)}%
              </strong>{" "}
              {completionPass ? "· meets 70% gate" : "· BELOW 70% gate"}
            </div>
            <div>
              Subscription:{" "}
              <strong className="text-[var(--mp-fg)]">
                {item.subscriptions?.tier || "—"}
              </strong>{" "}
              · expires {formatDateTime(item.subscriptions?.expires_at)} ·
              extensions {item.subscriptions?.puyp_extensions_used ?? 0}/2
            </div>
            {rejected && (
              <div className="text-[var(--mp-error)]">
                Reason: {item.rejection_reason}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2 flex-shrink-0 items-stretch min-w-[150px]">
          {item.proof_signed_url ? (
            <a
              href={item.proof_signed_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mp-btn mp-btn--secondary mp-btn--sm justify-center"
            >
              <FileText size={14} />
              View proof
              <ExternalLink size={12} />
            </a>
          ) : (
            <span className="text-[10px] text-[var(--mp-fg-subtle)] text-center">
              No proof file
            </span>
          )}
          {pending && (
            <>
              <button
                type="button"
                className="mp-btn mp-btn--primary mp-btn--sm justify-center"
                onClick={onApprove}
              >
                <Check size={14} /> Approve
              </button>
              <button
                type="button"
                className="mp-btn mp-btn--destructive mp-btn--sm justify-center"
                onClick={onReject}
              >
                <X size={14} /> Reject
              </button>
            </>
          )}
          {!pending && item.verified_at && (
            <div className="text-[10px] text-[var(--mp-fg-subtle)] text-center">
              Verified {formatDateTime(item.verified_at)}
            </div>
          )}
        </div>
      </div>

      {!item.proof_signed_url && !rejected && (
        <div className="mt-2 text-[10px] text-[var(--mp-status-warning)] flex items-center gap-1">
          <AlertTriangle size={12} />
          No proof file attached — refresh to regenerate the signed URL.
        </div>
      )}
    </div>
  );
}

// ═══ Helpers ════════════════════════════════════════════════════════
function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
