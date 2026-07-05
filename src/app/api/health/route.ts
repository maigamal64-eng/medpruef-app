import { NextResponse } from "next/server";

/**
 * GET /api/health: liveness/status probe for MedPrüf.
 *
 * Referenced as the `status` link relation from the API catalog
 * (see /.well-known/api-catalog and /openapi.json). Kept intentionally
 * tiny and public: no auth, no DB round-trip, no question-bank data.
 * Always force-dynamic + no-store so a cache never reports a stale
 * "ok" during a real outage.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      status: "ok",
      service: "medpruf",
      time: new Date().toISOString(),
    },
    {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
