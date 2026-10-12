import { adminErrorResponse } from "@/lib/admin/error-response";
import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";

export const dynamic = "force-dynamic";

export const GET = adminRouteShell(
  async () => {
    const sb = getServiceClient();
    const { data, error, count } = await sb
      .from("processed_webhook_events")
      .select("provider, event_id, processed_at", { count: "exact" })
      // a19: admin alert claims share this table; they are not webhook deliveries.
      .neq("provider", "admin_alert")
      .order("processed_at", { ascending: false, nullsFirst: false })
      .limit(200);
    if (error) {
      return adminErrorResponse(error, "/api/admin/webhooks");
    }
    // UX-ADM-34: say how many exist. The page moved to /admin/payments#deliveries (a14).
    return NextResponse.json({ items: data || [], total: count ?? null, limit: 200 });
  },
  { route: "/api/admin/webhooks" }
);
