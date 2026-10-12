import type { SupabaseClient } from "@supabase/supabase-js";
import { VERIFIED_CANCEL_PATH, billingPrechargeReminder } from "@/lib/billing-copy";
import { loadWhopBillingSnapshot, type ProviderBillingSnapshot } from "@/lib/whop-subscription-snapshot";
import { sendZohoEmail } from "@/lib/email/zoho";
import { checkSuppression, type SuppressionStatus } from "@/lib/mail-suppression";

export function prechargeRemindersEnabled(): boolean {
  return process.env.TRIAL_REMINDER_EMAILS_ENABLED === "true" && VERIFIED_CANCEL_PATH;
}
export function eligiblePrechargeReminder(snapshot: ProviderBillingSnapshot | null, nowMs: number): snapshot is ProviderBillingSnapshot {
  if (!snapshot?.provider_state_verified || !snapshot.is_trial || snapshot.provider_status !== "trialing" || snapshot.cancel_at_period_end ||
      snapshot.billing_cadence !== "auto_renews" || snapshot.billing_interval_days !== 30 ||
      !snapshot.manage_url || snapshot.next_charge_amount_cents == null || snapshot.next_charge_amount_cents <= 0 || !snapshot.next_charge_at) return false;
  const remaining = Date.parse(snapshot.next_charge_at) - nowMs;
  return Number.isFinite(remaining) && remaining > 86400_000 && remaining <= 2 * 86400_000;
}
export function renderPrechargeReminder(snapshot: ProviderBillingSnapshot, lang: "de" | "en") {
  if (!snapshot.next_charge_at || snapshot.next_charge_amount_cents == null || !snapshot.manage_url) throw new Error("Missing provider billing terms");
  const date = new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "en-US", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Vienna" }).format(new Date(snapshot.next_charge_at));
  const { subject, sentence, steps } = billingPrechargeReminder(date, snapshot.next_charge_amount_cents, lang);
  const href = snapshot.manage_url.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return { subject, htmlBody: `<p>${sentence}</p><p><a href="${href}">${lang === "de" ? "So kündigst du" : "How to cancel"}</a></p><p>${steps}</p>` };
}
export type PrechargeReminderResult = "disabled" | "ineligible" | "duplicate" | "sent" | "failed" | "unavailable";
/** Shared cron/webhook claim. A claim is never released after a send attempt:
 * provider acceptance can be ambiguous, so retrying would violate at-most-once. */
export async function sendPrechargeTrialReminder(sb: SupabaseClient, args: { userId: string; membershipId: string; nowMs?: number }): Promise<PrechargeReminderResult> {
  if (!prechargeRemindersEnabled()) return "disabled";
  const nowMs = args.nowMs ?? Date.now();
  const { data: trial, error: trialError } = await sb.from("subscriptions")
    .select("id, status, tier, expires_at, trial_reminder_sent_at")
    .eq("user_id", args.userId).eq("whop_membership_id", args.membershipId)
    .eq("payment_provider", "whop").eq("tier", "notes_pro_trial").eq("status", "active")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (trialError) return "unavailable";
  if (!trial || trial.trial_reminder_sent_at || !trial.expires_at || Date.parse(trial.expires_at) <= nowMs) return "ineligible";
  const snapshot = await loadWhopBillingSnapshot(args.membershipId, "notes_pro_trial");
  if (!eligiblePrechargeReminder(snapshot, nowMs)) return "ineligible";
  const { data: user, error: userError } = await sb.from("users").select("email, language_code")
    .eq("id", args.userId).maybeSingle();
  if (userError) return "unavailable";
  if (!user?.email) return "ineligible";
  // b39: a pre-charge billing notice counts as transactional, so a "Stopp"
  // (marketing) opt-out still gets it; a bounce or complaint (scope all) does
  // not. Checked before the claim, so an unreadable list burns no claim and a
  // later lift is honoured on the next sweep.
  let listed: SuppressionStatus;
  try { listed = await checkSuppression(sb, user.email, "transactional"); } catch { return "unavailable"; }
  if (listed !== "clear") {
    await sb.from("user_events").insert({ user_id: args.userId, event_type: "trial_precharge_reminder_suppressed", event_data: {
      subscription_id: trial.id, membership_id: args.membershipId, suppression: listed,
    } });
    return "ineligible";
  }
  const claimKey = `trialssoon:${args.membershipId}`;
  const claimedAt = new Date(nowMs).toISOString();
  const { data: claim, error: claimError } = await sb.from("processed_webhook_events").insert({
    provider: "whop", event_id: claimKey,
    payload: { claimed_at: claimedAt, reason: "precharge_trial_reminder", subscription_id: trial.id },
  }).select("event_id").maybeSingle();
  if (claimError) return claimError.code === "23505" ? "duplicate" : "unavailable";
  if (!claim) return "unavailable";
  // Claim before attempting delivery. Shared PK protects simultaneous cron/webhook runs.
  const lang = String(user.language_code ?? '').startsWith('de') ? 'de' : 'en';
  let sent = false;
  try {
    const template = renderPrechargeReminder(snapshot, lang);
    sent = (await sendZohoEmail({ to: user.email, ...template })).ok;
  } catch { /* Record the failed attempt, retaining the claim to prevent duplicate sends. */ }
  const event = sent ? "trial_precharge_reminder_sent" : "trial_precharge_reminder_failed";
  await sb.from("user_events").insert({ user_id: args.userId, event_type: event, event_data: {
    subscription_id: trial.id, membership_id: args.membershipId,
    first_charge_at: snapshot.next_charge_at, amount_cents: snapshot.next_charge_amount_cents, provider_accepted: sent,
  } });
  if (sent) await sb.from("subscriptions").update({ trial_reminder_sent_at: claimedAt, updated_at: claimedAt }).eq("id", trial.id);
  return sent ? "sent" : "failed";
}
