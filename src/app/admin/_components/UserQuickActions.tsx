"use client";

/**
 * Per-user admin quick actions — Grant N days of Pro, Lock/Unlock account.
 *
 * §2.4 of the April 23 admin revamp sprint.
 * 2-step confirmation on every mutation + audit-logged server-side.
 */

import { useState } from "react";
import { Gift, Lock, Unlock } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
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
  isBanned?: boolean;
  onChanged?: () => void;
}

export function UserQuickActions({
  userId,
  userEmail,
  isBanned,
  onChanged,
}: UserQuickActionsProps) {
  const toast = useToast();
  const [grantOpen, setGrantOpen] = useState(false);
  const [lockOpen, setLockOpen] = useState(false);
  const [days, setDays] = useState("30");
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [processing, setProcessing] = useState(false);

  async function submitGrant() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setProcessing(true);
    try {
      const res = await fetch("/api/admin/users/grant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, days: Number(days) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error || "Grant failed");
      toast.success(`Granted ${days} days`, `New expiry: ${new Date(body.new_expiry).toLocaleDateString()}`);
      setGrantOpen(false);
      setConfirming(false);
      setDays("30");
      onChanged?.();
    } catch (e) {
      toast.error((e as Error).message || "Grant failed");
    } finally {
      setProcessing(false);
    }
  }

  async function submitLock() {
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

  return (
    <>
      <div className="flex flex-wrap gap-2">
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
      </div>

      <Dialog
        open={grantOpen}
        onOpenChange={(o) => {
          if (!o) {
            setGrantOpen(false);
            setConfirming(false);
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
              }}
              disabled={processing}
            >
              Cancel
            </button>
            <button
              className="mp-btn mp-btn--primary"
              onClick={submitGrant}
              disabled={processing || !days || Number(days) <= 0}
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
              <code>users.tier=&apos;pro&apos;</code>. Action recorded to{" "}
              <code>admin_audit_log</code>.
            </Alert>
          )}
        </div>
      </Dialog>

      <Dialog
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
