import { NextRequest, NextResponse } from "next/server";
import { requireUser, isGuardFailure } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { withDbUnavailable } from "@/lib/db-unavailable-route";
import { scheduleIntercomContactSync } from "@/lib/intercom/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * PATCH /api/user/email-update
 * Allows a user to update their email address (e.g. after bounce detection).
 * Resets email_status to 'unverified' on update, and clears
 * email_verified_at (a-reverse-trial-claim review): the confirmation belongs
 * to the old address, and the trial and free-credit walls key on the
 * verified address.
 */
async function handlePATCH(req: NextRequest) {
  const guard = await requireUser(req);
  if (isGuardFailure(guard)) return guard.error;
  const { userId } = guard;

  try {
    const { email } = await req.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 },
      );
    }

    const trimmed = email.toLowerCase().trim();

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 },
      );
    }

    const sb = getServiceClient();

    // Check if email is already taken by another user
    const { data: existing } = await sb
      .from("users")
      .select("id")
      .eq("email", trimmed)
      .neq("id", userId)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: "Email already in use" },
        { status: 409 },
      );
    }

    const { error } = await sb
      .from("users")
      .update({ email: trimmed, email_status: "unverified", email_verified_at: null })
      .eq("id", userId);

    if (error) {
      console.error("[email-update] DB error:", error);
      return NextResponse.json(
        { error: "Update failed" },
        { status: 500 },
      );
    }

    scheduleIntercomContactSync(userId, "email_change");
    return NextResponse.json({ ok: true, email: trimmed });
  } catch (err) {
    console.error("[email-update] Unexpected error:", err);
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 },
    );
  }
}

export const PATCH = withDbUnavailable(handlePATCH);
