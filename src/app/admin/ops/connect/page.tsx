"use client";

/**
 * Connect MedPrüf Ops (a17: ADM-09 A, UX-ADM-14).
 *
 * The owner chooses which requested permissions to share. Approval only
 * completes in the browser that started the connection: the issuer returns a
 * one-time token that this page hands back (?bind=) together with the
 * starting browser's own cookie. A forwarded link therefore hands no tokens to
 * whoever started it (consent still replaces the owner's own grant for that client).
 * Cancel tells the client "no" instead of leaving the request open.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";
import { Alert, Skeleton } from "@/components/ui";
import { OPS_PREPARE_SCOPES, isOpsScope, opsScopeLabel } from "@/lib/ops/scopes";
import { issuerDestination } from "@/lib/ops/oauth-client";
import { AdminPageShell } from "../../_components/AdminPageShell";

interface Interaction { interaction_id: string; client_id: string; requested_scopes: string[]; prompt: string }
type Phase = "review" | "connecting" | "declined" | "done";

async function readBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  } catch { return {}; }
}
function failure(response: Response, body: Record<string, unknown>, fallback: string): string {
  if (typeof body.error === "string" && body.error) return body.error;
  return response.status >= 500 ? `Server error ${response.status}. Try again.` : fallback;
}

export default function ConnectOpsPage() {
  const access = useAdminPermissions();
  const allowed = !access.loading && !access.error && access.roles.some((role) => role.key === "owner") && access.can("access.manage");
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>("review");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fallbackLink, setFallbackLink] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!allowed) { setLoading(false); return; }
    setLoading(true); setError(null); setInteraction(null); setSelected([]);
    const uid = new URLSearchParams(window.location.search).get("interaction_id");
    try {
      if (!uid || !/^[A-Za-z0-9_-]{16,128}$/.test(uid)) throw new Error("This connection link is not valid.");
      const response = await authFetch(`/api/admin/ops/oauth/interaction?interaction_id=${encodeURIComponent(uid)}`, { cache: "no-store" });
      const data = await readBody(response);
      if (!response.ok) throw new Error(failure(response, data, "This connection request could not be loaded."));
      if (typeof data.client_id !== "string" || !Array.isArray(data.requested_scopes) || !data.requested_scopes.length || data.requested_scopes.some((scope) => typeof scope !== "string")) {
        throw new Error("This connection request could not be read.");
      }
      setInteraction(data as unknown as Interaction);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "This connection request could not be loaded."); }
    finally { setLoading(false); }
  }, [allowed]);

  useEffect(() => { if (!access.loading) void load(); }, [access.loading, load]);

  async function consent() {
    if (!allowed || !interaction || !selected.length || busy) return;
    setBusy(true); setError(null);
    let destination: string | null = null;
    try {
      const response = await authFetch("/api/admin/ops/oauth/consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ interaction_id: interaction.interaction_id, scopes: selected }) });
      const data = await readBody(response);
      if (!response.ok) throw new Error(failure(response, data, "The connection could not be completed."));
      destination = issuerDestination(data.returnTo, data.issuer, data.binding);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The connection could not be completed.");
      setBusy(false);
      return;
    }
    // Consent is recorded at this point. A bad return address is reported as
    // such, never as a failed consent (UX-ADM-14), and the button stays off.
    setPhase("connecting");
    if (!destination) { setError("Your approval was saved, but the return address could not be verified. Start the connection again from ChatGPT; nothing will connect from this approval."); return; }
    // The one-time ?bind= address is never rendered as a link, so it cannot be copied on.
    window.location.assign(destination);
  }

  async function decline() {
    if (!allowed || !interaction || busy) return;
    setBusy(true); setError(null);
    try {
      const response = await authFetch("/api/admin/ops/oauth/deny", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ interaction_id: interaction.interaction_id }) });
      const data = await readBody(response);
      if (!response.ok) throw new Error(failure(response, data, "The request could not be declined."));
      setPhase("declined");
      const destination = issuerDestination(data.returnTo, data.issuer);
      if (destination) { setFallbackLink(destination); window.location.assign(destination); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The request could not be declined."); }
    finally { setBusy(false); }
  }

  const viewScopes = interaction?.requested_scopes.filter((scope) => !OPS_PREPARE_SCOPES.has(scope)) ?? [];
  const prepareScopes = interaction?.requested_scopes.filter((scope) => OPS_PREPARE_SCOPES.has(scope)) ?? [];
  const toggle = (scope: string, on: boolean) => setSelected((current) => on ? [...new Set([...current, scope])] : current.filter((value) => value !== scope));
  const unknown = interaction?.requested_scopes.filter((scope) => !isOpsScope(scope)) ?? [];

  return <AdminPageShell title="Connect MedPrüf Ops" description="Review the permissions this ChatGPT connection is requesting.">
    {(access.loading || (allowed && loading)) && <Skeleton variant="card" />}
    {!access.loading && !allowed && (
      <Alert variant="info" title="Owner only">{access.error ?? "Only the current owner, signed in on this device, can approve an Ops connection."}</Alert>
    )}
    {error && (
      <Alert variant="error" title="Connection not completed">
        <p>{error}</p>
        <p className="mt-1">Start again from ChatGPT on the device where you are signed in to MedPrüf. <Link href="/admin/ops" className="underline underline-offset-2">Back to Ops approvals</Link></p>
      </Alert>
    )}
    {phase === "declined" && <Alert variant="success" title="Declined">Nothing was connected. You are being returned to ChatGPT. {fallbackLink && <a href={fallbackLink} className="underline underline-offset-2">Continue</a>}</Alert>}
    {phase === "connecting" && !error && <Alert variant="info" title="Finishing the connection">Returning to ChatGPT. If nothing happens, start the connection again from ChatGPT.</Alert>}

    {allowed && interaction && phase === "review" && <section className="max-w-2xl space-y-5 rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-5">
      <div className="flex gap-3"><ShieldCheck className="shrink-0 text-[var(--mp-viridian)]" size={24} aria-hidden /><div>
        <h2 className="font-semibold text-[var(--mp-fg)]">Choose the permissions to share</h2>
        <p className="mt-1 text-sm text-[var(--mp-fg-muted)]">Only approve a connection you started yourself, on this device, a moment ago. It will only finish in the browser that started it. Any change an agent prepares still needs your separate approval.</p>
      </div></div>
      <div><p className="text-xs text-[var(--mp-fg-muted)]">Client</p><p className="mt-1 break-all font-mono text-xs text-[var(--mp-fg)]">{interaction.client_id}</p></div>
      {unknown.length > 0 && <Alert variant="warning">This request includes permissions this page does not recognise. They are listed by their raw name; the server refuses any it does not support.</Alert>}
      {viewScopes.length > 0 && <fieldset className="space-y-2">
        <legend className="mb-2 flex w-full flex-wrap items-center justify-between gap-2 text-sm font-semibold text-[var(--mp-fg)]">
          <span>View</span>
          <button type="button" className="text-xs font-normal text-[var(--mp-viridian)] underline underline-offset-2" disabled={busy} onClick={() => setSelected((current) => [...new Set([...current, ...viewScopes])])}>Select all view-only</button>
        </legend>
        {viewScopes.map((scope) => <ScopeRow key={scope} scope={scope} checked={selected.includes(scope)} disabled={busy} onChange={toggle} />)}
      </fieldset>}
      {prepareScopes.length > 0 && <fieldset className="space-y-2">
        <legend className="mb-2 text-sm font-semibold text-[var(--mp-fg)]">Prepare changes <span className="font-normal text-[var(--mp-fg-muted)]">(you still approve each one)</span></legend>
        {prepareScopes.map((scope) => <ScopeRow key={scope} scope={scope} checked={selected.includes(scope)} disabled={busy} onChange={toggle} />)}
      </fieldset>}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={!selected.length || busy} aria-describedby="ops-connect-hint" onClick={() => void consent()} className="mp-btn mp-btn--primary">{busy ? "Connecting…" : "Approve and connect"}</button>
          <button type="button" disabled={busy} onClick={() => void decline()} className="mp-btn mp-btn--secondary">Decline</button>
        </div>
        <p id="ops-connect-hint" className="text-xs text-[var(--mp-fg-muted)]">{selected.length ? `${selected.length} of ${interaction.requested_scopes.length} permissions selected.` : "Select at least one permission to connect."}</p>
      </div>
    </section>}
  </AdminPageShell>;
}

function ScopeRow({ scope, checked, disabled, onChange }: { scope: string; checked: boolean; disabled: boolean; onChange: (scope: string, on: boolean) => void }) {
  return <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--mp-border-subtle)] p-3 text-sm text-[var(--mp-fg)]">
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(scope, event.target.checked)} className="mt-1 accent-[var(--mp-viridian)]" />
    <span>{opsScopeLabel(scope)}<span className="block font-mono text-xs text-[var(--mp-fg-muted)]">{scope}</span></span>
  </label>;
}
