import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { createMentorRequestStore } from "@/lib/mentor/requests";
import { getServiceClient } from "@/lib/supabase";
import { checkRateLimit, rateKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const guard = await requireUser(req);
  if ("error" in guard) return guard.error;
  const id = req.nextUrl.searchParams.get("client_request_id");
  if (!id || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const gate = checkRateLimit({ key: rateKey("mentor-result", guard.userId), limit: 30, windowMs: 60_000 });
  if (!gate.allowed) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  try {
    const result = await createMentorRequestStore(getServiceClient()).result(guard.userId, id.toLowerCase());
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "reserve_failed" }, { status: 503 });
  }
}
