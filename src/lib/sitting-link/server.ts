/**
 * Handlers of the one-tap sitting link (a-sitting-one-tap), GET and POST
 * /api/sitting-link.
 *
 * GET verifies the signed link, reads the account once and shows its
 * candidate sittings; it writes nothing except a best-effort
 * sitting_link_open event. Only a form POST that carries the token saves a
 * choice, through the same write as the in-app picker
 * (saveExamPreference), and may start the a-d5b double opt-in for deadline
 * reminders (the account's own address, confirmed by an emailed link; a30
 * consent rules). A mail scanner that follows the link changes nothing.
 *
 * Offers after the POST: the plan that fits (pricing v2 only) and the
 * one-time 3-day claim (TRIAL_CLAIM_ENABLED), each only for the audience in
 * audience.ts. Any read failure behind an offer drops the offer, never the
 * saved choice. The date-watch freeze turns every answer into the official
 * pages only.
 */
import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceClient } from "@/lib/supabase";
import { recordEventSafe } from "@/lib/user-events";
import { uaClass } from "@/lib/analytics-events";
import { checkRateLimit, rateKey } from "@/lib/rate-limit";
import { checkSuppression } from "@/lib/mail-suppression";
import { daysUntilViennaDate } from "@/lib/exam-dates";
import { saveExamPreference } from "@/lib/exam-preference-write";
import { trialEmailKey } from "@/lib/pricing-v2/reverse-trial";
import { pricingV2Enabled } from "@/lib/pricing-v2/flag";
import { sittingFit } from "@/lib/pricing-v2/fit";
import { halfYearGuardLive, v2Readiness } from "@/lib/pricing-v2/readiness";
import { planName } from "@/lib/pricing-v2/price-facts";
import { billingAmount } from "@/lib/billing-copy";
import { trialClaimEnabled } from "@/lib/trial-claim/flag";
import { claimStatus } from "@/lib/trial-claim/server";
import { claimCopy, fill as claimFill } from "@/lib/trial-claim/copy";
import { claimLinkUrl, claimLinksConfigured, signClaimToken } from "@/lib/trial-claim/token";
import { REVERSE_TRIAL_DAYS } from "@/lib/pricing-v2/reverse-trial";
import { reminderBankFor, startExamOptIn } from "@/lib/reminders/exam-optin";
import { deliverableDestination } from "@/lib/reminders/study-consent";
import type { LearnerSubscriptionRow } from "@/lib/admin/learner-access";
import { datesFrozen, sittingLinkEnabled } from "./flag";
import { verifySittingToken, type SittingLinkLang, type SittingLinkSource } from "./token";
import { allOfficialSources, candidateSittings, resolveChoice, timeLeft, type SittingOption } from "./candidates";
import { offerAudience } from "./audience";
import { formPage, frozenPage, messagePage, resultPage, type ResultArgs } from "./page";
import { sittingLinkCopy } from "./copy";

const SITE = "https://medpruf.com";

export function linkLang(value: string | null | undefined): SittingLinkLang {
  return value === "de" ? "de" : "en";
}

interface Account {
  id: string;
  email: string | null;
  email_status: string | null;
  role: string | null;
  tier: string | null;
  tier_expires_at: string | null;
  is_banned: boolean;
  active_exam: string | null;
  exam_date: string | null;
  session_invalidated_at: string | null;
}

type AccountRead =
  | { ok: true; account: Account; emailKey: string | null; source: SittingLinkSource | null }
  | { ok: false; page: "invalid" | "expired" | "retry" | "unavailable" };

async function readAccount(sb: SupabaseClient, token: string, now: Date): Promise<AccountRead> {
  const v = verifySittingToken(token, now);
  if (!v.ok) return { ok: false, page: v.error === "expired" ? "expired" : v.error === "unconfigured" ? "unavailable" : "invalid" };
  const read = await sb.from("users")
    .select("id, email, email_status, role, tier, tier_expires_at, is_banned, active_exam, exam_date, session_invalidated_at")
    .eq("id", v.userId).maybeSingle();
  if (read.error) return { ok: false, page: "retry" };
  const a = read.data as Account | null;
  if (!a || a.is_banned === true) return { ok: false, page: "invalid" };
  // Revocation: a link issued at or before the account's session cut is dead.
  const cut = a.session_invalidated_at ? Date.parse(a.session_invalidated_at) : NaN;
  if (Number.isFinite(cut) && cut >= v.issuedAt.getTime()) return { ok: false, page: "invalid" };
  // A link mailed to an address the account no longer has is dead.
  if (v.emailKey !== null && v.emailKey !== trialEmailKey(a.email)) return { ok: false, page: "invalid" };
  return { ok: true, account: a, emailKey: v.emailKey, source: v.source };
}

// sitting_link_open at most once per account per 10 minutes per instance, so
// a scanner plus the learner's own open do not count three times.
const OPEN_TTL_MS = 10 * 60_000;
const opened = new Map<string, number>();
// A browser refresh re-sends the POST: the same choice within a minute
// writes again (idempotent) but is counted once.
const SET_TTL_MS = 60_000;
const lastSet = new Map<string, number>();
function firstSet(key: string, now: Date): boolean {
  const last = lastSet.get(key);
  if (last !== undefined && now.getTime() - last < SET_TTL_MS) return false;
  if (lastSet.size > 5_000) lastSet.clear();
  lastSet.set(key, now.getTime());
  return true;
}
/** Test seam. */
export function resetSittingLinkMemo(): void { opened.clear(); lastSet.clear(); }
function firstOpen(userId: string, now: Date): boolean {
  const last = opened.get(userId);
  if (last !== undefined && now.getTime() - last < OPEN_TTL_MS) return false;
  if (opened.size > 5_000) opened.clear();
  opened.set(userId, now.getTime());
  return true;
}

function savedOptionId(account: Account, banks: ReturnType<typeof candidateSittings>): string | null {
  if (!account.exam_date) return null;
  const own = banks.find((b) => b.bank === account.active_exam) ?? banks[0];
  const hit = own?.options.find((o) => o.date === account.exam_date)
    ?? banks.flatMap((b) => b.options).find((o) => o.date === account.exam_date);
  return hit?.id ?? null;
}

export async function handleSittingLinkGet(req: NextRequest, now: Date = new Date()) {
  const params = req.nextUrl.searchParams;
  const lang = linkLang(params.get("lang"));
  if (!sittingLinkEnabled()) return messagePage(lang, "unavailable");
  if (datesFrozen()) return frozenPage(lang, allOfficialSources());
  const token = params.get("t") ?? "";
  const sb = getServiceClient();
  let read: AccountRead;
  try { read = await readAccount(sb, token, now); } catch { return messagePage(lang, "retry"); }
  if (!read.ok) return messagePage(lang, read.page);
  const { account, source } = read;
  if (!checkRateLimit({ key: rateKey("sitting-link-get", account.id), limit: 30, windowMs: 10 * 60_000 }).allowed) return messagePage(lang, "retry");
  const banks = candidateSittings(account.active_exam, now);
  if (firstOpen(account.id, now)) {
    await recordEventSafe(sb, {
      userId: account.id,
      eventType: "sitting_link_open",
      data: { lang, ua_class: uaClass(req.headers.get("user-agent")), had_date: !!account.exam_date, bank: banks[0]?.bank ?? null, ...(source ? { source: `${source}_mail` } : {}) },
    });
  }
  return formPage({
    lang,
    token,
    banks,
    savedId: savedOptionId(account, banks),
    showReminder: !!deliverableDestination(account),
  });
}

interface PostForm { token: string; choice: string; reminder: boolean; lang: SittingLinkLang }

const MAX_FORM_BYTES = 4096;

/** The body up to MAX_FORM_BYTES, or null when it is longer (never buffers more). */
async function readBounded(req: Request): Promise<string | null> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_FORM_BYTES) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readForm(req: Request): Promise<PostForm | null> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/x-www-form-urlencoded")) return null;
  if (Number(req.headers.get("content-length") ?? 0) > MAX_FORM_BYTES) return null;
  try {
    const body = await readBounded(req);
    if (body === null) return null;
    const form = new URLSearchParams(body);
    return { token: form.get("t") ?? "", choice: form.get("choice") ?? "", reminder: form.get("reminder") === "1", lang: linkLang(form.get("lang")) };
  } catch { return null; }
}

type ReminderOutcome = NonNullable<ResultArgs["reminder"]>;

async function startReminder(sb: SupabaseClient, userId: string, option: SittingOption): Promise<{ outcome: ReminderOutcome; detail: string }> {
  if (!reminderBankFor(option.bank)) return { outcome: "unsupported", detail: "unsupported_exam" };
  try {
    const r = await startExamOptIn(sb, userId);
    if (!r.ok) return { outcome: "not_now", detail: r.reason };
    if (r.mail === "sent" || r.mail === "cooldown") return { outcome: "sent", detail: r.mail };
    if (r.mail === "skipped" && r.view.state === "confirmed") return { outcome: "already", detail: "confirmed" };
    return { outcome: "not_now", detail: r.mail };
  } catch {
    return { outcome: "not_now", detail: "error" };
  }
}

const SUB_COLUMNS = "tier, status, payment_provider, payment_method, amount_cents, currency, provider_payment_id, crypto_tx_hash, granted_payment_ids, expires_at";

async function offersFor(
  sb: SupabaseClient,
  account: Account,
  emailKey: string | null,
  option: SittingOption,
  lang: SittingLinkLang,
  now: Date,
): Promise<Pick<ResultArgs, "fit" | "trial">> {
  const wantFit = pricingV2Enabled();
  const wantTrial = trialClaimEnabled() && claimLinksConfigured();
  if (!wantFit && !wantTrial) return { fit: null, trial: null };
  try {
    const [subs, suppression] = await Promise.all([
      sb.from("subscriptions").select(SUB_COLUMNS).eq("user_id", account.id),
      checkSuppression(sb, account.email, "marketing").catch(() => null),
    ]);
    if (subs.error) return { fit: null, trial: null };
    const audience = offerAudience({
      user: { email: account.email, role: account.role, tier: account.tier, tierExpiresAt: account.tier_expires_at, isBanned: account.is_banned },
      subs: (subs.data ?? []) as LearnerSubscriptionRow[],
      suppressed: suppression === null ? null : suppression === "clear" ? false : true,
      now,
    });
    let fit: ResultArgs["fit"] = null;
    if (wantFit && audience.planFit) {
      const result = sittingFit({ date: option.date, lastDay: option.lastDay }, now, { guard: halfYearGuardLive(), ready: v2Readiness() });
      const plan = result.plans[result.recommended];
      const q = new URLSearchParams({ bank: option.bank, sitting: option.date, sitting_end: option.lastDay, utm_source: "sitting_link", utm_medium: "email" });
      fit = { plan: planName(result.recommended, lang), total: billingAmount(plan.totalCents, lang), pricingUrl: `${SITE}/pricing?${q}` };
    }
    let trial: ResultArgs["trial"] = null;
    if (wantTrial && audience.trialOffer) {
      const status = await claimStatus(sb, account.id, { tokenEmailKey: emailKey, now });
      if (status.eligible) {
        const c = claimCopy(lang);
        trial = {
          offer: claimFill(c.offer, { days: REVERSE_TRIAL_DAYS }),
          cta: claimFill(c.cta, { days: REVERSE_TRIAL_DAYS }),
          url: claimLinkUrl(signClaimToken({ userId: account.id, emailKey, days: 7, now })),
        };
      }
    }
    return { fit, trial };
  } catch {
    return { fit: null, trial: null };
  }
}

export async function handleSittingLinkPost(req: NextRequest, now: Date = new Date()) {
  const form = await readForm(req);
  const lang = form?.lang ?? "en";
  if (!sittingLinkEnabled()) return messagePage(lang, "unavailable");
  if (!form) return messagePage(lang, "invalid");
  if (datesFrozen()) return frozenPage(lang, allOfficialSources());
  const sb = getServiceClient();
  let read: AccountRead;
  try { read = await readAccount(sb, form.token, now); } catch { return messagePage(lang, "retry"); }
  if (!read.ok) return messagePage(lang, read.page);
  const { account, emailKey, source } = read;
  if (!checkRateLimit({ key: rateKey("sitting-link-post", account.id), limit: 10, windowMs: 10 * 60_000 }).allowed) return messagePage(lang, "retry");

  const banks = candidateSittings(account.active_exam, now);
  const choice = resolveChoice(form.choice, banks);
  if (choice.kind === "invalid") {
    return formPage({ lang, token: form.token, banks, savedId: savedOptionId(account, banks), showReminder: !!deliverableDestination(account), notice: sittingLinkCopy(lang).stale });
  }

  const update = choice.kind === "sitting"
    ? { active_exam: choice.option.bank, exam_date: choice.option.date }
    : { exam_date: null };
  try {
    const { error } = await saveExamPreference(sb, account.id, update);
    if (error) return messagePage(lang, "retry");
  } catch { return messagePage(lang, "retry"); }

  let reminder: ResultArgs["reminder"] = null;
  if (form.reminder && choice.kind === "sitting" && deliverableDestination(account)) {
    const r = await startReminder(sb, account.id, choice.option);
    reminder = r.outcome;
    await recordEventSafe(sb, { userId: account.id, eventType: "reminder_optin_from_link", data: { result: r.outcome, detail: r.detail, bank: choice.option.bank } });
  }

  const offers = choice.kind === "sitting"
    ? await offersFor(sb, account, emailKey, choice.option, lang, now)
    : { fit: null, trial: null };

  const days = choice.kind === "sitting" ? Math.max(0, daysUntilViennaDate(choice.option.date, now)) : null;
  if (firstSet(`${account.id}|${form.choice}`, now)) await recordEventSafe(sb, {
    userId: account.id,
    eventType: "sitting_set",
    data: {
      source: source ? `${source}_mail` : "mail_link",
      choice: choice.kind,
      bank: choice.kind === "sitting" ? choice.option.bank : account.active_exam,
      date: choice.kind === "sitting" ? choice.option.date : null,
      exam_keys: choice.kind === "sitting" ? [...new Set(choice.option.rows.map((r) => r.exam_key))] : [],
      days_to_sitting: days,
      bank_switched: choice.kind === "sitting" && choice.option.bank !== account.active_exam,
      had_date: !!account.exam_date,
      offer_fit: !!offers.fit,
      offer_trial: !!offers.trial,
    },
  });

  return resultPage({
    lang,
    saved: choice.kind === "sitting" ? { option: choice.option, left: timeLeft(choice.option.date, now) } : null,
    reminder,
    fit: offers.fit,
    trial: offers.trial,
  });
}
