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
 *   - Reject → records a rejection_reason, marks verified. Canned
 *     reasons available via a <Select> to keep wording consistent.
 *
 * Status filter tabs: pending | approved | rejected | all.
 *
 * Endpoints:
 *   GET  /api/puyp/admin?status=<filter>  → queue
 *   POST /api/puyp/admin                  → approve/reject action
 *
 * Decisions email the learner (best effort). A rejection whose email could
 * not be sent stays under "Follow up needed" with a "Learner not notified"
 * chip, a copy-reason button and "Mark as sent" (UX-ADM-22).
 *
 * a13 (ADM-19): pending claims are sorted oldest first with the 72-hour
 * review clock; unknown qbank completion reads "unknown", not 0%.
 * Approval never shortens access (guarded database function).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  MailWarning,
  ExternalLink,
  FileText,
  ShieldCheck,
  X,
} from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";
import {
  Alert,
  BrandedLoader,
  Dialog,
  DialogFooter,
  EmptyState,
  Select,
  TextField,
  Textarea,
  useToast,
} from "@/components/ui";
import { AdminPageShell } from "../_components/AdminPageShell";
import { getNextExamDate, type PuypExamType } from "@/lib/exam-dates";

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
  /** Hours left on the 72-hour review promise; negative when overdue. */
  due_in_hours?: number | null;
  /** Rejections only: whether the learner was told (email or marked by hand). */
  learner_notified?: boolean | null;
}

const CANNED_REASONS: Array<{ value: string; label: string }> = [
  { value: "", label: "Pick a reason or write your own" },
  {
    value: "proof_no_date",
    label: "The proof doesn't show the attempt date",
  },
  {
    value: "proof_name_mismatch",
    label: "The name on the proof doesn't match the account",
  },
  {
    value: "completion_below_70",
    label: "Qbank completion is below the 70% gate",
  },
  {
    value: "proof_unreadable",
    label: "The uploaded file is unreadable (corrupt/blank)",
  },
  {
    value: "wrong_exam_type",
    label: "Proof is for a different exam than this subscription covers",
  },
  {
    value: "already_used",
    label: "PUYP extensions already used (2/2)",
  },
  { value: "custom", label: "Something else, write below" },
];

const CANNED_TEXT: Record<string, string> = {
  proof_no_date:
    "The uploaded document doesn't clearly show the exam date. Please resubmit a version where the attempt date is visible.",
  proof_name_mismatch:
    "The name on the proof doesn't match the name on your MedPrüf account. Please send a version that shows your full name matching your registered account, or contact support to correct your account name.",
  completion_below_70:
    "Your qbank completion is below the 70% threshold required to claim a Pass-Until-You-Pass extension. Please complete more questions across the exam's topics and resubmit after failing your next attempt.",
  proof_unreadable:
    "We couldn't read the file you uploaded: it may be corrupted or blank. Please resubmit a clearer scan or screenshot.",
  wrong_exam_type:
    "The proof uploaded is for a different exam than the one your subscription covers. Please upload the proof for the correct exam.",
  already_used:
    "You've already used both PUYP extensions on this subscription. The guarantee caps at two re-attempts. Please reach out if you'd like to discuss next steps.",
};

export default function AdminPuypPage() {
  const toast = useToast();
  const { can, loading: accessLoading } = useAdminPermissions();
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
  const [cannedKey, setCannedKey] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [followUps, setFollowUps] = useState<PuypAttempt[]>([]);
  const [followUpError, setFollowUpError] = useState("");

  const fetchFollowUps = useCallback(async () => {
    try {
      const res = await fetch("/api/puyp/admin?status=rejected&limit=200");
      if (!res.ok) throw new Error(`Follow-up list unavailable (HTTP ${res.status})`);
      const data = await res.json();
      const list = (Array.isArray(data.items) ? data.items : []) as PuypAttempt[];
      setFollowUps(list.filter((item) => item.learner_notified === false));
      setFollowUpError("");
    } catch (e) {
      setFollowUpError((e as Error).message);
    }
  }, []);

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
    if (!accessLoading && can("revenue.read")) void fetchQueue(status);
  }, [accessLoading, can, status, fetchQueue]);
  useEffect(() => {
    if (!accessLoading && can("revenue.read")) void fetchFollowUps();
  }, [accessLoading, can, fetchFollowUps]);

  // Pending: oldest first, so the claim closest to the 72-hour promise is on
  // top. Other filters: most recently decided first.
  const sorted = useMemo(() => {
    const arr = [...items];
    arr.sort((a, b) => {
      if (status === "pending") return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      return new Date(b.verified_at || b.created_at).getTime() - new Date(a.verified_at || a.created_at).getTime();
    });
    return arr;
  }, [items, status]);

  async function markNotified(item: PuypAttempt) {
    if (!can("revenue.manage")) return;
    try {
      const res = await fetch("/api/puyp/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attempt_id: item.id, action: "mark_notified" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Could not mark as sent");
      toast.success("Marked as sent");
      await Promise.all([fetchFollowUps(), fetchQueue(status)]);
    } catch (e) {
      toast.error((e as Error).message || "Could not mark as sent");
    }
  }

  // When an admin opens the approval dialog, pre-fill new_expires_at
  // with the next exam date + ~2 weeks buffer for the attempt's exam type.
  useEffect(() => {
    if (!approveTarget) {
      setNewExpiresAt("");
      return;
    }
    const exam = approveTarget.exam_type as PuypExamType;
    const iso = getNextExamDate(exam);
    if (iso) {
      const d = new Date(`${iso}T23:59:59Z`);
      d.setUTCDate(d.getUTCDate() + 14);
      const s = d.toISOString().slice(0, 16);
      setNewExpiresAt(s);
    }
  }, [approveTarget]);

  // When canned reason changes, prefill the free-text with the
  // canned text (admin can edit before submit).
  useEffect(() => {
    if (!cannedKey) return;
    if (cannedKey === "custom") {
      // leave whatever's in rejectReason
      return;
    }
    const text = CANNED_TEXT[cannedKey];
    if (text) setRejectReason(text);
  }, [cannedKey]);

  async function submitApprove() {
    if (!approveTarget || !can("revenue.manage")) return;
    setProcessing(true);
    try {
      const res = await fetch("/api/puyp/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          attempt_id: approveTarget.id,
          action: "approve",
          new_expires_at: newExpiresAt
            ? new Date(newExpiresAt).toISOString()
            : undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Approval failed");
      toast.success(
        "Extension granted",
        `Subscription ends ${formatDate(body.new_expires_at)}${body.user_access === "kept_permanent" ? ". Permanent Pro kept." : body.user_access === "kept_later" ? ". The learner's later access end was kept." : ""}${body.learner_notified ? "" : " The learner has not been emailed."}`
      );
      setApproveTarget(null);
      await fetchQueue(status);
    } catch (e) {
      toast.error((e as Error).message || "Could not approve");
    } finally {
      setProcessing(false);
    }
  }

  async function submitReject() {
    if (!rejectTarget || !rejectReason.trim() || !can("revenue.manage")) return;
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
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "Rejection failed");
      if (body.learner_notified) toast.success("Rejection saved. The learner was emailed the reason.");
      else toast.success("Rejection saved. The learner has not been notified yet.", "It stays under Follow up needed until you mark it as sent.");
      void fetchFollowUps();
      setRejectTarget(null);
      setRejectReason("");
      setCannedKey("");
      await fetchQueue(status);
    } catch (e) {
      toast.error((e as Error).message || "Could not reject");
    } finally {
      setProcessing(false);
    }
  }

  if (accessLoading) return <div className="p-6"><BrandedLoader size={40} label="Checking access…" /></div>;
  if (!can("revenue.read")) return <div className="p-6"><Alert variant="error" title="Access not available">Your admin role does not include permission to view payment verification requests.</Alert></div>;

  return (
    <AdminPageShell
      title="Pass-Until-You-Pass"
      description="Review proof uploads, grant or reject re-exam extensions. Admin-only."
      freshness={loading ? "cached" : error ? "disconnected" : "live"}
      onRefresh={() => fetchQueue(status)}
      actions={
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-xs text-[var(--mp-fg-muted)]">
            <ShieldCheck
              size={12}
              className="text-[var(--mp-viridian)]"
              aria-hidden
            />
            {error ? "Queue unavailable" : loading ? "Loading queue" : `${sorted.length} in queue`}
          </span>
          <div className="mp-tabs" role="tablist">
            {(["pending", "approved", "rejected", "all"] as StatusFilter[]).map(
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
      {followUpError && (
        <Alert variant="error" title="Follow-up list unavailable">
          {followUpError} <button type="button" className="ml-3 underline" onClick={() => void fetchFollowUps()}>Retry</button>
        </Alert>
      )}
      {followUps.length > 0 && (
        <section aria-labelledby="puyp-follow-up" className="space-y-3 rounded-xl border border-[var(--mp-status-warning)]/40 bg-[var(--mp-status-warning)]/5 p-4">
          <h2 id="puyp-follow-up" className="flex items-center gap-2 text-sm font-semibold text-[var(--mp-fg)]">
            <MailWarning size={14} aria-hidden /> Follow up needed ({followUps.length})
          </h2>
          <p className="text-xs text-[var(--mp-fg-muted)]">These learners were rejected but not told yet. Send them the reason, then mark it as sent.</p>
          {followUps.map((item) => (
            <AttemptCard key={`follow-${item.id}`} item={item} onMarkNotified={can("revenue.manage") ? () => void markNotified(item) : undefined} />
          ))}
        </section>
      )}

      {error && (
        <Alert variant="error" title="Failed to load">
          {error} <button type="button" className="ml-3 underline" onClick={() => void fetchQueue(status)}>Retry</button>
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <BrandedLoader size={60} label="Loading queue…" />
        </div>
      ) : error ? null : sorted.length === 0 ? (
        <EmptyState
          tone="success"
          icon={<CheckCircle2 className="w-10 h-10" aria-hidden />}
          title={
            status === "pending" ? "No pending reviews" : "Nothing in this filter"
          }
          body={
            status === "pending"
              ? "Inbox is clear. New PUYP submissions will appear here for verification."
              : "Try another filter to see attempts in a different state."
          }
        />
      ) : (
        <div className="space-y-3">
          {sorted.map((item) => (
            <AttemptCard
              key={item.id}
              item={item}
              onMarkNotified={can("revenue.manage") ? () => void markNotified(item) : undefined}
              onApprove={can("revenue.manage") ? () => setApproveTarget(item) : undefined}
              onReject={can("revenue.manage") ? () => {
                setRejectTarget(item);
                setCannedKey("");
                setRejectReason("");
              } : undefined}
            />
          ))}
        </div>
      )}

      {/* ── Approve dialog ── */}
      {can("revenue.manage") && <Dialog
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
              helper="Defaults to the next known exam date + 14-day buffer. Access is never shortened: a later current end and permanent Pro are kept."
            />
          </div>
        )}
      </Dialog>}

      {/* ── Reject dialog ── */}
      {can("revenue.manage") && <Dialog
        open={!!rejectTarget}
        onOpenChange={(o) => {
          if (!o) {
            setRejectTarget(null);
            setRejectReason("");
            setCannedKey("");
          }
        }}
        title="Reject PUYP claim"
        description="Pick a canned reason or write your own. The learner receives this reason by email."
        footer={
          <DialogFooter>
            <button
              className="mp-btn mp-btn--secondary"
              onClick={() => {
                setRejectTarget(null);
                setRejectReason("");
                setCannedKey("");
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
        <div className="space-y-3">
          <Select
            label="Canned reason"
            value={cannedKey}
            onChange={(e) => setCannedKey(e.target.value)}
            options={CANNED_REASONS}
          />
          <Textarea
            label="Reason (sent to user)"
            required
            rows={5}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            helper="Be specific: this is what the user will see. Prefilled from the canned reason above; edit before submitting if needed."
            placeholder="e.g. The uploaded document doesn't show the attempt date, or the name on the proof doesn't match the account."
          />
          <Alert variant="info" title="If the email cannot be sent">
            Accounts without an email address, or a failed send, keep the claim
            under Follow up needed with a Learner not notified chip until you
            mark the message as sent.
          </Alert>
        </div>
      </Dialog>}
    </AdminPageShell>
  );
}

// ═══ Row card ═══════════════════════════════════════════════════════
function AttemptCard({
  item,
  onApprove,
  onReject,
  onMarkNotified,
}: {
  item: PuypAttempt;
  onApprove?: () => void;
  onReject?: () => void;
  onMarkNotified?: () => void;
}) {
  const toast = useToast();
  const name =
    [item.users?.first_name, item.users?.last_name]
      .filter(Boolean)
      .join(" ") || "(no name)";
  const completion = item.qbank_completion_pct == null ? null : Number(item.qbank_completion_pct);
  const completionPass = completion != null && completion >= 70;
  const due = item.due_in_hours;
  const pending = !item.verified_at;
  const rejected = !!item.rejection_reason;

  return (
    <div
      className={`rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4 border-l-4 ${
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
            {pending && !rejected && typeof due === "number" && (
              <span className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded font-semibold ${due < 0 ? "bg-[var(--mp-error)]/10 text-[var(--mp-error)]" : due <= 24 ? "bg-[var(--mp-status-warning)]/10 text-[var(--mp-status-warning)]" : "bg-[var(--mp-surface-sunken)] text-[var(--mp-fg-muted)]"}`}>
                <Clock size={10} aria-hidden /> {due < 0 ? `Overdue by ${Math.abs(due)} h` : `Due in ${due} h`}
              </span>
            )}
            {rejected && item.learner_notified === false && (
              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded font-semibold bg-[var(--mp-status-warning)]/15 text-[var(--mp-status-warning)]">
                <MailWarning size={10} aria-hidden /> Learner not notified
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
              {completion == null ? (
                <strong className="text-[var(--mp-fg)]">unknown</strong>
              ) : (
                <>
                  <strong
                    className={
                      completionPass
                        ? "text-[var(--mp-viridian)]"
                        : "text-[var(--mp-status-warning)]"
                    }
                  >
                    {completion.toFixed(1)}%
                  </strong>{" "}
                  {completionPass ? "· meets 70% gate" : "· below 70% gate"}
                </>
              )}
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
          {pending && (onApprove || onReject) && (
            <>
              {onApprove && <button
                type="button"
                className="mp-btn mp-btn--primary mp-btn--sm justify-center"
                onClick={onApprove}
              >
                <Check size={14} /> Approve
              </button>}
              {onReject && <button
                type="button"
                className="mp-btn mp-btn--destructive mp-btn--sm justify-center"
                onClick={onReject}
              >
                <X size={14} /> Reject
              </button>}
            </>
          )}
          {!pending && item.verified_at && (
            <div className="text-[10px] text-[var(--mp-fg-subtle)] text-center">
              Verified {formatDateTime(item.verified_at)}
            </div>
          )}
          {rejected && item.learner_notified === false && (
            <>
              <button
                type="button"
                className="mp-btn mp-btn--secondary mp-btn--sm justify-center"
                onClick={() => {
                  void navigator.clipboard?.writeText(item.rejection_reason ?? "").then(
                    () => toast.success("Reason copied"),
                    () => toast.error("Could not copy the reason"),
                  );
                }}
              >
                <Copy size={14} /> Copy reason
              </button>
              {onMarkNotified && (
                <button type="button" className="mp-btn mp-btn--primary mp-btn--sm justify-center" onClick={onMarkNotified}>
                  <Check size={14} /> Mark as sent
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {!item.proof_signed_url && !rejected && (
        <div className="mt-2 text-[10px] text-[var(--mp-status-warning)] flex items-center gap-1">
          <AlertTriangle size={12} />
          No proof file attached: refresh to regenerate the signed URL.
        </div>
      )}
    </div>
  );
}

// ═══ Helpers ════════════════════════════════════════════════════════
function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("de-AT", {
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
    return new Date(iso).toLocaleString("de-AT", {
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
