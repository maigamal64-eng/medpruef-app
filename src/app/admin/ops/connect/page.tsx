"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { useAdminPermissions } from "@/lib/admin/useAdminPermissions";
import { AdminPageShell } from "../../_components/AdminPageShell";

const SCOPE_LABELS: Record<string, string> = {
  "users.read": "View bounded learner records",
  "users.sessions.read": "View bounded learner activity",
  "users.notes.read": "View bounded note-report summaries",
  "content.moderate": "Prepare moderation changes for separate owner approval",
  "content.read": "View bounded question and report records",
  "feedback.read": "View learner feedback",
  "feedback.manage": "Triage learner feedback",
  "users.entitlements.write": "Prepare access changes for separate owner approval",
  "revenue.read": "View payment and subscription records",
  "overview.read": "View business summaries",
  "system.read": "View operational records and approved context",
};
interface Interaction { interaction_id: string; client_id: string; requested_scopes: string[]; prompt: string }

export default function ConnectOpsPage() {
  const access = useAdminPermissions();
  const allowed = !access.loading && !access.error && access.roles.some((role) => role.key === "owner") && access.can("access.manage");
  const [interaction, setInteraction] = useState<Interaction | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true); setError(null); setInteraction(null); setSelected([]);
    const uid = new URLSearchParams(window.location.search).get("interaction_id");
    try {
      if (!uid || !/^[A-Za-z0-9_-]{16,128}$/.test(uid)) throw new Error("This connection link is invalid. Start again from the MCP client.");
      const response = await authFetch(`/api/admin/ops/oauth/interaction?interaction_id=${encodeURIComponent(uid)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Connection could not be loaded.");
      if (!data.client_id || !Array.isArray(data.requested_scopes) || !data.requested_scopes.length || data.requested_scopes.some((scope: unknown) => typeof scope !== "string" || !SCOPE_LABELS[scope])) throw new Error("The connection requested unsupported permissions.");
      setInteraction(data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Connection unavailable."); }
    finally { setLoading(false); }
  }, [allowed]);

  useEffect(() => { void load(); }, [load]);

  async function consent() {
    if (!allowed || !interaction || !selected.length || saving) return;
    setSaving(true); setError(null);
    try {
      const response = await authFetch("/api/admin/ops/oauth/consent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ interaction_id: interaction.interaction_id, scopes: selected }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Connection could not be completed.");
      const destination = new URL(data.returnTo);
      if (typeof data.issuer !== "string" || destination.origin !== data.issuer || destination.username || destination.password || !["https:", "http:"].includes(destination.protocol)) throw new Error("The connection return address could not be verified.");
      window.location.assign(destination.href);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Connection could not be completed."); setSaving(false); }
  }

  return <AdminPageShell title="Connect MedPrüf Ops" description="Review the permissions this ChatGPT connection is requesting." freshness="disconnected">
    {access.loading || loading ? <p role="status" className="text-sm text-[var(--mp-fg-muted)]">Verifying connection and owner access…</p> : null}
    {!access.loading && !allowed && <p role="alert" className="text-sm text-[var(--mp-fg-muted)]">{access.error ?? "A current owner with admin access management permission must approve this connection."}</p>}
    {error && <p role="alert" className="rounded-xl border border-red-500/30 p-4 text-sm text-[var(--mp-fg)]">{error}</p>}
    {allowed && interaction && <section className="max-w-2xl rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-5 space-y-5">
      <div className="flex gap-3"><ShieldCheck className="shrink-0 text-[var(--mp-viridian)]" size={24} /><div><h2 className="font-semibold text-[var(--mp-fg)]">Choose the permissions to share</h2><p className="mt-1 text-sm text-[var(--mp-fg-muted)]">The connection uses your current owner permissions. Individual access changes still require a separate approval of their exact payload.</p></div></div>
      <div><p className="text-xs text-[var(--mp-fg-muted)]">Verified client identifier</p><p className="mt-1 break-all font-mono text-xs text-[var(--mp-fg)]">{interaction.client_id}</p></div>
      <fieldset className="space-y-2"><legend className="mb-2 text-sm font-semibold text-[var(--mp-fg)]">Requested permissions</legend>{interaction.requested_scopes.map((scope) => <label key={scope} className="flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--mp-border-subtle)] p-3 text-sm text-[var(--mp-fg)]"><input type="checkbox" checked={selected.includes(scope)} disabled={saving} onChange={(event) => setSelected((current) => event.target.checked ? [...current, scope] : current.filter((value) => value !== scope))} className="mt-1 accent-[var(--mp-viridian)]" /><span>{SCOPE_LABELS[scope]}<span className="block text-xs font-mono text-[var(--mp-fg-muted)]">{scope}</span></span></label>)}</fieldset>
      <div className="flex flex-wrap items-center gap-3"><button type="button" disabled={!selected.length || saving} onClick={() => void consent()} className="mp-btn mp-btn--primary">{saving ? "Connecting…" : "Approve and connect"}</button><Link href="/admin/ops" className="mp-btn mp-btn--secondary">Cancel</Link></div>
    </section>}
  </AdminPageShell>;
}
