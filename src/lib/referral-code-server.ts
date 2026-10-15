/**
 * The caller's referral code, minted on first use (shared by
 * /api/referrals/status and /api/referrals/invite). A missing or malformed
 * users.referral_code gets a fresh 8-character code; a UNIQUE collision
 * (23505) retries up to five times. Server only: the caller passes a
 * service-role client and the signed user id.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateReferralCode, isValidReferralCodeFormat } from "@/lib/referrals";

type Db = Pick<SupabaseClient, "from">;

export type EnsureReferralCodeResult =
  | { ok: true; code: string }
  | { ok: false; reason: "update_failed" | "no_unique_code"; error?: unknown };

export async function ensureReferralCode(sb: Db, userId: string, current: string | null | undefined): Promise<EnsureReferralCodeResult> {
  const code = (current || "").toUpperCase();
  if (code && isValidReferralCodeFormat(code)) return { ok: true, code };
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = generateReferralCode();
    const { error } = await sb.from("users").update({ referral_code: candidate }).eq("id", userId);
    if (!error) return { ok: true, code: candidate };
    if ((error as { code?: string }).code !== "23505") return { ok: false, reason: "update_failed", error };
  }
  return { ok: false, reason: "no_unique_code" };
}
