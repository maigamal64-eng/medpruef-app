import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";

export const dynamic = "force-dynamic";

export const GET = adminRouteShell(
  async () => {
    const sb = getServiceClient();
    const { data, error } = await sb
      .from("flags")
      .select("key, description, env, enabled, rollout_pct, updated_at")
      .order("updated_at", { ascending: false });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ items: data || [] });
  },
  { route: "/api/admin/flags" }
);
