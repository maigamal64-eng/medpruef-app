import { NextResponse } from "next/server";
import { adminRouteShell } from "@/lib/admin/shell";
import { getServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = adminRouteShell(async ({ req }) => {
  const rawQuery = req.nextUrl.searchParams.get("q") ?? "";
  const query = rawQuery.trim().replace(/[^\p{L}\p{N}@.+\- ]/gu, " ").replace(/\s+/g, " ").trim();
  if (query.length < 2 || query.length > 100) {
    return NextResponse.json({ error: "q must contain between 2 and 100 searchable characters" }, { status: 400 });
  }
  const parsedLimit = Number(req.nextUrl.searchParams.get("limit") ?? 25);
  const parsedOffset = Number(req.nextUrl.searchParams.get("offset") ?? 0);
  if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 50 ||
      !Number.isInteger(parsedOffset) || parsedOffset < 0 || parsedOffset > 1_000_000) {
    return NextResponse.json({ error: "limit must be 1-50 and offset must be a nonnegative integer" }, { status: 400 });
  }

  const { data: users, count, error } = await getServiceClient()
    .from("users")
    .select("id, email, first_name, last_name, role", { count: "exact" })
    .or(`email.ilike.%${query}%,first_name.ilike.%${query}%,last_name.ilike.%${query}%`)
    .order("created_at", { ascending: false })
    .range(parsedOffset, parsedOffset + parsedLimit - 1);
  if (error) return NextResponse.json({ error: "Failed to search for admin candidates" }, { status: 500 });

  const userIds = (users ?? []).map((user) => user.id);
  const { data: memberships, error: membershipError } = userIds.length
    ? await getServiceClient()
      .from("admin_user_roles")
      .select("user_id, admin_roles(role_key)")
      .in("user_id", userIds)
    : { data: [], error: null };
  if (membershipError) return NextResponse.json({ error: "Failed to load candidate memberships" }, { status: 500 });

  const rolesByUser = new Map<string, string[]>();
  for (const assignment of memberships ?? []) {
    const role = assignment.admin_roles as unknown as { role_key: string };
    rolesByUser.set(assignment.user_id, [...(rolesByUser.get(assignment.user_id) ?? []), role.role_key]);
  }
  const candidates = (users ?? []).map((user) => ({
    id: user.id,
    name: [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email || "Unknown user",
    email: user.email,
    current_role: user.role,
    membership_keys: rolesByUser.get(user.id) ?? [],
  }));
  const total = count ?? 0;
  return NextResponse.json({ candidates, total, limit: parsedLimit, offset: parsedOffset, has_more: parsedOffset + candidates.length < total });
}, { route: "/api/admin/access/candidates", rateLimit: { limit: 30, windowMs: 60_000 } });
