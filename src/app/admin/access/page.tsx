"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, LockKeyhole, Plus, RefreshCw, Save, Shield, Users } from "lucide-react";
import { Alert, BrandedLoader } from "@/components/ui";
import { authFetch } from "@/lib/authFetch";
import { AdminPageShell } from "../_components/AdminPageShell";
import { useAdminPermissions, type AdminPermission } from "@/lib/admin/useAdminPermissions";

interface AccessRole {
  id: string;
  key: string;
  name: string;
  description: string | null;
  system: boolean;
  updated_at: string;
  permissions: AdminPermission[];
}

interface Membership {
  user_id: string;
  email: string | null;
  name: string;
  roles: Array<{ key: string; name: string; assigned_at: string }>;
  legacy_unassigned: boolean;
}

interface AdminCandidate {
  id: string;
  name: string;
  email: string | null;
  current_role: string;
  membership_keys: string[];
}

const PERMISSION_GROUPS: Array<{ title: string; keys: AdminPermission[] }> = [
  { title: "Overview", keys: ["overview.read"] },
  { title: "People and access", keys: ["users.read", "users.write", "users.entitlements.write", "users.sessions.read", "users.sessions.write", "users.notes.read", "access.manage"] },
  { title: "Learning content", keys: ["content.read", "content.moderate"] },
  { title: "Feedback", keys: ["feedback.read", "feedback.manage"] },
  { title: "Revenue", keys: ["revenue.read", "revenue.reconcile", "revenue.manage"] },
  { title: "Platform", keys: ["system.read", "system.manage"] },
];

function humanizePermission(permission: AdminPermission): string {
  const names: Partial<Record<AdminPermission, string>> = {
    "overview.read": "View overview",
    "users.read": "View users",
    "users.write": "Edit user records",
    "users.entitlements.write": "Grant or change access",
    "users.sessions.read": "View session history",
    "users.sessions.write": "Manage user sessions",
    "users.notes.read": "View private learner notes",
    "content.read": "View study content",
    "content.moderate": "Moderate study content",
    "feedback.read": "View learner feedback",
    "feedback.manage": "Resolve learner feedback",
    "revenue.read": "View revenue records",
    "revenue.reconcile": "Reconcile subscriptions",
    "revenue.manage": "Manage purchase and referral cases",
    "system.read": "View platform operations",
    "system.manage": "Manage platform operations",
    "access.manage": "Manage admin roles and access",
  };
  return names[permission] ?? permission;
}

export default function AdminAccessPage() {
  const { actor, roles: actorRoles, permissions, loading: accessLoading, error: accessError, can } = useAdminPermissions();
  const allowed = can("access.manage");
  const actorIsOwner = actorRoles.some((role) => role.key === "owner");
  const [roles, setRoles] = useState<AccessRole[]>([]);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [permissionCatalog, setPermissionCatalog] = useState<AdminPermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedRoleKey, setSelectedRoleKey] = useState<string | null>(null);
  const [roleEditor, setRoleEditor] = useState<{ key: string; name: string; description: string; permissions: AdminPermission[] } | null>(null);
  const [membershipDrafts, setMembershipDrafts] = useState<Record<string, string[]>>({});
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidateResults, setCandidateResults] = useState<AdminCandidate[]>([]);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [candidateOffset, setCandidateOffset] = useState(0);
  const [candidateTotal, setCandidateTotal] = useState(0);
  const [candidateHasMore, setCandidateHasMore] = useState(false);

  const load = useCallback(async () => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [roleResponse, membershipResponse] = await Promise.all([
        authFetch("/api/admin/access/roles", { cache: "no-store" }),
        authFetch("/api/admin/access/memberships", { cache: "no-store" }),
      ]);
      if (!roleResponse.ok) throw new Error(`Could not load roles (${roleResponse.status}).`);
      if (!membershipResponse.ok) throw new Error(`Could not load admin accounts (${membershipResponse.status}).`);
      const [roleData, membershipData] = await Promise.all([roleResponse.json(), membershipResponse.json()]);
      const loadedRoles = Array.isArray(roleData.roles) ? roleData.roles as AccessRole[] : [];
      setRoles(loadedRoles);
      setPermissionCatalog(Array.isArray(roleData.permission_catalog) ? roleData.permission_catalog as AdminPermission[] : []);
      const loadedMemberships = Array.isArray(membershipData.memberships) ? membershipData.memberships as Membership[] : [];
      setMemberships(loadedMemberships);
      setMembershipDrafts(Object.fromEntries(loadedMemberships.map((membership) => [membership.user_id, membership.roles.map((role) => role.key)])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Admin access could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => {
    if (!accessLoading) void load();
  }, [accessLoading, load]);

  const selectedRole = useMemo(
    () => roles.find((role) => role.key === selectedRoleKey) ?? null,
    [roles, selectedRoleKey]
  );

  const membershipByUserId = useMemo(
    () => new Map(memberships.map((membership) => [membership.user_id, membership])),
    [memberships]
  );

  function beginCreateRole() {
    setSelectedRoleKey(null);
    setRoleEditor({ key: "", name: "", description: "", permissions: [] });
    setNotice(null);
  }

  function beginEditRole(role: AccessRole) {
    if (!canEditRole(role)) return;
    setSelectedRoleKey(role.key);
    setRoleEditor({ key: role.key, name: role.name, description: role.description ?? "", permissions: [...role.permissions] });
    setNotice(null);
  }

  function canEditRole(role: AccessRole): boolean {
    if (role.key === "owner") return false;
    if (actorIsOwner) return true;
    if (role.system || role.permissions.includes("access.manage")) return false;
    return role.permissions.every((permission) => permissions.includes(permission));
  }

  async function searchCandidates(event?: React.FormEvent<HTMLFormElement>, offset = candidateOffset) {
    event?.preventDefault();
    if (!allowed || candidateQuery.trim().length < 2) return;
    setCandidateOffset(offset);
    setCandidateLoading(true);
    setCandidateError(null);
    try {
      const params = new URLSearchParams({ q: candidateQuery.trim(), limit: "25", offset: String(offset) });
      const response = await authFetch(`/api/admin/access/candidates?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`User lookup failed (${response.status}).`);
      const payload = await response.json() as { candidates?: AdminCandidate[]; total?: number; has_more?: boolean };
      const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
      setCandidateResults(candidates);
      setCandidateTotal(typeof payload.total === "number" ? payload.total : candidates.length);
      setCandidateHasMore(payload.has_more === true);
      setMembershipDrafts((drafts) => {
        const next = { ...drafts };
        for (const candidate of candidates) {
          next[candidate.id] ??= candidate.membership_keys ?? [];
        }
        return next;
      });
    } catch (cause) {
      setCandidateError(cause instanceof Error ? cause.message : "User lookup failed.");
    } finally {
      setCandidateLoading(false);
    }
  }

  async function saveCandidate(candidate: AdminCandidate) {
    if (!allowed || candidate.id === actor?.userId) return;
    const roleKeys = membershipDrafts[candidate.id] ?? [];
    const assignedNames = roles.filter((role) => roleKeys.includes(role.key)).map((role) => role.name);
    const action = roleKeys.length === 0 ? "remove all admin roles from" : `grant ${assignedNames.join(", ")} to`;
    if (!window.confirm(`Confirm access change: ${action} ${candidate.name}? The server will record this change in the audit log.`)) return;
    setSaving(true);
    setCandidateError(null);
    setNotice(null);
    try {
      const response = await authFetch(`/api/admin/access/memberships/${encodeURIComponent(candidate.id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role_keys: roleKeys }),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(detail?.error || `Admin access update failed (${response.status}).`);
      }
      setNotice(roleKeys.length ? `Admin access granted to ${candidate.name}.` : `Admin access removed from ${candidate.name}.`);
      await Promise.all([load(), searchCandidates(undefined, candidateOffset)]);
    } catch (cause) {
      setCandidateError(cause instanceof Error ? cause.message : "Admin access update failed.");
    } finally {
      setSaving(false);
    }
  }

  function setRolePermission(permission: AdminPermission, checked: boolean) {
    setRoleEditor((editor) => {
      if (!editor) return editor;
      const next = checked
        ? [...new Set([...editor.permissions, permission])]
        : editor.permissions.filter((item) => item !== permission);
      return { ...editor, permissions: next };
    });
  }

  async function saveRole() {
    if (!roleEditor || !allowed) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updating = Boolean(selectedRoleKey);
      const response = await authFetch("/api/admin/access/roles", {
        method: updating ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          key: roleEditor.key.trim(),
          name: roleEditor.name.trim(),
          description: roleEditor.description.trim(),
          permissions: roleEditor.permissions,
        }),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(detail?.error || `Role save failed (${response.status}).`);
      }
      setNotice(updating ? "Role changes saved." : "Role created.");
      setRoleEditor(null);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Role save failed.");
    } finally {
      setSaving(false);
    }
  }

  function canAssignRole(role: AccessRole): boolean {
    if (role.key === "owner") return false;
    if (actorIsOwner) return true;
    if (role.permissions.includes("access.manage")) return false;
    const actorPermissionSet = new Set(permissions);
    return role.permissions.every((permission) => actorPermissionSet.has(permission));
  }

  async function saveMembership(membership: Membership) {
    if (!allowed || membership.user_id === actor?.userId) return;
    const roleKeys = membershipDrafts[membership.user_id] ?? [];
    const assignedNames = roles.filter((role) => roleKeys.includes(role.key)).map((role) => role.name);
    const action = roleKeys.length === 0 ? "remove all admin roles from" : `set ${assignedNames.join(", ")} for`;
    if (!window.confirm(`Confirm access change: ${action} ${membership.name}? The server will record this change in the audit log.`)) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await authFetch(`/api/admin/access/memberships/${encodeURIComponent(membership.user_id)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role_keys: roleKeys }),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(detail?.error || `Access update failed (${response.status}).`);
      }
      setNotice(`Access updated for ${membership.name}.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Access update failed.");
    } finally {
      setSaving(false);
    }
  }

  if (accessLoading) {
    return <div className="flex min-h-64 items-center justify-center"><BrandedLoader size={44} label="Checking admin access…" /></div>;
  }

  if (!allowed) {
    return (
      <AdminPageShell title="Admin access" description="Role and membership controls are restricted to authorized managers.">
        <Alert variant="error" title="Access restricted">
          {accessError || "Your current admin permissions do not include access management."}
        </Alert>
      </AdminPageShell>
    );
  }

  return (
    <AdminPageShell
      title="Admins & roles"
      description="Create least-privilege roles and assign them to admin accounts. Server permissions remain the enforcement boundary."
      onRefresh={load}
      actions={
        <button type="button" onClick={beginCreateRole} className="mp-btn mp-btn--primary mp-btn--sm flex items-center gap-1.5">
          <Plus size={13} /> New role
        </button>
      }
    >
      {error && <Alert variant="error" title="Could not complete the access operation">{error}</Alert>}
      {notice && <Alert variant="success" title="Saved">{notice}</Alert>}
      {loading ? (
        <div className="flex items-center justify-center py-14"><BrandedLoader size={48} label="Loading roles and admin accounts…" /></div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(260px,0.78fr)_minmax(0,1.45fr)]">
          <section aria-labelledby="roles-heading" className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 id="roles-heading" className="text-sm font-semibold text-[var(--mp-fg)]">Roles</h2>
                <p className="mt-1 text-xs text-[var(--mp-fg-muted)]">Permissions attach to roles. Members can have more than one role.</p>
              </div>
              <button type="button" onClick={() => void load()} className="rounded-md p-2 text-[var(--mp-fg-muted)] hover:bg-[var(--mp-surface-raised)]" aria-label="Refresh roles and admins"><RefreshCw size={14} /></button>
            </div>
            {roles.length === 0 ? (
              <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-5 text-sm text-[var(--mp-fg-muted)]">No active roles were returned.</div>
            ) : (
              <div className="space-y-2">
                {roles.map((role) => {
                  const isOwnerRole = role.key === "owner";
                  const selected = role.key === selectedRoleKey;
                  return (
                    <button
                      key={role.key}
                      type="button"
                      onClick={() => beginEditRole(role)}
                      disabled={!canEditRole(role)}
                      aria-pressed={selected}
                      className={`w-full rounded-xl border p-4 text-left transition-colors ${selected ? "border-[var(--mp-viridian)] bg-[var(--mp-viridian)]/10" : "border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] hover:border-[var(--mp-viridian)]/50"} disabled:cursor-default disabled:opacity-80`}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-[var(--mp-fg)]">{role.name}</span>
                          <span className="mt-0.5 block truncate font-mono text-[10px] text-[var(--mp-fg-muted)]">{role.key}</span>
                        </span>
                        {isOwnerRole ? <LockKeyhole size={14} className="shrink-0 text-amber-400" aria-label="Protected owner role" /> : <span className="shrink-0 text-[10px] text-[var(--mp-fg-muted)]">{role.permissions.length} permissions</span>}
                      </span>
                      {role.description && <span className="mt-2 block text-xs leading-relaxed text-[var(--mp-fg-muted)]">{role.description}</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          <section aria-labelledby="members-heading" className="space-y-3">
            <div>
              <h2 id="members-heading" className="text-sm font-semibold text-[var(--mp-fg)]">Admin accounts</h2>
              <p className="mt-1 text-xs text-[var(--mp-fg-muted)]">Changes apply immediately after the server confirms the update. You cannot change your own membership.</p>
            </div>
            {memberships.length === 0 ? (
              <div className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-5 text-sm text-[var(--mp-fg-muted)]">No admin accounts were returned.</div>
            ) : (
              <div className="space-y-3">
                {memberships.map((membership) => {
                  const self = membership.user_id === actor?.userId;
                  const targetOwner = membership.roles.some((role) => role.key === "owner");
                  const current = membership.roles.map((role) => role.key).sort().join(",");
                  const draft = [...(membershipDrafts[membership.user_id] ?? [])].sort().join(",");
                  const changed = current !== draft;
                  return (
                    <article key={membership.user_id} className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--mp-viridian)]/10 text-[var(--mp-viridian)]"><Users size={15} /></span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-[var(--mp-fg)]">{membership.name}{self ? <span className="ml-2 text-[10px] text-[var(--mp-fg-muted)]">You</span> : null}</span>
                            <span className="block truncate text-xs text-[var(--mp-fg-muted)]">{membership.email || "Email unavailable"}</span>
                          </span>
                        </div>
                        {changed && !self && (
                          <button type="button" onClick={() => void saveMembership(membership)} disabled={saving} className="mp-btn mp-btn--primary mp-btn--sm flex items-center gap-1.5 disabled:opacity-50">
                            <Save size={12} /> Save access
                          </button>
                        )}
                      </div>
                      {membership.legacy_unassigned && <p className="mt-3 rounded-md bg-amber-400/10 px-3 py-2 text-xs text-amber-200">This admin account has no assigned role, so admin permissions are currently denied.</p>}
                      <div className="mt-4 grid gap-2 sm:grid-cols-2">
                        {roles.filter(canAssignRole).map((role) => {
                          const checked = (membershipDrafts[membership.user_id] ?? []).includes(role.key);
                          const locked = self || (targetOwner && !actorIsOwner) || (targetOwner && role.key === "owner");
                          return (
                            <label key={role.key} className={`flex min-w-0 items-start gap-2 rounded-lg border border-[var(--mp-border-subtle)] px-3 py-2.5 text-xs ${locked ? "opacity-70" : "cursor-pointer hover:bg-[var(--mp-surface-sunken)]"}`}>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={locked || saving}
                                onChange={(event) => setMembershipDrafts((drafts) => ({
                                  ...drafts,
                                  [membership.user_id]: event.target.checked
                                    ? [...new Set([...(drafts[membership.user_id] ?? []), role.key])]
                                    : (drafts[membership.user_id] ?? []).filter((key) => key !== role.key),
                                }))}
                                className="mt-0.5 accent-[var(--mp-viridian)]"
                              />
                              <span className="min-w-0">
                                <span className="block font-medium text-[var(--mp-fg)]">{role.name}</span>
                                <span className="mt-0.5 block break-words text-[10px] text-[var(--mp-fg-muted)]">{role.permissions.map(humanizePermission).join(" · ")}</span>
                              </span>
                            </label>
                          );
                        })}
                      </div>
                      {(self || (targetOwner && !actorIsOwner)) && <p className="mt-2 text-[10px] text-[var(--mp-fg-muted)]">{self ? "Your membership is locked to prevent accidental lockout." : "Only an owner can change owner access."}</p>}
                    </article>
                  );
                })}
              </div>
            )}
          </section>

          <section aria-labelledby="candidate-heading" className="space-y-3 xl:col-span-2">
            <div>
              <h2 id="candidate-heading" className="text-sm font-semibold text-[var(--mp-fg)]">Add access to an existing account</h2>
              <p className="mt-1 text-xs text-[var(--mp-fg-muted)]">Find a registered user, then choose the exact role set to grant. No access is added until you save.</p>
            </div>
            <form onSubmit={(event) => void searchCandidates(event, 0)} className="flex flex-col gap-2 sm:flex-row">
              <label htmlFor="admin-candidate-search" className="sr-only">Search registered users by name or email</label>
              <input id="admin-candidate-search" value={candidateQuery} onChange={(event) => setCandidateQuery(event.target.value)} minLength={2} maxLength={100} placeholder="Search name or email" className="min-h-10 min-w-0 flex-1 rounded-lg border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-sunken)] px-3 text-sm text-[var(--mp-fg)]" />
              <button type="submit" disabled={candidateLoading || candidateQuery.trim().length < 2} className="mp-btn mp-btn--secondary mp-btn--sm disabled:opacity-50">{candidateLoading ? "Searching…" : "Search users"}</button>
            </form>
            {candidateError && <Alert variant="error" title="User lookup failed">{candidateError}</Alert>}
            {candidateResults.length > 0 && (
              <div className="space-y-3">
                {candidateResults.map((candidate) => {
                  const alreadyListed = membershipByUserId.has(candidate.id);
                  const roleKeys = membershipDrafts[candidate.id] ?? candidate.membership_keys ?? [];
                  const currentKeys = [...(candidate.membership_keys ?? [])].sort().join(",");
                  const draftKeys = [...roleKeys].sort().join(",");
                  const changed = currentKeys !== draftKeys;
                  return (
                    <article key={candidate.id} className="rounded-xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-[var(--mp-fg)]">{candidate.name}</p>
                          <p className="truncate text-xs text-[var(--mp-fg-muted)]">{candidate.email || "Email unavailable"} · current account type: {candidate.current_role}</p>
                        </div>
                        {alreadyListed ? <span className="text-xs text-[var(--mp-fg-muted)]">Already shown above</span> : changed && (
                          <button type="button" onClick={() => void saveCandidate(candidate)} disabled={saving} className="mp-btn mp-btn--primary mp-btn--sm flex items-center gap-1.5 disabled:opacity-50"><Save size={12} />Save access</button>
                        )}
                      </div>
                      {!alreadyListed && (
                        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                          {roles.filter(canAssignRole).map((role) => {
                            const checked = roleKeys.includes(role.key);
                            return (
                              <label key={role.key} className="flex min-w-0 cursor-pointer items-start gap-2 rounded-lg border border-[var(--mp-border-subtle)] px-3 py-2.5 text-xs hover:bg-[var(--mp-surface-sunken)]">
                                <input type="checkbox" checked={checked} disabled={saving} onChange={(event) => setMembershipDrafts((drafts) => ({
                                  ...drafts,
                                  [candidate.id]: event.target.checked ? [...new Set([...roleKeys, role.key])] : roleKeys.filter((key) => key !== role.key),
                                }))} className="mt-0.5 accent-[var(--mp-viridian)]" />
                                <span className="min-w-0"><span className="block font-medium text-[var(--mp-fg)]">{role.name}</span><span className="mt-0.5 block text-[10px] text-[var(--mp-fg-muted)]">{role.permissions.map(humanizePermission).join(" · ")}</span></span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                      {!alreadyListed && roleKeys.length === 0 && <p className="mt-2 text-[10px] text-[var(--mp-fg-muted)]">No admin roles selected. Saving an empty role set removes any existing admin membership.</p>}
                    </article>
                  );
                })}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--mp-border-subtle)] pt-3 text-xs text-[var(--mp-fg-muted)]">
                  <span>Showing {candidateOffset + 1}–{candidateOffset + candidateResults.length} of {candidateTotal.toLocaleString()} matches</span>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => void searchCandidates(undefined, Math.max(0, candidateOffset - 25))} disabled={candidateOffset === 0 || candidateLoading} className="mp-btn mp-btn--secondary mp-btn--sm disabled:opacity-40">Previous</button>
                    <button type="button" onClick={() => void searchCandidates(undefined, candidateOffset + 25)} disabled={!candidateHasMore || candidateLoading} className="mp-btn mp-btn--secondary mp-btn--sm disabled:opacity-40">Next</button>
                  </div>
                </div>
              </div>
            )}
            {!candidateLoading && candidateQuery.trim().length >= 2 && candidateResults.length === 0 && !candidateError && <p className="rounded-lg border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] px-4 py-3 text-xs text-[var(--mp-fg-muted)]">No registered users matched this search.</p>}
          </section>

          {roleEditor && (
            <section aria-labelledby="role-editor-heading" className="xl:col-span-2 rounded-2xl border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-raised)] p-4 sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 id="role-editor-heading" className="text-sm font-semibold text-[var(--mp-fg)]">{selectedRole ? `Edit ${selectedRole.name}` : "Create a role"}</h2>
                  <p className="mt-1 text-xs text-[var(--mp-fg-muted)]">Choose only the actions this team member needs. The server rejects permissions you cannot delegate.</p>
                </div>
                <button type="button" onClick={() => setRoleEditor(null)} className="rounded-md px-2 py-1 text-xs text-[var(--mp-fg-muted)] hover:bg-[var(--mp-surface-sunken)]">Cancel</button>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                {!selectedRoleKey && (
                  <label className="grid gap-1 text-xs text-[var(--mp-fg-muted)]">Role key
                    <input required maxLength={40} value={roleEditor.key} onChange={(event) => setRoleEditor({ ...roleEditor, key: event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, "-") })} placeholder="content-reviewer" className="min-h-10 rounded-lg border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-sunken)] px-3 text-sm text-[var(--mp-fg)]" />
                  </label>
                )}
                <label className="grid gap-1 text-xs text-[var(--mp-fg-muted)]">Display name
                  <input required minLength={2} maxLength={80} value={roleEditor.name} onChange={(event) => setRoleEditor({ ...roleEditor, name: event.target.value })} placeholder="Content reviewer" className="min-h-10 rounded-lg border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-sunken)] px-3 text-sm text-[var(--mp-fg)]" />
                </label>
                <label className="grid gap-1 text-xs text-[var(--mp-fg-muted)] md:col-span-2">Description
                  <textarea rows={2} maxLength={240} value={roleEditor.description} onChange={(event) => setRoleEditor({ ...roleEditor, description: event.target.value })} placeholder="Describe the work and limits for this role." className="rounded-lg border border-[var(--mp-border-subtle)] bg-[var(--mp-surface-sunken)] px-3 py-2 text-sm text-[var(--mp-fg)]" />
                </label>
              </div>
              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                {PERMISSION_GROUPS.map((group) => {
                  const available = group.keys.filter((permission) => permissionCatalog.includes(permission));
                  if (!available.length) return null;
                  return (
                    <fieldset key={group.title} className="min-w-0 rounded-xl border border-[var(--mp-border-subtle)] p-3">
                      <legend className="px-1 text-xs font-semibold text-[var(--mp-fg)]">{group.title}</legend>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {available.map((permission) => {
                          const checked = roleEditor.permissions.includes(permission);
                          const restricted = !actorIsOwner && (permission === "access.manage" || !permissions.includes(permission));
                          return (
                            <label key={permission} className={`flex items-start gap-2 rounded-md px-2 py-1.5 text-xs ${restricted ? "opacity-60" : "cursor-pointer hover:bg-[var(--mp-surface-sunken)]"}`}>
                              <input type="checkbox" checked={checked} disabled={restricted || saving} onChange={(event) => setRolePermission(permission, event.target.checked)} className="mt-0.5 accent-[var(--mp-viridian)]" />
                              <span className="min-w-0"><span className="block text-[var(--mp-fg)]">{humanizePermission(permission)}</span><span className="block break-all font-mono text-[9px] text-[var(--mp-fg-muted)]">{permission}</span></span>
                            </label>
                          );
                        })}
                      </div>
                    </fieldset>
                  );
                })}
              </div>
              {!actorIsOwner && <p className="mt-3 flex items-start gap-2 text-xs text-[var(--mp-fg-muted)]"><Shield size={13} className="mt-0.5 shrink-0" />You can delegate only permissions you already have, and cannot delegate admin access management.</p>}
              <div className="mt-5 flex justify-end">
                <button type="button" onClick={() => void saveRole()} disabled={saving || roleEditor.name.trim().length < 2 || roleEditor.permissions.length === 0 || (!selectedRoleKey && !/^[a-z][a-z0-9_-]{1,39}$/.test(roleEditor.key))} className="mp-btn mp-btn--primary mp-btn--sm flex items-center gap-1.5 disabled:opacity-50">
                  {saving ? <RefreshCw size={12} className="animate-spin" /> : <Check size={12} />}{selectedRole ? "Save role" : "Create role"}
                </button>
              </div>
            </section>
          )}
        </div>
      )}
      <p className="text-[10px] leading-relaxed text-[var(--mp-fg-muted)]">Client visibility helps prevent mistakes. Every protected API request checks current role grants on the server. A lost or stale access response hides controls and does not grant permission.</p>
    </AdminPageShell>
  );
}
