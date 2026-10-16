import { NextResponse } from "next/server";
import { adminRouteShell } from "@/lib/admin/shell";
import { getServiceClient } from "@/lib/supabase";
import { PARTNER_REPORT_PATH, REPORT_LINK_DAYS, isPartnerCode, partnerKitEnabled, partnerLang } from "@/lib/partner-kit";
import { buildHandout, variantFromEnv } from "@/lib/partner-kit/handout";
import { handoutImage } from "@/lib/partner-kit/handout-image";
import { renderHandoutPdf } from "@/lib/partner-kit/pdf";
import { readPartnerCodeInfo } from "@/lib/partner-kit/server";
import { reminderLinksConfigured, signPartnerReportToken } from "@/lib/reminders/tokens";
import { normalizeCampaignCode } from "@/lib/mentor/credits/free-credits";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });

/**
 * GET /api/admin/partner-kit/<code>?format=pdf|png|link&lang=de|en&variant=register|settings
 * (a-partner-kit, revenue.read). Renders the handout of one partner code (A4
 * PDF, square PNG) or returns the signed organiser report link. 404 while
 * PARTNER_KIT_ENABLED is off, for a code outside PARTNER_CODES and for a code
 * that is not live; the answer never says which. Reads only; no write.
 */
export const GET = adminRouteShell(
  async ({ req }) => {
    if (!partnerKitEnabled()) return notFound();
    let raw = "";
    try { raw = decodeURIComponent(new URL(req.url).pathname.split("/").pop() ?? ""); } catch { return notFound(); }
    const code = normalizeCampaignCode(raw);
    if (!code || !isPartnerCode(code)) return notFound();
    const url = new URL(req.url);
    const info = await readPartnerCodeInfo(getServiceClient(), code, new Date());
    if (!info) return notFound();
    const format = url.searchParams.get("format") ?? "pdf";
    const lang = partnerLang(url.searchParams.get("lang"));
    const variant = url.searchParams.get("variant") === "register" ? "register" : url.searchParams.get("variant") === "settings" ? "settings" : variantFromEnv();
    const headers = (type: string, ext: string) => ({ "content-type": type, "content-disposition": `attachment; filename="medpruef-${code.toLowerCase()}-${lang}.${ext}"`, "cache-control": "private, no-store" });
    if (format === "pdf") return new NextResponse(Buffer.from(renderHandoutPdf(buildHandout(info, lang, variant, "print"))), { headers: headers("application/pdf", "pdf") });
    if (format === "png") {
      const png = await handoutImage(buildHandout(info, lang, variant, "image")).arrayBuffer();
      return new NextResponse(Buffer.from(png), { headers: headers("image/png", "png") });
    }
    if (format === "link") {
      if (!reminderLinksConfigured()) return NextResponse.json({ error: "Link signing is not configured", code: "NOT_CONFIGURED" }, { status: 503 });
      const token = signPartnerReportToken(code, REPORT_LINK_DAYS);
      return NextResponse.json({ path: `${PARTNER_REPORT_PATH}?t=${token}`, expires_in_days: REPORT_LINK_DAYS }, { headers: { "cache-control": "private, no-store" } });
    }
    return NextResponse.json({ error: "Invalid format", code: "INVALID" }, { status: 400 });
  },
  { route: "/api/admin/partner-kit", rateLimit: { limit: 30, windowMs: 60_000 } },
);
