import { NextRequest, NextResponse } from "next/server";
import { safeEqual } from "@/lib/security/timing-safe";
import { claimOnce } from "@/lib/data-cache";
import { HEARTBEAT_SOURCES, ageMinutes, isHeartbeatSource, readHeartbeat, recordHeartbeat } from "@/lib/heartbeat";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * /api/cron/heartbeat (a-fo-03). Off-Mac evidence that the Mac jobs ran.
 *
 * POST {source: "backup" | "watchdog"}: stores {source, at} in the Vercel Data
 * Cache (src/lib/heartbeat.ts), never the database; `at` is the server clock,
 * never a client value. The backup posts after a successful medpruf upload,
 * the watchdog on every run. GET: the status read, last beat per source.
 *
 * Auth on both: Bearer CRON_SECRET, constant-time compare, fail closed.
 */
function authorise(req: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 503 });
  if (!safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(req: NextRequest) {
  const denied = authorise(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { source?: unknown } | null;
  if (!body || !isHeartbeatSource(body.source)) {
    return NextResponse.json({ error: "unknown_source", allowed: HEARTBEAT_SOURCES }, { status: 400 });
  }
  const now = Date.now();
  const { shared } = await recordHeartbeat(body.source, now);
  return NextResponse.json({ ok: true, source: body.source, at: now, shared }, { headers: NO_STORE });
}

export async function GET(req: NextRequest) {
  const denied = authorise(req);
  if (denied) return denied;
  const now = Date.now();
  const sources = Object.fromEntries(
    await Promise.all(
      HEARTBEAT_SOURCES.map(async (source) => {
        const status = await readHeartbeat(source, now);
        return [source, { lastAt: status.lastAt ? new Date(status.lastAt).toISOString() : null, ageMin: ageMinutes(status.lastAt, now), everSeen: status.everSeen }] as const;
      }),
    ),
  );
  // One write-once probe per 5-minute slot says whether a shared cache exists.
  const probe = await claimOnce(["heartbeat-v1", "status-probe", String(Math.floor(now / 300_000))], { at: now });
  return NextResponse.json({ ok: true, now: new Date(now).toISOString(), shared: probe.shared, sources }, { headers: NO_STORE });
}
