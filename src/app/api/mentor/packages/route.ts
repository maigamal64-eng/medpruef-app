import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";
import { readMentorConfig } from "@/lib/mentor/config";
import type { MentorErrorBody, MentorPackagesResponse } from "@/lib/mentor/contract";
import { canBuyMentorPackages } from "@/lib/mentor/credits/gate";
import { buildOffers, loadPackageCatalogue } from "@/lib/mentor/credits/packages";
import { rpcBalance } from "@/lib/mentor/credits/db";
import { createWallet } from "@/lib/mentor/credits/wallet";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

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
  const sb = getServiceClient();
  if (!(await canBuyMentorPackages(userId, config))) {
    // Existing credit holders can still inspect packages while paused. Checkout remains guarded.
    let everGranted = false;
    try { everGranted = (await rpcBalance(sb, userId)).ever_granted; } catch { /* fail closed */ }
    if (!everGranted) {
      const body: MentorErrorBody = { error: "mentor_disabled" };
      return NextResponse.json(body, { status: 403 });
    }
  }

  try {
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
