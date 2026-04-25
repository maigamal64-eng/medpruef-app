import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireAdmin } from "@/lib/auth-guard";
import { captureServerError } from "@/lib/sentry-capture";
import { logAdminAction, resolveActorEmail } from "@/lib/admin/audit";

export const dynamic = "force-dynamic";

// POST — User submits a flag or edit suggestion.
//
// User identity: prefers the `x-user-id` header set by authFetch
// (which is verified against the users table via a lightweight check
// below) over any body-supplied userId. Before this fix, the body
// userId was the ONLY source — and all 45 existing rows in
// question_suggestions had `user_id = null` because the flag forms
// weren't consistently including it. The live DB audit on 2026-04-15
// confirmed this. Anonymous submissions are still allowed (tracked
// via the guest_id context field).
export async function POST(req: NextRequest) {
  try {
    const db = getServiceClient();
    const body = await req.json();
    const { questionId, type, reason, details, suggestedChanges, context } = body;

    if (!questionId || !type) {
      return NextResponse.json({ error: "questionId and type required" }, { status: 400 });
    }
    if (!["flag", "edit"].includes(type)) {
      return NextResponse.json({ error: "type must be 'flag' or 'edit'" }, { status: 400 });
    }

    // Prefer header-provided identity; fall back to body for legacy
    // clients that haven't migrated. Either way, validate as UUID and
    // verify the row actually exists (prevents stuffing arbitrary
    // UUIDs as user_id). Guest IDs (guest_*) are stored in context
    // instead.
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const headerId = req.headers.get("x-user-id");
    const bodyId = (body.userId as string | undefined) || null;
    let validUserId: string | null = null;
    let rawId: string | null = null;
    const candidate =
      headerId && uuidRegex.test(headerId)
        ? headerId
        : bodyId && uuidRegex.test(bodyId)
          ? bodyId
          : null;
    if (candidate) {
      const { data: userRow } = await db
        .from("users")
        .select("id")
        .eq("id", candidate)
        .maybeSingle();
      if (userRow) validUserId = candidate;
    }
    if (!validUserId && bodyId) rawId = bodyId; // preserve guest_* IDs for triage

    // Enrich context with server-side data
    const enrichedContext = {
      ...(context || {}),
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
      server_user_agent: req.headers.get("user-agent") || null,
      guest_id: rawId || null, // preserve raw guest_* ID for triage
      submitted_at: new Date().toISOString(),
    };

    const { data, error } = await db
      .from("question_suggestions")
      .insert({
        question_id: questionId,
        user_id: validUserId,
        type,
        reason: reason || null,
        details: details || null,
        suggested_changes: suggestedChanges || null,
        context: enrichedContext,
        status: "pending",
      })
      .select("id")
      .single();

    if (error) {
      captureServerError(error, { route: "/api/suggestions", method: "POST", phase: "insert" });
      return NextResponse.json({ error: "Failed to submit" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, id: data.id });
  } catch (err) {
    captureServerError(err, { route: "/api/suggestions", method: "POST" });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// GET — Admin fetches suggestions (with question + user info joined)
export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;
  try {
    const db = getServiceClient();
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 200);
    const offset = parseInt(url.searchParams.get("offset") || "0");

    let query = db
      .from("question_suggestions")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) query = query.eq("status", status);

    const { data: suggestions, count, error } = await query;
    if (error) {
      captureServerError(error, {
        route: "/api/suggestions",
        method: "GET",
        userId: guard.userId,
        phase: "select",
      });
      return NextResponse.json({ error: "Failed to fetch" }, { status: 500 });
    }

    // Enrich with question text and user name
    const questionIds = [...new Set((suggestions || []).map((s: { question_id: number }) => s.question_id))];
    const userIds = [...new Set((suggestions || []).filter((s: { user_id: string | null }) => s.user_id).map((s: { user_id: string }) => s.user_id))];

    const [questionsRes, usersRes] = await Promise.all([
      questionIds.length > 0
        ? db.from("questions").select("id, question, topic, choices").in("id", questionIds)
        : Promise.resolve({ data: [] }),
      userIds.length > 0
        ? db.from("users").select("id, first_name, last_name, telegram_username, email").in("id", userIds)
        : Promise.resolve({ data: [] }),
    ]);

    const questionMap: Record<number, { question: string; topic: string; choices: unknown }> = {};
    for (const q of (questionsRes.data || []) as { id: number; question: string; topic: string; choices: unknown }[]) {
      questionMap[q.id] = { question: q.question, topic: q.topic, choices: q.choices };
    }

    const userMap: Record<string, string> = {};
    for (const u of (usersRes.data || []) as { id: string; first_name: string | null; last_name: string | null; telegram_username: string | null; email: string | null }[]) {
      userMap[u.id] = [u.first_name, u.last_name].filter(Boolean).join(" ") || u.telegram_username || u.email || "Anonymous";
    }

    const enriched = (suggestions || []).map((s: Record<string, unknown>) => ({
      ...s,
      question_text: questionMap[s.question_id as number]?.question?.slice(0, 200) || "",
      question_topic: questionMap[s.question_id as number]?.topic || "",
      question_choices: questionMap[s.question_id as number]?.choices || null,
      user_name: s.user_id ? (userMap[s.user_id as string] || "Unknown") : "Anonymous",
    }));

    // Counts by status
    const [pendingRes, approvedRes, rejectedRes] = await Promise.all([
      db.from("question_suggestions").select("id", { count: "exact", head: true }).eq("status", "pending"),
      db.from("question_suggestions").select("id", { count: "exact", head: true }).eq("status", "approved"),
      db.from("question_suggestions").select("id", { count: "exact", head: true }).eq("status", "rejected"),
    ]);

    return NextResponse.json({
      suggestions: enriched,
      total: count || 0,
      counts: {
        pending: pendingRes.count || 0,
        approved: approvedRes.count || 0,
        rejected: rejectedRes.count || 0,
        total: (count || 0),
      },
    });
  } catch (err) {
    captureServerError(err, { route: "/api/suggestions", method: "GET", userId: guard.userId });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// PATCH — Admin resolves a suggestion (approve, reject, modify)
export async function PATCH(req: NextRequest) {
  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;
  try {
    const db = getServiceClient();
    const body = await req.json();
    // Prefer the guard-derived userId over any client-supplied adminUserId.
    // adminUserId is kept in the body for backward-compat but ignored below.
    const { suggestionId, action, adminNote } = body;
    const adminUserId = guard.userId;

    if (!suggestionId || !action) {
      return NextResponse.json({ error: "suggestionId and action required" }, { status: 400 });
    }
    if (!["approve", "reject", "modify"].includes(action)) {
      return NextResponse.json({ error: "action must be approve, reject, or modify" }, { status: 400 });
    }

    // Get the suggestion
    const { data: suggestion, error: fetchErr } = await db
      .from("question_suggestions")
      .select("*")
      .eq("id", suggestionId)
      .single();

    if (fetchErr || !suggestion) {
      return NextResponse.json({ error: "Suggestion not found" }, { status: 404 });
    }

    // If approving an edit suggestion, apply the changes to the question
    if (action === "approve" && suggestion.type === "edit" && suggestion.suggested_changes) {
      const changes = suggestion.suggested_changes as Record<string, unknown>;
      const questionUpdates: Record<string, unknown> = {};
      if (changes.question) questionUpdates.question = changes.question;
      if (changes.answer) questionUpdates.answer = changes.answer;
      if (changes.explanation) questionUpdates.explanation = changes.explanation;
      if (changes.topic) questionUpdates.topic = changes.topic;
      if (changes.choices) questionUpdates.choices = changes.choices;

      if (Object.keys(questionUpdates).length > 0) {
        const { error: updateErr } = await db
          .from("questions")
          .update(questionUpdates)
          .eq("id", suggestion.question_id);
        if (updateErr) {
          captureServerError(updateErr, {
            route: "/api/suggestions",
            method: "PATCH",
            userId: adminUserId,
            phase: "apply-edit",
            suggestionId,
          });
          return NextResponse.json({ error: "Failed to apply changes" }, { status: 500 });
        }
      }
    }

    // Update suggestion status
    const status = action === "approve" ? "approved" : action === "reject" ? "rejected" : "modified";
    const { error: updateErr } = await db
      .from("question_suggestions")
      .update({
        status,
        admin_note: adminNote || null,
        resolved_by: adminUserId || null,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", suggestionId);

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    const actorEmail = await resolveActorEmail(adminUserId);
    await logAdminAction({
      req,
      actorId: adminUserId,
      actorEmail,
      action:
        action === "approve"
          ? suggestion.type === "edit"
            ? "approve_question_edit"
            : "approve_question_flag"
          : action === "reject"
            ? "reject_question_flag"
            : "modify_question_flag",
      targetType: "question_suggestion",
      targetId: String(suggestionId),
      payload: {
        suggestion_type: suggestion.type,
        question_id: suggestion.question_id,
        admin_note: adminNote ?? null,
        had_suggested_changes: !!suggestion.suggested_changes,
      },
    });

    return NextResponse.json({ ok: true, status });
  } catch (err) {
    captureServerError(err, { route: "/api/suggestions", method: "PATCH", userId: guard.userId });
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
