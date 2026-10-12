"use client";

import { useEffect, useState } from "react";
import { authFetch as fetch } from "@/lib/authFetch";
import { Dialog } from "@/components/ui";
import { money, type UnresolvedPaymentRow } from "./types";

export type ResolveAction = "link" | "test" | "not_ours";

interface Preview {
  learner_id: string;
  learner_label: string;
  current_access: string;
  tier: string;
  months: number;
  gross_cents: number;
  currency: string;
  already_pro?: boolean;
}

const TITLES: Record<ResolveAction, string> = {
  link: "Link payment to a learner",
  test: "Mark payment as test",
  not_ours: "Mark payment as not ours",
};

/**
 * One dialog for the three Unresolved-payment actions. Link is two steps:
 * Find learner (server preview, no writes) then Grant. Every submit is
 * busy-guarded and the server is idempotent per payment id.
 */
export function ResolveDialog({
  payment,
  action,
  onClose,
  onDone,
}: {
  payment: UnresolvedPaymentRow | null;
  action: ResolveAction;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [userRef, setUserRef] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setReason(action === "test" ? "Synthetic Whop test delivery, not a customer payment." : "");
    setUserRef("");
    setPreview(null);
    setError(null);
    setBusy(false);
  }, [payment, action]);

  if (!payment) return null;

  const post = async (confirm: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/payments/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payment_id: payment.payment_id, action, reason, user_ref: action === "link" ? userRef : undefined, confirm }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; preview?: Preview; expires_at?: string | null; duplicate?: boolean; entitlement_pending?: boolean };
      if (!res.ok) throw new Error(body.error || `Request failed (HTTP ${res.status}).`);
      if (body.preview) {
        setPreview(body.preview);
        return;
      }
      if (action === "link") {
        onDone(body.duplicate
          ? "This payment was already linked to that learner."
          : `Linked. Pro${body.expires_at ? ` until ${body.expires_at.slice(0, 10)}` : ""} granted${body.entitlement_pending ? "; the learner's tier will sync on their next request" : ""}.`);
      } else {
        onDone(action === "test" ? "Marked as test. It no longer counts as money in." : "Marked as not ours. It no longer counts as money in.");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reasonOk = reason.trim().length >= 5 && reason.trim().length <= 500;
  const canFind = action === "link" && !preview && reasonOk && userRef.trim().length > 3;

  return (
    <Dialog
      open
      onOpenChange={(open) => { if (!open && !busy) onClose(); }}
      title={TITLES[action]}
      description={`${money(payment.gross_cents, payment.currency)} paid ${payment.paid_at.slice(0, 10)}, payment ${payment.payment_id}`}
      closeOnBackdrop={!busy}
      maxWidth="520px"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="mp-btn mp-btn--secondary mp-btn--sm" onClick={onClose} disabled={busy}>Cancel</button>
          {action === "link" && !preview ? (
            <button type="button" className="mp-btn mp-btn--primary mp-btn--sm" disabled={!canFind || busy} aria-busy={busy} onClick={() => void post(false)}>
              {busy ? "Checking…" : "Find learner"}
            </button>
          ) : (
            <button
              type="button"
              className={`mp-btn mp-btn--sm ${action === "link" ? "mp-btn--primary" : "mp-btn--destructive"}`}
              disabled={!reasonOk || busy}
              aria-busy={busy}
              onClick={() => void post(true)}
            >
              {busy ? "Saving…" : action === "link" ? `Grant ${preview?.months ?? ""} month${preview?.months === 1 ? "" : "s"} of Pro` : action === "test" ? "Mark as test" : "Mark as not ours"}
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-3 text-sm">
        {action === "link" && (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--mp-fg)]">Learner email or user id</span>
            <input
              className="mp-field__input w-full"
              value={userRef}
              onChange={(e) => { setUserRef(e.target.value); setPreview(null); }}
              disabled={busy}
              autoComplete="off"
              inputMode="email"
            />
          </label>
        )}
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-[var(--mp-fg)]">Reason (kept in the audit log)</span>
          <textarea className="mp-field__input w-full" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} disabled={busy} maxLength={500} />
        </label>
        {action === "link" && preview && (
          <div className="rounded-lg border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-sunken)] p-3 text-xs leading-relaxed">
            <p><span className="text-[var(--mp-fg-muted)]">Learner:</span> <strong className="break-words">{preview.learner_label}</strong></p>
            <p><span className="text-[var(--mp-fg-muted)]">Access now:</span> {preview.current_access}</p>
            <p><span className="text-[var(--mp-fg-muted)]">Grants:</span> {preview.months} month{preview.months === 1 ? "" : "s"} of Pro ({preview.tier}), added from the current end of access.</p>
            {preview.already_pro && (
              <p className="mt-1 font-medium text-[var(--mp-fg)]">This learner already has Pro. If that Pro was granted by hand for this payment, cancel here instead of granting a second window.</p>
            )}
            <p className="mt-1 text-[var(--mp-fg-muted)]">The grant uses the same path as the webhook, so a later refund still removes it.</p>
          </div>
        )}
        {action !== "link" && (
          <p className="text-xs text-[var(--mp-fg-muted)]">The payment leaves the Unresolved queue and no longer counts as money in. No learner access changes.</p>
        )}
        {error && <p role="alert" className="rounded-md border border-[var(--mp-error)]/40 bg-[var(--mp-error-bg)] px-3 py-2 text-xs text-[var(--mp-error)]">{error}</p>}
      </div>
    </Dialog>
  );
}
