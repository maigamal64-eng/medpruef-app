import { NextRequest, NextResponse } from "next/server";
import { adminRouteShell } from "@/lib/admin/shell";
import { getServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export const PUT = adminRouteShell(async ({ req, actor }) => {
  const { userId } = await reqRouteParams(req);
  const body = await req.json().catch(() => null) as null | { role_keys?: unknown };
  if (!body || !Array.isArray(body.role_keys) || body.role_keys.some((key) => typeof key !== "string") || new Set(body.role_keys).size !== body.role_keys.length) {
    return NextResponse.json({ error: "Expected a unique role_keys array. Empty array removes admin access." }, { status: 400 });
  }
  const { error } = await getServiceClient().rpc("admin_update_membership", {
    p_actor_id: actor.userId,
    p_target_user_id: userId,
    p_role_keys: body.role_keys,
    p_audit_context: {
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      user_agent: req.headers.get("user-agent") ?? null,
    },
  });
  if (error) {
    const status = error.code === "42501" ? 403 : error.code === "P0002" ? 404 : error.code === "22023" || error.code === "23514" ? 400 : 500;
    return NextResponse.json({ error: error.code === "42501" ? "Permission denied" : error.message }, { status });
  }
  return NextResponse.json({ ok: true });
}, { route: "/api/admin/access/memberships/update", rateLimit: { limit: 20, windowMs: 60_000 } });

async function reqRouteParams(req: NextRequest): Promise<{ userId: string }> {
  const parts = req.nextUrl.pathname.split("/").filter(Boolean);
  return { userId: parts.at(-1) ?? "" };
}
