import { NextRequest, NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase";
import { parseReviewVerdict } from "@/lib/mentor/review";
import { requireMentorAdmin } from "../summary/guard";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
export async function GET(req: NextRequest) {
 const gate = await requireMentorAdmin(req, "content.read"); if (!gate.ok) return gate.response;
 try {
  const { data, error } = await getServiceClient().rpc("mentor_review_sample");
  if (error) return NextResponse.json({ error: "review_unavailable" }, { status: 503, headers });
  return NextResponse.json({ items: data ?? [], retention_days: 30 }, { headers });
 } catch { return NextResponse.json({ error: "review_unavailable" }, { status: 503, headers }); }
}
export async function POST(req: NextRequest) {
 const gate = await requireMentorAdmin(req, "content.moderate"); if (!gate.ok) return gate.response;
 const raw = await req.text(); if (raw.length > 1024) return NextResponse.json({ error: "invalid_input" }, { status: 400, headers });
 let parsed: ReturnType<typeof parseReviewVerdict>;
 try { parsed = parseReviewVerdict(JSON.parse(raw)); } catch { parsed = null; }
 if (!parsed) return NextResponse.json({ error: "invalid_input" }, { status: 400, headers });
 try {
  const { data, error } = await getServiceClient().rpc("mentor_review_verdict", { p_request: parsed.requestId, p_verdict: parsed.verdict, p_actor: gate.userId });
  if (error) return NextResponse.json({ error: "verdict_unavailable" }, { status: 503, headers });
  return NextResponse.json(data ? { ok: true } : { error: "not_found" }, { status: data ? 200 : 404, headers });
 } catch { return NextResponse.json({ error: "verdict_unavailable" }, { status: 503, headers }); }
}
