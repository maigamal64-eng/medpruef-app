import { NextResponse } from "next/server";
import { adminRouteShell } from "@/lib/admin/shell";
import { logAdminAction } from "@/lib/admin/audit";
import { canAccessAdminPermission, loadAdminPermissionSnapshot } from "@/lib/admin/permissions";
import { getServiceClient } from "@/lib/supabase";
import { isMissingObjectError } from "@/lib/mentor/credits/db";
import { loadCampaignStats, parseCampaignInput } from "@/lib/mentor/credits/campaign";
import { readFreeCreditConfig } from "@/lib/mentor/credits/free-credits";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET  /api/admin/mentor-campaigns  (revenue.read): every campaign code with
 *      redemptions total and today (Vienna), new accounts and later payers.
 * POST /api/admin/mentor-campaigns  (revenue.manage): create a code. Amount,
 *      expiry, caps and end date are fixed at creation; only label, caps,
 *      end date, note and active can change later (column grants). Audited.
 * Counts only; no learner identity leaves this route.
 */
export const GET = adminRouteShell(async ({ actor }) => {
  if (!canAccessAdminPermission(await loadAdminPermissionSnapshot(actor.userId), "revenue.read")) {
    return NextResponse.json({ error: "Your admin role cannot read campaign codes." }, { status: 403 });
  }
  const stats = await loadCampaignStats(getServiceClient(), new Date());
  return NextResponse.json({ ...stats, enabled: readFreeCreditConfig().campaignEnabled }, { headers: { "cache-control": "no-store" } });
}, { route: "/api/admin/mentor-campaigns" });

export const POST = adminRouteShell(async ({ req, actor }) => {
  if (!canAccessAdminPermission(await loadAdminPermissionSnapshot(actor.userId), "revenue.manage")) {
    return NextResponse.json({ error: "Your admin role cannot create campaign codes." }, { status: 403 });
  }
  const parsed = parseCampaignInput(await req.json().catch(() => null), new Date());
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const v = parsed.value;
  const { error } = await getServiceClient().from("ai_credit_campaign").insert({ ...v, created_by: actor.userId });
  if (error) {
    if (error.code === "23505") return NextResponse.json({ error: "This code already exists." }, { status: 409 });
    if (isMissingObjectError(error)) return NextResponse.json({ error: "Campaign codes need the a-free-credit-hooks changeset (20270102090000). Nothing was created." }, { status: 503 });
    throw error;
  }
  await logAdminAction({ req, actorId: actor.userId, actorEmail: actor.email, action: "mentor_campaign_created", targetType: "ai_credit_campaign", targetId: v.code, payload: { ...v } });
  return NextResponse.json({ ok: true, code: v.code });
}, { route: "/api/admin/mentor-campaigns", rateLimit: { limit: 20, windowMs: 60_000 } });
