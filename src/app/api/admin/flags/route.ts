import { adminErrorResponse } from "@/lib/admin/error-response";
import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export const GET = adminRouteShell(
  async () => {
    const sb = getServiceClient();
    const { data, error } = await sb
      .from("flags")
      .select("key, description, env, enabled, rollout_pct, updated_at")
      .order("updated_at", { ascending: false });
    if (error) {
      return adminErrorResponse(error, "/api/admin/flags");
    }
    return NextResponse.json({ items: data || [] });
  },
  { route: "/api/admin/flags" }
);
