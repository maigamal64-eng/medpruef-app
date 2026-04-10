import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// POST — User submits a flag or edit suggestion
export async function POST(req: NextRequest) {
  try {
    const db = getServiceClient();
    const body = await req.json();
    const { questionId, userId, type, reason, details, suggestedChanges } = body;

    if (!questionId || !type) {
      return NextResponse.json({ error: "questionId and type required" }, { status: 400 });
    }
    if (!["flag", "edit"].includes(type)) {
      return NextResponse.json({ error: "type must be 'flag' or 'edit'" }, { status: 400 });
    }

    const { data, error } = await db
      .from("question_suggestions")
      .insert({
        question_id: questionId,
        user_id: userId || null,
        type,
        reason: reason || null,
        details: details || null,
        suggested_changes: suggestedChanges || null,
        status: "pending",
      })
      .select("id")
      .single();

    if (error) {
      console.error("[suggestions POST]", error);
      return NextResponse.json({ error: "Failed to submit" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, id: data.id });
  } catch (err) {
    console.error("[suggestions POST]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// GET — Admin fetches suggestions (with question + user info joined)
export async function GET(req: NextRequest) {
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
      console.error("[suggestions GET]", error);
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
    console.error("[suggestions GET]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}

// PATCH — Admin resolves a suggestion (approve, reject, modify)
export async function PATCH(req: NextRequest) {
  try {
    const db = getServiceClient();
    const body = await req.json();
    const { suggestionId, action, adminNote, adminUserId } = body;

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
          console.error("[suggestions PATCH] Question update error:", updateErr);
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

    return NextResponse.json({ ok: true, status });
  } catch (err) {
    console.error("[suggestions PATCH]", err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
