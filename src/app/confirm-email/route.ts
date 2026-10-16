import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { checkRateLimit, callerIdentity, rateKey, rateLimitHeaders } from "@/lib/rate-limit";
import { emailConfirmEnabled } from "@/lib/email-confirm/flag";
import { confirmLang } from "@/lib/email-confirm/copy";
import { verifyConfirmToken } from "@/lib/email-confirm/token";
import { confirmEmail } from "@/lib/email-confirm/server";
import { confirmFormPage, confirmResultPage, readConfirmPost } from "@/lib/email-confirm/page-html";

export const dynamic = "force-dynamic";
// The POST may start the reverse trial (one database call); 30 s is the default budget.
export const maxDuration = 30;

const POST_LIMIT = { limit: 20, windowMs: 10 * 60_000 };

function notFound(): NextResponse {
  return new NextResponse("Not found", { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

/**
 * GET /confirm-email?t=<ec1 token>&lang=de|en (a-email-confirm-trial).
 * Never writes: mail scanners follow links. A valid link shows a button; a
 * forged or expired one says so at once (signature check only, no read).
 */
export async function GET(req: NextRequest) {
  if (!emailConfirmEnabled()) return notFound();
  const lang = confirmLang(req.nextUrl.searchParams.get("lang"));
  const token = req.nextUrl.searchParams.get("t") ?? "";
  const parsed = verifyConfirmToken(token);
  if (!parsed.ok) return confirmResultPage(lang, parsed.error === "expired" ? "expired" : "invalid");
  return confirmFormPage(lang, token);
}

/** POST (form): the only request that confirms. */
export async function POST(req: NextRequest) {
  if (!emailConfirmEnabled()) return notFound();
  const gate = checkRateLimit({ key: rateKey("email-confirm-post", callerIdentity(req)), ...POST_LIMIT });
  const form = await readConfirmPost(req);
  const lang = form?.lang ?? confirmLang(req.nextUrl.searchParams.get("lang"));
  if (!gate.allowed) {
    const res = confirmResultPage(lang, "retry");
    for (const [k, v] of Object.entries(rateLimitHeaders(gate, POST_LIMIT))) res.headers.set(k, String(v));
    return res;
  }
  if (!form || !form.token) return confirmResultPage(lang, "invalid");
  const result = await confirmEmail(getServiceClient(), form.token, { headers: req.headers });
  return result.outcome === "confirmed" || result.outcome === "already"
    ? confirmResultPage(lang, result.outcome, result.trialActive)
    : confirmResultPage(lang, result.outcome);
}
