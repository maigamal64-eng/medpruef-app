/**
 * Server side of the one-time 3-day claim (a-reverse-trial-claim). Rules and
 * why each wall exists: ./rules.ts. Reverse-trial background:
 * src/lib/pricing-v2/reverse-trial.ts.
 *
 * No migration of its own: start_reverse_trial (20270103090000) refuses any
 * account older than 7 days, which is every account this claim is for, so
 * the grant is three service-role writes in this order:
 *   1. INSERT trials (kind 'reverse', email key, Telegram id, network hash).
 *      The unique indexes on user_id, telegram_id and email_key make this the
 *      atomic once-per-person lock: a second claim fails with 23505.
 *   2. INSERT the dated `reverse_trial` subscriptions row (amount 0).
 *   3. UPDATE users to a dated 'pro' with a compare-and-set on the tier and
 *      end that were read.
 * A write can commit after its 8 s deadline, so an error is never undone:
 * an own lock that has not ended while the account has no access is
 * "resume" (rules.ts ownLockUnfinished), and the next press finishes the
 * grant with the stored dates (reusing the lock's subscription row) instead
 * of answering "used" for good. When the users update reports an error, the
 * row is read again and a committed grant counts as success. Only a definite
 * compare-and-set miss (the account changed between read and write) removes
 * the rows again, so the learner can retry.
 * The network cap is a count before the insert; without the RPC's advisory
 * lock two parallel claims from one network can both pass it (bounded by
 * the per-account and per-identity walls, which stay atomic).
 *
 * Nothing here creates a checkout session, calls Whop or writes
 * payment_events. Depends on 20270103090000 (trials.kind/email_key/ip_hash
 * and the reverse_trial tier); before it is applied the insert fails and the
 * route answers 503.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { forgetGuardUser } from "@/lib/auth-guard";
import { captureServerError } from "@/lib/sentry-capture";
import { recordEventSafe } from "@/lib/user-events";
import type { LearnerSubscriptionRow } from "@/lib/admin/learner-access";
import { reverseTrialSince } from "@/lib/pricing-v2/flag";
import { forgetReverseTrialNo } from "@/lib/pricing-v2/reverse-trial-server";
import {
  REVERSE_TRIAL_DAYS,
  REVERSE_TRIAL_DEFAULT_MAX_PER_IP,
  trialEmailKey,
  trialIpHash,
} from "@/lib/pricing-v2/reverse-trial";
import { claimEligibility, type ClaimReason } from "./rules";

const DAY_MS = 86_400_000;

export interface ClaimContext {
  reason: ClaimReason;
  eligible: boolean;
  /** Ends of a running claimed trial (reason "running"). */
  endsAt: string | null;
  /** The own lock's dates (reason "resume"). */
  lock: { startedAt: string; expiresAt: string } | null;
  emailKey: string | null;
  telegramId: number | null;
  user: { tier: string | null; tierExpiresAt: string | null };
}

export class ClaimReadError extends Error {
  constructor(public readonly cause: unknown) {
    super("trial claim read failed");
  }
}

// A "no" is remembered per instance for 5 minutes so the Home card's status
// read does not repeat four queries on every Home load (a-db-relief rule).
const NO_TTL_MS = 5 * 60_000;
const noUntil = new Map<string, { until: number; reason: ClaimReason }>();
/** Test seam. */
export function resetTrialClaimCache(): void { noUntil.clear(); }
export function rememberedNo(userId: string, now: Date = new Date()): ClaimReason | null {
  const hit = noUntil.get(userId);
  return hit && hit.until > now.getTime() ? hit.reason : null;
}
function rememberNo(userId: string, reason: ClaimReason, now: Date) {
  if (noUntil.size > 5_000) noUntil.clear();
  noUntil.set(userId, { until: now.getTime() + NO_TTL_MS, reason });
}

function maxPerIp(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.REVERSE_TRIAL_MAX_PER_IP);
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : REVERSE_TRIAL_DEFAULT_MAX_PER_IP;
}

const SUB_COLUMNS = "tier, status, payment_provider, payment_method, amount_cents, currency, provider_payment_id, crypto_tx_hash, granted_payment_ids, expires_at";

/**
 * Read everything the decision needs (four reads). `tokenEmailKey` is the
 * address key a verified claim link carries: when it equals the key of the
 * account's current address, the mailbox counts as verified.
 */
export async function readClaimContext(
  sb: SupabaseClient,
  userId: string,
  opts: { tokenEmailKey?: string | null; now?: Date } = {},
): Promise<ClaimContext> {
  const now = opts.now ?? new Date();
  const since = reverseTrialSince();
  const userRead = await sb.from("users")
    .select("role, tier, tier_expires_at, created_at, is_banned, email, email_verified_at, telegram_id")
    .eq("id", userId).maybeSingle();
  if (userRead.error) throw new ClaimReadError(userRead.error);
  const u = userRead.data as Record<string, unknown> | null;
  const base = { endsAt: null, lock: null, emailKey: null, telegramId: null, user: { tier: null, tierExpiresAt: null } };
  if (!u || !since) return { ...base, reason: "new_account", eligible: false };

  const email = typeof u.email === "string" ? u.email : null;
  const currentKey = trialEmailKey(email);
  const verifiedEmail = typeof u.email_verified_at === "string" && Number.isFinite(Date.parse(u.email_verified_at));
  const mailboxProof = !!opts.tokenEmailKey && opts.tokenEmailKey === currentKey;
  const emailKey = verifiedEmail || mailboxProof ? currentKey : null;
  const telegramRaw = u.telegram_id;
  const telegramId = telegramRaw !== null && telegramRaw !== undefined && /^\d+$/.test(String(telegramRaw)) ? Number(telegramRaw) : null;
  const userBase = { tier: (u.tier as string | null) ?? null, tierExpiresAt: (u.tier_expires_at as string | null) ?? null };

  // The common refusal costs one read: no verified identity and no claim link.
  // (An unfinished own lock is still found below when the account holds one.)
  const [subsRead, trialRead] = emailKey === null && telegramId === null && u.role !== "admin" && u.tier !== "admin"
    ? await (async () => {
      const own = await sb.from("trials").select("kind, started_at, expires_at").eq("user_id", userId).maybeSingle();
      if (own.error) throw new ClaimReadError(own.error);
      if (!own.data) return [null, null] as const;
      return [await sb.from("subscriptions").select(SUB_COLUMNS).eq("user_id", userId), own] as const;
    })()
    : await Promise.all([
      sb.from("subscriptions").select(SUB_COLUMNS).eq("user_id", userId),
      sb.from("trials").select("kind, started_at, expires_at").eq("user_id", userId).maybeSingle(),
    ]);
  if (!subsRead || !trialRead) {
    return { ...base, user: userBase, reason: u.is_banned === true ? "banned" : "unverified", eligible: false };
  }
  if (subsRead.error) throw new ClaimReadError(subsRead.error);
  if (trialRead.error) throw new ClaimReadError(trialRead.error);

  let identityUsed = false;
  const ors = [emailKey ? `email_key.eq.${emailKey}` : null, telegramId !== null ? `telegram_id.eq.${telegramId}` : null].filter(Boolean);
  if (ors.length > 0) {
    // Rows of deleted accounts keep their key with user_id NULL; they count as used too.
    const idRead = await sb.from("trials").select("user_id").or(ors.join(",")).limit(2);
    if (idRead.error) throw new ClaimReadError(idRead.error);
    identityUsed = ((idRead.data ?? []) as Array<{ user_id: string | null }>).some((r) => r.user_id !== userId);
  }

  const t = trialRead.data as { kind?: string | null; started_at?: string | null; expires_at?: string | null } | null;
  const ownTrial = t ? { kind: t.kind ?? null, startedAt: t.started_at ?? null, expiresAt: t.expires_at ? String(t.expires_at) : null } : null;
  const user = {
    role: (u.role as string | null) ?? null,
    tier: (u.tier as string | null) ?? null,
    tierExpiresAt: (u.tier_expires_at as string | null) ?? null,
    createdAt: (u.created_at as string | null) ?? null,
    isBanned: u.is_banned === true,
  };
  const decision = claimEligibility({
    user,
    subs: (subsRead.data ?? []) as LearnerSubscriptionRow[],
    ownTrial,
    identityUsed,
    verified: emailKey !== null || telegramId !== null,
    since,
    now,
  });
  return {
    ...decision,
    endsAt: decision.reason === "running" ? ownTrial?.expiresAt ?? null : null,
    lock: decision.reason === "resume" && ownTrial?.startedAt && ownTrial.expiresAt ? { startedAt: ownTrial.startedAt, expiresAt: ownTrial.expiresAt } : null,
    emailKey,
    telegramId,
    user: { tier: user.tier, tierExpiresAt: user.tierExpiresAt },
  };
}

/** Status for the Home card and the claim page. Never throws for a "no". */
export async function claimStatus(
  sb: SupabaseClient,
  userId: string,
  opts: { tokenEmailKey?: string | null; now?: Date } = {},
): Promise<{ eligible: boolean; reason: ClaimReason; endsAt: string | null }> {
  const now = opts.now ?? new Date();
  const remembered = opts.tokenEmailKey ? null : rememberedNo(userId, now);
  if (remembered) return { eligible: false, reason: remembered, endsAt: null };
  const ctx = await readClaimContext(sb, userId, { ...opts, now });
  // A "no" (its real reason) is remembered 5 minutes; a newly verified learner waits at most that long.
  if (!ctx.eligible && ctx.reason !== "running" && ctx.reason !== "in_progress" && !opts.tokenEmailKey) rememberNo(userId, ctx.reason, now);
  return { eligible: ctx.eligible, reason: ctx.reason === "resume" ? "eligible" : ctx.reason, endsAt: ctx.endsAt };
}

export type ClaimResult =
  | { claimed: true; endsAt: string; already: boolean }
  | { claimed: false; reason: ClaimReason | "ip_limit" | "changed" };

function clientIp(headers: Headers): string | null {
  return headers.get("x-forwarded-for") ?? headers.get("x-real-ip");
}

/**
 * Remove a lock whose grant did not finish. The subscription row goes first:
 * if its delete fails the lock stays, and the claim stays resumable (a stale
 * reverse_trial row without its lock would block the account for good).
 */
async function undo(sb: SupabaseClient, userId: string, startedAt: string, subId: string | null) {
  try {
    if (subId) {
      const del = await sb.from("subscriptions").delete().eq("id", subId).eq("tier", "reverse_trial").eq("amount_cents", 0);
      if (del.error) throw del.error;
    }
  } catch (err) {
    captureServerError(err, { route: "/api/trial/claim", phase: "claim_undo_subscription", userId });
    return;
  }
  try {
    const delTrial = await sb.from("trials").delete().eq("user_id", userId).eq("kind", "reverse").eq("started_at", startedAt);
    if (delTrial.error) throw delTrial.error;
  } catch (err) {
    captureServerError(err, { route: "/api/trial/claim", phase: "claim_undo_lock", userId });
  }
}

const sameInstant = (a: unknown, b: string) => typeof a === "string" && Date.parse(a) === Date.parse(b);

/** After a failed users update: did the grant commit anyway (a write past its deadline)? */
async function grantCommitted(sb: SupabaseClient, userId: string, endsAt: string): Promise<boolean> {
  try {
    const { data, error } = await sb.from("users").select("tier, tier_expires_at").eq("id", userId).maybeSingle();
    if (error || !data) return false;
    const row = data as { tier?: string | null; tier_expires_at?: string | null };
    return row.tier === "pro" && sameInstant(row.tier_expires_at, endsAt);
  } catch {
    return false;
  }
}

/**
 * Claim the 3 days. Throws ClaimReadError (or a write error) for a database
 * failure: the route answers 503 and nothing stays half written that the
 * next press cannot finish.
 */
export async function claimTrial(
  sb: SupabaseClient,
  args: { userId: string; tokenEmailKey?: string | null; source: "link" | "home"; headers: Headers; now?: Date },
): Promise<ClaimResult> {
  const now = args.now ?? new Date();
  const ctx = await readClaimContext(sb, args.userId, { tokenEmailKey: args.tokenEmailKey, now });
  if (ctx.reason === "running" && ctx.endsAt) return { claimed: true, endsAt: ctx.endsAt, already: true };
  if (!ctx.eligible) return { claimed: false, reason: ctx.reason };

  let startedAt: string;
  let endsAt: string;
  let resumed = false;
  if (ctx.reason === "resume" && ctx.lock) {
    startedAt = ctx.lock.startedAt;
    endsAt = ctx.lock.expiresAt;
    resumed = true;
  } else {
    const salt = process.env.REVERSE_TRIAL_IP_SALT || process.env.CSP_REPORT_IP_SALT || null;
    const ipHash = trialIpHash(clientIp(args.headers), salt);
    if (ipHash) {
      const recent = await sb.from("trials").select("user_id", { count: "exact", head: true })
        .eq("ip_hash", ipHash).gt("started_at", new Date(now.getTime() - DAY_MS).toISOString());
      if (recent.error) throw new ClaimReadError(recent.error);
      if ((recent.count ?? 0) >= maxPerIp()) return { claimed: false, reason: "ip_limit" };
    }
    startedAt = now.toISOString();
    endsAt = new Date(now.getTime() + REVERSE_TRIAL_DAYS * DAY_MS).toISOString();
    const lock = await sb.from("trials").insert({
      telegram_id: ctx.telegramId,
      user_id: args.userId,
      started_at: startedAt,
      expires_at: endsAt,
      kind: "reverse",
      email_key: ctx.emailKey,
      ip_hash: ipHash,
    });
    if (lock.error) {
      if (lock.error.code !== "23505") throw lock.error;
      // A parallel press of the same account may have won: report its claim, not a refusal.
      const again = await readClaimContext(sb, args.userId, { tokenEmailKey: args.tokenEmailKey, now: new Date() });
      if (again.reason === "running" && again.endsAt) return { claimed: true, endsAt: again.endsAt, already: true };
      return { claimed: false, reason: "trial_used" };
    }
  }

  let subId: string | null = null;
  let subInserted = false;
  try {
    if (resumed) {
      const found = await sb.from("subscriptions").select("id")
        .eq("user_id", args.userId).eq("tier", "reverse_trial").eq("amount_cents", 0).eq("started_at", startedAt).limit(1);
      if (found.error) throw found.error;
      subId = ((found.data ?? []) as Array<{ id: string }>)[0]?.id ?? null;
    }
    if (!subId) {
      const sub = await sb.from("subscriptions").insert({
        user_id: args.userId,
        tier: "reverse_trial",
        status: "active",
        payment_provider: "trial",
        payment_method: "reverse_trial",
        amount_cents: 0,
        currency: "EUR",
        started_at: startedAt,
        expires_at: endsAt,
      }).select("id").single();
      if (sub.error) throw sub.error;
      subId = String((sub.data as { id: string }).id);
      subInserted = true;
    }

    let update = sb.from("users")
      .update({ tier: "pro", tier_expires_at: endsAt, updated_at: new Date().toISOString() })
      .eq("id", args.userId);
    update = ctx.user.tier === null ? update.is("tier", null) : update.eq("tier", ctx.user.tier);
    update = ctx.user.tierExpiresAt === null ? update.is("tier_expires_at", null) : update.eq("tier_expires_at", ctx.user.tierExpiresAt);
    const updated = await update.select("id");
    if (updated.error) {
      if (await grantCommitted(sb, args.userId, endsAt)) {
        // committed past its deadline: fall through to success
      } else {
        throw updated.error;
      }
    } else if ((updated.data ?? []).length !== 1) {
      // The lock's grant may have landed through another request: then it is a success, never an undo (review N1).
      if (await grantCommitted(sb, args.userId, endsAt)) {
        // fall through to success
      } else {
        if (!resumed) await undo(sb, args.userId, startedAt, subInserted ? subId : null);
        return { claimed: false, reason: "changed" };
      }
    }
  } catch (err) {
    // An error does not say whether the write committed (a deadline can cut a
    // committed write), so nothing is removed: the lock stays, the account is
    // either running (the grant landed) or "resume", and the next press
    // finishes it. Only a definite compare-and-set miss above is undone.
    throw err;
  }

  forgetGuardUser(args.userId);
  forgetReverseTrialNo(args.userId);
  noUntil.delete(args.userId);
  await recordEventSafe(sb, { userId: args.userId, eventType: "trial_claimed", data: { source: args.source, days: REVERSE_TRIAL_DAYS, ...(resumed ? { resumed: true } : {}) } });
  return { claimed: true, endsAt, already: false };
}
