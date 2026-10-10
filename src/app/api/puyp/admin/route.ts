import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { captureServerError } from "@/lib/sentry-capture";
import { PUYP_MAX_EXTENSIONS } from "@/lib/puyp";
import { suggestNextExpiresAt, type PuypExamType } from "@/lib/exam-dates";
import { logAdminAction, resolveActorEmail } from "@/lib/admin/audit";

import { sendZohoEmail } from "@/lib/email/zoho";
import { recordEventSafe } from "@/lib/user-events";

export const dynamic = "force-dynamic";

// ── PUYP decision emails (best effort; never blocks or fails the decision) ──
// Voice: doctor-to-doctor "du" for DE, plain EN otherwise. No em dashes.
function puypEsc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function sendPuypDecisionEmail(
  sb: ReturnType<typeof getServiceClient>,
  userId: string,
  kind: "approved" | "rejected",
  detail: { newExpiresAtIso?: string; reason?: string },
): Promise<void> {
  try {
    const { data: u } = await sb
      .from("users")
      .select("email, first_name, language_code")
      .eq("id", userId)
      .maybeSingle();
    const to = (u?.email as string | null) || null;
    if (!to) return; // Telegram-only accounts have no email: nothing to send.
    const de = ((u?.language_code as string | null) || "de").toLowerCase().startsWith("de");
    const name = u?.first_name ? puypEsc(String(u.first_name)) : "";
    const hello = de ? `Hallo${name ? ` ${name}` : ""},` : `Hi${name ? ` ${name}` : ""},`;
    let subject: string;
    let body: string;
    if (kind === "approved") {
      const when = new Date(detail.newExpiresAtIso as string).toLocaleDateString(
        de ? "de-AT" : "en-GB",
        { day: "numeric", month: "long", year: "numeric" },
      );
      subject = de ? "Dein MedPrüf-Zugang wurde verlängert" : "Your MedPrüf access has been extended";
      body = de
        ? `<p>${hello}</p><p>wir haben deine Prüfung geprüft und deinen Zugang bis zum <strong>${when}</strong> verlängert. Du musst nichts weiter tun.</p><p>Viel Erfolg beim nächsten Versuch.</p><p>Das MedPrüf-Team</p>`
        : `<p>${hello}</p><p>we reviewed your exam result and extended your access until <strong>${when}</strong>. You do not need to do anything.</p><p>Good luck with your next attempt.</p><p>The MedPrüf Team</p>`;
    } else {
      const why = puypEsc(detail.reason || "");
      subject = de ? "Zu deiner Verlängerungsanfrage bei MedPrüf" : "About your MedPrüf extension request";
      body = de
        ? `<p>${hello}</p><p>wir konnten deine Verlängerungsanfrage leider nicht bestätigen.</p><p>Grund: ${why}</p><p>Wenn du Fragen hast oder einen neuen Nachweis schicken möchtest, antworte einfach auf diese E-Mail oder schreib an user-b7e46e80@example.com.</p><p>Das MedPrüf-Team</p>`
        : `<p>${hello}</p><p>unfortunately we could not confirm your extension request.</p><p>Reason: ${why}</p><p>If you have questions or want to send a new proof, reply to this email or write to user-b7e46e80@example.com.</p><p>The MedPrüf Team</p>`;
    }
    const res = await sendZohoEmail({ to, subject, htmlBody: body });
    await recordEventSafe(sb, {
      userId,
      eventType: kind === "approved" ? "puyp_approval_email" : "puyp_rejection_email",
      data: { ok: res.ok, reason: res.ok ? null : res.reason },
    });
  } catch (err) {
    console.error("[puyp] decision email failed", err);
  }
}

/**
 * /api/puyp/admin — admin-only PUYP queue + action endpoint.
 *
 * GET    → list all exam_attempts, filterable by `?status=pending|approved|rejected`,
 *          enriched with user email/first_name, subscription tier / expires_at,
 *          and a short-lived signed URL for the proof file.
 * POST   → approve / reject an attempt.
 *          Body: { attempt_id: uuid, action: 'approve'|'reject',
 *                  new_expires_at?: ISO string (approve only),
 *                  reason?: string (reject only) }
 *
 * Both methods require `requireAdmin`. Admin means `users.role='admin'`.
 *
 * Approve flow (atomic enough — two writes, but the insert into
 * `subscription_extensions` is the audit trail so a half-finished
 * partial is still recoverable by [name] manually flipping
 * `subscriptions.expires_at` if needed):
 *
 *   1. Load the `exam_attempts` row + its `subscription_id`.
 *   2. Refuse if already verified, or result != 'fail', or
 *      `puyp_extensions_used >= 2`.
 *   3. Compute `new_expires_at` — either the admin-supplied ISO, or
 *      fall back to `suggestNextExpiresAt(exam_type)`.
 *   4. Update `subscriptions.expires_at = new_expires_at`,
 *      increment `puyp_extensions_used`.
 *   5. Mirror `users.tier_expires_at = new_expires_at`.
 *   6. Insert `subscription_extensions` row with attempt_id, granted_by.
 *   7. Update `exam_attempts` with verified_at/verified_by.
 *
 * Reject flow:
 *   1. Update `exam_attempts` with verified_at/verified_by and
 *      rejection_reason.
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
      .order("created_at", { ascending: false })
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

    return NextResponse.json({ items: enriched, count: enriched.length });
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

  try {
    const body = await req.json().catch(() => ({}));
    const attemptId = String(body?.attempt_id || "");
    const action = String(body?.action || "").toLowerCase();

    if (!attemptId || (action !== "approve" && action !== "reject")) {
      return NextResponse.json(
        { error: "Body must contain attempt_id and action='approve'|'reject'" },
        { status: 400 }
      );
    }

    const sb = getServiceClient();

    // Load the attempt. Join with subscription for the counter check.
    const { data: attempt, error: attemptErr } = await sb
      .from("exam_attempts")
      .select(
        "id, user_id, subscription_id, exam_type, attempt_date, result, verified_at, rejection_reason"
      )
      .eq("id", attemptId)
      .maybeSingle();

    if (attemptErr) {
      captureServerError(attemptErr, {
        route: "/api/puyp/admin",
        step: "attempt_lookup",
      });
      return NextResponse.json(
        { error: "Attempt lookup failed" },
        { status: 500 }
      );
    }
    if (!attempt) {
      return NextResponse.json(
        { error: "Attempt not found" },
        { status: 404 }
      );
    }

    if (attempt.verified_at) {
      return NextResponse.json(
        { error: "This attempt has already been verified." },
        { status: 409 }
      );
    }

    if (attempt.result !== "fail") {
      return NextResponse.json(
        {
          error:
            "Only fail attempts can be approved/rejected via this endpoint. Pass attempts are self-verified.",
        },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();

    // ═══ REJECT PATH ══════════════════════════════════════════════
    if (action === "reject") {
      const reason =
        typeof body?.reason === "string" ? body.reason.trim() : "";
      if (!reason) {
        return NextResponse.json(
          { error: "Reject requires a `reason` message for the user." },
          { status: 400 }
        );
      }

      const { error: updateErr } = await sb
        .from("exam_attempts")
        .update({
          verified_at: nowIso,
          verified_by: adminId,
          rejection_reason: reason,
        })
        .eq("id", attempt.id);

      if (updateErr) {
        captureServerError(updateErr, {
          route: "/api/puyp/admin",
          step: "reject_update",
        });
        return NextResponse.json(
          { error: "Failed to reject attempt" },
          { status: 500 }
        );
      }

      await sendPuypDecisionEmail(sb, attempt.user_id as string, "rejected", { reason });

      await sb.from("user_events").insert({
        user_id: attempt.user_id,
        event_type: "puyp_attempt_rejected",
        event_data: {
          attempt_id: attempt.id,
          admin_id: adminId,
          reason,
        },
      });

      const actorEmail = await resolveActorEmail(adminId);
      await logAdminAction({
        req,
        actorId: adminId,
        actorEmail,
        action: "reject_puyp",
        targetType: "exam_attempt",
        targetId: attempt.id,
        payload: {
          reason,
          exam_type: attempt.exam_type,
          target_user_id: attempt.user_id,
        },
      });

      return NextResponse.json({
        ok: true,
        action: "rejected",
        attempt_id: attempt.id,
      });
    }

    // ═══ APPROVE PATH ═════════════════════════════════════════════
    // Load the subscription to enforce the max-extensions rule.
    if (!attempt.subscription_id) {
      return NextResponse.json(
        {
          error:
            "Attempt has no linked subscription, cannot extend. Check the user's subscription history manually.",
        },
        { status: 400 }
      );
    }

    const { data: sub, error: subErr } = await sb
      .from("subscriptions")
      .select("id, user_id, tier, expires_at, puyp_extensions_used, status")
      .eq("id", attempt.subscription_id)
      .maybeSingle();

    if (subErr || !sub) {
      captureServerError(subErr, {
        route: "/api/puyp/admin",
        step: "sub_lookup",
      });
      return NextResponse.json(
        { error: "Subscription lookup failed" },
        { status: 500 }
      );
    }

    const used = Number(sub.puyp_extensions_used) || 0;
    if (used >= PUYP_MAX_EXTENSIONS) {
      return NextResponse.json(
        {
          error: `Subscription has already used ${used} PUYP extensions (cap: ${PUYP_MAX_EXTENSIONS}).`,
        },
        { status: 409 }
      );
    }

    // Compute the new expires_at.
    let newExpiresAt: Date;
    if (typeof body?.new_expires_at === "string") {
      const parsed = new Date(body.new_expires_at);
      if (isNaN(parsed.getTime())) {
        return NextResponse.json(
          {
            error:
              "Invalid new_expires_at: expected ISO timestamp string.",
          },
          { status: 400 }
        );
      }
      newExpiresAt = parsed;
    } else {
      newExpiresAt = suggestNextExpiresAt(
        attempt.exam_type as PuypExamType
      );
    }

    const previousExpiresAt = sub.expires_at
      ? new Date(sub.expires_at as string).toISOString()
      : null;

    // Don't shrink the subscription — if the admin accidentally picks
    // an earlier date than the current expiry, keep the later one.
    const current = sub.expires_at ? new Date(sub.expires_at as string) : null;
    if (current && current.getTime() > newExpiresAt.getTime()) {
      newExpiresAt = current;
    }

    // 1. Update subscription.
    const { error: subUpdateErr } = await sb
      .from("subscriptions")
      .update({
        expires_at: newExpiresAt.toISOString(),
        puyp_extensions_used: used + 1,
        updated_at: nowIso,
      })
      .eq("id", sub.id);

    if (subUpdateErr) {
      captureServerError(subUpdateErr, {
        route: "/api/puyp/admin",
        step: "sub_update",
      });
      return NextResponse.json(
        { error: "Failed to extend subscription" },
        { status: 500 }
      );
    }

    // 2. Mirror to users.tier_expires_at (the denormalized read-path).
    const { error: userUpdateErr } = await sb
      .from("users")
      .update({
        tier_expires_at: newExpiresAt.toISOString(),
        updated_at: nowIso,
      })
      .eq("id", sub.user_id);

    if (userUpdateErr) {
      // Non-fatal — subscription is the source of truth. Log and move
      // on so the approval still completes.
      captureServerError(userUpdateErr, {
        route: "/api/puyp/admin",
        step: "user_mirror",
      });
    }

    // 3. Audit row.
    const { error: extErr } = await sb
      .from("subscription_extensions")
      .insert({
        subscription_id: sub.id,
        user_id: sub.user_id,
        source: "puyp",
        attempt_id: attempt.id,
        previous_expires_at: previousExpiresAt,
        new_expires_at: newExpiresAt.toISOString(),
        granted_by: adminId,
      });

    if (extErr) {
      captureServerError(extErr, {
        route: "/api/puyp/admin",
        step: "extension_insert",
      });
      // The subscription IS extended, the audit trail is missing.
      // Flag and continue.
    }

    // 4. Flip attempt to verified.
    const { error: attemptUpdateErr } = await sb
      .from("exam_attempts")
      .update({
        verified_at: nowIso,
        verified_by: adminId,
      })
      .eq("id", attempt.id);

    if (attemptUpdateErr) {
      captureServerError(attemptUpdateErr, {
        route: "/api/puyp/admin",
        step: "attempt_verify",
      });
      // Same situation — extension granted, attempt row stale.
    }

    await sendPuypDecisionEmail(sb, sub.user_id as string, "approved", {
      newExpiresAtIso: newExpiresAt.toISOString(),
    });

    await sb.from("user_events").insert({
      user_id: sub.user_id,
      event_type: "puyp_extension_granted",
      event_data: {
        attempt_id: attempt.id,
        subscription_id: sub.id,
        admin_id: adminId,
        previous_expires_at: previousExpiresAt,
        new_expires_at: newExpiresAt.toISOString(),
        extensions_used: used + 1,
      },
    });

    const actorEmail = await resolveActorEmail(adminId);
    await logAdminAction({
      req,
      actorId: adminId,
      actorEmail,
      action: "approve_puyp",
      targetType: "exam_attempt",
      targetId: attempt.id,
      payload: {
        via: "single",
        subscription_id: sub.id,
        target_user_id: sub.user_id,
        previous_expires_at: previousExpiresAt,
        new_expires_at: newExpiresAt.toISOString(),
        extensions_used: used + 1,
        exam_type: attempt.exam_type,
      },
    });

    return NextResponse.json({
      ok: true,
      action: "approved",
      attempt_id: attempt.id,
      new_expires_at: newExpiresAt.toISOString(),
      extensions_used: used + 1,
    });
  } catch (err) {
    captureServerError(err, { route: "/api/puyp/admin", step: "POST" });
    return NextResponse.json(
      { error: "Internal error" },
      { status: 500 }
    );
  }
}
