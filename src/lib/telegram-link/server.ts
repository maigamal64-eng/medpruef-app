/**
 * Bind a Telegram account to an existing MedPrüf account (a-trial-phone-gate).
 * Called by the bot webhook for "/start lk_<token>" (token.ts). Server only.
 *
 * Rules, in order:
 *   - the token verifies (signature, 15 minutes) and the flag is on;
 *   - the account exists, is not banned, is not an admin, staff or test
 *     account (Reviewer P2: a Telegram login must never become a password-free
 *     way into those), and the token was issued after the account's last
 *     session revocation (users.session_invalidated_at, whole seconds);
 *   - the account has no telegram_id yet (a second Telegram never replaces
 *     the first; the same Telegram again answers "already");
 *   - no other account holds this Telegram id (users.telegram_id is UNIQUE;
 *     the write also hits that index on a race).
 * The write is one compare-and-set: telegram_id, telegram_username and
 * telegram_chat_id_confirmed (the person just talked to the bot), only while
 * telegram_id is still null. It never touches the trial: the learner's own
 * browser starts it (GET /api/telegram/link) so the network cap counts the
 * learner's network, not Telegram's servers.
 *
 * Once linked, Telegram can also sign in to this account (web_login), which
 * the prompt says before the learner opens the bot, and the account's address
 * gets a transactional notice ("was this not you? reply") right after.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { forgetGuardUser } from "@/lib/auth-guard";
import { captureServerError } from "@/lib/sentry-capture";
import { recordEventSafe } from "@/lib/user-events";
import { telegramLinkEnabled } from "./flag";
import { verifyTelegramLinkToken } from "./token";
import { sendLinkNotice } from "./notice";
import { isStaffOrTestAccount } from "@/lib/admin/money-rules";

export type BindResult =
  | "linked"
  | "already"
  | "account_has_other"
  | "telegram_in_use"
  | "expired"
  | "invalid"
  | "off"
  | "error";

export interface TelegramFrom {
  id: number;
  username?: string | null;
}

const isUniqueViolation = (e: unknown) => !!e && typeof e === "object" && (e as { code?: string }).code === "23505";

export async function bindTelegramFromStart(
  sb: SupabaseClient,
  args: { token: string; from: TelegramFrom; now?: Date },
): Promise<BindResult> {
  if (!telegramLinkEnabled()) return "off";
  const now = args.now ?? new Date();
  const token = verifyTelegramLinkToken(args.token, { now });
  if (!token.ok) return token.error === "expired" ? "expired" : token.error === "unconfigured" ? "off" : "invalid";
  if (!Number.isSafeInteger(args.from.id) || args.from.id <= 0) return "invalid";
  try {
    const read = await sb.from("users")
      .select("id, telegram_id, is_banned, session_invalidated_at, role, tier, email, language_code")
      .eq("id", token.userId).maybeSingle();
    if (read.error) throw read.error;
    const u = read.data as { telegram_id: unknown; is_banned: boolean | null; session_invalidated_at: string | null; role: string | null; tier: string | null; email: string | null; language_code: string | null } | null;
    if (!u || u.is_banned === true) return "invalid";
    if (isStaffOrTestAccount({ role: u.role, tier: u.tier, email: u.email })) return "invalid";
    const revokedAt = u.session_invalidated_at ? Date.parse(u.session_invalidated_at) : NaN;
    // Whole seconds (the token carries seconds): a link minted in the second of a revocation is refused too.
    if (Number.isFinite(revokedAt) && token.issuedAt.getTime() <= Math.floor(revokedAt / 1000) * 1000) return "invalid";
    if (u.telegram_id !== null && u.telegram_id !== undefined) {
      return Number(u.telegram_id) === args.from.id ? "already" : "account_has_other";
    }
    const holder = await sb.from("users").select("id").eq("telegram_id", args.from.id).limit(1);
    if (holder.error) throw holder.error;
    if ((holder.data ?? []).length > 0) return "telegram_in_use";

    const username = typeof args.from.username === "string" && args.from.username.length <= 64 ? args.from.username : null;
    const write = await sb.from("users")
      .update({ telegram_id: args.from.id, telegram_username: username, telegram_chat_id_confirmed: now.toISOString() })
      .eq("id", token.userId).is("telegram_id", null)
      .select("id");
    if (write.error) {
      if (isUniqueViolation(write.error)) return "telegram_in_use";
      throw write.error;
    }
    if ((write.data ?? []).length === 0) {
      // Someone (the same person in a second tab, most likely) linked first.
      const again = await sb.from("users").select("telegram_id").eq("id", token.userId).maybeSingle();
      if (again.error) throw again.error;
      return Number(again.data?.telegram_id) === args.from.id ? "already" : "account_has_other";
    }
    forgetGuardUser(token.userId);
    await recordEventSafe(sb, { userId: token.userId, eventType: "telegram_linked", data: { source: "trial_prompt" } });
    await sendLinkNotice(sb, { userId: token.userId, email: u.email, languageCode: u.language_code });
    return "linked";
  } catch (err) {
    captureServerError(err, { route: "/api/telegram/webhook", phase: "telegram_link", userId: token.userId });
    return "error";
  }
}
