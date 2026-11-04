import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { safeEqual } from "@/lib/security/timing-safe";
import { captureServerError } from "@/lib/sentry-capture";
import { sendUnlessSuppressed } from "@/lib/mail-suppression";
import { buildDeclineHelpMail, declineHelpKey } from "@/lib/decline-help-mail";
import { buildDunningMail } from "@/lib/dunning-mail";
import { WHOP_MANAGE_URL } from "@/lib/billing-copy";
import { classifyDunningSend, markDunningClaim, takeHeldClaim } from "@/lib/whop-dunning-claim";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** A hold older than this is never mailed (the cron was down): the learner has long moved on. */
const HOLD_EXPIRY_MS = 24 * 3600_000;
const MAX_PER_RUN = 10;

/**
 * GET /api/cron/dunning-held (a-trial-checkout-1104), every 10 minutes.
 *
 * The automatic mail after a FIRST purchase fails (trial decline or first
 * charge) waits 30 minutes (DUNNING_FIRST_HOLD_ENABLED on the webhook). Here
 * the held claims whose hold ran out are mailed, unless the learner paid
 * meanwhile (a grant_succeeded since the claim, or a paid tier now): a decline
 * followed by a success inside the window gets no mail. One mail at most: the
 * claim is taken held to pending by compare-and-set. Auth: Bearer CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 503 });
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sb = getServiceClient({ fastFail: false });
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  try {
    const { data: rows, error } = await sb
      .from("processed_webhook_events")
      .select("event_id,payload")
      .eq("provider", "whop")
      .like("event_id", "recover:%")
      .eq("payload->>mail", "held")
      .lte("payload->>hold_until", nowIso)
      .limit(MAX_PER_RUN);
    if (error) throw error;
    const out = { due: (rows ?? []).length, sent: 0, skipped_paid: 0, expired: 0, failed: 0 };
    for (const row of (rows ?? []) as Array<{ event_id: string; payload: Record<string, unknown> }>) {
      const paymentId = row.event_id.slice("recover:".length);
      const claimedAt = typeof row.payload.claimed_at === "string" ? row.payload.claimed_at : nowIso;
      const userId = typeof row.payload.user_id === "string" ? row.payload.user_id : null;
      const claimed = await takeHeldClaim(sb, row.event_id, nowIso);
      if (!claimed || !userId) {
        if (claimed) await markDunningClaim(sb, paymentId, "no_recipient", { reason: "held_no_user", nowIso });
        continue;
      }
      const stop = async (reason: string, counter: "skipped_paid" | "expired") => {
        out[counter] += 1;
        await markDunningClaim(sb, paymentId, "no_recipient", { reason, nowIso });
        await sb.from("user_events").insert({ user_id: userId, event_type: "whop_dunning_email_skipped", event_data: { payment_id: paymentId, reason } });
      };
      if (now - Date.parse(claimedAt) > HOLD_EXPIRY_MS) { await stop("hold_expired", "expired"); continue; }
      const [{ data: grants, error: gErr }, { data: u, error: uErr }] = await Promise.all([
        sb.from("payment_events").select("id").eq("user_id", userId).eq("event", "grant_succeeded").gte("created_at", claimedAt).limit(1),
        sb.from("users").select("email,first_name,language_code,tier").eq("id", userId).maybeSingle(),
      ]);
      if (gErr || uErr) {
        // Unreadable: put it back as held, the next run tries again (never a mail on a guess).
        await sb.from("processed_webhook_events").update({ payload: { ...claimed, mail: "held" } }).eq("provider", "whop").eq("event_id", row.event_id);
        out.failed += 1;
        continue;
      }
      const tier = ((u?.tier as string | null) ?? "free").toLowerCase();
      if ((grants ?? []).length > 0 || tier !== "free") { await stop("paid_within_hold", "skipped_paid"); continue; }
      const email = (u?.email as string | null) ?? null;
      if (!email) { await markDunningClaim(sb, paymentId, "no_recipient", { reason: "held_no_address", nowIso }); continue; }
      const isDe = !((u?.language_code as string | null) ?? "").toLowerCase().startsWith("en");
      const firstName = (u?.first_name as string | null) ?? null;
      const isDecline = claimed.held_kind === "decline_help";
      if (isDecline) {
        // Same one-note-per-learner-per-day rule as the live path.
        const dayKey = declineHelpKey(userId);
        const { error: dErr } = await sb.from("processed_webhook_events").insert({ provider: "whop", event_id: dayKey, payload: { claimed_at: nowIso, payment_id: paymentId, held: true } });
        if (dErr) {
          await markDunningClaim(sb, paymentId, "no_recipient", { reason: (dErr as { code?: string }).code === "23505" ? "decline_help_dedupe" : "decline_help_claim_failed", nowIso });
          continue;
        }
      }
      const recoveryUrl = typeof claimed.recovery_url === "string" ? claimed.recovery_url : null;
      const actionUrl = recoveryUrl ?? (typeof claimed.action_url === "string" && /^https:\/\/([a-z0-9-]+\.)*whop\.com\//i.test(claimed.action_url) ? claimed.action_url : WHOP_MANAGE_URL);
      const mail = isDecline
        ? buildDeclineHelpMail({ isDe, firstName })
        : buildDunningMail({ isDe, firstName, declineCode: typeof claimed.decline_code === "string" ? claimed.decline_code : null, recoveryUrl, actionUrl });
      let res: Awaited<ReturnType<typeof sendUnlessSuppressed>> | null = null;
      try {
        res = await sendUnlessSuppressed(sb, "transactional", { to: email, subject: mail.subject, htmlBody: mail.html });
      } catch (err) {
        captureServerError(err, { route: "cron/dunning-held", step: "send" });
      }
      const state = classifyDunningSend(res);
      if (isDecline && state !== "sent" && state !== "unknown") await sb.from("processed_webhook_events").delete().eq("provider", "whop").eq("event_id", declineHelpKey(userId));
      await markDunningClaim(sb, paymentId, state, { reason: res && !res.ok ? res.reason : null, status: res && !res.ok ? ((res as { status?: number }).status ?? null) : null, nowIso });
      await sb.from("user_events").insert({
        user_id: userId,
        event_type: state === "sent" ? "whop_dunning_email" : "whop_dunning_email_failed",
        event_data: { payment_id: paymentId, ok: state === "sent", outcome: state, link_kind: isDecline ? "decline_help" : recoveryUrl ? "recovery_url" : "manage_url", held: true },
      });
      if (state === "sent") out.sent += 1; else out.failed += 1;
    }
    return NextResponse.json({ ok: true, ...out });
  } catch (err) {
    captureServerError(err, { route: "cron/dunning-held" });
    return NextResponse.json({ ok: false, error: "dunning_held_failed" }, { status: 500 });
  }
}
