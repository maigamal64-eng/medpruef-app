/**
 * PUYP (pay until you pass) admin decisions shared by the single and bulk
 * routes (ADM-19, UX-ADM-22).
 *
 * Approval runs in ONE guarded database function (admin_puyp_approve,
 * migration 20261201090000): never shortens the subscription or the learner's
 * access, keeps permanent Pro, checks owner/status/cap and writes extension,
 * verification and audit together. Until that migration is applied approval
 * returns 503 and [name] approves by hand (0 claims so far).
 *
 * Decision emails are best effort and report whether they were sent, so the
 * queue can show "Learner not notified" instead of assuming delivery.
 * German copy uses formal Sie.
 */
import type { NextRequest } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { sendZohoEmail } from "@/lib/email/zoho";
import { recordEventSafe } from "@/lib/user-events";
import { PUYP_MAX_EXTENSIONS } from "@/lib/puyp";
import { isMissingFunctionError } from "@/lib/admin/duplicates";
import { logAdminAction } from "@/lib/admin/audit";
import { scheduleIntercomContactSync } from "@/lib/intercom/sync";

type Db = ReturnType<typeof getServiceClient>;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface DecisionEmailResult {
  sent: boolean;
  reason: string | null;
}

export function puypDecisionEmail(
  kind: "approved" | "rejected",
  lang: string | null,
  firstName: string | null,
  detail: { newExpiresAtIso?: string; reason?: string },
): { subject: string; htmlBody: string } {
  const de = (lang || "de").toLowerCase().startsWith("de");
  const name = firstName ? esc(firstName) : "";
  const hello = de ? `Guten Tag${name ? ` ${name}` : ""},` : `Hi${name ? ` ${name}` : ""},`;
  if (kind === "approved") {
    const when = new Date(detail.newExpiresAtIso as string).toLocaleDateString(de ? "de-AT" : "en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Europe/Vienna",
    });
    return de
      ? {
          subject: "Ihr MedPrüf-Zugang wurde verlängert",
          htmlBody: `<p>${hello}</p><p>wir haben Ihren Nachweis geprüft und Ihren Zugang bis zum <strong>${when}</strong> verlängert. Sie müssen nichts weiter tun.</p><p>Viel Erfolg beim nächsten Antritt.</p><p>Ihr MedPrüf-Team</p>`,
        }
      : {
          subject: "Your MedPrüf access has been extended",
          htmlBody: `<p>${hello}</p><p>we reviewed your exam result and extended your access until <strong>${when}</strong>. You do not need to do anything.</p><p>Good luck with your next attempt.</p><p>The MedPrüf Team</p>`,
        };
  }
  const why = esc(detail.reason || "");
  return de
    ? {
        subject: "Zu Ihrer Verlängerungsanfrage bei MedPrüf",
        htmlBody: `<p>${hello}</p><p>wir konnten Ihre Verlängerungsanfrage leider nicht bestätigen.</p><p>Grund: ${why}</p><p>Wenn Sie Fragen haben oder einen neuen Nachweis senden möchten, antworten Sie einfach auf diese E-Mail oder schreiben Sie an user-b7e46e80@example.com.</p><p>Ihr MedPrüf-Team</p>`,
      }
    : {
        subject: "About your MedPrüf extension request",
        htmlBody: `<p>${hello}</p><p>unfortunately we could not confirm your extension request.</p><p>Reason: ${why}</p><p>If you have questions or want to send a new proof, reply to this email or write to user-b7e46e80@example.com.</p><p>The MedPrüf Team</p>`,
      };
}

export async function sendPuypDecisionEmail(
  sb: Db,
  userId: string,
  attemptId: string,
  kind: "approved" | "rejected",
  detail: { newExpiresAtIso?: string; reason?: string },
): Promise<DecisionEmailResult> {
  try {
    const { data: u } = await sb
      .from("users")
      .select("email, first_name, language_code")
      .eq("id", userId)
      .maybeSingle();
    const to = (u?.email as string | null) || null;
    if (!to) return { sent: false, reason: "no_email" }; // Telegram-only account
    const mail = puypDecisionEmail(kind, (u?.language_code as string | null) ?? null, (u?.first_name as string | null) ?? null, detail);
    const res = await sendZohoEmail({ to, subject: mail.subject, htmlBody: mail.htmlBody });
    await recordEventSafe(sb, {
      userId,
      eventType: kind === "approved" ? "puyp_approval_email" : "puyp_rejection_email",
      data: { ok: res.ok, reason: res.ok ? null : res.reason, attempt_id: attemptId },
    });
    return res.ok ? { sent: true, reason: null } : { sent: false, reason: String(res.reason ?? "send_failed") };
  } catch (err) {
    console.error("[puyp] decision email failed", err);
    return { sent: false, reason: "error" };
  }
}

/** Audit record that the learner was told about a rejection (email or by hand). */
export async function recordRejectionNotified(
  req: NextRequest,
  actor: { userId: string; email: string },
  attemptId: string,
  channel: "email" | "manual",
): Promise<void> {
  await logAdminAction({
    req,
    actorId: actor.userId,
    actorEmail: actor.email,
    action: "puyp_rejection_notified",
    targetType: "exam_attempt",
    targetId: attemptId,
    payload: { channel },
  });
}

export type ApproveResult =
  | { ok: true; newExpiresAt: string; previousExpiresAt: string | null; userId: string; userAccess: string; extensionsUsed: number }
  | { ok: false; status: number; error: string; code: string };

const ERROR_STATUS: Record<string, number> = { "42501": 403, P0002: 404, "55000": 409, "23514": 409, "22023": 400 };

export async function approvePuypAttempt(
  sb: Db,
  args: { actorId: string; attemptId: string; requestedExpiresAt: Date; via: "single" | "bulk"; context?: Record<string, unknown> },
): Promise<ApproveResult> {
  const { data, error } = await sb.rpc("admin_puyp_approve", {
    p_actor_id: args.actorId,
    p_attempt_id: args.attemptId,
    p_new_expires_at: args.requestedExpiresAt.toISOString(),
    p_via: args.via,
    p_max_extensions: PUYP_MAX_EXTENSIONS,
    p_audit_context: args.context ?? {},
  });
  if (error) {
    if (isMissingFunctionError(error)) {
      return { ok: false, status: 503, code: "migration_pending", error: "PUYP approval needs the a13 database update. Approve by hand until it is applied." };
    }
    const status = ERROR_STATUS[error.code ?? ""] ?? 500;
    return { ok: false, status, code: error.code ?? "unknown", error: status === 500 ? "Approval failed. Nothing was changed." : error.message };
  }
  const row = data as {
    new_expires_at: string;
    previous_expires_at: string | null;
    user_id: string;
    user_access: string;
    extensions_used: number;
  };
  scheduleIntercomContactSync(row.user_id, "tier_change");
  return {
    ok: true,
    newExpiresAt: new Date(row.new_expires_at).toISOString(),
    previousExpiresAt: row.previous_expires_at ? new Date(row.previous_expires_at).toISOString() : null,
    userId: row.user_id,
    userAccess: row.user_access,
    extensionsUsed: Number(row.extensions_used),
  };
}

/** Hours left on the 72-hour review promise (negative when overdue). */
export function hoursUntilDue(createdAt: string, now = Date.now(), slaHours = 72): number {
  return Math.round((new Date(createdAt).getTime() + slaHours * 3_600_000 - now) / 3_600_000);
}
