import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";

export const dynamic = "force-dynamic";

export const GET = adminRouteShell(
  async ({ req }) => {
    const sb = getServiceClient();
    const url = new URL(req.url);
    const actor = url.searchParams.get("actor_id");
    const action = url.searchParams.get("action");

    let q = sb
      .from("admin_audit_log")
      .select(
        "id, actor_email, action, target_type, target_id, payload, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (actor) q = q.eq("actor_id", actor);
    if (action) q = q.eq("action", action);

    const { data, error } = await q;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ items: data || [] });
  },
  { route: "/api/admin/audit" }
);
