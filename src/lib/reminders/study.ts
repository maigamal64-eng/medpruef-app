import { asPuypExamType, viennaToday } from "@/lib/exam-dates";
import { renderStudyNudge } from "@/lib/email/study-nudge-template";
import { isPaidTier } from "@/lib/free-tier";
import { assertDb, deliverBatch, loadSubscriptions, SITE, unsubscribeUrl, type Delivery, type ReminderDb } from "./common";
import { verifiedDestination } from "./study-consent";
import { normalizeEmail } from "./tokens";
import { studyNudgeWindow } from "./schedule";

export async function runStudyNudges(db: ReminderDb, now: Date, dryRun: boolean) {
  if (!studyNudgeWindow(now)) return { eligible: 0, pending: 0, sent: 0, failed: 0, skipped: 0 };
  const rows = await loadSubscriptions(db, "study_nudge_prefs", "id,user_id,unsub_token,last_sent,consent_email,consent_confirmed_at,consent_version", "study");
  const day = viennaToday(now);
  const deliveries: Delivery[] = [];
  for (const row of rows) {
    if (typeof row.unsub_token !== "string" || typeof row.consent_email !== "string" || !row.consent_confirmed_at || row.consent_version !== 1) continue;
    if (row.last_sent && viennaToday(new Date(String(row.last_sent))) >= day) continue;
    const { data: user, error } = await db.from("users").select("email,email_verified_at,email_status,language_code,active_exam,is_banned,role,tier,tier_expires_at").eq("id", row.user_id).maybeSingle();
    assertDb(error);
    const bank = asPuypExamType(user?.active_exam);
    if (!user?.email || verifiedDestination(user) !== row.consent_email || user.is_banned || !bank) continue;
    if (user.role !== "admin" && !isPaidTier(user.tier, user.tier_expires_at)) continue;
    // Same due-time predicate as /api/questions' spaced-repetition queue.
    // Count only active questions in the current bank. No content is exposed.
    const due = await db.from("user_question_progress").select("id,questions!inner(id)", { count: "exact", head: true }).eq("user_id", row.user_id).lte("next_review_at", now.toISOString()).eq("questions.is_active", true).eq("questions.exam_type", bank);
    assertDb(due.error);
    if (!due.count) continue;
    deliveries.push({
      keys: { pref_id: String(row.id), nudge_day: day, channel: "email" },
      mail: { to: normalizeEmail(user.email), ...renderStudyNudge(due.count, user.language_code, dryRun ? SITE : unsubscribeUrl("study", row.unsub_token)) },
      isSubscribed: async () => {
        const pref = await db.from("study_nudge_prefs").select("id").eq("id", row.id).eq("user_id", row.user_id).eq("unsub_token", row.unsub_token).eq("opt_in", true).eq("channel", "email").eq("consent_email", row.consent_email).eq("consent_confirmed_at", row.consent_confirmed_at).eq("consent_version", 1).maybeSingle();
        assertDb(pref.error);
        if (!pref.data) return false;
        const owner = await db.from("users").select("email,email_verified_at,email_status,active_exam,is_banned,role,tier,tier_expires_at").eq("id", row.user_id).maybeSingle();
        assertDb(owner.error);
        return !!owner.data && !owner.data.is_banned && verifiedDestination(owner.data) === row.consent_email && owner.data.active_exam === bank && (owner.data.role === "admin" || isPaidTier(owner.data.tier, owner.data.tier_expires_at));
      },
      onSent: async () => {
        const { error: stampError } = await db.from("study_nudge_prefs").update({ last_sent: now.toISOString() }).eq("id", row.id);
        assertDb(stampError);
      },
    });
  }
  return deliverBatch(db, "study_nudge_sends", deliveries, dryRun, now);
}
