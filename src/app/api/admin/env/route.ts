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

function maskHint(value: string | undefined): string {
  if (!value) return "";
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}…${value.slice(-3)} (${value.length} chars)`;
}

/**
 * Presence-only check — never returns the value itself. Returns a
 * short masked hint so the admin can confirm "this is what I set"
 * without exfiltrating the secret.
 */
export const GET = adminRouteShell(
  async () => {
    const items = REQUIRED_VARS.map((name) => {
      const value = process.env[name];
      return {
        name,
        present: !!value && value.length > 0,
        masked: value ? maskHint(value) : undefined,
      };
    });
    return NextResponse.json({ items });
  },
  { route: "/api/admin/env" }
);
