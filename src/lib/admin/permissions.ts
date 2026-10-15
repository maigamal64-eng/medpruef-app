/** Permission catalog and fail-closed mapping for admin API routes. */
export const ADMIN_PERMISSION_KEYS = [
  "overview.read",
  "users.read",
  "users.write",
  "users.entitlements.write",
  "users.sessions.write",
  "users.sessions.read",
  "users.notes.read",
  "content.read",
  "content.moderate",
  "feedback.read",
  "feedback.manage",
  "revenue.read",
  "revenue.reconcile",
  "revenue.manage",
  "system.read",
  "system.manage",
  "access.manage",
] as const;

export type AdminPermission = (typeof ADMIN_PERMISSION_KEYS)[number];

/**
 * The API route is the security boundary. New admin endpoints without an
 * explicit entry here are denied until an owner classifies them.
 */
export function permissionForAdminRequest(
  pathname: string,
  method: string,
): AdminPermission | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  const verb = method.toUpperCase();

  if (path === "/api/admin/access/me") return null;
  if (path === "/api/admin/session/revoke-all") return null; // self-service, see canAuthorizeAdminRequest
  if (path === "/api/admin/inbox") return null; // a15: per-count permission checks in the handler, see canAuthorizeAdminRequest
  if (path === "/api/admin/ops/oauth/interaction") return verb === "GET" ? "access.manage" : null;
  if (path === "/api/admin/ops/oauth/consent") return verb === "POST" ? "access.manage" : null;
  if (path === "/api/admin/ops/oauth/deny") return verb === "POST" ? "access.manage" : null;
  if (path === "/api/admin/ops/connections") return verb === "GET" ? "access.manage" : null;
  if (/^\/api\/admin\/ops\/connections\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/disconnect$/i.test(path)) return verb === "POST" ? "access.manage" : null;
  if (path === "/api/admin/ops/actions") return verb === "GET" ? "access.manage" : null;
  if (/^\/api\/admin\/ops\/actions\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(approve|reject)$/i.test(path)) return verb === "POST" ? "access.manage" : null;
  if (path === "/api/admin/access/roles") return ["GET", "POST", "PUT"].includes(verb) ? "access.manage" : null;
  if (path === "/api/admin/access/memberships") return verb === "GET" ? "access.manage" : null;
  if (path === "/api/admin/access/candidates") return verb === "GET" ? "access.manage" : null;
  if (/^\/api\/admin\/access\/memberships\/[^/]+$/.test(path)) return verb === "PUT" ? "access.manage" : null;

  if (path === "/api/admin/overview") return verb === "GET" ? "overview.read" : null;
  if (path === "/api/stats/admin") return verb === "GET" ? "overview.read" : null;
  if (path.startsWith("/api/stats/admin/")) {
    if (/^\/api\/stats\/admin\/users\/[^/]+$/.test(path)) return verb === "GET" ? "users.read" : null;
    if (path === "/api/stats/admin/users") {
      return verb === "GET" ? "users.read" : verb === "PATCH" ? "users.write" : null;
    }
    if (path === "/api/stats/admin/payments" || path === "/api/stats/admin/payments/trace" || path === "/api/stats/admin/growth" || path === "/api/stats/admin/growth/content") return verb === "GET" ? "revenue.read" : null;
    if (["/api/stats/admin/questions", "/api/stats/admin/duplicates", "/api/stats/admin/missing-images", "/api/stats/admin/explanations/downvoted"].includes(path)) {
      if (verb === "GET") return "content.read";
      if (path.endsWith("/questions") && verb === "PATCH") return "content.moderate";
      return null;
    }
    return null;
  }

  if (path === "/api/feedback") {
    if (verb === "POST") return null; // learner feedback submission is public
    return verb === "GET" ? "feedback.read" : verb === "PATCH" ? "feedback.manage" : null;
  }
  if (path === "/api/suggestions") {
    if (verb === "POST") return null; // learner question report submission is public
    return verb === "GET" ? "content.read" : verb === "PATCH" ? "content.moderate" : null;
  }

  if (path === "/api/admin/users") return verb === "GET" ? "users.read" : verb === "PATCH" ? "users.write" : null;
  if (path === "/api/admin/users/lock" || /^\/api\/admin\/users\/[^/]+\/force-refresh-session$/.test(path)) return verb === "POST" ? "users.sessions.write" : null;
  if (path === "/api/admin/users/grant") return verb === "POST" ? "users.entitlements.write" : null;
  if (path === "/api/admin/users/names") return verb === "GET" ? "users.read" : null;
  if (path === "/api/admin/subscriptions") return verb === "GET" ? "revenue.read" : null;
  // a-anthropic-features: Anthropic workspace spend meter and per-feature cache hit rate.
  if (path === "/api/admin/ai-spend") return verb === "GET" ? "revenue.read" : null;
  if (path === "/api/admin/payments/resolve") return verb === "POST" ? "revenue.manage" : null;
  if (path === "/api/admin/referrals" || path === "/api/admin/referrals/pending-exam-rewards") return verb === "GET" ? "revenue.read" : null;
  if (["/api/admin/referrals/grant-exam-reward", "/api/admin/referrals/mark-paid", "/api/admin/puyp/bulk-approve"].includes(path)) return verb === "POST" ? "revenue.manage" : null;
  if (path === "/api/puyp/admin") return verb === "GET" ? "revenue.read" : verb === "POST" ? "revenue.manage" : null;
  if (path === "/api/admin/note-reports") return verb === "GET" ? "content.read" : verb === "POST" ? "content.moderate" : null;
  // a-free-credit-hooks: campaign codes, the free grant log and the testimonial
  // reward (which also requires revenue.manage, checked in the route).
  if (path === "/api/admin/mentor-campaigns") return verb === "GET" ? "revenue.read" : verb === "POST" ? "revenue.manage" : null;
  if (/^\/api\/admin\/mentor-campaigns\/[^/]+$/.test(path)) return verb === "PATCH" ? "revenue.manage" : null;
  if (path === "/api/admin/mentor-grants") return verb === "GET" ? "revenue.read" : null;
  if (path === "/api/admin/feedback/reward") return verb === "POST" ? "feedback.manage" : null;
  // a-db-relief-1: purge the 24 h bank-wide caches after a content change.
  if (path === "/api/admin/revalidate-bank") return verb === "POST" ? "content.moderate" : null;
  if (path === "/api/admin/flags") return verb === "GET" ? "system.read" : null;
  // a40 (OW-66): AI Mentor admin. The learner panel, beta search and beta cohort
  // also require a second grant, checked by requireMentorAdmin(req, also).
  if (["/api/mentor/admin/summary", "/api/mentor/admin/operations", "/api/mentor/admin/funnel", "/api/mentor/admin/learner", "/api/mentor/admin/revenue"].includes(path)) return verb === "GET" ? "revenue.read" : null;
  if (path === "/api/mentor/admin/review") return verb === "GET" ? "content.read" : verb === "POST" ? "content.moderate" : null;
  if (path === "/api/mentor/admin/flags") return verb === "GET" ? "system.read" : verb === "POST" ? "system.manage" : null;
  if (path === "/api/mentor/admin/beta") return verb === "GET" || verb === "POST" ? "system.manage" : null;
  if (path === "/api/mentor/admin/beta/cohort") return verb === "GET" ? "revenue.read" : verb === "POST" ? "system.manage" : null;
  if (path === "/api/admin/audit" || path === "/api/admin/audit-log/latest" || path === "/api/admin/crons" || path === "/api/admin/system-status" || path === "/api/admin/ai-auth-check" || path === "/api/admin/deploys" || path === "/api/admin/env" || path === "/api/admin/errors" || path === "/api/admin/webhooks") return verb === "GET" ? "system.read" : null;
  return null;
}

export interface AdminPermissionSnapshot {
  roles: Array<{ key: string; name: string }>;
  permissions: AdminPermission[];
}

/** Reads live grants on every request so revocations take effect immediately. */
export async function loadAdminPermissionSnapshot(
  userId: string,
): Promise<AdminPermissionSnapshot | null> {
  const { getServiceClient } = await import("@/lib/supabase");
  const db = getServiceClient();
  const { data: assignments, error: assignmentsError } = await db
    .from("admin_user_roles")
    .select("role_id, admin_roles!inner(role_key, name, is_active)")
    .eq("user_id", userId)
    .eq("admin_roles.is_active", true);
  if (assignmentsError) throw assignmentsError;
  if (!assignments?.length) return null;

  const roleIds = [...new Set(assignments.map((row) => row.role_id as string))];
  const { data: grants, error: grantsError } = await db
    .from("admin_role_permissions")
    .select("permission_key")
    .in("role_id", roleIds);
  if (grantsError) throw grantsError;

  return {
    roles: assignments.map((row) => {
      const role = row.admin_roles as unknown as { role_key: string; name: string };
      return { key: role.role_key, name: role.name };
    }),
    permissions: [...new Set((grants ?? []).map((row) => row.permission_key as AdminPermission))],
  };
}

export function canAccessAdminPermission(
  snapshot: AdminPermissionSnapshot | null,
  permission: AdminPermission,
): boolean {
  if (!snapshot) return false;
  return snapshot.permissions.includes(permission);
}

export function canAuthorizeAdminRequest(
  userRole: string | null | undefined,
  snapshot: AdminPermissionSnapshot | null,
  pathname: string,
  method: string,
): boolean {
  if (userRole !== "admin") return false;
  if (pathname.replace(/\/+$/, "") === "/api/admin/access/me" && method.toUpperCase() === "GET") {
    return snapshot !== null;
  }
  // ADM-17: any admin may end every session of their OWN account.
  if (pathname.replace(/\/+$/, "") === "/api/admin/session/revoke-all" && method.toUpperCase() === "POST") {
    return snapshot !== null;
  }
  // a15: inbox counts; the handler returns only counts the admin may read
  // (content.read / feedback.read), null for the rest.
  if (pathname.replace(/\/+$/, "") === "/api/admin/inbox" && method.toUpperCase() === "GET") {
    return snapshot !== null;
  }
  const permission = permissionForAdminRequest(pathname, method);
  return permission !== null && canAccessAdminPermission(snapshot, permission);
}

/** Mirrors the database RPC's privilege-escalation boundary. */
export function canDelegateAdminPermissions(
  actorIsOwner: boolean,
  actorPermissions: readonly string[],
  requestedPermissions: readonly string[],
): boolean {
  if (new Set(requestedPermissions).size !== requestedPermissions.length) return false;
  if (requestedPermissions.some((key) => !ADMIN_PERMISSION_KEYS.includes(key as AdminPermission))) return false;
  if (actorIsOwner) return requestedPermissions.length > 0;
  return !requestedPermissions.includes("access.manage") &&
    requestedPermissions.every((key) => actorPermissions.includes(key));
}
