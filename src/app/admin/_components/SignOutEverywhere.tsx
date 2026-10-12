"use client";

import { useState } from "react";
import { MonitorX } from "lucide-react";
import { authFetch as fetch } from "@/lib/authFetch";
import { clearSession } from "@/lib/auth";
import { Alert, Dialog, DialogFooter } from "@/components/ui";

/**
 * ADM-17: ends every session of the signed-in admin, including this one, so a
 * lost phone's token stops working. The server stamps session_invalidated_at.
 */
export function SignOutEverywhere({ collapsed }: { collapsed: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/session/revoke-all", { method: "POST" });
      if (!res.ok) throw new Error(`Could not sign out other devices (HTTP ${res.status}). Nothing changed.`);
      clearSession();
      window.location.replace("/login");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { setError(""); setOpen(true); }}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-[var(--mp-fg-muted)] hover:bg-[var(--mp-surface-sunken)]"
        title="Sign out all devices"
      >
        <MonitorX size={14} />
        {!collapsed && <span>Sign out all devices</span>}
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => { if (!busy) setOpen(next); }}
        title="Sign out all devices?"
        description="Every device signed in to this admin account is signed out, including this one. Use it if a phone or laptop is lost."
        footer={(
          <DialogFooter>
            <button type="button" className="mp-btn mp-btn--secondary" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="mp-btn mp-btn--destructive" disabled={busy} onClick={() => void confirm()}>
              {busy ? "Signing out…" : "Sign out all devices"}
            </button>
          </DialogFooter>
        )}
      >
        <p className="text-sm text-[var(--mp-fg-muted)]">You will need to sign in again here afterwards.</p>
        {error && <Alert variant="error" title="Not signed out">{error}</Alert>}
      </Dialog>
    </>
  );
}
