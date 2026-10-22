import { NextRequest, NextResponse } from "next/server";
import {
  goLinkDestination,
  goPreviewHtml,
  goTargetEnabled,
  isPreviewBot,
  lookupGoLink,
  normalizeGoCode,
} from "@/lib/golinks";

export const dynamic = "force-dynamic";
export const maxDuration = 10;

/**
 * /g/<code> (a-golinks): short campaign link for group posts. A known code
 * 302s to its target with the full utm_* set; the target page's
 * AttributionCapture then stores the first touch and fires the landing beacon,
 * so the arrival is counted once, the same way as a long UTM link. Preview
 * bots get the og page instead. Unknown codes go to /landing untagged.
 * No database read or write here, so a slow database never holds the click.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  // Production links always name the canonical host (defence in depth; Vercel already routes by Host).
  const origin = process.env.VERCEL_ENV === "production" ? "https://medpruf.com" : req.nextUrl.origin;
  const link = lookupGoLink(code);
  const noindex = { "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "no-store" };

  if (!link) {
    return NextResponse.redirect(new URL("/landing", origin), { status: 302, headers: noindex });
  }

  const enabled = goTargetEnabled(link.target);
  const destination = goLinkDestination(link, enabled);
  const bot = isPreviewBot(req.headers.get("user-agent"));
  // Counts-only log line (Vercel logs): no IP, no user agent, no id.
  console.info(JSON.stringify({ event: "golink", code: normalizeGoCode(code), campaign: link.campaign, preview: bot }));

  if (bot) {
    const self = `${origin}/g/${normalizeGoCode(code)}`;
    return new NextResponse(goPreviewHtml(link, origin, destination, self, enabled), {
      status: 200,
      headers: { ...noindex, "Content-Type": "text/html; charset=utf-8" },
    });
  }
  return NextResponse.redirect(new URL(destination, origin), { status: 302, headers: noindex });
}
