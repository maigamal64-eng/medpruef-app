import { NextResponse } from "next/server";
import { adminRouteShell } from "@/lib/admin/shell";
import { logAdminAction } from "@/lib/admin/audit";
import { canAccessAdminPermission, loadAdminPermissionSnapshot } from "@/lib/admin/permissions";
import { getServiceClient } from "@/lib/supabase";
import { readFreeCreditConfig } from "@/lib/mentor/credits/free-credits";
import { grantExperienceReward, readExperienceEligibility, TESTIMONIAL_KIND } from "@/lib/mentor/credits/experience";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * POST /api/admin/feedback/reward {id, confirm?} (feedback.manage + revenue.manage):
 * the experience reward for one testimonial (a-free-credit-hooks L5).
 * Without confirm: a preview (eligibility facts, consent, already rewarded).
 * With confirm: the grant, once per person, audited. The admin filters spam
 * only; the decision never depends on what the testimonial says.
 * 404 while MENTOR_EXPERIENCE_REWARD_ENABLED is off.
 */
export const POST = adminRouteShell(async ({ req, actor }) => {
  const fc = readFreeCreditConfig();
  if (!fc.experienceEnabled) return NextResponse.json({ error: "The experience reward is off (MENTOR_EXPERIENCE_REWARD_ENABLED)." }, { status: 404 });
  const perms = await loadAdminPermissionSnapshot(actor.userId);
  if (!canAccessAdminPermission(perms, "feedback.manage") || !canAccessAdminPermission(perms, "revenue.manage")) {
    return NextResponse.json({ error: "Granting a reward needs feedback.manage and revenue.manage." }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { id?: unknown; confirm?: unknown } | null;
  const id = typeof body?.id === "number" ? body.id : typeof body?.id === "string" && /^\d{1,18}$/.test(body.id) ? body.id : null;
  if (id === null) return NextResponse.json({ error: "id required" }, { status: 400 });
  const sb = getServiceClient();

  if (body?.confirm !== true) {
    const fb = await sb.from("user_feedback").select("id, user_id, context").eq("id", id).maybeSingle();
    if (fb.error) throw fb.error;
    const row = fb.data as { user_id: string | null; context: Record<string, unknown> | null } | null;
    if (!row || row.context?.kind !== TESTIMONIAL_KIND) return NextResponse.json({ error: "Not a testimonial." }, { status: 404 });
    const testimonial = (row.context?.testimonial ?? {}) as { consent_public?: boolean };
    return NextResponse.json({
      credits: fc.experienceCredits,
      expiry_days: fc.experienceExpiryDays,
      consent_public: testimonial.consent_public === true,
      rewarded: typeof row.context?.reward_granted_at === "string",
      eligibility: row.user_id ? await readExperienceEligibility(sb, row.user_id) : null,
    });
  }

  const r = await grantExperienceReward(sb, id, actor.userId, fc, new Date());
  if (!r.ok) {
    const status = r.reason === "not_found" || r.reason === "not_testimonial" ? 404 : r.reason === "grant_failed" ? 503 : 409;
    return NextResponse.json({ error: r.reason }, { status });
  }
  await logAdminAction({ req, actorId: actor.userId, actorEmail: actor.email, action: "mentor_experience_reward_granted", targetType: "user_feedback", targetId: typeof id === "number" ? id : String(id), payload: { credits: r.credits, lot_id: r.lotId, expires_at: r.expiresAt } });
  return NextResponse.json({ ok: true, credits: r.credits, expires_at: r.expiresAt });
}, { route: "/api/admin/feedback/reward", rateLimit: { limit: 30, windowMs: 60_000 } });
