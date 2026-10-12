import { NextRequest, NextResponse } from "next/server";
import { BILLING_SUPPORT_EMAIL } from "@/lib/billing-copy";
import { sendZohoEmail } from "@/lib/email/zoho";
import { callerIp, checkRateLimit, rateKey, rateLimitHeaders } from "@/lib/rate-limit";
import { captureServerError } from "@/lib/sentry-capture";
import { supportMail, validateSupportContact } from "@/lib/support-contact";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const IP_LIMIT = { limit: 3, windowMs: 10 * 60_000 };
const EMAIL_LIMIT = { limit: 5, windowMs: 24 * 3_600_000 };

/**
 * POST /api/support/contact (LX-31): the no-session contact form.
 * Flag SUPPORT_CONTACT_ENABLED (default OFF): 503 while off, and the forms
 * then show the mailbox address instead. Rate limited per IP and per email,
 * honeypot field `website`. The message is mailed to the support mailbox via
 * Zoho and never logged or stored. A honeypot hit answers like a success so a
 * bot learns nothing.
 */
/** Public availability probe so a page shows the form only when it can be sent. */
export async function GET() {
  return NextResponse.json({ enabled: process.env.SUPPORT_CONTACT_ENABLED === "true" }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  if (process.env.SUPPORT_CONTACT_ENABLED !== "true") {
    return NextResponse.json({ error: "Contact form unavailable", code: "SUPPORT_CONTACT_DISABLED" }, { status: 503 });
  }
  const ipGate = checkRateLimit({ key: rateKey("support-contact-ip", callerIp(req)), ...IP_LIMIT });
  if (!ipGate.allowed) {
    return NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429, headers: rateLimitHeaders(ipGate, { limit: IP_LIMIT.limit }) });
  }
  const body = await req.json().catch(() => null);
  const result = validateSupportContact(body);
  if (!result.ok) {
    if (result.error === "honeypot") return NextResponse.json({ ok: true });
    return NextResponse.json({ error: "Invalid request", code: "INVALID", field: result.error }, { status: 400 });
  }
  const emailGate = checkRateLimit({ key: rateKey("support-contact-email", result.value.email), ...EMAIL_LIMIT });
  if (!emailGate.allowed) {
    return NextResponse.json({ error: "Too many requests", code: "RATE_LIMITED" }, { status: 429, headers: rateLimitHeaders(emailGate, { limit: EMAIL_LIMIT.limit }) });
  }
  const mail = supportMail(result.value);
  const sent = await sendZohoEmail({ to: BILLING_SUPPORT_EMAIL, subject: mail.subject, htmlBody: mail.htmlBody });
  if (!sent.ok) {
    // Reason only: the visitor's message and address never reach logs or Sentry.
    captureServerError(new Error(`support contact send failed: ${sent.reason}`), { route: "/api/support/contact" });
    return NextResponse.json({ error: "Could not send", code: "SEND_FAILED" }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
