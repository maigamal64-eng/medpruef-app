"use client";

/**
 * Per-user admin actions on the learner profile: grant N days of Pro,
 * lock/unlock, sign out everywhere and reset progress counters.
 *
 * §2.4 of the April 23 admin revamp sprint; ADM-06/ADM-17/UX-ADM-18 (a13):
 * mounted only on the profile, which knows the lock state and current
 * expiry. Permanent Pro cannot be granted dated days, and each grant dialog
 * carries one idempotency key so a retried submit cannot stack.
 * 2-step confirmation on every mutation + audit-logged server-side.
 */

import { useState } from "react";
import { Gift, Lock, LogOut, RotateCcw, Unlock } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";
import {
  Alert,
  Dialog,
  DialogFooter,
  TextField,
  Textarea,
  useToast,
} from "@/components/ui";

interface UserQuickActionsProps {
  userId: string;
  userEmail: string | null;
  isBanned: boolean;
  isAdmin?: boolean;
  /** Current entitlement, shown before a grant (null when hidden by permissions). */
  tier?: string | null;
  tierExpiresAt?: string | null;
  onChanged?: () => void;
}

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : "00000000-0000-4000-8000-000000000000".replace(/0/g, () => Math.floor(Math.random() * 16).toString(16));
}

export function UserQuickActions({
  userId,
  userEmail,
  isBanned,
  isAdmin = false,
  tier,
  tierExpiresAt,
  onChanged,
}: UserQuickActionsProps) {
  const { can } = useAdminPermissions();
  const permanentPro = tier === "pro" && !tierExpiresAt;
  const canGrant = can("users.entitlements.write") && !isAdmin;
  const canLock = can("users.sessions.write") && !isAdmin;
  const canSignOut = can("users.sessions.write");
  const canReset = can("users.write") && !isAdmin;
  const [grantKey, setGrantKey] = useState(newKey);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const toast = useToast();
  const [grantOpen, setGrantOpen] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const [days, setDays] = useState("30");
  const [grantReason, setGrantReason] = useState("");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [processing, setProcessing] = useState(false);

  async function submitGrant() {
    if (!canGrant) {
      setGrantOpen(false);
      setConfirming(false);
      toast.error("You do not have permission to grant Pro access.");
      return;
    }
    const grantDays = Number(days);
    if (!Number.isInteger(grantDays) || grantDays < 1 || grantDays > 365 || grantReason.trim().length < 5 || grantReason.trim().length > 500) {
      toast.error("Enter 1 to 365 days and a reason between 5 and 500 characters.");
      return;
    }
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setProcessing(true);
    try {
      const res = await fetch("/api/admin/users/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, days: grantDays, reason: grantReason.trim(), idempotency_key: grantKey }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Grant failed");
      toast.success(body.duplicate ? "Grant already applied" : `Granted ${days} days`, `New expiry: ${new Date(body.new_expiry).toLocaleDateString("en-GB")}`);
      setGrantKey(newKey());
      setGrantOpen(false);
      setConfirming(false);
      setDays("30");
      setGrantReason("");
      onChanged?.();
    } catch (e) {
      toast.error((e as Error).message || "Grant failed");
    } finally {
      setProcessing(false);
    }
  }

  async function submitLock() {
    if (!canLock) {
      setLockOpen(false);
      setConfirming(false);
      toast.error("You do not have permission to change account access.");
      return;
    }
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setProcessing(true);
    try {
      const res = await fetch("/api/admin/users/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          lock: !isBanned,
          reason: reason.trim() || undefined,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Lock toggle failed");
      toast.success(isBanned ? "Unlocked" : "Locked", userEmail ?? "");
      setLockOpen(false);
      setConfirming(false);
      setReason("");
      onChanged?.();
    } catch (e) {
      toast.error((e as Error).message || "Lock toggle failed");
    } finally {
      setProcessing(false);
    }
  }

  async function postAction(url: string, payload: Record<string, unknown>, success: string, close: () => void) {
    setProcessing(true);
    try {
      const res = await fetch(url, {
        method: url.endsWith("force-refresh-session") ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || `Request failed (HTTP ${res.status})`);
      toast.success(success);
      close();
      onChanged?.();
    } catch (e) {
      toast.error((e as Error).message || "Request failed");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canGrant && (
          <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setGrantOpen(true);
          }}
          className="mp-btn mp-btn--secondary mp-btn--sm flex items-center gap-1"
          title="Grant free Pro access"
        >
          <Gift size={12} />
          Grant free days
          </button>
        )}
        {canLock && (
          <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setReason("");
            setLockOpen(true);
          }}
          className={`mp-btn ${isBanned ? "mp-btn--primary" : "mp-btn--destructive"} mp-btn--sm flex items-center gap-1`}
          title={isBanned ? "Unlock account" : "Lock account"}
        >
          {isBanned ? <Unlock size={12} /> : <Lock size={12} />}
          {isBanned ? "Unlock" : "Lock"}
          </button>
        )}
        {canSignOut && (
          <button
            type="button"
            onClick={() => setSignOutOpen(true)}
            className="mp-btn mp-btn--secondary mp-btn--sm flex items-center gap-1"
            title="Sign this learner out on every device"
          >
            <LogOut size={12} />
            Sign out everywhere
          </button>
        )}
        {canReset && (
          <button
            type="button"
            onClick={() => setResetOpen(true)}
            className="mp-btn mp-btn--ghost mp-btn--sm flex items-center gap-1"
          >
            <RotateCcw size={12} />
            Reset progress…
          </button>
        )}
      </div>

      <Dialog
        busy={processing}
        open={signOutOpen}
        onOpenChange={(o) => { if (!processing) setSignOutOpen(o); }}
        title="Sign out everywhere?"
        description={userEmail ? `Target: ${userEmail}` : undefined}
        footer={
          <DialogFooter>
            <button data-dialog-safe className="mp-btn mp-btn--secondary" onClick={() => setSignOutOpen(false)} disabled={processing}>Cancel</button>
            <button
              data-dialog-primary
              className="mp-btn mp-btn--primary"
              disabled={processing}
              onClick={() => void postAction(`/api/admin/users/${userId}/force-refresh-session`, { reason: "Admin: sign out everywhere" }, "Signed out on every device", () => setSignOutOpen(false))}
            >
              {processing ? "Signing out…" : "Sign out everywhere"}
            </button>
          </DialogFooter>
        }
      >
        <p className="text-sm text-[var(--mp-fg-muted)]">Every device signed in to this account must sign in again. Access and progress are unchanged.</p>
      </Dialog>

      <Dialog
        busy={processing}
        open={resetOpen}
        onOpenChange={(o) => { if (!processing) setResetOpen(o); }}
        title="Reset learner progress counters?"
        description={userEmail ? `Target: ${userEmail}` : undefined}
        footer={
          <DialogFooter>
            <button data-dialog-safe className="mp-btn mp-btn--secondary" onClick={() => setResetOpen(false)} disabled={processing}>Cancel</button>
            <button
              data-dialog-primary
              className="mp-btn mp-btn--destructive"
              disabled={processing}
              onClick={() => void postAction("/api/stats/admin/users", { userId, updates: { reset_gamification: true } }, "Progress counters reset", () => setResetOpen(false))}
            >
              {processing ? "Resetting…" : "Reset counters"}
            </button>
          </DialogFooter>
        }
      >
        <p className="text-sm text-[var(--mp-fg-muted)]">
          XP, streak and answered-question counters go back to zero. Answer history and subscriptions stay. The previous values are kept in the audit log so they can be restored by hand.
        </p>
      </Dialog>

      <Dialog
        busy={processing}
        open={grantOpen}
        onOpenChange={(o) => {
          if (!o) {
            setGrantOpen(false);
            setConfirming(false);
            setGrantReason("");
          }
        }}
        title={confirming ? "Confirm grant" : "Grant free Pro access"}
        description={
          userEmail ? `Extending Pro access for ${userEmail}` : undefined
        }
        footer={
          <DialogFooter>
            <button
              className="mp-btn mp-btn--secondary"
              onClick={() => {
                setGrantOpen(false);
                setConfirming(false);
                setGrantReason("");
              }}
              disabled={processing}
            >
              Cancel
            </button>
            <button
              className="mp-btn mp-btn--primary"
              onClick={submitGrant}
              disabled={processing || permanentPro || !Number.isInteger(Number(days)) || Number(days) < 1 || Number(days) > 365 || grantReason.trim().length < 5 || grantReason.trim().length > 500 || !canGrant}
            >
              {processing
                ? "Granting…"
                : confirming
                  ? "Confirm grant"
                  : "Continue"}
            </button>
          </DialogFooter>
        }
      >
        <div className="space-y-3">
          {tier !== undefined && (
            <p className="text-xs text-[var(--mp-fg-muted)]">
              Current access: {permanentPro ? "permanent Pro" : tier === "pro" && tierExpiresAt ? `Pro until ${new Date(tierExpiresAt).toLocaleDateString("en-GB")}` : (tier ?? "unknown")}
            </p>
          )}
          {permanentPro && (
            <Alert variant="warning" title="Already permanent Pro">
              A dated grant would shorten this learner&apos;s access, so it is blocked.
            </Alert>
          )}
          <Textarea
            label="Reason for granting access"
            rows={3}
            value={grantReason}
            onChange={(e) => setGrantReason(e.target.value)}
            maxLength={500}
            placeholder="Explain why this access change is needed"
            helper="Required for the audit record. Enter at least 5 characters."
          />
          <TextField
            label="Days to grant"
            type="number"
            min={1}
            max={365}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            helper="Up to 365 days. Current Pro expiry (if any) is extended, not replaced."
          />
          {confirming && (
            <Alert variant="info" title="Confirm action">
              This bumps <code>users.tier_expires_at</code> and flips{" "}
              <code>users.tier=&apos;pro&apos;</code> for this learner. Reason: {grantReason.trim()}. Action recorded to{" "}
              <code>admin_audit_log</code>.
            </Alert>
          )}
        </div>
      </Dialog>

      <Dialog
        busy={processing}
        open={lockOpen}
        onOpenChange={(o) => {
          if (!o) {
            setLockOpen(false);
            setConfirming(false);
          }
        }}
        title={
          isBanned
            ? confirming
              ? "Confirm unlock"
              : "Unlock account"
            : confirming
              ? "Confirm lock"
              : "Lock account"
        }
        description={userEmail ? `Target: ${userEmail}` : undefined}
        footer={
          <DialogFooter>
            <button
              data-dialog-safe
              className="mp-btn mp-btn--secondary"
              onClick={() => {
                setLockOpen(false);
                setConfirming(false);
              }}
              disabled={processing}
            >
              Cancel
            </button>
            <button
              data-dialog-primary
              className={`mp-btn ${isBanned ? "mp-btn--primary" : "mp-btn--destructive"}`}
              onClick={submitLock}
              disabled={processing}
            >
              {processing
                ? "Applying…"
                : confirming
                  ? isBanned
                    ? "Confirm unlock"
                    : "Confirm lock"
                  : "Continue"}
            </button>
          </DialogFooter>
        }
      >
        <div className="space-y-3">
          <Textarea
            label="Reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              isBanned
                ? "Why are we restoring access?"
                : "Why is this account being locked?"
            }
          />
          {confirming && !isBanned && (
            <Alert variant="warning" title="Destructive action">
              Locking flips <code>users.is_banned=true</code>. The user&apos;s
              API calls will return 403. Other admins cannot be locked
              without first demoting their role.
            </Alert>
          )}
        </div>
      </Dialog>
    </>
  );
}
