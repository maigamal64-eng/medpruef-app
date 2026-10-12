import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { audienceOf, canUse } from "@/lib/entitlements";
import { getServiceClient } from "@/lib/supabase";
import { withDbUnavailable } from "@/lib/db-unavailable-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BOOKMARKS = 10_000;

/**
 * GET /api/bookmarks
 * Return the signed-in user's bookmarked question IDs. This route is Pro/admin
 * gated because bookmarks are a Pro feature in the learner UI.
 */
async function handleGET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  if (!canUse("bookmarks", audienceOf({ signedIn: true, ...guard }))) {
    return NextResponse.json({ error: "Pro access required" }, { status: 403 });
  }

  const { data, error } = await getServiceClient()
    .from("user_question_progress")
    .select("question_id")
    .eq("user_id", guard.userId)
    .eq("is_bookmarked", true)
    .limit(MAX_BOOKMARKS);

  if (error) {
    console.error("[bookmarks] list failed:", error);
    return NextResponse.json({ error: "Could not load bookmarks" }, { status: 500 });
  }

  const questionIds = (data || [])
    .map((row) => Number(row.question_id))
    .filter((id) => Number.isSafeInteger(id) && id > 0);
  return NextResponse.json({ questionIds });
}

/**
 * PATCH /api/bookmarks
 * Idempotently set one bookmark state without upserting partial progress rows.
 * A new progress row gets database defaults; an existing row only has its
 * bookmark flag changed, preserving all spaced-repetition state.
 */
async function handlePATCH(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  if (!canUse("bookmarks", audienceOf({ signedIn: true, ...guard }))) {
    return NextResponse.json({ error: "Pro access required" }, { status: 403 });
  }

  let body: { questionId?: unknown; isBookmarked?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const questionId = Number(body.questionId);
  if (!Number.isSafeInteger(questionId) || questionId <= 0 || typeof body.isBookmarked !== "boolean") {
    return NextResponse.json({ error: "Valid questionId and isBookmarked are required" }, { status: 400 });
  }

  const progress = getServiceClient().from("user_question_progress");
  const values = {
    user_id: guard.userId,
    question_id: questionId,
    is_bookmarked: body.isBookmarked,
  };

  // Update first so the existing SM-2 columns are never overwritten with
  // nulls/defaults by a partial upsert. Select tells us whether a row matched.
  const { data: updated, error: updateError } = await progress
    .update({ is_bookmarked: body.isBookmarked })
    .eq("user_id", guard.userId)
    .eq("question_id", questionId)
    .select("question_id");

  let error = updateError;
  if (!error && (!updated || updated.length === 0)) {
    const inserted = await progress.insert(values);
    error = inserted.error;

    // A concurrent answer may create this unique row between the update and
    // insert. On that specific conflict, retry the narrow update.
    if (error?.code === "23505") {
      const retried = await progress
        .update({ is_bookmarked: body.isBookmarked })
        .eq("user_id", guard.userId)
        .eq("question_id", questionId);
      error = retried.error;
    }
  }

  if (error) {
    console.error("[bookmarks] update failed:", error);
    return NextResponse.json({ error: "Could not save bookmark" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, questionId, isBookmarked: body.isBookmarked });
}

/**
 * DELETE /api/bookmarks
 * Clear bookmark flags for the signed-in account while retaining each row's
 * spaced-repetition and answer history. Clearing personal data remains
 * available to any authenticated account, including expired Pro accounts.
 */
async function handleDELETE(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;

  const { error } = await getServiceClient()
    .from("user_question_progress")
    .update({ is_bookmarked: false })
    .eq("user_id", guard.userId)
    .eq("is_bookmarked", true);

  if (error) {
    console.error("[bookmarks] clear failed:", error);
    return NextResponse.json({ error: "Could not clear bookmarks" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

export const GET = withDbUnavailable(handleGET);
export const PATCH = withDbUnavailable(handlePATCH);
export const DELETE = withDbUnavailable(handleDELETE);
