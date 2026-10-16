/**
 * Server side of the reverse trial (a-pricing-v2). Rules and the reasons the
 * design differs from the retired no-card trial: ./reverse-trial.ts.
 *
 * ensureReverseTrial runs from /api/auth/me (the call every app load makes)
 * and reads nothing more for an account that cannot qualify: the guard's
 * users row already carries created_at, role and tier. Only a new account
 * (created after REVERSE_TRIAL_SINCE, at most 7 days old, not Pro) costs one
 * users read and one database call, which takes every check again under a
 * row lock (start_reverse_trial, 20270103090000).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { captureServerError } from "@/lib/sentry-capture";
import { forgetGuardUser } from "@/lib/auth-guard";
import { reverseTrialEnabled, reverseTrialSince } from "./flag";
import { trialClaimEnabled } from "@/lib/trial-claim/flag";
import {
  REVERSE_TRIAL_DAYS,
  REVERSE_TRIAL_DEFAULT_MAX_PER_IP,
  mayStartReverseTrial,
  trialEmailKey,
  trialIpHash,
  type TrialCandidate,
} from "./reverse-trial";

export interface ReverseTrialState {
  /** The trial runs now. */
  active: boolean;
  endsAt: string | null;
  /** This call started it. */
  started: boolean;
}

const NONE: ReverseTrialState = { active: false, endsAt: null, started: false };

// Review P3: a new account that cannot start the trial (unverified, address,
// Telegram or network already used) is not re-checked on every /api/auth/me
// call; this instance remembers the "no" for 5 minutes.
const NO_TRIAL_TTL_MS = 5 * 60_000;
const noTrialUntil = new Map<string, number>();
function rememberNo(userId: string, now: Date): ReverseTrialState {
  if (noTrialUntil.size > 5_000) noTrialUntil.clear();
  noTrialUntil.set(userId, now.getTime() + NO_TRIAL_TTL_MS);
  return NONE;
}
/** Test seam. */
export function resetReverseTrialCache(): void { noTrialUntil.clear(); }
/** a-reverse-trial-claim: a fresh claim must show its Home line at once. */
export function forgetReverseTrialNo(userId: string): void { noTrialUntil.delete(userId); }

function maxPerIp(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.REVERSE_TRIAL_MAX_PER_IP);
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : REVERSE_TRIAL_DEFAULT_MAX_PER_IP;
}

function clientIp(headers: Headers): string | null {
  return headers.get("x-forwarded-for") ?? headers.get("x-real-ip");
}

/**
 * Start the trial when the account qualifies, or report the running one.
 * Never throws: a failure is reported and the learner simply has no trial.
 */
export async function ensureReverseTrial(
  sb: SupabaseClient,
  args: { userId: string; candidate: TrialCandidate; headers: Headers; now?: Date },
): Promise<ReverseTrialState> {
  if (!reverseTrialEnabled()) return NONE;
  const since = reverseTrialSince();
  if (!since) return NONE;
  const now = args.now ?? new Date();
  try {
    if (!mayStartReverseTrial(args.candidate, since, now)) {
      return await runningTrial(sb, args.userId, args.candidate, since, now);
    }
    if ((noTrialUntil.get(args.userId) ?? 0) > now.getTime()) return NONE;
    const { data: user, error } = await sb.from("users")
      .select("email, email_verified_at, telegram_id, is_banned")
      .eq("id", args.userId).maybeSingle();
    if (error) return NONE;
    if (!user || user.is_banned === true) return rememberNo(args.userId, now);
    // Verified identity only (the same rule as the free Mentor taste): a
    // confirmed address gives its key, a Telegram login gives its id.
    const verifiedEmail = typeof user.email_verified_at === "string" && Number.isFinite(Date.parse(user.email_verified_at));
    const emailKey = verifiedEmail ? trialEmailKey(user.email as string | null) : null;
    const telegramRaw = user.telegram_id;
    const telegramId = telegramRaw !== null && telegramRaw !== undefined && /^\d+$/.test(String(telegramRaw)) ? Number(telegramRaw) : null;
    if (!emailKey && telegramId === null) return rememberNo(args.userId, now);
    const salt = process.env.REVERSE_TRIAL_IP_SALT || process.env.CSP_REPORT_IP_SALT || null;
    const { data, error: rpcError } = await sb.rpc("start_reverse_trial", {
      p_user_id: args.userId,
      p_email_key: emailKey,
      p_telegram_id: telegramId,
      p_ip_hash: trialIpHash(clientIp(args.headers), salt),
      p_days: REVERSE_TRIAL_DAYS,
      p_since: since.toISOString(),
      p_max_per_ip: maxPerIp(),
    });
    if (rpcError) {
      captureServerError(rpcError, { route: "/api/auth/me", phase: "reverse_trial_start", userId: args.userId });
      return NONE;
    }
    const result = (data ?? {}) as { started?: boolean; expires_at?: string; reason?: string };
    if (result.started === true && typeof result.expires_at === "string") {
      forgetGuardUser(args.userId);
      return { active: true, endsAt: result.expires_at, started: true };
    }
    return rememberNo(args.userId, now);
  } catch (err) {
    captureServerError(err, { route: "/api/auth/me", phase: "reverse_trial", userId: args.userId });
    return NONE;
  }
}

/** A running reverse trial of a recent account (one trials read, new accounts only). */
async function runningTrial(sb: SupabaseClient, userId: string, c: TrialCandidate, since: Date, now: Date): Promise<ReverseTrialState> {
  const created = c.createdAt ? Date.parse(c.createdAt) : NaN;
  const end = c.tierExpiresAt ? Date.parse(c.tierExpiresAt) : NaN;
  if (c.tier !== "pro" || !Number.isFinite(end) || end <= now.getTime()) return NONE;
  if (end > now.getTime() + (REVERSE_TRIAL_DAYS + 1) * 86_400_000) return NONE;
  // Only an account young enough to hold one, whose access ends within the
  // window; a-reverse-trial-claim: while the claim is on, an older account
  // that claimed the same 3 days is reported too, so the Home line shows.
  const young = Number.isFinite(created) && created >= since.getTime() && created >= now.getTime() - 10 * 86_400_000;
  if (!young && !trialClaimEnabled()) return NONE;
  // An older Pro account near its end (a payer before renewal) reads trials once per 5 minutes at most.
  if (!young && (noTrialUntil.get(userId) ?? 0) > now.getTime()) return NONE;
  const { data, error } = await sb.from("trials").select("expires_at, kind").eq("user_id", userId).eq("kind", "reverse").maybeSingle();
  if (error) return NONE;
  const trialEnd = data ? Date.parse(String(data.expires_at)) : NaN;
  if (Number.isFinite(trialEnd) && trialEnd > now.getTime()) return { active: true, endsAt: String(data!.expires_at), started: false };
  if (!young) rememberNo(userId, now);
  return NONE;
}

/** Rows that give access without a payment: the reverse trial and the seed seat. */
const FREE_ACCESS_TIERS: ReadonlySet<string> = new Set(["reverse_trial", "seed_seat"]);

/**
 * True when the account's current access comes only from the reverse trial
 * (every live subscriptions row is a reverse_trial row) or a seed seat
 * (a-seed-seats: a seed_seat row, the 30-day seat from a venue code, never a
 * payment). Such an account buys like a free one: the paid window starts at
 * once (a paid grant never extends a non-Whop row). null = could not read;
 * callers fail closed.
 */
export async function accessIsReverseTrialOnly(
  sb: SupabaseClient,
  userId: string,
  now: Date = new Date(),
  /** users.tier_expires_at: Pro that runs past the trial (a manual grant) is real access. */
  userExpiresAt?: string | null,
): Promise<boolean | null> {
  try {
    const { data, error } = await sb.from("subscriptions")
      .select("tier, expires_at")
      .eq("user_id", userId).eq("status", "active");
    if (error) return null;
    const live = ((data ?? []) as Array<{ tier: string; expires_at: string | null }>).filter((r) => {
      if (!r.expires_at) return true;
      const t = Date.parse(r.expires_at);
      return Number.isFinite(t) && t > now.getTime();
    });
    if (!(live.length > 0 && live.every((r) => FREE_ACCESS_TIERS.has(r.tier)))) return false;
    if (userExpiresAt === undefined) return true;
    if (userExpiresAt === null) return false;
    const trialEnd = Math.max(...live.map((r) => Date.parse(String(r.expires_at))));
    const userEnd = Date.parse(userExpiresAt);
    return Number.isFinite(userEnd) && userEnd <= trialEnd + 60_000;
  } catch {
    return null;
  }
}
