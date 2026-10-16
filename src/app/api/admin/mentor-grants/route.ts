import { NextResponse } from "next/server";
import { adminRouteShell } from "@/lib/admin/shell";
import { canAccessAdminPermission, loadAdminPermissionSnapshot } from "@/lib/admin/permissions";
import { getServiceClient } from "@/lib/supabase";
import { readFreeCreditConfig } from "@/lib/mentor/credits/free-credits";
import { loadFreeGrantSummary } from "@/lib/mentor/credits/free-grants-admin";
import { readRewardConfig } from "@/lib/rewards-program";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** GET /api/admin/mentor-grants (revenue.read): free mentor credit grants this Vienna month, per kind and newest 50. */
export const GET = adminRouteShell(async ({ actor }) => {
  if (!canAccessAdminPermission(await loadAdminPermissionSnapshot(actor.userId), "revenue.read")) {
    return NextResponse.json({ error: "Your admin role cannot read mentor grants." }, { status: 403 });
  }
  const summary = await loadFreeGrantSummary(getServiceClient(), readFreeCreditConfig(), new Date(), readRewardConfig());
  return NextResponse.json(summary, { headers: { "cache-control": "no-store" } });
}, { route: "/api/admin/mentor-grants" });
