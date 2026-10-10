import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { adminRouteShell } from "@/lib/admin/shell";
import { logAdminAction } from "@/lib/admin/audit";
import { suggestNextExpiresAt, type PuypExamType } from "@/lib/exam-dates";
import { PUYP_MAX_EXTENSIONS } from "@/lib/puyp";

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
 * POST /api/admin/puyp/bulk-approve
 * Body: { attempt_ids: string[] }  (max 20)
 *
 * Approves up to 20 PUYP submissions in one call. Writes per-attempt
 * audit-log rows so the trail mirrors single approvals. Aggregate
 * audit row captures the bulk intent.
 *
 * §2.4 + §2.7. Handlers mirror the single-POST logic in
 * /api/puyp/admin so any future schema change touches both places.
 */
export const POST = adminRouteShell(
  async ({ req, actor }) => {
    let body: { attempt_ids?: string[] };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }
    const ids = Array.isArray(body.attempt_ids)
      ? body.attempt_ids.filter((s) => typeof s === "string" && s.length > 0)
      : [];
    if (ids.length === 0) {
      return NextResponse.json(
        { error: "attempt_ids required" },
        { status: 400 }
      );
    }
    if (ids.length > 20) {
      return NextResponse.json(
        { error: "Bulk approval capped at 20 attempts per call" },
        { status: 400 }
      );
    }

    const sb = getServiceClient();
    const results: Array<{
      attempt_id: string;
      ok: boolean;
      error?: string;
      new_expires_at?: string;
    }> = [];

    for (const attemptId of ids) {
      try {
        const { data: attempt, error: fetchErr } = await sb
          .from("exam_attempts")
          .select(
            "id, subscription_id, exam_type, result, verified_at, qbank_completion_pct"
          )
          .eq("id", attemptId)
          .maybeSingle();
        if (fetchErr || !attempt) {
          results.push({ attempt_id: attemptId, ok: false, error: "not_found" });
          continue;
        }
        if (attempt.verified_at) {
          results.push({
            attempt_id: attemptId,
            ok: false,
            error: "already_verified",
          });
          continue;
        }
        if (attempt.result !== "fail") {
          results.push({
            attempt_id: attemptId,
            ok: false,
            error: "not_a_fail",
          });
          continue;
        }
        const subId = attempt.subscription_id as string | null;
        if (!subId) {
          results.push({
            attempt_id: attemptId,
            ok: false,
            error: "no_subscription",
          });
          continue;
        }

        const { data: sub, error: subErr } = await sb
          .from("subscriptions")
          .select("id, expires_at, puyp_extensions_used, user_id")
          .eq("id", subId)
          .maybeSingle();
        if (subErr || !sub) {
          results.push({
            attempt_id: attemptId,
            ok: false,
            error: "subscription_missing",
          });
          continue;
        }
        if ((sub.puyp_extensions_used ?? 0) >= PUYP_MAX_EXTENSIONS) {
          results.push({
            attempt_id: attemptId,
            ok: false,
            error: "extensions_exhausted",
          });
          continue;
        }

        const suggested = suggestNextExpiresAt(
          attempt.exam_type as PuypExamType
        );
        const newExpiryIso =
          suggested instanceof Date ? suggested.toISOString() : String(suggested);

        const { error: updSubErr } = await sb
          .from("subscriptions")
          .update({
            expires_at: newExpiryIso,
            puyp_extensions_used: (sub.puyp_extensions_used ?? 0) + 1,
          })
          .eq("id", subId);
        if (updSubErr) {
          results.push({
            attempt_id: attemptId,
            ok: false,
            error: updSubErr.message,
          });
          continue;
        }

        // Mirror to users.tier_expires_at.
        await sb
          .from("users")
          .update({ tier_expires_at: newExpiryIso })
          .eq("id", sub.user_id);

        // Record in subscription_extensions (if table exists) — best effort.
        await sb.from("subscription_extensions").insert({
          subscription_id: subId,
          attempt_id: attemptId,
          granted_by: actor.userId,
          new_expires_at: newExpiryIso,
        });

        // Flip the attempt to verified.
        const { error: updAttemptErr } = await sb
          .from("exam_attempts")
          .update({
            verified_at: new Date().toISOString(),
            verified_by: actor.userId,
          })
          .eq("id", attemptId);
        if (updAttemptErr) {
          results.push({
            attempt_id: attemptId,
            ok: false,
            error: updAttemptErr.message,
          });
          continue;
        }

        // Per-attempt audit.
        await logAdminAction({
          req,
          actorId: actor.userId,
          actorEmail: actor.email,
          action: "approve_puyp",
          targetType: "exam_attempt",
          targetId: attemptId,
          payload: {
            via: "bulk",
            new_expires_at: newExpiryIso,
            previous_extensions_used: sub.puyp_extensions_used ?? 0,
          },
        });

        await sendPuypDecisionEmail(sb, sub.user_id as string, "approved", {
          newExpiresAtIso: newExpiryIso,
        });

        results.push({
          attempt_id: attemptId,
          ok: true,
          new_expires_at: newExpiryIso,
        });
      } catch (err) {
        results.push({
          attempt_id: attemptId,
          ok: false,
          error: (err as Error).message,
        });
      }
    }

    // Aggregate audit row.
    await logAdminAction({
      req,
      actorId: actor.userId,
      actorEmail: actor.email,
      action: "bulk_approve_puyp",
      payload: {
        requested: ids.length,
        approved: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
      },
    });

    return NextResponse.json({ results });
  },
  {
    route: "/api/admin/puyp/bulk-approve",
    rateLimit: { limit: 6, windowMs: 60_000 },
  }
);
