import { NextResponse } from "next/server";
import { adminRouteShell } from "@/lib/admin/shell";
import { logAdminAction } from "@/lib/admin/audit";
import { canAccessAdminPermission, loadAdminPermissionSnapshot } from "@/lib/admin/permissions";
import { getServiceClient } from "@/lib/supabase";
import { normalizeCampaignCode } from "@/lib/mentor/credits/free-credits";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * PATCH /api/admin/mentor-campaigns/<code> {active} (revenue.manage): pause
 * or resume a code. Compare-and-set on the current state; audited with
 * before and after. Credits already granted stay (they expire on their own).
 */
export const PATCH = adminRouteShell(async ({ req, actor }) => {
  if (!canAccessAdminPermission(await loadAdminPermissionSnapshot(actor.userId), "revenue.manage")) {
    return NextResponse.json({ error: "Your admin role cannot change campaign codes." }, { status: 403 });
  }
  const code = normalizeCampaignCode(decodeURIComponent(new URL(req.url).pathname.split("/").pop() ?? ""));
  const body = (await req.json().catch(() => null)) as { active?: unknown } | null;
  if (!code || typeof body?.active !== "boolean") return NextResponse.json({ error: "code and active (true or false) required" }, { status: 400 });
  const { data, error } = await getServiceClient().from("ai_credit_campaign")
    .update({ active: body.active, updated_at: new Date().toISOString() })
    .eq("code", code).eq("active", !body.active).select("code").maybeSingle();
  if (error) throw error;
  if (!data) return NextResponse.json({ error: "Code not found, or it is already in that state." }, { status: 409 });
  await logAdminAction({ req, actorId: actor.userId, actorEmail: actor.email, action: body.active ? "mentor_campaign_resumed" : "mentor_campaign_paused", targetType: "ai_credit_campaign", targetId: code, payload: { before: { active: !body.active }, after: { active: body.active } } });
  return NextResponse.json({ ok: true, code, active: body.active });
}, { route: "/api/admin/mentor-campaigns/[code]", rateLimit: { limit: 30, windowMs: 60_000 } });
