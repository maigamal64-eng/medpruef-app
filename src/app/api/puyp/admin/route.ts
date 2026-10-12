import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { captureServerError } from "@/lib/sentry-capture";
import { suggestPuypExtension } from "@/lib/exam-dates";
import { logAdminAction, resolveActorEmail } from "@/lib/admin/audit";
import { adminErrorResponse } from "@/lib/admin/error-response";
import {
  approvePuypAttempt,
  hoursUntilDue,
  recordRejectionNotified,
  sendPuypDecisionEmail,
} from "@/lib/admin/puyp-decision";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * /api/puyp/admin — admin-only PUYP queue + action endpoint.
 *
 * GET    → list all exam_attempts, filterable by `?status=pending|approved|rejected`,
 *          enriched with user email/first_name, subscription tier / expires_at,
 *          and a short-lived signed URL for the proof file.
 * POST   → approve / reject an attempt, or record that a rejected learner
 *          was told by hand.
 *          Body: { attempt_id: uuid, action: 'approve'|'reject'|'mark_notified',
 *                  new_expires_at?: ISO string (approve only),
 *                  reason?: string (reject only) }
 *
 * a13 (ADM-19): approval is ONE guarded database function shared with the
 * bulk route (src/lib/admin/puyp-decision.ts). The numbered steps below are
 * what that function does in a single transaction; it never shortens access
 * and keeps permanent Pro.
 *
 * Both methods require `requireAdmin`. Admin means `users.role='admin'`.
 *
 * Approve flow (admin_puyp_approve, one transaction):
 *   1. Lock the attempt; refuse if decided, not a fail, or unlinked.
 *   2. Lock the subscription; refuse another owner, a status other than
 *      active/expired, or `puyp_extensions_used >= PUYP_MAX_EXTENSIONS`.
 *   3. expires_at = max(requested, current); count the extension.
 *   4. users: keep admin and permanent Pro; otherwise Pro until the later of
 *      the new end and the learner's current end.
 *   5. subscription_extensions row, attempt verified, admin_audit_log row.
 *
 * Reject flow: compare-and-set on an undecided attempt, then the email. The
 * response says whether the learner was notified; the queue keeps unnotified
 * rejections in "Follow up needed" until marked as sent.
 *
 * Both flows email the user via Zoho (best effort, see sendPuypDecisionEmail).
 * No 404/403 leakage about admin identity — the
 * requireAdmin guard is the gate.
 */

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;

  try {
    const sp = req.nextUrl.searchParams;
    const status = (sp.get("status") || "pending").toLowerCase();
    const limit = Math.min(parseInt(sp.get("limit") || "50", 10) || 50, 200);

    const sb = getServiceClient();

    // Build the query based on the status filter. "pending" = not yet
    // verified. "approved" = verified_at set AND result='fail' (pass
    // rows are always self-verified so they don't live in the queue).
    // "rejected" = verified_at set AND rejection_reason present.
    let query = sb
      .from("exam_attempts")
      .select(
        `id, user_id, subscription_id, exam_type, attempt_date, result,
         proof_url, verified_at, verified_by, rejection_reason,
         qbank_completion_pct, created_at,
         users!exam_attempts_user_id_fkey (
           email, first_name, last_name, tier, tier_expires_at
         ),
         subscriptions!exam_attempts_subscription_id_fkey (
           tier, expires_at, puyp_extensions_used, status
         )`
      )
      .order("created_at", { ascending: status === "pending" })
      .limit(limit);

    if (status === "pending") {
      query = query.is("verified_at", null).eq("result", "fail");
    } else if (status === "approved") {
      query = query
        .not("verified_at", "is", null)
        .is("rejection_reason", null)
        .eq("result", "fail");
    } else if (status === "rejected") {
      query = query.not("rejection_reason", "is", null);
    }
    // status === 'all' → no extra filter

    const { data, error } = await query;
    if (error) {
      captureServerError(error, { route: "/api/puyp/admin", step: "list" });
      return NextResponse.json(
        { error: "Failed to load queue" },
        { status: 500 }
      );
    }

    // Augment each row with a signed URL for the proof (5-minute TTL).
    // Signed URLs let the admin open the file directly in a new tab
    // without us exposing the storage path publicly.
    const rows = Array.isArray(data) ? data : [];
    const enriched = await Promise.all(
      rows.map(async (row) => {
        const proofPath = (row as { proof_url?: string | null }).proof_url;
        let signedUrl: string | null = null;
        if (proofPath) {
          try {
            const { data: signed } = await sb.storage
              .from("exam-proofs")
              .createSignedUrl(proofPath, 300); // 5 min
            signedUrl = signed?.signedUrl ?? null;
          } catch {
            /* best-effort; admin can re-list to refresh */
          }
        }
        return { ...row, proof_signed_url: signedUrl };
      })
    );

    // UX-ADM-22: a rejection stays in "Follow up needed" until the learner
    // was told (email sent, or marked as sent by hand).
    const rejectedIds = rows
      .filter((row) => (row as { rejection_reason?: string | null }).rejection_reason)
      .map((row) => (row as { id: string }).id);
    const notified = new Set<string>();
    if (rejectedIds.length > 0) {
      const { data: notes, error: notesError } = await sb
        .from("admin_audit_log")
        .select("target_id")
        .eq("action", "puyp_rejection_notified")
        .in("target_id", rejectedIds);
      if (notesError) return adminErrorResponse(notesError, "/api/puyp/admin");
      for (const note of notes ?? []) notified.add(note.target_id as string);
    }
    const now = Date.now();
    const items = enriched.map((row) => {
      const r = row as { id: string; created_at: string; verified_at: string | null; rejection_reason: string | null };
      return {
        ...row,
        due_in_hours: r.verified_at ? null : hoursUntilDue(r.created_at, now),
        learner_notified: r.rejection_reason ? notified.has(r.id) : null,
      };
    });

    return NextResponse.json({ items, count: items.length });
  } catch (err) {
    captureServerError(err, { route: "/api/puyp/admin", step: "GET" });
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if ("error" in guard) return guard.error;
  const adminId = guard.userId;
  const route = "/api/puyp/admin";

  try {
    const body = await req.json().catch(() => ({}));
    const attemptId = String(body?.attempt_id || "");
    const action = String(body?.action || "").toLowerCase();

    if (!UUID_RE.test(attemptId) || !["approve", "reject", "mark_notified"].includes(action)) {
      return NextResponse.json(
        { error: "Body must contain attempt_id and action='approve'|'reject'|'mark_notified'" },
        { status: 400 }
      );
    }

    const sb = getServiceClient();
    const { data: attempt, error: attemptErr } = await sb
      .from("exam_attempts")
      .select("id, user_id, subscription_id, exam_type, attempt_date, result, verified_at, rejection_reason")
      .eq("id", attemptId)
      .maybeSingle();
    if (attemptErr) return adminErrorResponse(attemptErr, route);
    if (!attempt) return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
    const actor = { userId: adminId, email: await resolveActorEmail(adminId) };

    // ═══ MARK NOTIFIED (UX-ADM-22) ════════════════════════════════
    if (action === "mark_notified") {
      if (!attempt.rejection_reason) {
        return NextResponse.json({ error: "Only a rejected claim can be marked as notified." }, { status: 409 });
      }
      await recordRejectionNotified(req, actor, attempt.id, "manual");
      return NextResponse.json({ ok: true, action: "notified", attempt_id: attempt.id });
    }

    if (attempt.verified_at || attempt.rejection_reason) {
      return NextResponse.json({ error: "This attempt has already been decided." }, { status: 409 });
    }
    if (attempt.result !== "fail") {
      return NextResponse.json(
        { error: "Only fail attempts can be approved/rejected via this endpoint. Pass attempts are self-verified." },
        { status: 400 }
      );
    }

    // ═══ REJECT PATH ══════════════════════════════════════════════
    if (action === "reject") {
      const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 1000) : "";
      if (!reason) {
        return NextResponse.json({ error: "Reject requires a `reason` message for the user." }, { status: 400 });
      }
      const nowIso = new Date().toISOString();
      const { data: claimed, error: updateErr } = await sb
        .from("exam_attempts")
        .update({ verified_at: nowIso, verified_by: adminId, rejection_reason: reason })
        .eq("id", attempt.id)
        .is("verified_at", null)
        .is("rejection_reason", null)
        .select("id")
        .maybeSingle();
      if (updateErr) return adminErrorResponse(updateErr, route);
      if (!claimed) return NextResponse.json({ error: "This attempt was decided in the meantime." }, { status: 409 });

      await logAdminAction({
        req,
        actorId: adminId,
        actorEmail: actor.email,
        action: "reject_puyp",
        targetType: "exam_attempt",
        targetId: attempt.id,
        payload: { reason, exam_type: attempt.exam_type, target_user_id: attempt.user_id },
      });
      const email = await sendPuypDecisionEmail(sb, attempt.user_id as string, attempt.id, "rejected", { reason });
      if (email.sent) await recordRejectionNotified(req, actor, attempt.id, "email");
      await sb.from("user_events").insert({
        user_id: attempt.user_id,
        event_type: "puyp_attempt_rejected",
        event_data: { attempt_id: attempt.id, admin_id: adminId, reason },
      });

      return NextResponse.json({
        ok: true,
        action: "rejected",
        attempt_id: attempt.id,
        learner_notified: email.sent,
        notify_failure: email.sent ? null : email.reason,
      });
    }

    // ═══ APPROVE PATH ═════════════════════════════════════════════
    let requested: Date;
    if (typeof body?.new_expires_at === "string") {
      requested = new Date(body.new_expires_at);
      if (isNaN(requested.getTime())) {
        return NextResponse.json({ error: "Invalid new_expires_at: expected ISO timestamp string." }, { status: 400 });
      }
    } else {
      // a27: default only from an official sitting with open registration;
      // otherwise (none published, or a Stichprobentest claim) the admin
      // sends the date.
      const suggested = suggestPuypExtension(attempt.exam_type);
      if (!suggested) {
        return NextResponse.json(
          { error: "No official sitting date can be suggested for this claim. Set new_expires_at.", code: "set_date_manually" },
          { status: 400 }
        );
      }
      requested = suggested;
    }

    const result = await approvePuypAttempt(sb, { actorId: adminId, attemptId: attempt.id, requestedExpiresAt: requested, via: "single" });
    if (!result.ok) {
      if (result.status === 500) return adminErrorResponse(new Error(`admin_puyp_approve ${result.code}`), route);
      return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    }

    const email = await sendPuypDecisionEmail(sb, result.userId, attempt.id, "approved", { newExpiresAtIso: result.newExpiresAt });
    await sb.from("user_events").insert({
      user_id: result.userId,
      event_type: "puyp_extension_granted",
      event_data: {
        attempt_id: attempt.id,
        subscription_id: attempt.subscription_id,
        admin_id: adminId,
        previous_expires_at: result.previousExpiresAt,
        new_expires_at: result.newExpiresAt,
        extensions_used: result.extensionsUsed,
      },
    });

    return NextResponse.json({
      ok: true,
      action: "approved",
      attempt_id: attempt.id,
      new_expires_at: result.newExpiresAt,
      user_access: result.userAccess,
      extensions_used: result.extensionsUsed,
      learner_notified: email.sent,
    });
  } catch (err) {
    return adminErrorResponse(err, route);
  }
}
