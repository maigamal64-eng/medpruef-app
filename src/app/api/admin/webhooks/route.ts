import { adminErrorResponse } from "@/lib/admin/error-response";
import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";

export const dynamic = "force-dynamic";

export const GET = adminRouteShell(
  async () => {
    const sb = getServiceClient();
    const { data, error } = await sb
      .from("processed_webhook_events")
      .select("provider, event_id, processed_at")
      .order("processed_at", { ascending: false, nullsFirst: false })
      .limit(200);
    if (error) {
      return adminErrorResponse(error, "/api/admin/webhooks");
    }
    return NextResponse.json({ items: data || [] });
  },
  { route: "/api/admin/webhooks" }
);
