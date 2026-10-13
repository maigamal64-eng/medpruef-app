import { NextRequest, NextResponse } from "next/server";
import { probeDatabaseShared } from "@/lib/db-health";
import { callerIp, checkRateLimit } from "@/lib/rate-limit";
import { DB_RETRY_AFTER_SECONDS } from "@/lib/db-unavailable";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * GET /api/health/db (a-db-relief-1, T0d): is the database answering?
 *
 * One primary-key read through PostgREST (src/lib/db-health.ts). No auth,
 * no-store, 200 `{status:"ok"}` or 503 `{status:"unavailable"}` with
 * Retry-After; nothing else in the body. Public, so it is bounded twice:
 * 30 requests a minute per IP, and one database read per instance every
 * 5 seconds (concurrent and repeated probes share the last result).
 */
export async function GET(req: NextRequest) {
  const gate = checkRateLimit({ key: `health-db:${callerIp(req)}`, limit: 30, windowMs: 60_000 });
  if (!gate.allowed) {
    return NextResponse.json({ status: "rate_limited" }, { status: 429, headers: { "Retry-After": String(gate.retryAfterSec), "Cache-Control": "no-store" } });
  }
  const result = await probeDatabaseShared();
  if (result.ok) return NextResponse.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(
    { status: "unavailable" },
    { status: 503, headers: { "Retry-After": String(DB_RETRY_AFTER_SECONDS), "Cache-Control": "no-store" } },
  );
}
