import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/auth-guard";
import { logAdminAction, resolveActorEmail } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";

interface UserRow {
  id: string;
  telegram_id: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  telegram_username: string | null;
  photo_url: string | null;
  role: string;
  tier: string | null;
  created_at: string;
  updated_at: string;
  user_gamification: {
    total_xp: number;
    current_streak: number;
    total_questions_answered: number;
    total_correct: number;
    daily_questions_today: number;
    last_study_date: string | null;
  }[] | null;
}

// GET — List all users with gamification data
export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;
  try {
    const db = getServiceClient();

    const { data: users, error: usersError } = await db
      .from("users")
      .select(`
        id, telegram_id, email, first_name, last_name, telegram_username,
        photo_url, role, tier, created_at, updated_at,
        user_gamification (
          total_xp, current_streak, total_questions_answered, total_correct,
          daily_questions_today, last_study_date
        )
      `)
      .order("created_at", { ascending: false });

    if (usersError) {
      console.error("[admin/users GET]", usersError);
      return NextResponse.json({ error: "Failed to fetch users" }, { status: 500 });
    }

    // Get last active from user_events
    const lastActiveMap: Record<string, string> = {};
    const { data: events } = await db
      .from("user_events")
      .select("user_id, created_at")
      .order("created_at", { ascending: false })
      .limit(5000);

    if (events) {
      for (const evt of events) {
        const uid = evt.user_id as string;
        if (!lastActiveMap[uid]) lastActiveMap[uid] = evt.created_at as string;
      }
    }

    // Get answer counts from answer_history for more accurate data
    const { data: answerCounts } = await db
      .from("answer_history")
      .select("user_id");

    const answerCountMap: Record<string, number> = {};
    if (answerCounts) {
      for (const a of answerCounts) {
        const uid = a.user_id as string;
        answerCountMap[uid] = (answerCountMap[uid] || 0) + 1;
      }
    }

    const result = (users as UserRow[]).map((u) => {
      const gam = u.user_gamification?.[0] || null;
      const questionsAnswered = gam?.total_questions_answered || answerCountMap[u.id] || 0;
      const totalCorrect = gam?.total_correct || 0;
      const accuracy = questionsAnswered > 0 ? Math.round((totalCorrect / questionsAnswered) * 100) : 0;
      const lastActive = lastActiveMap[u.id] || u.updated_at || u.created_at;

      // Determine status
      const daysSinceActive = Math.floor((Date.now() - new Date(lastActive).getTime()) / 86400000);
      const status = daysSinceActive <= 1 ? "active" : daysSinceActive <= 7 ? "recent" : "inactive";

      return {
        id: u.id,
        telegram_id: u.telegram_id,
        email: u.email,
        name: [u.first_name, u.last_name].filter(Boolean).join(" ") || u.telegram_username || "Anonymous",
        first_name: u.first_name,
        last_name: u.last_name,
        username: u.telegram_username,
        photo_url: u.photo_url,
        role: u.role || "user",
        tier: u.tier || "free",
        status,
        created_at: u.created_at,
        xp: gam?.total_xp || 0,
        streak: gam?.current_streak || 0,
        questions_answered: questionsAnswered,
        accuracy,
        daily_today: gam?.daily_questions_today || 0,
        last_study: gam?.last_study_date || null,
        last_active: lastActive,
      };
    });

    result.sort((a, b) => new Date(b.last_active).getTime() - new Date(a.last_active).getTime());
    return NextResponse.json(result);
  } catch (err) {
    console.error("[admin/users GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PATCH — Edit user (role, name, reset gamification)
export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;
  try {
    const db = getServiceClient();
    const body = await req.json();
    const { userId, updates } = body;

    if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });

    // Update user fields
    const userUpdates: Record<string, unknown> = {};
    if (updates.role) userUpdates.role = updates.role;
    if (updates.tier) userUpdates.tier = updates.tier;
    if (updates.first_name !== undefined) userUpdates.first_name = updates.first_name;
    if (updates.last_name !== undefined) userUpdates.last_name = updates.last_name;
    if (updates.email !== undefined) userUpdates.email = updates.email;

    if (Object.keys(userUpdates).length > 0) {
      userUpdates.updated_at = new Date().toISOString();
      const { error } = await db.from("users").update(userUpdates).eq("id", userId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Reset gamification if requested
    if (updates.reset_gamification) {
      await db.from("user_gamification").update({
        total_xp: 0, current_streak: 0, longest_streak: 0,
        total_questions_answered: 0, total_correct: 0,
        daily_questions_today: 0, level: 1, rank_name: "Praktikant",
      }).eq("user_id", userId);
    }

    const actorEmail = await resolveActorEmail(guard.userId);
    await logAdminAction({
      req,
      actorId: guard.userId,
      actorEmail,
      action: updates.reset_gamification ? "reset_user_gamification" : "edit_user",
      targetType: "user",
      targetId: userId,
      payload: {
        applied_fields: Object.keys(userUpdates).filter((k) => k !== "updated_at"),
        role: updates.role ?? null,
        tier: updates.tier ?? null,
        reset_gamification: !!updates.reset_gamification,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/users PATCH]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE — Remove a user and related data (GDPR erasure).
// Note: answer_history, user_gamification, user_question_progress all
// have ON DELETE CASCADE on users.id (verified live 2026-04-15), so
// deleting users cascades them automatically. user_activity_log +
// question_suggestions have ON DELETE NO ACTION so we clear them
// manually. user_feedback / user_events / user_sessions have no FK
// (they support guest_ IDs in the same column) so we clear them by
// user_id filter. This covers every table that references the user
// either by FK or by text column.
export async function DELETE(req: NextRequest) {
  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;
  try {
    const db = getServiceClient();
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get("id");

    if (!userId) return NextResponse.json({ error: "id required" }, { status: 400 });

    // Clear tables that don't cascade from users.id (audit reports
    // 02-database.md DB-P0-002 + 03-backend-api.md BE-P3-031).
    // Errors are tolerated on these — the important one is the final
    // users.delete which is checked below. If any of these fail we
    // log but keep going; the cascade will still get answer_history,
    // user_gamification, user_question_progress via FK.
    const manualTables = [
      "user_activity_log",
      "question_suggestions",
      "user_feedback",
      "user_events",
      "user_sessions",
    ] as const;
    for (const t of manualTables) {
      const { error } = await db.from(t).delete().eq("user_id", userId);
      if (error) console.error(`[admin/users DELETE] clear ${t}:`, error);
    }
    // Capture deleted user's email before the cascade wipes the row so
    // the audit trail can reference who was erased.
    const { data: deletedSnapshot } = await db
      .from("users")
      .select("email, role, tier")
      .eq("id", userId)
      .maybeSingle();

    // Delete user — remaining tables (answer_history, user_gamification,
    // user_question_progress) cascade from here.
    const { error } = await db.from("users").delete().eq("id", userId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const actorEmail = await resolveActorEmail(guard.userId);
    await logAdminAction({
      req,
      actorId: guard.userId,
      actorEmail,
      action: "delete_user",
      targetType: "user",
      targetId: userId,
      payload: {
        deleted_email: deletedSnapshot?.email ?? null,
        deleted_role: deletedSnapshot?.role ?? null,
        deleted_tier: deletedSnapshot?.tier ?? null,
        cascade_note: "GDPR erasure — cascading FKs handled cleanup",
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/users DELETE]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
