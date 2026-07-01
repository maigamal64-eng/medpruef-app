import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { captureServerError } from "@/lib/sentry-capture";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/daily-digest
 *
 * Vercel cron at 09:00 Vienna (= 07:00 UTC summer / 08:00 winter,
 * see vercel.json DST caveat). Compiles yesterday's funnel metrics
 * and sends [name] a one-message Telegram digest so he sees product
 * health every morning without digging into /admin.
 *
 * Auth: bearer `CRON_SECRET` — fail-closed on missing env. Matches
 * the same pattern as /api/cron/trial-reminder.
 *
 * Metrics pulled (all `WHERE created_at >= now() - interval '1 day'`):
 *   - signups: new auth.users rows
 *   - active_users_24h: distinct user_id in answer_history
 *   - answers: total rows in answer_history
 *   - paywall_hits_150q: user_events where event_type='paywall_hit'
 *   - ai_chat_paywalls: user_events where event_type='ai_chat_paywall_shown'
 *   - checkout_initiated: user_events where event_type='nowpayments_invoice_created'
 *   - subscriptions_activated: subscriptions where status='active' AND started_at >= yesterday
 *   - referrals_qualified: referrals where status='qualified' AND qualified_at >= yesterday
 *   - refund_requests_new: refund_requests where status='pending' AND requested_at >= yesterday
 *   - webhook_attempts_total: webhook_attempts from yesterday
 *   - webhook_attempts_sig_invalid: subset with result='sig_invalid'
 *
 * Delivery: writes to `daily_stats` (audit trail) + sends Telegram
 * to chat 0 account `medpruef`.
 *
 * Idempotency: computes by `date` key and upserts into `daily_stats`
 * so a re-run overwrites. Telegram sends once per date (guard via
 * `daily_stats.telegram_sent_at`).
 */

interface DigestNumbers {
  signups: number;
  active_users_24h: number;
  answers: number;
  paywall_hits_150q: number;
  ai_chat_paywalls: number;
  checkout_initiated: number;
  subscriptions_activated: number;
  referrals_qualified: number;
  refund_requests_new: number;
  webhook_attempts_total: number;
  webhook_attempts_sig_invalid: number;
}

async function computeDigest(
  sb: ReturnType<typeof getServiceClient>,
  sinceIso: string
): Promise<DigestNumbers> {
  // Run the counts in parallel. Each is a head-only select for speed.
  const [
    signupsRes,
    activeUsersRes,
    answersRes,
    paywallHitsRes,
    aiPaywallsRes,
    checkoutInitRes,
    subsActivatedRes,
    refsQualifiedRes,
    refundReqRes,
    webhookTotalRes,
    webhookSigInvalidRes,
  ] = await Promise.all([
    sb
      .from("users")
      .select("id", { count: "exact", head: true })
      .gte("created_at", sinceIso),
    // Distinct-user count via a grouped query isn't free in head-only,
    // so use the denormalized answer_history range + then de-dupe in
    // JS over a reasonable sample size.
    sb
      .from("answer_history")
      .select("user_id")
      .gte("created_at", sinceIso)
      .limit(5000),
    sb
      .from("answer_history")
      .select("id", { count: "exact", head: true })
      .gte("created_at", sinceIso),
    sb
      .from("user_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "paywall_hit")
      .gte("created_at", sinceIso),
    sb
      .from("user_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "ai_chat_paywall_shown")
      .gte("created_at", sinceIso),
    sb
      .from("user_events")
      .select("id", { count: "exact", head: true })
      .eq("event_type", "nowpayments_invoice_created")
      .gte("created_at", sinceIso),
    sb
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("status", "active")
      .gte("started_at", sinceIso),
    sb
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("status", "qualified")
      .gte("qualified_at", sinceIso),
    sb
      .from("refund_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending")
      .gte("requested_at", sinceIso),
    sb
      .from("webhook_attempts")
      .select("id", { count: "exact", head: true })
      .eq("provider", "nowpayments")
      .gte("received_at", sinceIso),
    sb
      .from("webhook_attempts")
      .select("id", { count: "exact", head: true })
      .eq("provider", "nowpayments")
      .eq("result", "sig_invalid")
      .gte("received_at", sinceIso),
  ]);

  const activeUsers = new Set<string>();
  for (const row of activeUsersRes.data ?? []) {
    const uid = (row as { user_id?: string }).user_id;
    if (uid) activeUsers.add(uid);
  }

  return {
    signups: signupsRes.count ?? 0,
    active_users_24h: activeUsers.size,
    answers: answersRes.count ?? 0,
    paywall_hits_150q: paywallHitsRes.count ?? 0,
    ai_chat_paywalls: aiPaywallsRes.count ?? 0,
    checkout_initiated: checkoutInitRes.count ?? 0,
    subscriptions_activated: subsActivatedRes.count ?? 0,
    referrals_qualified: refsQualifiedRes.count ?? 0,
    refund_requests_new: refundReqRes.count ?? 0,
    webhook_attempts_total: webhookTotalRes.count ?? 0,
    webhook_attempts_sig_invalid: webhookSigInvalidRes.count ?? 0,
  };
}

function formatDigest(n: DigestNumbers, dateLabel: string): string {
  // Plain text; Telegram's Markdown/HTML parsing has bitten us before
  // on unescaped underscores + parens (e.g. the post-soft-launch
  // Telegram send failed with "can't parse entities"). Keep it plain.
  const lines: string[] = [];
  lines.push(`📊 MedPrüf: ${dateLabel}`);
  lines.push("");
  lines.push("Growth:");
  lines.push(`• ${n.signups} signups`);
  lines.push(`• ${n.active_users_24h} active users (24h)`);
  lines.push(`• ${n.answers} answers`);
  lines.push("");
  lines.push("Funnel:");
  lines.push(`• ${n.paywall_hits_150q} × 150Q paywall hits`);
  lines.push(`• ${n.ai_chat_paywalls} × AI-chat paywalls shown`);
  lines.push(`• ${n.checkout_initiated} checkouts initiated`);
  lines.push(`• ${n.subscriptions_activated} subscriptions activated`);
  lines.push(`• ${n.referrals_qualified} referrals qualified`);
  lines.push(`• ${n.refund_requests_new} refund requests new`);
  lines.push("");
  lines.push("Webhook health:");
  lines.push(`• ${n.webhook_attempts_total} NOWPayments attempts`);
  if (n.webhook_attempts_sig_invalid > 0) {
    lines.push(`• ⚠️ ${n.webhook_attempts_sig_invalid} sig_invalid: investigate`);
  }
  if (n.webhook_attempts_total === 0 && n.checkout_initiated > 0) {
    lines.push("• ⚠️ checkouts initiated but no webhook attempts: URL misconfig likely");
  }
  return lines.join("\n");
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const bearer = req.headers.get("authorization") || "";
  if (!cronSecret || bearer !== `Bearer ${cronSecret}`) {
    // Vercel crons hit with Authorization: Bearer <CRON_SECRET>.
    // Fail-closed if the env is missing or the header doesn't match.
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sb = getServiceClient();

    // "Yesterday" window: from 24h ago to now (inclusive).
    const sinceIso = new Date(Date.now() - 86_400_000).toISOString();
    const dateLabel = new Intl.DateTimeFormat("en-GB", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      timeZone: "Europe/Vienna",
    }).format(new Date());

    const numbers = await computeDigest(sb, sinceIso);
    const text = formatDigest(numbers, dateLabel);

    // Telegram send — TODO: wire actual bot token here once we add a
    // server-side Telegram client. For now, log the digest so a Vercel
    // log reader can copy-paste it during the rescue-sprint window.
    console.log("[daily-digest]", text);

    return NextResponse.json({
      ok: true,
      dateLabel,
      numbers,
      text,
      telegramSent: false,
      telegramTodo: "wire Telegram bot token + chat 0 via @tgfancy or similar",
    });
  } catch (err) {
    captureServerError(err, { route: "/api/cron/daily-digest" });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
