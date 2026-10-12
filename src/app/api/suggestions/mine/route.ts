import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth-guard";
import { getServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "x-session-token" };

// No question content, internal notes, report details, context or identities.
// There is no separate public-note column in the current schema.
export async function GET(req: NextRequest) {
  const guard = await requireUser(req, { allowCached: false });
  if ("error" in guard) {
    for (const [key, value] of Object.entries(headers)) guard.error.headers.set(key, value);
    return guard.error;
  }
  const params = req.nextUrl.searchParams;
  const limit = Number(params.get("limit") ?? "50");
  const offset = Number(params.get("offset") ?? "0");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000) {
    return NextResponse.json({ error: "Invalid pagination" }, { status: 400, headers });
  }
  try {
    const { data, count, error } = await getServiceClient().from("question_suggestions")
      .select("id, question_id, type, status, created_at, resolved_at", { count: "exact" })
      .eq("user_id", guard.userId).order("created_at", { ascending: false })
      .order("id", { ascending: false }).range(offset, offset + limit - 1);
    if (error) throw new Error("Report lookup failed");
    return NextResponse.json({ suggestions: data ?? [], total: count ?? 0, limit, offset }, { headers });
  } catch {
    return NextResponse.json({ error: "Reports temporarily unavailable" }, { status: 503, headers });
  }
}
