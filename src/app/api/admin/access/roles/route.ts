import { NextRequest, NextResponse } from "next/server";
import { adminRouteShell } from "@/lib/admin/shell";
import { ADMIN_PERMISSION_KEYS } from "@/lib/admin/permissions";
import { getServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export const GET = adminRouteShell(async () => {
  const { data, error } = await getServiceClient()
    .from("admin_roles")
    .select("id, role_key, name, description, is_system, is_active, updated_at, admin_role_permissions(permission_key)")
    .eq("is_active", true)
    .order("name");
  if (error) return NextResponse.json({ error: "Failed to load admin roles" }, { status: 500 });
  const roles = (data ?? []).map((row) => ({
    id: row.id,
    key: row.role_key,
    name: row.name,
    description: row.description,
    system: row.is_system,
    updated_at: row.updated_at,
    permissions: (row.admin_role_permissions ?? []).map((permission) => permission.permission_key),
  }));
  return NextResponse.json({ roles, permission_catalog: ADMIN_PERMISSION_KEYS });
}, { route: "/api/admin/access/roles" });

export const POST = adminRouteShell(async ({ req, actor }) => {
  const body = await req.json().catch(() => null) as null | { key?: unknown; name?: unknown; description?: unknown; permissions?: unknown };
  if (!body || typeof body.key !== "string" || typeof body.name !== "string" ||
      (body.description !== undefined && typeof body.description !== "string") ||
      !Array.isArray(body.permissions) || body.permissions.some((key) => typeof key !== "string")) {
    return NextResponse.json({ error: "Expected key, name, optional description, and an explicit permissions array" }, { status: 400 });
  }
  const { data, error } = await getServiceClient().rpc("admin_create_role", {
    p_actor_id: actor.userId,
    p_role_key: body.key,
    p_name: body.name,
    p_description: body.description ?? "",
    p_permissions: body.permissions,
    p_audit_context: auditContext(req),
  });
  if (error) return rpcError(error);
  return NextResponse.json({ ok: true, role_id: data }, { status: 201 });
}, { route: "/api/admin/access/roles/create", rateLimit: { limit: 20, windowMs: 60_000 } });

export const PUT = adminRouteShell(async ({ req, actor }) => {
  const body = await req.json().catch(() => null) as null | { key?: unknown; name?: unknown; description?: unknown; permissions?: unknown };
  if (!body || typeof body.key !== "string" || typeof body.name !== "string" ||
      (body.description !== undefined && typeof body.description !== "string") ||
      !Array.isArray(body.permissions) || body.permissions.some((key) => typeof key !== "string")) {
    return NextResponse.json({ error: "Expected key, name, optional description, and an explicit permissions array" }, { status: 400 });
  }
  const { error } = await getServiceClient().rpc("admin_update_role", {
    p_actor_id: actor.userId,
    p_role_key: body.key,
    p_name: body.name,
    p_description: body.description ?? "",
    p_permissions: body.permissions,
    p_audit_context: auditContext(req),
  });
  if (error) return rpcError(error);
  return NextResponse.json({ ok: true });
}, { route: "/api/admin/access/roles/update", rateLimit: { limit: 20, windowMs: 60_000 } });

function auditContext(req: NextRequest) {
  return {
    ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    user_agent: req.headers.get("user-agent") ?? null,
  };
}

function rpcError(error: { code?: string; message: string }) {
  const status = error.code === "42501" ? 403
    : error.code === "P0002" ? 404
    : error.code === "23505" ? 409
    : error.code === "22023" || error.code === "23514" ? 400
    : 500;
  return NextResponse.json({ error: error.code === "42501" ? "Permission denied" : error.message }, { status });
}
