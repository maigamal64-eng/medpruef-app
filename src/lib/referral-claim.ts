/**
 * Referral claim, shared by POST /api/referrals/claim (a ?ref= link) and the
 * code front door (a typed code, a-code-front-door). One owner of the writes:
 * users.referred_by_code and the pending referrals row. Server only.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidReferralCodeFormat, normalizeReferralCode } from "@/lib/referrals";
import { isReferralExamRewardEnabled } from "@/lib/referral-exam-reward";

export type ClaimStatus = "ok" | "deduped" | "invalid" | "not_found" | "already" | "self" | "too_old" | "error";
export interface ClaimResult { status: ClaimStatus; firstName?: string | null }

/**
 * maxAccountAgeDays: set by the typed-code path only (an old account must not
 * hand a friend a referral after the fact); the ?ref= route passes nothing and
 * behaves as before.
 */
export async function claimReferralCode(
  sb: Pick<SupabaseClient, "from">,
  userId: string,
  raw: string,
  opts: { maxAccountAgeDays?: number; now?: Date } = {},
): Promise<ClaimResult> {
  const code = normalizeReferralCode(raw);
  if (!code || !isValidReferralCodeFormat(code)) return { status: "invalid" };

  const { data: me, error: meErr } = await sb.from("users").select("id, referral_code, referred_by_code, created_at").eq("id", userId).maybeSingle();
  if (meErr) { console.error("[referrals/claim] self lookup", meErr); return { status: "error" }; }
  if (!me) return { status: "not_found" };
  if (me.referred_by_code) return { status: "already" };
  if (me.referral_code && String(me.referral_code).toUpperCase() === code) return { status: "self" };
  if (opts.maxAccountAgeDays !== undefined) {
    const created = me.created_at ? Date.parse(String(me.created_at)) : NaN;
    const now = (opts.now ?? new Date()).getTime();
    if (!Number.isFinite(created) || now - created > opts.maxAccountAgeDays * 86_400_000) return { status: "too_old" };
  }

  // Legacy codes (md5 default) may be lower case: match case-insensitively. The
  // code is [A-Z0-9] only, so no LIKE wildcard can reach the pattern.
  const { data: referrer, error: refErr } = await sb.from("users").select("id, first_name").ilike("referral_code", code).maybeSingle();
  if (refErr) { console.error("[referrals/claim] referrer lookup", refErr); return { status: "error" }; }
  if (!referrer) return { status: "not_found" };
  if (referrer.id === userId) return { status: "self" };

  // Compare-and-set: two claims racing at first login (a ?ref= link and a typed code) cannot both win.
  const { data: won, error: updErr } = await sb.from("users").update({ referred_by_code: code }).eq("id", userId).is("referred_by_code", null).select("id");
  if (updErr) { console.error("[referrals/claim] user update", updErr); return { status: "error" }; }
  if (!won || won.length === 0) return { status: "already" };

  // reward_type: rows created under the active exam-reward program are program rows
  // (see the history in /api/referrals/claim: a cash default let the legacy webhook
  // qualifier win a race and bypass the card and activity gate).
  const { error: insErr } = await sb.from("referrals").insert({
    referrer_user_id: referrer.id,
    referee_user_id: userId,
    referral_code: code,
    status: "pending",
    reward_credit_cents: 0,
    reward_type: isReferralExamRewardEnabled() ? "pro_until_exam" : "cash",
  });
  if (insErr) {
    if ((insErr as { code?: string }).code === "23505") return { status: "deduped", firstName: referrer.first_name || null };
    console.error("[referrals/claim] insert", insErr);
    return { status: "error" };
  }
  return { status: "ok", firstName: referrer.first_name || null };
}
