import { NextResponse } from "next/server";
import { adminRouteShell } from "@/lib/admin/shell";
import { getServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export const GET = adminRouteShell(async () => {
  const db = getServiceClient();
  const { data: users, error: userError } = await db
    .from("users")
    .select("id, email, first_name, last_name, role, created_at")
    .eq("role", "admin")
    .order("created_at", { ascending: true });
  if (userError) return NextResponse.json({ error: "Failed to load admin accounts" }, { status: 500 });
  const ids = (users ?? []).map((user) => user.id);
  const { data: assignments, error: assignmentError } = ids.length
    ? await db.from("admin_user_roles").select("user_id, assigned_at, admin_roles(role_key, name)").in("user_id", ids)
    : { data: [], error: null };
  if (assignmentError) return NextResponse.json({ error: "Failed to load admin memberships" }, { status: 500 });
  const byUser = new Map<string, Array<{ key: string; name: string; assigned_at: string }>>();
  for (const row of assignments ?? []) {
    const role = row.admin_roles as unknown as { role_key: string; name: string };
    byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), { key: role.role_key, name: role.name, assigned_at: row.assigned_at }]);
  }
  return NextResponse.json({
    memberships: (users ?? []).map((user) => ({
      user_id: user.id,
      email: user.email,
      name: [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email || "Admin account",
      roles: byUser.get(user.id) ?? [],
      legacy_unassigned: (byUser.get(user.id) ?? []).length === 0,
    })),
  });
}, { route: "/api/admin/access/memberships" });
