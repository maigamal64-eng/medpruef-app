import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { readMentorConfig } from "@/lib/mentor/config";
import type { MentorErrorBody, MentorPackagesResponse } from "@/lib/mentor/contract";
import { canBuyMentorPackages } from "@/lib/mentor/credits/gate";
import { buildOffers, loadPackageCatalogue } from "@/lib/mentor/credits/packages";
import { createWallet } from "@/lib/mentor/credits/wallet";

export const dynamic = "force-dynamic";

/**
 * GET /api/mentor/packages -> MentorPackagesResponse (contract C4, W2-CREDITS).
 * Buyable mentor credit packages for the signed-in user: credits and an
 * "about N messages" estimate, never dollars. 403 mentor_disabled while any
 * flag is off (every flag defaults OFF).
 */
export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const { userId } = guard;

  const config = readMentorConfig();
  if (!(await canBuyMentorPackages(userId, config))) {
    const body: MentorErrorBody = { error: "mentor_disabled" };
    return NextResponse.json(body, { status: 403 });
  }

  try {
    const sb = getServiceClient();
    const catalogue = await loadPackageCatalogue(sb);
    const avg = await createWallet(sb, { freeEnabled: config.freeEnabled }).avgMessageCostMicro(userId);
    const body: MentorPackagesResponse = { packages: buildOffers(catalogue, config, avg) };
    return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    Sentry.captureException(err, { tags: { route: "mentor/packages" } });
    const body: MentorErrorBody = { error: "upstream_error" };
    return NextResponse.json(body, { status: 503 });
  }
}
