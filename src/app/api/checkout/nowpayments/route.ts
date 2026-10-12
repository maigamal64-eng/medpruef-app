import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * NOWPayments checkout is retired. Keep this route as an explicit rejection
 * so direct callers cannot create new invoices on the former payment rail.
 * The separate webhook route remains active to reconcile historical payments.
 */
export async function POST(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;

  return NextResponse.json(
    {
      error: "CHECKOUT_UNAVAILABLE",
      message: "This payment option is no longer available. See /pricing for current plans.",
    },
    { status: 410 },
  );
}
