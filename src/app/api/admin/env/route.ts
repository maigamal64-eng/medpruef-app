import { NextResponse } from "next/server";
import { adminRouteShell } from "@/lib/admin/shell";

export const dynamic = "force-dynamic";

const REQUIRED_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_WEBHOOK_SECRET",
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_GA_ID",
  "NEXT_PUBLIC_CLARITY_ID",
  "CLARITY_API_TOKEN",
  "OPENAI_API_KEY",
  "NOWPAYMENTS_API_KEY",
  "NOWPAYMENTS_IPN_SECRET",
  "SENTRY_AUTH_TOKEN",
  "NEXT_PUBLIC_BUILD_ID",
];

/** Returns variable names and presence only. */
export const GET = adminRouteShell(
  async () => {
    const items = REQUIRED_VARS.map((name) => {
      const value = process.env[name];
      return {
        name,
        present: !!value && value.length > 0,
      };
    });
    return NextResponse.json({ items });
  },
  { route: "/api/admin/env" }
);
