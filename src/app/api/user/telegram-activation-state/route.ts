import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { requireUser } from "@/lib/auth-guard";
import { captureServerError } from "@/lib/sentry-capture";
import { withDbUnavailable } from "@/lib/db-unavailable-route";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/user/telegram-activation-state
 *
 * Returns the user's Telegram activation state for the
 * TelegramActivationCard on /dashboard:
 *   {
 *     user_id: string,
 *     telegram_id: number | null,
 *     telegram_chat_id_confirmed: string | null  // ISO ts
 *   }
 *
 * The card uses these to decide:
 *   - telegram_id == null  → user didn't register via TG → hide card
 *   - telegram_chat_id_confirmed != null → already activated → hide
 *   - otherwise → render the activation prompt with a deep-link to
 *     t.me/MedPruefBot?start=auth_<user_id>
 *
 * review-2026-04-26-B2.
 */
async function handleGET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;

  try {
    const sb = getServiceClient();
    const { data, error } = await sb
      .from("users")
      .select("id, telegram_id, telegram_chat_id_confirmed")
      .eq("id", guard.userId)
      .maybeSingle();

    if (error) {
      captureServerError(error, {
        route: "/api/user/telegram-activation-state",
        userId: guard.userId,
      });
      return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
    }

    return NextResponse.json({
      user_id: guard.userId,
      telegram_id: (data?.telegram_id as number | null) ?? null,
      telegram_chat_id_confirmed:
        (data?.telegram_chat_id_confirmed as string | null) ?? null,
    });
  } catch (err) {
    captureServerError(err, { route: "/api/user/telegram-activation-state" });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export const GET = withDbUnavailable(handleGET);
