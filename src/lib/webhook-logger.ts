/**
 * Webhook-attempt logger — writes every inbound webhook POST to the
 * `webhook_attempts` table regardless of outcome (processed, dup,
 * signature-invalid, parse-error, user-not-found, other-error).
 *
 * Why this exists (2026-04-24 rescue sprint):
 *   5 NOWPayments invoices created, 0 webhooks ever processed. We
 *   don't know if NOWPayments never POSTed at all, or if our endpoint
 *   received requests but rejected them (bad signature, malformed
 *   body, wrong URL). The `processed_webhook_events` table only
 *   captures successes — it's idempotency-keyed. This module captures
 *   attempts BEFORE any outcome decision, so /admin/webhooks can show
 *   "5 attempts received · 5 sig_invalid" if that's what happened, or
 *   "0 attempts received" if NOWPayments never reached us (which means
 *   the dashboard Webhook URL is the bug, not our code).
 *
 * Every webhook path (nowpayments today, stripe + paddle later) should
 * call `logWebhookAttempt` exactly once per inbound POST, regardless
 * of whether signature verification passed.
 */

import type { NextRequest } from "next/server";
import crypto from "crypto";
import { getServiceClient } from "@/lib/supabase";

export type WebhookAttemptResult =
  | "processed"
  | "dup"
  | "sig_invalid"
  | "parse_error"
  | "user_not_found"
  | "other_error";

export interface LogWebhookAttemptArgs {
  req: NextRequest;
  provider: "nowpayments" | "whop" | "stripe" | "paddle";
  path: string;
  signatureHeader?: string | null;
  signatureValid?: boolean | null;
  body?: string | null; // raw body; we hash + store a preview
  result: WebhookAttemptResult;
  error?: string | null;
  subscriptionId?: string | null;
  eventId?: string | null;
}

/**
 * Hash the body with SHA-256 so we can tell "the same payload came
 * through twice" without storing the full body in the audit row.
 */
function hashBody(body: string | null | undefined): string | null {
  if (!body) return null;
  try {
    return crypto.createHash("sha256").update(body, "utf8").digest("hex");
  } catch {
    return null;
  }
}

/**
 * Extract the best-effort source IP from the request.
 */
function extractIp(req: NextRequest): string | null {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return null;
}

/**
 * Insert a single row into webhook_attempts. Never throws — logging
 * a webhook must never prevent the webhook itself from being processed.
 * If the insert fails, we fall back to a stderr log so the Vercel
 * runtime logs still carry the signal.
 */
export async function logWebhookAttempt(args: LogWebhookAttemptArgs): Promise<void> {
  const {
    req,
    provider,
    path,
    signatureHeader,
    signatureValid,
    body,
    result,
    error,
    subscriptionId,
    eventId,
  } = args;

  try {
    const sb = getServiceClient();
    const payloadHash = hashBody(body);
    const bodyPreview =
      typeof body === "string" && body.length > 0 ? body.slice(0, 500) : null;

    const { error: insertErr } = await sb.from("webhook_attempts").insert({
      provider,
      path,
      ip: extractIp(req),
      user_agent: req.headers.get("user-agent") || null,
      signature_header: signatureHeader ?? null,
      signature_valid: signatureValid ?? null,
      payload_hash: payloadHash,
      body_preview: bodyPreview,
      result,
      error: error ?? null,
      subscription_id: subscriptionId ?? null,
      event_id: eventId ?? null,
    });

    if (insertErr) {
      // eslint-disable-next-line no-console
      console.error("[webhook-logger] failed to insert attempt row:", insertErr, {
        provider,
        result,
      });
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[webhook-logger] unexpected error:", err, { provider, result });
  }
}
